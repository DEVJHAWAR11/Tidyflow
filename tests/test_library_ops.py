"""Library actions: folders, paste and remove, renames and moves on disk, Trash, and Undo."""

import sqlite3
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import src.api as api
from src import library, library_ops
from src.database import DatabaseManager
from src.library_ops import LibraryError

from test_library import _record


@pytest.fixture
def home(tmp_path):
    root = tmp_path / "Downloads"
    root.mkdir()
    for name, body in [("bill.pdf", "electricity bill"), ("notes.txt", "dbms unit 4"), ("photo.jpg", "jpeg")]:
        (root / name).write_text(body)
    return root


@pytest.fixture
def db(tmp_path, home):
    manager = DatabaseManager(db_path=tmp_path / "tidyflow.db")
    manager.sync_index_records([_record(p, "Unknown") for p in sorted(home.iterdir())])
    return manager


@pytest.fixture
def conn(db):
    c = sqlite3.connect(db.db_path)
    yield c
    c.close()


def _id(conn, path: Path) -> int:
    return conn.execute("SELECT id FROM files WHERE path = ? OR new_path = ?", (str(path), str(path))).fetchone()[0]


def _members(conn, folder_id: int) -> set[int]:
    return {r[0] for r in conn.execute("SELECT file_row_id FROM folder_files WHERE folder_id = ?", (folder_id,))}


def _folders(conn) -> dict[str, dict]:
    return {f["name"]: f for f in library.folder_rows(conn)}


def test_folder_create_rename_move_delete_and_undo(conn, home):
    finance = library_ops.create_folder(conn, "Finance")
    bills = library_ops.create_folder(conn, " Bills ", finance["id"])
    assert bills["name"] == "Bills" and bills["parent_id"] == finance["id"]
    with pytest.raises(LibraryError) as err:
        library_ops.create_folder(conn, "finance")
    assert err.value.status == 409
    with pytest.raises(LibraryError):
        library_ops.create_folder(conn, "a/b")
    with pytest.raises(LibraryError, match="inside itself"):
        library_ops.update_folder(conn, finance["id"], parent_id=bills["id"], change_parent=True)

    library_ops.update_folder(conn, bills["id"], name="Utility bills")
    library_ops.update_folder(conn, bills["id"], parent_id=None, change_parent=True)
    assert _folders(conn)["Utility bills"]["parent_id"] is None

    bill = _id(conn, home / "bill.pdf")
    library_ops.paste(conn, [bill], finance["id"])
    child = library_ops.create_folder(conn, "2026", finance["id"])
    result = library_ops.delete_folder(conn, finance["id"])
    assert result == {"deleted_folders": 2, "files_unsorted": 1}
    assert set(_folders(conn)) == {"Utility bills"}

    assert library_ops.undo_last(conn)["kind"] == "delete_folder"
    restored = _folders(conn)
    assert restored["Finance"]["id"] == finance["id"] and restored["2026"]["id"] == child["id"]
    assert _members(conn, finance["id"]) == {bill}

    library_ops.undo_last(conn)  # the "2026" folder
    library_ops.undo_last(conn)  # the paste
    library_ops.undo_last(conn)  # moving Bills to the top
    library_ops.undo_last(conn)  # the rename
    assert _folders(conn)["Bills"]["parent_id"] == finance["id"]
    library_ops.undo_last(conn)
    library_ops.undo_last(conn)
    assert library.folder_rows(conn) == []
    with pytest.raises(LibraryError, match="nothing to undo"):
        library_ops.undo_last(conn)


def test_paste_cut_remove_change_only_the_database(conn, home):
    a = library_ops.create_folder(conn, "A")["id"]
    b = library_ops.create_folder(conn, "B")["id"]
    ids = [_id(conn, home / "bill.pdf"), _id(conn, home / "notes.txt")]
    before = sorted(p.name for p in home.iterdir())

    library_ops.paste(conn, ids, a, op="copy")
    library_ops.paste(conn, ids, b, op="copy")
    assert _members(conn, a) == _members(conn, b) == set(ids)  # a file can be in two folders
    library_ops.paste(conn, ids[:1], b, op="cut", from_folder_id=a)
    assert _members(conn, a) == {ids[1]}
    library_ops.remove_from_folder(conn, [ids[1]], a)
    assert _members(conn, a) == set()
    assert sorted(p.name for p in home.iterdir()) == before

    library_ops.undo_last(conn)
    library_ops.undo_last(conn)
    assert _members(conn, a) == set(ids)
    assert [h["label"] for h in library_ops.history(conn)][:2] == ["Added 2 files to B", "Added 2 files to A"]


