"""Tests for undoing the most recent organize."""

import json
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

import src.api as api
from src.models import CopyManifestEntry
from src.utils import compute_sha256


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(api, "get_app_data_dir", lambda: tmp_path / "appdata")
    (tmp_path / "appdata").mkdir()
    return TestClient(api.app)


def _entry(orig, dest, op):
    return CopyManifestEntry(
        original_path=orig,
        destination_path=dest,
        sha256=compute_sha256(dest),
        category=dest.parent.name,
        file_type="document",
        classification_confidence=0.9,
        operation=op,
        copied_at=datetime.now(timezone.utc),
    )


def test_undo_copy_removes_copies_and_empty_folders(client, tmp_path):
    src = tmp_path / "in" / "a.txt"
    src.parent.mkdir()
    src.write_text("hello")
    dest = tmp_path / "out" / "Notes" / "a.txt"
    dest.parent.mkdir(parents=True)
    dest.write_text("hello")
    api._save_last_apply([_entry(src, dest, "copy")], tmp_path / "out")

    assert client.get("/pipeline/undo-last").json() == {"available": True, "count": 1}
    res = client.post("/pipeline/undo-last").json()

    assert res["restored"] == 1
    assert src.exists()
    assert not dest.exists()
    assert not dest.parent.exists()
    assert client.get("/pipeline/undo-last").json()["available"] is False


def test_undo_move_puts_file_back(client, tmp_path):
    orig = tmp_path / "in" / "b.txt"
    orig.parent.mkdir()
    dest = tmp_path / "out" / "Docs" / "b.txt"
    dest.parent.mkdir(parents=True)
    dest.write_text("moved")
    api._save_last_apply([_entry(orig, dest, "move")], tmp_path / "out")

    res = client.post("/pipeline/undo-last").json()

    assert res["restored"] == 1
    assert orig.read_text() == "moved"
    assert not dest.exists()


def test_undo_skips_files_changed_since(client, tmp_path):
    src = tmp_path / "c.txt"
    src.write_text("orig")
    dest = tmp_path / "out" / "X" / "c.txt"
    dest.parent.mkdir(parents=True)
    dest.write_text("orig")
    api._save_last_apply([_entry(src, dest, "copy")], tmp_path / "out")
    dest.write_text("user edited this")

    res = client.post("/pipeline/undo-last").json()

    assert res == {"status": "success", "restored": 0, "skipped": 1}
    assert dest.exists()


def test_undo_with_nothing_to_undo(client):
    assert client.post("/pipeline/undo-last").status_code == 400


def test_undo_removes_empty_nested_folders_but_keeps_output_root(client, tmp_path):
    src = tmp_path / "in" / "d.txt"
    src.parent.mkdir()
    src.write_text("x")
    out = tmp_path / "out"
    dest = out / "Finance" / "Invoices" / "d.txt"
    dest.parent.mkdir(parents=True)
    dest.write_text("x")
    keep = out / "Media" / "keep.png"
    keep.parent.mkdir()
    keep.write_text("not ours")
    api._save_last_apply([_entry(src, dest, "copy")], out)

    client.post("/pipeline/undo-last")

    assert not (out / "Finance").exists()
    assert keep.exists()
    assert out.exists()


def test_undo_removes_output_folder_it_created(client, tmp_path):
    src = tmp_path / "in" / "e.txt"
    src.parent.mkdir()
    src.write_text("e")
    out = tmp_path / "Organized"
    dest = out / "Notes" / "e.txt"
    dest.parent.mkdir(parents=True)
    dest.write_text("e")
    api._save_last_apply([_entry(src, dest, "copy")], out, created_output_dir=True)

    client.post("/pipeline/undo-last")

    assert not out.exists()
    assert src.exists()


def test_undo_keeps_output_folder_that_already_existed(client, tmp_path):
    src = tmp_path / "in" / "f.txt"
    src.parent.mkdir()
    src.write_text("f")
    out = tmp_path / "Organized"
    dest = out / "Notes" / "f.txt"
    dest.parent.mkdir(parents=True)
    dest.write_text("f")
    api._save_last_apply([_entry(src, dest, "copy")], out, created_output_dir=False)

    client.post("/pipeline/undo-last")

    assert out.exists()


def test_clear_forgets_latest_run_but_keeps_undo(client, tmp_path):
    src = tmp_path / "in" / "g.txt"
    src.parent.mkdir()
    src.write_text("g")
    dest = tmp_path / "out" / "Notes" / "g.txt"
    dest.parent.mkdir(parents=True)
    dest.write_text("g")
    api._save_last_apply([_entry(src, dest, "copy")], tmp_path / "out")
    api.latest_pipeline_data["input_dir"] = str(src.parent)
    api._save_latest_run()
    assert api._latest_run_dir().exists()

    assert client.post("/pipeline/clear").json() == {"status": "cleared"}

    assert not api._latest_run_dir().exists()
    latest = client.get("/pipeline/latest").json()
    assert latest["files"] == [] and latest["input_dir"] == ""
    assert client.get("/pipeline/undo-last").json()["available"] is True


def test_search_points_at_current_location_and_drops_missing_files(client, tmp_path, monkeypatch):
    here = tmp_path / "invoice.txt"
    here.write_text("invoice")
    rows = [
        # Organized, then undone: the copy is gone but the original is back.
        {"id": 1, "path": str(here), "new_path": str(tmp_path / "Organized" / "invoice.txt")},
        # Deleted everywhere.
        {"id": 2, "path": str(tmp_path / "gone.txt"), "new_path": None},
    ]
    deleted = []

    async def fake_search(q):
        return rows

    async def fake_write(query, params=()):
        deleted.append(params[0])

    monkeypatch.setattr(api.db, "search", fake_search)
    monkeypatch.setattr(api.db, "execute_write", fake_write)

    results = client.get("/search", params={"q": "invoice"}).json()["results"]

    assert [r["id"] for r in results] == [1]
    assert results[0]["new_path"] is None
    assert deleted == [2]


def test_folder_plans_are_kept_apart_and_never_touch_config(client, tmp_path):
    cfg = tmp_path / "appdata" / "config.yaml"
    cfg.write_text("categories:\n  Defaults:\n    description: d\n")
    a, b = str(tmp_path / "A"), str(tmp_path / "B")

    client.post("/categories", json={"folder": a, "categories": {"Invoices": {"description": "x"}}})
    client.post("/categories", json={"folder": b, "categories": {"Photos": {"description": "y"}}})

    assert list(client.get("/categories", params={"folder": a}).json()["categories"]) == ["Invoices"]
    assert list(client.get("/categories", params={"folder": b}).json()["categories"]) == ["Photos"]
    assert client.get("/categories", params={"folder": str(tmp_path / "C")}).json()["categories"] == {}
    assert "Defaults" in cfg.read_text()

    client.post("/pipeline/clear", params={"folder": a})
    assert client.get("/categories", params={"folder": a}).json()["categories"] == {}
    assert list(client.get("/categories", params={"folder": b}).json()["categories"]) == ["Photos"]
