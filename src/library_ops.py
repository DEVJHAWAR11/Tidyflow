"""What people do in the Library: folder and file actions, each logged so it can be undone.

Actions on TidyFlow folders (new, rename, delete, paste, remove) change only the database. Actions
that touch the disk (rename a file, move on disk, make a folder real, Trash) move files the safe way
and record where each went, so Undo can put them back if they haven't changed since.

Every function takes an open ``sqlite3.Connection`` and leaves committing to the caller; a refused
action raises ``LibraryError`` before it changes anything.
"""

from __future__ import annotations

import json
import os
import sqlite3
import sys
from pathlib import Path
from typing import Iterable, Optional

from .applier import place_file
from . import library_rules
from .library import folder_rows, undo_sort
from .utils import compute_sha256

# How many past actions Undo can reach.
HISTORY_LIMIT = 100


class LibraryError(Exception):
    """An action that can't be done, with a message to show as it is."""

    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.message = message
        self.status = status


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _plural(n: int, one: str, many: str = "") -> str:
    return f"{n} {one if n == 1 else (many or one + 's')}"


def clean_name(name: str, what: str = "name") -> str:
    """A file or folder name as typed, refused if it can't be one name on disk."""
    cleaned = (name or "").strip()
    if not cleaned:
        raise LibraryError(f"Type a {what}.")
    if cleaned in (".", "..") or any(c in cleaned for c in "/\\\0:"):
        raise LibraryError(f"A {what} can't contain / \\ or :.")
    if len(cleaned.encode()) > 255:
        raise LibraryError(f"That {what} is too long.")
    return cleaned


def _folder(conn: sqlite3.Connection, folder_id: int) -> dict:
    rows = folder_rows(conn, only_id=folder_id)
    if not rows:
        raise LibraryError("That folder doesn't exist any more.", 404)
    return rows[0]


def _name_taken(conn: sqlite3.Connection, parent_id: Optional[int], name: str, except_id: int = 0) -> bool:
    return conn.execute(
        "SELECT 1 FROM folders WHERE COALESCE(parent_id, 0) = ? AND name = ? COLLATE NOCASE AND id != ?",
        (parent_id or 0, name, except_id),
    ).fetchone() is not None


def _files(conn: sqlite3.Connection, file_ids: Iterable[int]) -> list[dict]:
    ids = list(dict.fromkeys(int(i) for i in file_ids))
    if not ids:
        raise LibraryError("Pick at least one file.")
    marks = ",".join("?" * len(ids))
    rows = conn.execute(f"SELECT id, path, new_path FROM files WHERE id IN ({marks})", ids).fetchall()
    found = {r[0]: {"id": r[0], "path": r[1], "new_path": r[2] or ""} for r in rows}
    if len(found) != len(ids):
        raise LibraryError("Some of those files aren't in TidyFlow any more. Reload the Library.", 404)
    return [found[i] for i in ids]


def _location(row: dict) -> Optional[tuple[str, Path]]:
    """Which column holds where the file really is now, and that path; None if it can't be found."""
    for col in ("new_path", "path"):
        if row[col] and Path(row[col]).is_file():
            return col, Path(row[col])
    return None


def _signature(path: Path) -> list[int]:
    """Size and modified time: enough to tell whether a file was changed after we moved it."""
    st = path.stat()
    return [st.st_size, st.st_mtime_ns]


def _free_path(folder: Path, name: str, taken: set[str]) -> Path:
    """``folder/name``, or ``name (2)`` and so on when that is already used on disk or in this batch."""
    stem, suffix = Path(name).stem, Path(name).suffix
    candidate, n = folder / name, 2
    while candidate.exists() or str(candidate).lower() in taken:
        candidate = folder / f"{stem} ({n}){suffix}"
        n += 1
    taken.add(str(candidate).lower())
    return candidate