def test_paste_into_a_real_folder_asks_for_a_disk_move(conn, home, tmp_path):
    real = tmp_path / "Organized" / "Finance"
    real.mkdir(parents=True)
    fid = library_ops.create_folder(conn, "Finance")["id"]
    conn.execute("UPDATE folders SET disk_path = ? WHERE id = ?", (str(real), fid))
    bill = _id(conn, home / "bill.pdf")

    result = library_ops.paste(conn, [bill], fid)
    assert result == {"needs_disk_move": True, "dest_dir": str(real), "count": 1}
    assert _members(conn, fid) == set()

    moved = library_ops.move_on_disk(conn, [bill], str(real), to_folder_id=fid)
    assert moved["moved"] == 1 and (real / "bill.pdf").exists() and not (home / "bill.pdf").exists()
    assert _members(conn, fid) == {bill} and _folders(conn)["Finance"]["is_real"]


def test_rename_file_on_disk_and_undo(conn, home):
    bill = _id(conn, home / "bill.pdf")
    with pytest.raises(LibraryError, match="already a file"):
        library_ops.rename_file(conn, bill, "notes.txt")
    library_ops.rename_file(conn, bill, "October bill.pdf")
    new = home / "October bill.pdf"
    assert new.exists() and not (home / "bill.pdf").exists()
    path, inode = conn.execute("SELECT path, inode FROM files WHERE id = ?", (bill,)).fetchone()
    assert path == str(new) and inode == new.stat().st_ino

    library_ops.undo_last(conn)
    assert (home / "bill.pdf").exists() and not new.exists()
    assert conn.execute("SELECT path FROM files WHERE id = ?", (bill,)).fetchone()[0] == str(home / "bill.pdf")


def test_move_on_disk_unmakes_real_folders_and_undo_refuses_changed_files(conn, home, tmp_path):
    real = tmp_path / "Organized" / "Notes"
    real.mkdir(parents=True)
    notes = _id(conn, home / "notes.txt")
    fid = library_ops.create_folder(conn, "Notes")["id"]
    library_ops.move_on_disk(conn, [notes], str(real), to_folder_id=fid)
    conn.execute("UPDATE folders SET disk_path = ? WHERE id = ?", (str(real), fid))
    assert _folders(conn)["Notes"]["is_real"]

    elsewhere = tmp_path / "Elsewhere"
    elsewhere.mkdir()
    (elsewhere / "notes.txt").write_text("already here")  # forces "notes (2).txt"
    result = library_ops.move_on_disk(conn, [notes], str(elsewhere))
    assert result["unreal_folders"] == [fid]
    assert (elsewhere / "notes (2).txt").read_text() == "dbms unit 4"
    assert not _folders(conn)["Notes"]["is_real"]  # its file isn't in its disk folder any more

    (elsewhere / "notes (2).txt").write_text("edited since")
    with pytest.raises(LibraryError, match="changed or moved since"):
        library_ops.undo_last(conn)
    assert (elsewhere / "notes (2).txt").exists()


def test_move_on_disk_undo_restores_place_and_realness(conn, home, tmp_path):
    real = tmp_path / "Real"
    real.mkdir()
    photo = _id(conn, home / "photo.jpg")
    fid = library_ops.create_folder(conn, "Photos")["id"]
    library_ops.make_real(conn, fid, str(tmp_path))  # empty folder: just linked
    out = tmp_path / "Out"
    out.mkdir()
    library_ops.paste(conn, [photo], fid)  # not in Photos/ on disk: asks for a move
    library_ops.move_on_disk(conn, [photo], str(tmp_path / "Photos"), to_folder_id=fid)
    assert _folders(conn)["Photos"]["is_real"]

    library_ops.move_on_disk(conn, [photo], str(out))
    assert not _folders(conn)["Photos"]["is_real"]
    library_ops.undo_last(conn)
    assert (tmp_path / "Photos" / "photo.jpg").exists() and not (out / "photo.jpg").exists()
    assert _folders(conn)["Photos"]["is_real"]


def test_make_real_moves_every_file_and_undo_puts_them_back(conn, home, tmp_path):
    fid = library_ops.create_folder(conn, "College")["id"]
    ids = [_id(conn, home / "notes.txt"), _id(conn, home / "bill.pdf")]
    library_ops.paste(conn, ids, fid)
    dest_parent = tmp_path / "Documents"
    dest_parent.mkdir()

    result = library_ops.make_real(conn, fid, str(dest_parent))
    folder = dest_parent / "College"
    assert result == {"moved": 2, "disk_path": str(folder)}
    assert sorted(p.name for p in folder.iterdir()) == ["bill.pdf", "notes.txt"]
    assert _folders(conn)["College"]["disk_path"] == str(folder)
    page = library.folder_files_page(conn, fid)[1]
    assert {f["current_path"] for f in page} == {str(folder / "bill.pdf"), str(folder / "notes.txt")}

    library_ops.undo_last(conn)
    assert (home / "notes.txt").exists() and (home / "bill.pdf").exists()
    assert not folder.exists()  # TidyFlow made it, and it's empty again
    assert not _folders(conn)["College"]["is_real"]


