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
