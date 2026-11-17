"""TidyFlow folders: folders kept in TidyFlow's own database, apart from the folders on disk.

A TidyFlow folder groups indexed files (rows of ``files``) without touching them. A file can be in
several folders, and files in none show as "Not sorted yet". A folder with a ``disk_path`` is a
real folder: its files sit in that folder on disk.

Every function here takes an open ``sqlite3.Connection`` and leaves committing to the caller.
"""

from __future__ import annotations

import os
import re
import sqlite3
from pathlib import Path
from typing import Iterable, Optional


def ensure_schema(conn: sqlite3.Connection) -> None:
    """Create the folder tables if they are missing."""
    conn.execute("""
        CREATE TABLE IF NOT EXISTS folders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            parent_id INTEGER,
            disk_path TEXT,
            sort_order INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    # One name per parent, ignoring case ("Finance" and "finance" are the same folder).
    conn.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_folders_parent_name "
        "ON folders(COALESCE(parent_id, 0), name COLLATE NOCASE)"
    )
    conn.execute("""
        CREATE TABLE IF NOT EXISTS folder_files (
            folder_id INTEGER NOT NULL,
            file_row_id INTEGER NOT NULL,
            added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (folder_id, file_row_id)
        )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_folder_files_file ON folder_files(file_row_id)")
    conn.execute("""
        CREATE TABLE IF NOT EXISTS scan_roots (
            path TEXT PRIMARY KEY,
            last_checked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS library_ops (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            kind TEXT NOT NULL,
            payload TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            undone INTEGER DEFAULT 0
        )
    """)
    # Where the person put a file when TidyFlow had suggested another folder (or none): what rules learn from.
    conn.execute("""
        CREATE TABLE IF NOT EXISTS corrections (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            file_row_id INTEGER NOT NULL,
            from_folder_id INTEGER,
            to_folder_id INTEGER NOT NULL,
            at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_corrections_to ON corrections(to_folder_id)")
    # Rules the person accepted: a file whose name contains ``contains`` is suggested for the folder.
    conn.execute("""
        CREATE TABLE IF NOT EXISTS learned_rules (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            folder_id INTEGER NOT NULL,
            contains TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_learned_rules_contains ON learned_rules(contains COLLATE NOCASE)"
    )
    conn.execute("""
        CREATE TABLE IF NOT EXISTS dismissed_rules (
            folder_id INTEGER NOT NULL,
            contains TEXT NOT NULL COLLATE NOCASE,
            at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (folder_id, contains)
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS library_settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )
    """)
    # The Finder tags TidyFlow put on a file (JSON list), so it only ever takes back its own.
    try:
        conn.execute("ALTER TABLE files ADD COLUMN finder_tags TEXT")
    except sqlite3.OperationalError:
        pass  # already there (or no files table yet, in tests that only need folders)
    # Triggers rather than foreign keys: they fire on every connection, without a PRAGMA.
    conn.execute("""
        CREATE TRIGGER IF NOT EXISTS files_ad_folder_files AFTER DELETE ON files BEGIN
            DELETE FROM folder_files WHERE file_row_id = old.id;
        END;
    """)
    conn.execute("""
        CREATE TRIGGER IF NOT EXISTS folders_ad_folder_files AFTER DELETE ON folders BEGIN
            DELETE FROM folder_files WHERE folder_id = old.id;
        END;
    """)


def category_parts(category: str) -> list[str]:
    """``"Finance / Bills"`` → ``["Finance", "Bills"]``: the nested folders a category stands for."""
    return [p.strip() for p in re.split(r"[/\\]", category or "") if p.strip()]


def folder_paths(conn: sqlite3.Connection) -> dict[int, str]:
    """Every folder's path from the top, like ``{2: "Finance/Bills"}``."""
    rows = {r[0]: (r[1], r[2]) for r in conn.execute("SELECT id, name, parent_id FROM folders")}
    out: dict[int, str] = {}

    def path(fid: int) -> str:
        if fid in out:
            return out[fid]
        parts: list[str] = []
        node: Optional[int] = fid
        while node is not None and node in rows and len(parts) < 32:
            parts.insert(0, rows[node][0])
            node = rows[node][1]
        out[fid] = "/".join(parts)
        return out[fid]

    for fid in rows:
        path(fid)
    return out


def find_folder_path(conn: sqlite3.Connection, category: str) -> Optional[int]:
    """The folder for ``category`` if it exists (nothing is made)."""
    parent_id: Optional[int] = None
    parts = category_parts(category)
    for name in parts:
        row = conn.execute(
            "SELECT id FROM folders WHERE COALESCE(parent_id, 0) = ? AND name = ? COLLATE NOCASE",
            (parent_id or 0, name),
        ).fetchone()
        if row is None:
            return None
        parent_id = row[0]
    return parent_id if parts else None


def ensure_folder_path(conn: sqlite3.Connection, category: str) -> tuple[Optional[int], list[int]]:
    """The folder for ``category``, made (with its parents) if needed: ``(folder_id, ids_created)``."""
    parent_id: Optional[int] = None
    created: list[int] = []
    for name in category_parts(category):
        row = conn.execute(
            "SELECT id FROM folders WHERE COALESCE(parent_id, 0) = ? AND name = ? COLLATE NOCASE",
            (parent_id or 0, name),
        ).fetchone()
        if row:
            parent_id = row[0]
        else:
            parent_id = conn.execute(
                "INSERT INTO folders (name, parent_id) VALUES (?, ?)", (name, parent_id)
            ).lastrowid
            created.append(parent_id)
    return parent_id, created


def sort_into_folders(
    conn: sqlite3.Connection,
    items: Iterable[tuple[str, str]],
    disk_root: Optional[Path] = None,
) -> dict:
    """Put each ``(path, category)`` file into the TidyFlow folder for its category.

    With ``disk_root`` (the files were copied or moved to ``disk_root/<category>``), a folder that
    was new or empty is linked to that disk folder, so it shows as real. Returns what was done, in
    the shape ``undo_sort`` takes.
    """
    links: list[list[int]] = []
    created_folders: list[int] = []
    linked_disk: list[int] = []
    had_members: dict[int, bool] = {}
    sorted_rows: set[int] = set()
    for path, category in items:
        row = conn.execute("SELECT id FROM files WHERE path = ?", (str(path),)).fetchone()
        if row is None:
            continue
        folder_id, created = ensure_folder_path(conn, category)
        if folder_id is None:
            continue
        sorted_rows.add(row[0])
        created_folders.extend(created)
        if folder_id not in had_members:
            had_members[folder_id] = conn.execute(
                "SELECT 1 FROM folder_files WHERE folder_id = ? LIMIT 1", (folder_id,)
            ).fetchone() is not None
            if disk_root is not None and not had_members[folder_id]:
                disk = str(Path(disk_root, *category_parts(category)))
                cur = conn.execute(
                    "UPDATE folders SET disk_path = ? WHERE id = ? AND disk_path IS NULL", (disk, folder_id)
                )
                if cur.rowcount:
                    linked_disk.append(folder_id)
        cur = conn.execute(
            "INSERT OR IGNORE INTO folder_files (folder_id, file_row_id) VALUES (?, ?)", (folder_id, row[0])
        )
        if cur.rowcount:
            links.append([row[0], folder_id])
    return {
        "links": links,
        "created_folders": created_folders,
        "linked_disk": linked_disk,
        # Files now in a folder, counting ones that were already there.
        "sorted": len(sorted_rows),
    }


def undo_sort(conn: sqlite3.Connection, info: dict) -> int:
    """Reverse ``sort_into_folders``: drop its links, then the folders it made that are now empty."""
    removed = 0
    for file_row_id, folder_id in info.get("links", []):
        removed += conn.execute(
            "DELETE FROM folder_files WHERE folder_id = ? AND file_row_id = ?", (folder_id, file_row_id)
        ).rowcount
    for folder_id in info.get("linked_disk", []):
        conn.execute("UPDATE folders SET disk_path = NULL WHERE id = ?", (folder_id,))
    # Children were created after their parents, so newest first removes them before their parents.
    for folder_id in sorted(info.get("created_folders", []), reverse=True):
        busy = conn.execute(
            "SELECT 1 FROM folder_files WHERE folder_id = ? UNION ALL SELECT 1 FROM folders WHERE parent_id = ? LIMIT 1",
            (folder_id, folder_id),
        ).fetchone()
        if busy is None:
            conn.execute("DELETE FROM folders WHERE id = ?", (folder_id,))
    return removed


def add_scan_root(conn: sqlite3.Connection, path: str | Path) -> None:
    """Remember a folder TidyFlow has scanned, so it can look there for new files later."""
    conn.execute(
        "INSERT INTO scan_roots (path, last_checked_at) VALUES (?, CURRENT_TIMESTAMP) "
        "ON CONFLICT(path) DO UPDATE SET last_checked_at = CURRENT_TIMESTAMP",
        (str(path),),
    )


# Files the Library lists: everything indexed except files the scan skipped.
_LISTED = "COALESCE(files.status, '') != 'skipped'"


def folder_rows(conn: sqlite3.Connection, only_id: Optional[int] = None) -> list[dict]:
    """Every folder (or just ``only_id``) with how many listed files sit directly in it."""
    where, params = ("WHERE folders.id = ?", (only_id,)) if only_id is not None else ("", ())
    rows = conn.execute(f"""
        SELECT folders.id, folders.name, folders.parent_id, folders.disk_path,
               COUNT(files.id) AS count
        FROM folders
        LEFT JOIN folder_files ON folder_files.folder_id = folders.id
        LEFT JOIN files ON files.id = folder_files.file_row_id AND {_LISTED}
        {where}
        GROUP BY folders.id
        ORDER BY folders.name COLLATE NOCASE
    """, params).fetchall()
    return [
        {
            "id": r[0],
            "name": r[1],
            "parent_id": r[2],
            "disk_path": r[3],
            # The disk folder as people say it, with the home folder shown as "~".
            "disk_label": display_dir(Path(r[3])) if r[3] else None,
            "is_real": bool(r[3]),
            "count": r[4],
        }
        for r in rows
    ]


def unsorted_count(conn: sqlite3.Connection) -> int:
    return conn.execute(
        f"SELECT COUNT(*) FROM files WHERE {_LISTED} "
        "AND NOT EXISTS (SELECT 1 FROM folder_files WHERE folder_files.file_row_id = files.id)"
    ).fetchone()[0]


def listed_count(conn: sqlite3.Connection) -> int:
    return conn.execute(f"SELECT COUNT(*) FROM files WHERE {_LISTED}").fetchone()[0]


def current_path(path: Optional[str], new_path: Optional[str]) -> Optional[Path]:
    """Where a file is now: its organized copy or place if that exists, else where it was found."""
    for value in (new_path, path):
        if value and Path(value).is_file():
            return Path(value)
    return None


def display_dir(path: Path) -> str:
    """A folder path as people say it: the home folder shown as ``~``."""
    home = str(Path.home())
    text = str(path)
    return "~" + text[len(home):] if text == home or text.startswith(home + os.sep) else text


def _summary(reason: Optional[str], text: Optional[str]) -> str:
    if reason and reason.strip():
        return reason.strip()
    flat = " ".join((text or "").split())
    return flat[:140] + ("…" if len(flat) > 140 else "")


def folder_files_page(
    conn: sqlite3.Connection, folder_id: Optional[int], *, offset: int = 0, limit: int = 50
) -> tuple[int, list[dict]]:
    """One page of the files in a folder (``None`` = "Not sorted yet"), newest first, missing ones last.

    Each file says where it really is now. Files that can't be found are flagged ``missing`` and
    their ``missing_since`` is set; a file that turns up again has it cleared.
    """
    limit = max(1, min(int(limit), 200))
    offset = max(0, int(offset))
    cols = (
        "files.id, files.path, files.new_path, files.extension, files.file_size_bytes, files.reason, "
        "substr(files.extracted_text, 1, 600) AS text, files.thumbnail_b64, files.missing_since"
    )
    if folder_id is None:
        where = (
            f"FROM files WHERE {_LISTED} "
            "AND NOT EXISTS (SELECT 1 FROM folder_files WHERE folder_files.file_row_id = files.id)"
        )
        params: tuple = ()
        added = "files.last_updated"
    else:
        where = (
            "FROM folder_files JOIN files ON files.id = folder_files.file_row_id "
            f"WHERE folder_files.folder_id = ? AND {_LISTED}"
        )
        params = (folder_id,)
        added = "folder_files.added_at"
    total = conn.execute(f"SELECT COUNT(*) {where}", params).fetchone()[0]
    rows = conn.execute(
        # Files that couldn't be found last time go after the rest.
        f"SELECT {cols}, {added} AS added_at {where} "
        f"ORDER BY files.missing_since IS NOT NULL, {added} DESC, files.id DESC LIMIT ? OFFSET ?",
        (*params, limit, offset),
    ).fetchall()

    files: list[dict] = []
    gone: list[int] = []
    back: list[int] = []
    for r in rows:
        (row_id, path, new_path, extension, size, reason, text, thumb, missing_since, added_at) = r
        now = current_path(path, new_path)
        if now is None and missing_since is None:
            gone.append(row_id)
        elif now is not None and missing_since is not None:
            back.append(row_id)
        shown = now or Path(new_path or path)
        files.append({
            "id": row_id,
            "name": shown.name,
            "path": path,
            "current_path": str(now) if now else None,
            "lives_in": display_dir(shown.parent),
            "missing": now is None,
            "extension": extension or shown.suffix.lower(),
            "file_size_bytes": size or 0,
            "summary": _summary(reason, text),
            "thumbnail_b64": thumb,
            "added_at": added_at,
        })
    for row_id in gone:
        conn.execute("UPDATE files SET missing_since = CURRENT_TIMESTAMP WHERE id = ?", (row_id,))
    for row_id in back:
        conn.execute("UPDATE files SET missing_since = NULL WHERE id = ?", (row_id,))
    return total, files
