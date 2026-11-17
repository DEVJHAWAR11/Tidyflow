"""TidyFlow folders: sorting into them, keeping them across rescans, and the Library routes."""

import sqlite3
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import src.api as api
from src import library
from src.database import DatabaseManager
from src.models import ClassificationResult, FileRecord
from src.utils import compute_sha256


def _record(path: Path, category: str, *, skipped: bool = False) -> FileRecord:
    return FileRecord(
        file_id=f"id-{path.name}",
        abs_path=path,
        rel_path=Path(path.name),
        filename=path.name,
        extension=path.suffix,
        file_size_bytes=path.stat().st_size if path.exists() else 0,
        sha256=compute_sha256(path) if path.exists() else "",
        extracted_text_normalized=f"text of {path.name}",
        classification=ClassificationResult(category=category, confidence=0.9, reason=f"looks like {category}"),
        skipped=skipped,
    )


@pytest.fixture
def folder(tmp_path):
    root = tmp_path / "Downloads"
    root.mkdir()
    for name, body in [("bill.pdf", "electricity bill"), ("notes.txt", "dbms unit 4"), ("photo.jpg", "jpeg")]:
        (root / name).write_text(body)
    return root


@pytest.fixture
def db(tmp_path):
    return DatabaseManager(db_path=tmp_path / "tidyflow.db")


def _conn(db: DatabaseManager) -> sqlite3.Connection:
    return sqlite3.connect(db.db_path)


def test_sort_into_nested_folders_and_undo(db, folder):
    db.sync_index_records([_record(folder / "bill.pdf", "Finance/Bills"), _record(folder / "notes.txt", "College")])
    conn = _conn(db)
    info = library.sort_into_folders(conn, [
        (str(folder / "bill.pdf"), "Finance / Bills"),
        (str(folder / "notes.txt"), "College"),
        (str(folder / "not-indexed.txt"), "College"),
    ])
    conn.commit()

    rows = {f["name"]: f for f in library.folder_rows(conn)}
    assert set(rows) == {"Finance", "Bills", "College"}
    assert rows["Bills"]["parent_id"] == rows["Finance"]["id"]
    assert rows["Bills"]["count"] == 1 and rows["Finance"]["count"] == 0
    assert not rows["Bills"]["is_real"]
    assert info["sorted"] == 2
    assert library.unsorted_count(conn) == 0

    # Sorting the same file again adds nothing new.
    again = library.sort_into_folders(conn, [(str(folder / "bill.pdf"), "finance/bills")])
    assert again["links"] == [] and again["created_folders"] == [] and again["sorted"] == 1

    library.undo_sort(conn, info)
    conn.commit()
    assert library.folder_rows(conn) == []
    assert library.unsorted_count(conn) == 2


def test_disk_folder_is_linked_only_when_it_starts_empty(db, folder, tmp_path):
    db.sync_index_records([_record(folder / "bill.pdf", "Finance"), _record(folder / "notes.txt", "Finance")])
    conn = _conn(db)
    library.sort_into_folders(conn, [(str(folder / "bill.pdf"), "Finance")])
    # Finance already holds a file that isn't on disk under Organized, so it must stay a TidyFlow folder.
    info = library.sort_into_folders(conn, [(str(folder / "notes.txt"), "Finance")], disk_root=tmp_path / "Organized")
    assert info["linked_disk"] == []
    assert library.folder_rows(conn)[0]["is_real"] is False
    conn.commit()

    db.sync_index_records([_record(folder / "photo.jpg", "Photos")])
    real = library.sort_into_folders(conn, [(str(folder / "photo.jpg"), "Photos")], disk_root=tmp_path / "Organized")
    photos = next(f for f in library.folder_rows(conn) if f["name"] == "Photos")
    assert photos["is_real"] and photos["disk_path"] == str(tmp_path / "Organized" / "Photos")
    assert real["linked_disk"] == [photos["id"]]


def test_rescan_keeps_organized_place_and_folders(db, folder, tmp_path):
    bill = folder / "bill.pdf"
    db.sync_index_records([_record(bill, "Finance")])
    conn = _conn(db)
    copy = tmp_path / "Organized" / "Finance" / "bill.pdf"
    conn.execute("UPDATE files SET new_path = ?, status = 'copied' WHERE path = ?", (str(copy), str(bill)))
    library.sort_into_folders(conn, [(str(bill), "Finance")])
    conn.commit()

    db.sync_index_records([_record(bill, "Finance")])  # same contents: a plain rescan
    row = conn.execute("SELECT new_path, status, inode FROM files WHERE path = ?", (str(bill),)).fetchone()
    assert row[:2] == (str(copy), "copied")
    assert row[2] == bill.stat().st_ino
    assert library.folder_rows(conn)[0]["count"] == 1

    bill.write_text("a different bill")  # changed contents: the old organized copy no longer matches
    db.sync_index_records([_record(bill, "Finance")])
    assert conn.execute("SELECT new_path, status FROM files WHERE path = ?", (str(bill),)).fetchone() == ("", "scanned")
    assert library.folder_rows(conn)[0]["count"] == 1  # still in its TidyFlow folder