def _move_file(src: Path, dest: Path) -> None:
    """Move one file, checking a cross-disk copy before the original is removed."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    how = place_file(src, dest, move=True)
    if how == "renamed":
        return
    if how == "copied" and compute_sha256(src) != compute_sha256(dest):
        dest.unlink(missing_ok=True)
        raise LibraryError(f"Couldn't move {src.name}: the copy didn't match the original, so it was left where it was.")
    src.unlink()


def _set_location(conn: sqlite3.Connection, row_id: int, col: str, path: Path) -> None:
    if col == "path":
        clash = conn.execute("SELECT 1 FROM files WHERE path = ? AND id != ?", (str(path), row_id)).fetchone()
        if clash:
            # A stale row for a file that used to be here: the file now here is this one.
            conn.execute("DELETE FROM files WHERE path = ? AND id != ?", (str(path), row_id))
    try:
        st = path.stat()
        dev, ino = st.st_dev, st.st_ino
    except OSError:
        dev = ino = None
    if col == "path":
        conn.execute(
            "UPDATE files SET path = ?, dev = ?, inode = ?, missing_since = NULL WHERE id = ?",
            (str(path), dev, ino, row_id),
        )
    else:
        conn.execute("UPDATE files SET new_path = ?, missing_since = NULL WHERE id = ?", (str(path), row_id))


def _log(conn: sqlite3.Connection, kind: str, label: str, payload: dict) -> int:
    op_id = conn.execute(
        "INSERT INTO library_ops (kind, payload) VALUES (?, ?)",
        (kind, json.dumps({"label": label, **payload})),
    ).lastrowid
    conn.execute(
        "DELETE FROM library_ops WHERE id NOT IN (SELECT id FROM library_ops ORDER BY id DESC LIMIT ?)",
        (HISTORY_LIMIT,),
    )
    return op_id


def _add_members(conn: sqlite3.Connection, file_ids: list[int], folder_id: int) -> list[list]:
    added = []
    for fid in file_ids:
        if conn.execute(
            "INSERT OR IGNORE INTO folder_files (folder_id, file_row_id) VALUES (?, ?)", (folder_id, fid)
        ).rowcount:
            added.append([fid, folder_id])
    return added


def _remove_members(conn: sqlite3.Connection, file_ids: list[int], folder_id: int) -> list[list]:
    removed = []
    for fid in file_ids:
        row = conn.execute(
            "SELECT added_at FROM folder_files WHERE folder_id = ? AND file_row_id = ?", (folder_id, fid)
        ).fetchone()
        if row:
            conn.execute("DELETE FROM folder_files WHERE folder_id = ? AND file_row_id = ?", (folder_id, fid))
            removed.append([fid, folder_id, row[0]])
    return removed


def _undo_members(conn: sqlite3.Connection, added: list, removed: list) -> None:
    for fid, folder_id in added:
        conn.execute("DELETE FROM folder_files WHERE folder_id = ? AND file_row_id = ?", (folder_id, fid))
    for fid, folder_id, added_at in removed:
        if conn.execute("SELECT 1 FROM files WHERE id = ?", (fid,)).fetchone() and conn.execute(
            "SELECT 1 FROM folders WHERE id = ?", (folder_id,)
        ).fetchone():
            conn.execute(
                "INSERT OR IGNORE INTO folder_files (folder_id, file_row_id, added_at) VALUES (?, ?, ?)",
                (folder_id, fid, added_at),
            )


def _repath_prefix(conn: sqlite3.Connection, old_dir: str, new_dir: str) -> None:
    """After a disk folder is renamed, point every path inside it at the new name."""
    old_prefix = old_dir.rstrip(os.sep) + os.sep
    new_prefix = new_dir.rstrip(os.sep) + os.sep
    n = len(old_prefix)
    for col in ("path", "new_path"):
        conn.execute(
            f"UPDATE files SET {col} = ? || substr({col}, ?) WHERE substr({col}, 1, ?) = ?",
            (new_prefix, n + 1, n, old_prefix),
        )
    conn.execute("UPDATE folders SET disk_path = ? WHERE disk_path = ?", (new_dir, old_dir))
    conn.execute(
        "UPDATE folders SET disk_path = ? || substr(disk_path, ?) WHERE substr(disk_path, 1, ?) = ?",
        (new_prefix, n + 1, n, old_prefix),
    )


def _no_longer_real(conn: sqlite3.Connection, moved: dict[int, Path]) -> list[list]:
    """Real folders that a moved file belongs to but no longer sits in stop being real."""
    changed = []
    for row_id, dest in moved.items():
        for folder_id, disk_path in conn.execute(
            "SELECT folders.id, folders.disk_path FROM folder_files JOIN folders ON folders.id = folder_files.folder_id "
            "WHERE folder_files.file_row_id = ? AND folders.disk_path IS NOT NULL",
            (row_id,),
        ).fetchall():
            if Path(disk_path) != dest.parent:
                conn.execute("UPDATE folders SET disk_path = NULL WHERE id = ?", (folder_id,))
                changed.append([folder_id, disk_path, None])
    return changed


def _move_batch(conn: sqlite3.Connection, rows: list[dict], dest_dir: Path) -> tuple[list[dict], dict[int, Path]]:
    """Move each file into ``dest_dir``; all or nothing. Returns the moves (for Undo) and where each went."""
    plans: list[tuple[dict, str, Path, Path]] = []
    taken: set[str] = set()
    missing = []
    for row in rows:
        where = _location(row)
        if where is None:
            missing.append(Path(row["new_path"] or row["path"]).name)
            continue
        col, src = where
        if src.parent == dest_dir:
            continue  # already there
        plans.append((row, col, src, _free_path(dest_dir, src.name, taken)))
    if missing:
        raise LibraryError(
            f"TidyFlow can't find {_plural(len(missing), 'file')} ({', '.join(missing[:3])}). "
            "Remove them from the folder first."
        )
    done: list[tuple[Path, Path]] = []
    try:
        for _, _, src, dest in plans:
            _move_file(src, dest)
            done.append((src, dest))
    except Exception as exc:
        for src, dest in reversed(done):
            try:
                _move_file(dest, src)
            except Exception:
                pass
        if isinstance(exc, LibraryError):
            raise
        raise LibraryError(f"Couldn't move the files: {exc}. Nothing was changed.") from exc
    moves, placed = [], {}
    for row, col, src, dest in plans:
        _set_location(conn, row["id"], col, dest)
        moves.append({"row": row["id"], "col": col, "from": str(src), "to": str(dest), "sig": _signature(dest)})
        placed[row["id"]] = dest
    return moves, placed


# ---------------------------------------------------------------------------
# Folder actions (database only, except renaming a real folder)
# ---------------------------------------------------------------------------


def create_folder(conn: sqlite3.Connection, name: str, parent_id: Optional[int] = None) -> dict:
    name = clean_name(name, "folder name")
    if parent_id is not None:
        _folder(conn, parent_id)
    if _name_taken(conn, parent_id, name):
        raise LibraryError(f"There's already a folder called {name} here.", 409)
    folder_id = conn.execute("INSERT INTO folders (name, parent_id) VALUES (?, ?)", (name, parent_id)).lastrowid
    _log(conn, "create_folder", f"New folder {name}", {"folder_id": folder_id})
    return _folder(conn, folder_id)


def update_folder(
    conn: sqlite3.Connection, folder_id: int, *, name: Optional[str] = None, parent_id: Optional[int] = None,
    change_parent: bool = False,
) -> dict:
    """Rename a folder or put it in another one. Renaming a real folder renames it on disk too."""
    folder = _folder(conn, folder_id)
    new_name = clean_name(name, "folder name") if name is not None else folder["name"]
    new_parent = parent_id if change_parent else folder["parent_id"]
    if new_name == folder["name"] and new_parent == folder["parent_id"]:
        return folder
    if new_parent is not None:
        _folder(conn, new_parent)
        ancestor: Optional[int] = new_parent
        while ancestor is not None:
            if ancestor == folder_id:
                raise LibraryError("A folder can't go inside itself.")
            ancestor = conn.execute("SELECT parent_id FROM folders WHERE id = ?", (ancestor,)).fetchone()[0]
    if _name_taken(conn, new_parent, new_name, except_id=folder_id):
        raise LibraryError(f"There's already a folder called {new_name} there.", 409)

    disk_from = disk_to = None
    if folder["disk_path"] and new_name != folder["name"]:
        old_dir = Path(folder["disk_path"])
        new_dir = old_dir.with_name(new_name)
        if new_dir.exists() and not (new_dir.exists() and old_dir.exists() and new_dir.samefile(old_dir)):
            raise LibraryError(f"There's already a folder called {new_name} next to it on disk.", 409)
        if not old_dir.is_dir():
            raise LibraryError(f"The folder {old_dir} isn't on disk any more.", 409)
        os.rename(old_dir, new_dir)
        _repath_prefix(conn, str(old_dir), str(new_dir))
        disk_from, disk_to = str(old_dir), str(new_dir)

    conn.execute("UPDATE folders SET name = ?, parent_id = ? WHERE id = ?", (new_name, new_parent, folder_id))
    label = f"Renamed {folder['name']} to {new_name}" if new_name != folder["name"] else f"Moved {new_name}"
    _log(conn, "update_folder", label, {
        "folder_id": folder_id, "old": [folder["name"], folder["parent_id"]], "new": [new_name, new_parent],
        "disk_from": disk_from, "disk_to": disk_to,
    })
    return _folder(conn, folder_id)


def delete_folder(conn: sqlite3.Connection, folder_id: int) -> dict:
    """Delete a TidyFlow folder and its subfolders. Their files go back to "Not sorted yet"; nothing on disk changes."""
    root = _folder(conn, folder_id)
    ids, frontier = [folder_id], [folder_id]
    while frontier:
        marks = ",".join("?" * len(frontier))
        frontier = [r[0] for r in conn.execute(f"SELECT id FROM folders WHERE parent_id IN ({marks})", frontier)]
        ids.extend(frontier)
    marks = ",".join("?" * len(ids))
    folders = [list(r) for r in conn.execute(
        f"SELECT id, name, parent_id, disk_path, sort_order, created_at FROM folders WHERE id IN ({marks}) ORDER BY id",
        ids,
    )]
    members = [list(r) for r in conn.execute(
        f"SELECT folder_id, file_row_id, added_at FROM folder_files WHERE folder_id IN ({marks})", ids
    )]
    conn.execute(f"DELETE FROM folders WHERE id IN ({marks})", ids)  # a trigger drops their memberships
    _log(conn, "delete_folder", f"Deleted folder {root['name']}", {"folders": folders, "members": members})
    return {"deleted_folders": len(ids), "files_unsorted": len({m[1] for m in members})}


# ---------------------------------------------------------------------------
# Membership actions (database only)
# ---------------------------------------------------------------------------


def paste(
    conn: sqlite3.Connection, file_ids: list[int], to_folder_id: int, *, op: str = "copy",
    from_folder_id: Optional[int] = None,
) -> dict:
    """Put files into a folder; ``op="cut"`` also takes them out of ``from_folder_id``.

    Pasting into a real folder files that aren't in its disk folder would break the rule that a real
    folder holds only files in it on disk, so nothing changes and ``needs_disk_move`` is returned.
    """
    target = _folder(conn, to_folder_id)
    rows = _files(conn, file_ids)
    if target["disk_path"]:
        outside = [r for r in rows if (where := _location(r)) is None or where[1].parent != Path(target["disk_path"])]
        if outside:
            return {"needs_disk_move": True, "dest_dir": target["disk_path"], "count": len(outside)}
    ids = [r["id"] for r in rows]
    added = _add_members(conn, ids, to_folder_id)
    removed = []
    if op == "cut" and from_folder_id is not None and from_folder_id != to_folder_id:
        removed = _remove_members(conn, ids, from_folder_id)
    verb = "Moved" if op == "cut" else "Added"
    label = f"{verb} {_plural(len(ids), 'file')} to {target['name']}"
    if added or removed:
        _log(conn, "members", label, {"added": added, "removed": removed})
    if op == "cut":
        # Moving a file out of a folder (or out of Not sorted yet) into this one says where it belongs.
        library_rules.record(conn, [(fid, from_folder_id, to_folder_id) for fid, _ in added])
    return {"needs_disk_move": False, "count": len(ids)}


def remove_from_folder(conn: sqlite3.Connection, file_ids: list[int], folder_id: int) -> dict:
    folder = _folder(conn, folder_id)
    ids = [r["id"] for r in _files(conn, file_ids)]
    removed = _remove_members(conn, ids, folder_id)
    if removed:
        _log(conn, "members", f"Took {_plural(len(removed), 'file')} out of {folder['name']}",
             {"added": [], "removed": removed})
    return {"count": len(removed)}


# ---------------------------------------------------------------------------
# Disk actions
# ---------------------------------------------------------------------------


def rename_file(conn: sqlite3.Connection, file_id: int, new_name: str) -> dict:
    """Rename a file where it is on disk."""
    row = _files(conn, [file_id])[0]
    where = _location(row)
    if where is None:
        raise LibraryError("TidyFlow can't find this file on disk.", 409)
    col, src = where
    new_name = clean_name(new_name, "file name")
    dest = src.with_name(new_name)
    if dest == src:
        return {"path": str(src)}
    if dest.exists() and not dest.samefile(src):  # samefile: only the case changed on a case-blind disk
        raise LibraryError(f"There's already a file called {new_name} in that folder.", 409)
    os.rename(src, dest)
    _set_location(conn, row["id"], col, dest)
    _log(conn, "disk", f"Renamed {src.name} to {new_name}", {
        "moves": [{"row": row["id"], "col": col, "from": str(src), "to": str(dest), "sig": _signature(dest)}],
    })
    return {"path": str(dest)}


def move_on_disk(
    conn: sqlite3.Connection, file_ids: list[int], dest_dir: str, *, to_folder_id: Optional[int] = None,
    from_folder_id: Optional[int] = None, op: str = "cut",
) -> dict:
    """Move files into ``dest_dir`` on disk, and (with ``to_folder_id``) into that TidyFlow folder."""
    dest = Path(dest_dir).expanduser()
    if not dest.is_absolute() or not dest.is_dir():
        raise LibraryError("Pick a folder that exists on disk.")
    target = _folder(conn, to_folder_id) if to_folder_id is not None else None
    rows = _files(conn, file_ids)
    moves, placed = _move_batch(conn, rows, dest)
    ids = [r["id"] for r in rows]
    added = _add_members(conn, ids, to_folder_id) if target else []
    removed = (
        _remove_members(conn, ids, from_folder_id)
        if target and op == "cut" and from_folder_id is not None and from_folder_id != to_folder_id else []
    )
    disk_paths = _no_longer_real(conn, placed)
    where = target["name"] if target else dest.name
    _log(conn, "disk", f"Moved {_plural(len(ids), 'file')} to {where} on disk", {
        "moves": moves, "added": added, "removed": removed, "disk_paths": disk_paths,
    })
    return {"moved": len(moves), "dest_dir": str(dest), "unreal_folders": [d[0] for d in disk_paths]}


def make_real(conn: sqlite3.Connection, folder_id: int, parent_dir: str) -> dict:
    """Move every file in a folder into ``parent_dir/<folder name>`` on disk, so the folder becomes real."""
    folder = _folder(conn, folder_id)
    parent = Path(parent_dir).expanduser()
    if not parent.is_absolute() or not parent.is_dir():
        raise LibraryError("Pick a folder that exists on disk.")
    dest = parent / folder["name"]
    if dest.exists() and not dest.is_dir():
        raise LibraryError(f"There's a file called {folder['name']} there already.", 409)
    created_dir = not dest.exists()
    file_ids = [r[0] for r in conn.execute(
        "SELECT file_row_id FROM folder_files WHERE folder_id = ?", (folder_id,)
    )]
    if created_dir:
        dest.mkdir()
    try:
        rows = _files(conn, file_ids) if file_ids else []
        moves, placed = _move_batch(conn, rows, dest)
    except Exception:
        if created_dir:
            try:
                dest.rmdir()
            except OSError:
                pass
        raise
    old_disk = folder["disk_path"]
    conn.execute("UPDATE folders SET disk_path = ? WHERE id = ?", (str(dest), folder_id))
    disk_paths = [[folder_id, old_disk, str(dest)]] + [
        d for d in _no_longer_real(conn, placed) if d[0] != folder_id
    ]
    _log(conn, "disk", f"Made {folder['name']} a real folder", {
        "moves": moves, "added": [], "removed": [], "disk_paths": disk_paths,
        "created_dir": str(dest) if created_dir else None,
    })
    return {"moved": len(moves), "disk_path": str(dest)}


def _send_to_trash(path: Path) -> None:
    if sys.platform == "darwin":
        from Foundation import NSFileManager, NSURL  # comes with pywebview's pyobjc

        ok, _, error = NSFileManager.defaultManager().trashItemAtURL_resultingItemURL_error_(
            NSURL.fileURLWithPath_(str(path)), None, None
        )
        if not ok:
            raise LibraryError(f"Couldn't move {path.name} to the Trash: {error.localizedDescription() if error else 'unknown error'}.")
        return
    try:
        from send2trash import send2trash
    except ImportError as exc:
        raise LibraryError("Moving files to the Trash isn't available on this computer.") from exc
    send2trash(str(path))


def trash(conn: sqlite3.Connection, file_ids: list[int]) -> dict:
    """Move files to the Trash (never a permanent delete) and forget them.

    A file that can't be found is just forgotten. When the file trashed was an organized copy and the
    original is still where it was found, TidyFlow keeps the original, back in "Not sorted yet".
    """
    rows = _files(conn, file_ids)
    trashed = forgotten = 0
    for row in rows:
        where = _location(row)
        if where is not None:
            col, path = where
            _send_to_trash(path)
            trashed += 1
            if col == "new_path" and Path(row["path"]).is_file():
                conn.execute("UPDATE files SET new_path = '', status = 'scanned' WHERE id = ?", (row["id"],))
                conn.execute("DELETE FROM folder_files WHERE file_row_id = ?", (row["id"],))
                continue
        else:
            forgotten += 1
        conn.execute("DELETE FROM files WHERE id = ?", (row["id"],))
    return {"trashed": trashed, "forgotten": forgotten}


def log_sort(conn: sqlite3.Connection, info: dict, label: str) -> None:
    """Record a sort into TidyFlow folders (``library.sort_into_folders``) so Undo can take it back."""
    if info.get("links") or info.get("created_folders"):
        _log(conn, "sort", label, {"info": info})


# ---------------------------------------------------------------------------
# Undo
# ---------------------------------------------------------------------------


def history(conn: sqlite3.Connection, limit: int = 20) -> list[dict]:
    rows = conn.execute(
        "SELECT id, kind, payload, created_at FROM library_ops WHERE undone = 0 ORDER BY id DESC LIMIT ?", (limit,)
    ).fetchall()
    return [{"id": r[0], "kind": r[1], "label": json.loads(r[2]).get("label", ""), "at": r[3]} for r in rows]


def _undo_disk(conn: sqlite3.Connection, p: dict) -> None:
    moves = p.get("moves", [])
    for m in moves:
        to, frm = Path(m["to"]), Path(m["from"])
        if not to.is_file() or _signature(to) != m["sig"]:
            raise LibraryError(f"{to.name} was changed or moved since, so Undo would lose that. Nothing was changed.", 409)
        if frm.exists() and not frm.samefile(to):
            raise LibraryError(f"There's a new file at {frm}, so {to.name} can't go back. Nothing was changed.", 409)
    done: list[dict] = []
    try:
        for m in reversed(moves):
            _move_file(Path(m["to"]), Path(m["from"]))
            done.append(m)
    except Exception as exc:
        for m in reversed(done):
            try:
                _move_file(Path(m["from"]), Path(m["to"]))
            except Exception:
                pass
        if isinstance(exc, LibraryError):
            raise
        raise LibraryError(f"Couldn't undo: {exc}. Nothing was changed.") from exc
    for m in moves:
        if conn.execute("SELECT 1 FROM files WHERE id = ?", (m["row"],)).fetchone():
            _set_location(conn, m["row"], m["col"], Path(m["from"]))
    _undo_members(conn, p.get("added", []), p.get("removed", []))
    for folder_id, old, _new in p.get("disk_paths", []):
        conn.execute("UPDATE folders SET disk_path = ? WHERE id = ?", (old, folder_id))
    if p.get("created_dir"):
        try:
            Path(p["created_dir"]).rmdir()
        except OSError:
            pass  # not empty any more: leave it


def undo_last(conn: sqlite3.Connection) -> dict:
    """Undo the newest action not undone yet."""
    row = conn.execute(
        "SELECT id, kind, payload FROM library_ops WHERE undone = 0 ORDER BY id DESC LIMIT 1"
    ).fetchone()
    if row is None:
        raise LibraryError("There's nothing to undo.", 409)
    op_id, kind, p = row[0], row[1], json.loads(row[2])

    if kind == "create_folder":
        fid = p["folder_id"]
        busy = conn.execute(
            "SELECT 1 FROM folder_files WHERE folder_id = ? UNION ALL SELECT 1 FROM folders WHERE parent_id = ? LIMIT 1",
            (fid, fid),
        ).fetchone()
        if busy:
            raise LibraryError("That folder has files or folders in it now, so Undo leaves it.", 409)
        conn.execute("DELETE FROM folders WHERE id = ?", (fid,))
    elif kind == "update_folder":
        fid = p["folder_id"]
        old_name, old_parent = p["old"]
        if not conn.execute("SELECT 1 FROM folders WHERE id = ?", (fid,)).fetchone():
            raise LibraryError("That folder doesn't exist any more.", 409)
        if old_parent is not None and not conn.execute("SELECT 1 FROM folders WHERE id = ?", (old_parent,)).fetchone():
            old_parent = None
        if _name_taken(conn, old_parent, old_name, except_id=fid):
            raise LibraryError(f"There's a folder called {old_name} there now.", 409)
        if p.get("disk_to"):
            frm, to = Path(p["disk_to"]), Path(p["disk_from"])
            if not frm.is_dir() or to.exists():
                raise LibraryError("The folder on disk was changed since, so Undo leaves it.", 409)
            os.rename(frm, to)
            _repath_prefix(conn, str(frm), str(to))
        conn.execute("UPDATE folders SET name = ?, parent_id = ? WHERE id = ?", (old_name, old_parent, fid))
    elif kind == "delete_folder":
        for fid, name, parent_id, disk_path, sort_order, created_at in p["folders"]:
            if _name_taken(conn, parent_id, name, except_id=fid):
                raise LibraryError(f"There's a new folder called {name} there now.", 409)
            conn.execute(
                "INSERT INTO folders (id, name, parent_id, disk_path, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                (fid, name, parent_id, disk_path, sort_order, created_at),
            )
        _undo_members(conn, [], [[m[1], m[0], m[2]] for m in p["members"]])
    elif kind == "members":
        _undo_members(conn, p.get("added", []), p.get("removed", []))
    elif kind == "disk":
        _undo_disk(conn, p)
    elif kind == "sort":
        undo_sort(conn, p["info"])
    elif kind in ("add_rule", "remove_rule"):
        library_rules.undo(conn, kind, p)
    else:
        raise LibraryError("TidyFlow doesn't know how to undo that.", 409)

    conn.execute("UPDATE library_ops SET undone = 1 WHERE id = ?", (op_id,))
    return {"undone": p.get("label", ""), "kind": kind}