def test_make_real_refuses_missing_files_and_rolls_back_a_failed_move(conn, home, tmp_path, monkeypatch):
    fid = library_ops.create_folder(conn, "Mixed")["id"]
    ids = [_id(conn, home / "notes.txt"), _id(conn, home / "bill.pdf"), _id(conn, home / "photo.jpg")]
    library_ops.paste(conn, ids, fid)

    (home / "photo.jpg").unlink()
    with pytest.raises(LibraryError, match="can't find 1 file"):
        library_ops.make_real(conn, fid, str(tmp_path))
    assert not (tmp_path / "Mixed").exists()
    library_ops.remove_from_folder(conn, [ids[2]], fid)

    real_move = library_ops._move_file
    calls = []

    def flaky(src, dest):
        calls.append(src)
        if len(calls) == 2:
            raise OSError("disk full")
        real_move(src, dest)

    monkeypatch.setattr(library_ops, "_move_file", flaky)
    with pytest.raises(LibraryError, match="Nothing was changed"):
        library_ops.make_real(conn, fid, str(tmp_path))
    assert (home / "notes.txt").exists() and (home / "bill.pdf").exists()
    assert not (tmp_path / "Mixed").exists()
    assert not _folders(conn)["Mixed"]["is_real"]


def test_renaming_a_real_folder_renames_it_on_disk(conn, home, tmp_path):
    fid = library_ops.create_folder(conn, "Bills")["id"]
    library_ops.paste(conn, [_id(conn, home / "bill.pdf")], fid)
    library_ops.make_real(conn, fid, str(tmp_path))

    library_ops.update_folder(conn, fid, name="Utility bills")
    renamed = tmp_path / "Utility bills"
    assert (renamed / "bill.pdf").exists() and not (tmp_path / "Bills").exists()
    assert _folders(conn)["Utility bills"]["disk_path"] == str(renamed)
    assert conn.execute("SELECT path FROM files WHERE path LIKE '%bill.pdf'").fetchone()[0] == str(renamed / "bill.pdf")

    library_ops.undo_last(conn)
    assert (tmp_path / "Bills" / "bill.pdf").exists()
    assert _folders(conn)["Bills"]["disk_path"] == str(tmp_path / "Bills")


def test_trash_keeps_the_original_of_an_organized_copy(conn, home, tmp_path, monkeypatch):
    bin_dir = tmp_path / "Trash"
    bin_dir.mkdir()
    monkeypatch.setattr(library_ops, "_send_to_trash", lambda p: p.rename(bin_dir / p.name))

    copy = tmp_path / "Organized" / "bill.pdf"
    copy.parent.mkdir()
    copy.write_text("electricity bill")
    bill = _id(conn, home / "bill.pdf")
    conn.execute("UPDATE files SET new_path = ?, status = 'copied' WHERE id = ?", (str(copy), bill))
    fid = library_ops.create_folder(conn, "Finance")["id"]
    library_ops.paste(conn, [bill], fid)
    notes = _id(conn, home / "notes.txt")
    (home / "photo.jpg").unlink()
    photo = _id(conn, home / "photo.jpg")

    result = library_ops.trash(conn, [bill, notes, photo])
    assert result == {"trashed": 2, "forgotten": 1}
    assert (bin_dir / "bill.pdf").exists() and (bin_dir / "notes.txt").exists()
    assert conn.execute("SELECT new_path, status FROM files WHERE id = ?", (bill,)).fetchone() == ("", "scanned")
    assert _members(conn, fid) == set()  # the original is back in "Not sorted yet"
    assert conn.execute("SELECT COUNT(*) FROM files WHERE id IN (?, ?)", (notes, photo)).fetchone()[0] == 0


@pytest.fixture
def client(db, monkeypatch):
    monkeypatch.setattr(api, "db", db)
    monkeypatch.setattr(api, "latest_pipeline_data", {})
    return TestClient(api.app)


def test_library_action_routes(client, db, home, monkeypatch):
    created = client.post("/library/folders", json={"name": "Finance"}).json()
    assert client.post("/library/folders", json={"name": "finance"}).status_code == 409
    with sqlite3.connect(db.db_path) as c:
        bill = _id(c, home / "bill.pdf")

    assert client.post("/library/paste", json={"file_ids": [bill], "to_folder_id": created["id"]}).json() == {
        "needs_disk_move": False, "count": 1,
    }
    assert client.patch(f"/library/folders/{created['id']}", json={"name": "Money"}).json()["name"] == "Money"
    assert client.post("/library/rename-file", json={"file_id": bill, "new_name": "x.pdf"}).status_code == 200
    assert (home / "x.pdf").exists()
    assert [a["label"] for a in client.get("/library/history").json()["actions"]][0] == "Renamed bill.pdf to x.pdf"
    assert client.post("/library/undo").json()["undone"] == "Renamed bill.pdf to x.pdf"
    assert client.post("/library/paste", json={"file_ids": [99999], "to_folder_id": created["id"]}).status_code == 404

    monkeypatch.setattr(api, "active_cancel_event", object())  # a sort is running
    res = client.post("/library/rename-file", json={"file_id": bill, "new_name": "y.pdf"})
    assert res.status_code == 409 and "sorting" in res.json()["detail"]
    assert client.post("/library/remove", json={"file_ids": [bill], "folder_id": created["id"]}).status_code == 200
