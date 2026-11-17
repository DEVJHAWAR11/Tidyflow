"""Finder tags for TidyFlow folders (macOS, off unless the person turns it on).

With it on, each file in a TidyFlow folder carries a Finder tag named after that folder, so Finder's
sidebar and Spotlight can find the folder's files too. Tags live in the file's extended attributes;
the file's contents, name and place don't change. TidyFlow remembers which tags it added to each file
(``files.finder_tags``) and only ever takes those back, so tags the person added stay.

``sync`` is cheap when nothing changed: it compares the database with what was last written and only
touches files whose folders changed. Every function takes an open ``sqlite3.Connection`` and leaves
committing to the caller. A tag that can't be written is logged and skipped; it never stops an action.
"""

from __future__ import annotations

import ctypes
import ctypes.util
import json
import logging
import plistlib
import sqlite3
import sys
from pathlib import Path
from typing import Optional

from .library import current_path

logger = logging.getLogger(__name__)

TAGS_ATTR = "com.apple.metadata:_kMDItemUserTags"
SETTING = "finder_tags"


def supported() -> bool:
    return sys.platform == "darwin"


# --- Settings for the Library, kept in the database ---


def setting(conn: sqlite3.Connection, key: str, default: object = None) -> object:
    row = conn.execute("SELECT value FROM library_settings WHERE key = ?", (key,)).fetchone()
    return json.loads(row[0]) if row else default


def set_setting(conn: sqlite3.Connection, key: str, value: object) -> None:
    conn.execute(
        "INSERT INTO library_settings (key, value) VALUES (?, ?) "
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (key, json.dumps(value)),
    )


def enabled(conn: sqlite3.Connection) -> bool:
    return supported() and bool(setting(conn, SETTING, False))


# --- Reading and writing a file's tags ---


def _libc():
    return ctypes.CDLL(ctypes.util.find_library("c"), use_errno=True)


def read_tags(path: Path) -> list[str]:
    """A file's Finder tags as stored: ``"Name"`` or ``"Name\\n<colour number>"``."""
    libc = _libc()
    p, n = str(path).encode(), TAGS_ATTR.encode()
    size = libc.getxattr(p, n, None, 0, 0, 0)
    if size < 0:
        err = ctypes.get_errno()
        if err == 93:  # ENOATTR: no tags yet
            return []
        raise OSError(err, f"Couldn't read the tags of {path.name}")
    buf = ctypes.create_string_buffer(size)
    got = libc.getxattr(p, n, buf, size, 0, 0)
    if got < 0:
        raise OSError(ctypes.get_errno(), f"Couldn't read the tags of {path.name}")
    try:
        tags = plistlib.loads(buf.raw[:got])
    except (plistlib.InvalidFileException, ValueError):
        return []
    return [t for t in tags if isinstance(t, str)] if isinstance(tags, list) else []


def write_tags(path: Path, tags: list[str]) -> None:
    libc = _libc()
    p, n = str(path).encode(), TAGS_ATTR.encode()
    if not tags:
        if libc.removexattr(p, n, 0) != 0 and ctypes.get_errno() != 93:
            raise OSError(ctypes.get_errno(), f"Couldn't clear the tags of {path.name}")
        return
    value = plistlib.dumps(tags, fmt=plistlib.FMT_BINARY)
    if libc.setxattr(p, n, value, len(value), 0, 0) != 0:
        raise OSError(ctypes.get_errno(), f"Couldn't tag {path.name}")


def _name(tag: str) -> str:
    return tag.split("\n", 1)[0]


def retag(path: Path, ours_before: list[str], wanted: list[str]) -> list[str]:
    """Give ``path`` the tags ``wanted``, taking back only tags TidyFlow added (``ours_before``).

    Returns the tags TidyFlow now owns on the file: a wanted tag the person had already added
    themselves stays theirs, so turning the feature off later leaves it.
    """
    existing = read_tags(path)
    names = {_name(t) for t in existing}
    ours = [w for w in wanted if w in ours_before or w not in names]
    keep = [t for t in existing if _name(t) not in ours_before or _name(t) in wanted]
    kept = {_name(t) for t in keep}
    tags = keep + [w for w in ours if w not in kept]
    if tags != existing:
        write_tags(path, tags)
    return ours


# --- Keeping tags in step with the folders ---


def sync(conn: sqlite3.Connection, *, on: Optional[bool] = None) -> dict:
    """Make every file's TidyFlow tags match its folders (or remove them all when tagging is off)."""
    on = enabled(conn) if on is None else on
    wanted: dict[int, set[str]] = {}
    if on:
        for file_id, name in conn.execute(
            "SELECT folder_files.file_row_id, folders.name FROM folder_files "
            "JOIN folders ON folders.id = folder_files.folder_id"
        ):
            wanted.setdefault(file_id, set()).add(name)

    tagged = untagged = failed = 0
    rows = conn.execute(
        "SELECT id, path, new_path, finder_tags FROM files WHERE finder_tags IS NOT NULL"
        + (" OR id IN (SELECT file_row_id FROM folder_files)" if on else "")
    ).fetchall()
    for file_id, path, new_path, stored in rows:
        before = json.loads(stored) if stored else []
        want = sorted(wanted.get(file_id, ()), key=str.lower)
        if want == before:
            continue
        target = current_path(path, new_path)
        if target is None or not target.is_file():
            continue  # can't find it now: try again next time
        try:
            ours = retag(target, before, want)
        except OSError as exc:
            failed += 1
            logger.info("Finder tags: %s", exc)
            continue
        conn.execute(
            "UPDATE files SET finder_tags = ? WHERE id = ?", (json.dumps(ours) if ours else None, file_id)
        )
        if want:
            tagged += 1
        else:
            untagged += 1
    return {"tagged": tagged, "untagged": untagged, "failed": failed}


def set_enabled(conn: sqlite3.Connection, on: bool) -> dict:
    set_setting(conn, SETTING, bool(on))
    return {"finder_tags": bool(on), **sync(conn, on=bool(on) and supported())}
