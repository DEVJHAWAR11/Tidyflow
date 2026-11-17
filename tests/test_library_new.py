"""New since last time: finding new files, following renamed and moved ones, suggesting and sorting."""

import sqlite3
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import src.api as api
from src import library, library_new
from src.database import DatabaseManager
from src.models import ClassificationResult

from test_library import _record


@pytest.fixture
def home(tmp_path):
    root = tmp_path / "Downloads"
    root.mkdir()
    for name, body in [("bill.pdf", "electricity bill"), ("notes.txt", "dbms unit 4")]:
        (root / name).write_text(body)
    return root


@pytest.fixture
def db(tmp_path, home):
    manager = DatabaseManager(db_path=tmp_path / "tidyflow.db")
    manager.sync_index_records([_record(p, "Unknown") for p in sorted(home.iterdir())])
    with sqlite3.connect(manager.db_path) as conn:
        library.add_scan_root(conn, home)
        library.sort_into_folders(conn, [(str(home / "bill.pdf"), "Finance/Bills")])
        conn.execute("UPDATE scan_roots SET last_checked_at = '2026-11-01 09:00:00'")
    return manager


@pytest.fixture
def conn(db):
    c = sqlite3.connect(db.db_path)
    yield c
    c.close()


def test_check_finds_only_files_it_has_not_seen(conn, home):
    (home / "resume.pdf").write_text("resume")
    (home / ".hidden").write_text("x")
    (home / "Organized_Output").mkdir()
    (home / "Organized_Output" / "copy.pdf").write_text("an organized copy")
    (home / "sub").mkdir()
    (home / "sub" / "photo.jpg").write_text("jpeg")
    skipped = home / "skipped.bin"
    skipped.write_text("x")
    conn.execute("INSERT INTO files (path, status) VALUES (?, 'skipped')", (str(skipped),))

    result = library_new.check_new(conn)
    assert sorted(f["name"] for f in result["new"]) == ["photo.jpg", "resume.pdf"]
    assert result["total_new"] == 2 and result["followed"] == 0 and result["missing"] == 0
    assert result["roots"][0]["last_checked_at"] == "2026-11-01 09:00:00"  # when it was checked before
    assert conn.execute("SELECT last_checked_at FROM scan_roots").fetchone()[0] != "2026-11-01 09:00:00"


def test_a_file_renamed_in_finder_keeps_its_row_and_folders(conn, home):
    bill_id = conn.execute("SELECT id FROM files WHERE path = ?", (str(home / "bill.pdf"),)).fetchone()[0]
    (home / "bill.pdf").rename(home / "October bill.pdf")

    result = library_new.check_new(conn)
    assert result["new"] == [] and result["followed"] == 1
    assert conn.execute("SELECT path FROM files WHERE id = ?", (bill_id,)).fetchone()[0] == str(home / "October bill.pdf")
    assert {f["name"]: f["count"] for f in library.folder_rows(conn)}["Bills"] == 1


def test_a_file_copied_back_is_matched_by_its_contents(conn, home):
    notes_id = conn.execute("SELECT id FROM files WHERE path = ?", (str(home / "notes.txt"),)).fetchone()[0]
    (home / "notes.txt").unlink()
    (home / "sub").mkdir()
    (home / "sub" / "dbms.txt").write_text("dbms unit 4")  # a new inode, the same bytes

    result = library_new.check_new(conn)
    assert result["new"] == [] and result["followed"] == 1
    assert conn.execute("SELECT path FROM files WHERE id = ?", (notes_id,)).fetchone()[0] == str(home / "sub" / "dbms.txt")


def test_a_file_that_is_gone_is_marked_missing(conn, home):
    (home / "notes.txt").unlink()
    result = library_new.check_new(conn)
    assert result["missing"] == 1
    assert conn.execute("SELECT missing_since IS NOT NULL FROM files WHERE path LIKE '%notes.txt'").fetchone()[0] == 1


def test_folder_categories_describe_the_folders_with_examples(conn):
    cats = library_new.folder_categories(conn, {"Finance": {"description": "Money things", "keywords": ["bank"]}})
    assert set(cats) == {"Finance", "Finance/Bills"}
    assert "bill.pdf" in cats["Finance/Bills"]["description"]
    assert cats["Finance"]["description"].startswith("Money things") and cats["Finance"]["keywords"] == ["bank", "finance"]
    assert cats["Finance/Bills"]["keywords"] == ["bills", "bill"]


@pytest.fixture
def client(db, monkeypatch):
    monkeypatch.setattr(api, "db", db)
    monkeypatch.setattr(api, "latest_pipeline_data", {})
    monkeypatch.setattr(api, "_new_check", {})
    monkeypatch.setattr(api, "ai_enabled", lambda: False)
    return TestClient(api.app)


def test_suggest_and_sort_new_files_then_undo(client, db, home, monkeypatch):
    (home / "airtel-bill.pdf").write_text("airtel bill")
    (home / "random.bin").write_text("??")
    seen = {}

    def fake_pipeline(cfg, *, use_llm, db, strict_mode, cancellation_token, only_paths):
        seen.update(categories=set(cfg.categories), strict=strict_mode, paths=sorted(p.name for p in only_paths))
        records = []
        for p in only_paths:
            rec = _record(p, "finance/bills" if "bill" in p.name else "Unknown")
            records.append(rec)
        db.sync_index_records(records)
        return records, None

    monkeypatch.setattr(api, "run_pipeline", fake_pipeline)
    status = client.get("/library/new").json()
    assert status["total_new"] == 2

    res = client.post("/library/new/suggest", json={"paths": [f["path"] for f in status["new"]]}).json()
    assert seen == {"categories": {"Finance", "Finance/Bills"}, "strict": True, "paths": ["airtel-bill.pdf", "random.bin"]}
    suggestions = {f["name"]: f["suggestion"] for f in res["files"]}
    assert suggestions == {"airtel-bill.pdf": "Finance/Bills", "random.bin": None}
    assert client.get("/library/new").json()["total_new"] == 0  # read now, so no longer new

    items = [{"id": f["id"], "folder": f["suggestion"]} for f in res["files"]]
    assert client.post("/library/new/sort", json={"items": items}).json() == {"sorted": 1}
    bills = next(f for f in client.get("/library/folders").json()["folders"] if f["name"] == "Bills")
    assert bills["count"] == 2

    assert client.post("/library/undo").json()["undone"] == "Sorted 1 new file"
    bills = next(f for f in client.get("/library/folders").json()["folders"] if f["name"] == "Bills")
    assert bills["count"] == 1


def test_suggest_refuses_files_outside_scanned_folders(client, tmp_path):
    other = tmp_path / "elsewhere.txt"
    other.write_text("x")
    assert client.post("/library/new/suggest", json={"paths": [str(other)]}).status_code == 400


def test_an_exact_keyword_hit_is_a_fallback_suggestion():
    pick = library_new.exact_keyword_folder
    assert pick({"Finance": 100.0, "Finance/Bills": 100.0, "Career": 66.7}) == "Finance/Bills"
    assert pick({"Finance/Bills": 100.0, "College": 100.0}) is None
    assert pick({"Career": 66.7}) is None and pick(None) is None