@pytest.mark.asyncio
async def test_skipped_files_get_hidden_rows(db, folder):
    db.sync_index_records([_record(folder / "photo.jpg", "Photos", skipped=True), _record(folder / "bill.pdf", "Finance")])
    conn = _conn(db)
    assert conn.execute("SELECT status FROM files WHERE path = ?", (str(folder / "photo.jpg"),)).fetchone() == ("skipped",)
    assert library.listed_count(conn) == 1
    assert library.unsorted_count(conn) == 1
    assert (await db.search_page("photo"))["results"] == []
    assert (await db.search_stats())["files"] == 1


def test_folder_page_flags_missing_files_and_clears_them(db, folder):
    db.sync_index_records([_record(folder / "bill.pdf", "Finance")])
    conn = _conn(db)
    library.sort_into_folders(conn, [(str(folder / "bill.pdf"), "Finance")])
    fid = library.folder_rows(conn)[0]["id"]

    total, files = library.folder_files_page(conn, fid)
    assert total == 1 and files[0]["missing"] is False
    assert files[0]["summary"] == "looks like Finance"
    assert files[0]["current_path"] == str(folder / "bill.pdf")

    hidden = folder / "bill.hidden"
    (folder / "bill.pdf").rename(hidden)
    _, files = library.folder_files_page(conn, fid)
    assert files[0]["missing"] is True and files[0]["current_path"] is None
    assert conn.execute("SELECT missing_since IS NOT NULL FROM files").fetchone()[0] == 1

    hidden.rename(folder / "bill.pdf")
    _, files = library.folder_files_page(conn, fid)
    assert files[0]["missing"] is False
    assert conn.execute("SELECT missing_since FROM files").fetchone()[0] is None


@pytest.fixture
def client(db, monkeypatch):
    monkeypatch.setattr(api, "db", db)
    monkeypatch.setattr(api, "latest_pipeline_data", {})
    return TestClient(api.app)


def _load_run(folder: Path, records: list[FileRecord]) -> None:
    api.latest_pipeline_data.update(records=records, input_dir=str(folder), output_dir="", summary=None, categories=[])


def test_library_mode_sorts_without_touching_disk(client, db, folder):
    records = [_record(folder / "bill.pdf", "Finance"), _record(folder / "notes.txt", "Unknown"),
               _record(folder / "photo.jpg", "Photos")]
    db.sync_index_records(records)
    _load_run(folder, records)
    before = sorted((p.name, p.read_text()) for p in folder.iterdir())

    res = client.post("/pipeline/apply-direct", json={
        "mode": "library",
        "decisions": [
            {"file_id": "id-bill.pdf"},
            {"file_id": "id-notes.txt"},  # Unknown with no choice: left unsorted
            {"file_id": "id-photo.jpg", "override_category": "Pictures/2026"},
        ],
    }).json()

    assert res["action"] == "sorted" and res["applied_count"] == 2
    assert sorted((p.name, p.read_text()) for p in folder.iterdir()) == before
    assert not (folder / "Organized_Output").exists()

    lib = client.get("/library/folders").json()
    names = {f["name"]: f for f in lib["folders"]}
    assert set(names) == {"Finance", "Pictures", "2026"}
    assert lib["unsorted_count"] == 1 and lib["total_files"] == 3

    page = client.get(f"/library/folders/{names['2026']['id']}/files").json()
    assert page["folder"]["name"] == "2026" and page["total"] == 1
    assert page["files"][0]["name"] == "photo.jpg"
    unsorted = client.get("/library/folders/unsorted/files").json()
    assert [f["name"] for f in unsorted["files"]] == ["notes.txt"]
    with sqlite3.connect(db.db_path) as conn:
        roots = conn.execute("SELECT path FROM scan_roots").fetchall()
    assert roots == [(str(folder),)]

    assert client.get("/pipeline/undo-last").json() == {"available": True, "count": 2}
    undone = client.post("/pipeline/undo-last").json()
    assert undone["restored"] == 2
    assert client.get("/library/folders").json()["folders"] == []
    assert client.get("/pipeline/undo-last").json()["available"] is False


def test_copy_mode_links_real_folders(client, db, folder, tmp_path):
    records = [_record(folder / "bill.pdf", "Finance")]
    db.sync_index_records(records)
    _load_run(folder, records)
    out = tmp_path / "Organized"

    res = client.post("/pipeline/apply-direct", json={
        "mode": "copy", "output_dir": str(out), "decisions": [{"file_id": "id-bill.pdf"}],
    }).json()

    assert res["action"] == "copied" and (out / "Finance" / "bill.pdf").exists()
    finance = client.get("/library/folders").json()["folders"][0]
    assert finance["is_real"] and finance["disk_path"] == str(out / "Finance")
    page = client.get(f"/library/folders/{finance['id']}/files").json()
    assert page["files"][0]["current_path"] == str(out / "Finance" / "bill.pdf")

    client.post("/pipeline/undo-last")
    assert not (out / "Finance" / "bill.pdf").exists()
    assert client.get("/library/folders").json()["folders"] == []


def test_unknown_folder_is_404(client):
    assert client.get("/library/folders/999/files").status_code == 404
    assert client.get("/library/folders/abc/files").status_code == 404
