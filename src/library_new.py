"""New since last time: files that turned up in the folders TidyFlow has scanned.

Nothing watches the disk. A check runs when the app opens or when the person asks: it walks each
scanned folder with the same rules as a sort, and a file TidyFlow has no row for is new. Files that
were renamed or moved inside those folders are recognised (same disk identity, else same contents)
and their rows follow them, so they keep their TidyFlow folders.

Every function takes an open ``sqlite3.Connection`` and leaves committing to the caller.
"""

from __future__ import annotations

import os
import re
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from .library import display_dir
from .scanner import iter_candidate_files
from .utils import compute_sha256, is_secret_file

# The most new files one check lists; the count still covers all of them.
MAX_LISTED = 1000


def _under(path: str, root: str) -> bool:
    return path == root or path.startswith(root.rstrip(os.sep) + os.sep)


def check_new(conn: sqlite3.Connection, *, max_listed: int = MAX_LISTED) -> dict:
    """Look in every scanned folder for files TidyFlow hasn't seen, and follow files that moved.

    Returns ``{"roots", "new", "total_new", "followed", "missing"}``: each scanned folder with when
    it was checked before this, the new files (newest first), how many renamed or moved files were
    followed, and how many files TidyFlow can't find any more.
    """
    roots = [
        {"path": r[0], "last_checked_at": r[1]}
        for r in conn.execute("SELECT path, last_checked_at FROM scan_roots ORDER BY path")
    ]
    known: set[str] = set()
    for path, new_path in conn.execute("SELECT path, new_path FROM files"):
        known.add(path)
        if new_path:
            known.add(new_path)

    candidates: list[Path] = []
    checked: list[str] = []
    for root in roots:
        base = Path(root["path"])
        root["exists"] = base.is_dir()
        root["label"] = display_dir(base)
        if not root["exists"]:
            continue
        checked.append(root["path"])
        for p in iter_candidate_files(base):
            if str(p) not in known and not is_secret_file(p):
                candidates.append(p)

    # Rows in the scanned folders whose file is gone: it may be one of the "new" files, renamed or moved.
    gone: dict[int, dict] = {}
    for row_id, path, new_path, dev, inode, size, fingerprint in conn.execute(
        "SELECT id, path, new_path, dev, inode, file_size_bytes, fingerprint FROM files"
    ):
        if not any(_under(path, r) for r in checked):
            continue
        if Path(path).exists() or (new_path and Path(new_path).exists()):
            continue
        gone[row_id] = {"dev": dev, "inode": inode, "size": size, "fingerprint": fingerprint}
    by_identity = {(g["dev"], g["inode"]): rid for rid, g in gone.items() if g["dev"] is not None and g["inode"] is not None}
    by_size: dict[int, list[int]] = {}
    for rid, g in gone.items():
        if g["fingerprint"]:
            by_size.setdefault(g["size"] or 0, []).append(rid)

    followed = 0
    new: list[dict] = []
    for p in candidates:
        try:
            st = p.stat()
        except OSError:
            continue
        match: Optional[int] = by_identity.get((st.st_dev, st.st_ino))
        if match is not None and match not in gone:
            match = None
        if match is None and by_size.get(st.st_size):
            # Same size as a file that vanished: compare contents, the only hashing a check does.
            try:
                digest = compute_sha256(p)
            except OSError:
                digest = None
            match = next((rid for rid in by_size[st.st_size] if rid in gone and gone[rid]["fingerprint"] == digest), None)
        if match is not None:
            gone.pop(match)
            conn.execute(
                "UPDATE files SET path = ?, dev = ?, inode = ?, missing_since = NULL WHERE id = ?",
                (str(p), st.st_dev, st.st_ino, match),
            )
            followed += 1
            continue
        root = next(r for r in checked if _under(str(p), r))
        new.append({
            "path": str(p),
            "name": p.name,
            "size": st.st_size,
            "modified": st.st_mtime,
            "root": root,
            "lives_in": display_dir(p.parent),
        })

    for rid in gone:
        conn.execute(
            "UPDATE files SET missing_since = COALESCE(missing_since, CURRENT_TIMESTAMP) WHERE id = ?", (rid,)
        )
    for path in checked:
        conn.execute("UPDATE scan_roots SET last_checked_at = CURRENT_TIMESTAMP WHERE path = ?", (path,))

    new.sort(key=lambda f: f["modified"], reverse=True)
    return {
        "roots": roots,
        "new": new[:max_listed],
        "total_new": len(new),
        "followed": followed,
        "missing": len(gone),
        "checked_at": datetime.now(timezone.utc).isoformat(),
    }


def _name_keywords(name: str) -> list[str]:
    """Words of a folder's name as keywords, singular too: "Bills" matches a file called gas-bill.pdf."""
    words: list[str] = []
    for word in re.findall(r"[a-z0-9]+", name.lower()):
        if len(word) < 3:
            continue
        words.append(word)
        if len(word) > 3 and word.endswith("s") and not word.endswith("ss"):
            words.append(word[:-1])
    return words


def folder_categories(conn: sqlite3.Connection, plan: Optional[dict] = None) -> dict[str, dict]:
    """The TidyFlow folders as categories to sort new files into, keyed by path ("Finance/Bills").

    Each gets a description naming a few files already in it, so suggestions follow how the person
    actually sorts. A saved folder plan (``plan``: name -> {description, keywords, extensions})
    fills in the descriptions and keywords for folders it knows. The folder's own name is always a
    keyword, so the rules can suggest something even when AI is off.
    """
    plan = {k.lower(): v for k, v in (plan or {}).items() if isinstance(v, dict)}
    rows = {r[0]: (r[1], r[2]) for r in conn.execute("SELECT id, name, parent_id FROM folders")}

    def label(fid: int) -> str:
        parts: list[str] = []
        node: Optional[int] = fid
        while node is not None and node in rows and len(parts) < 32:
            parts.insert(0, rows[node][0])
            node = rows[node][1]
        return "/".join(parts)

    out: dict[str, dict] = {}
    for fid, (name, _parent) in rows.items():
        key = label(fid)
        examples = [
            Path(r[0]).name
            for r in conn.execute(
                "SELECT files.path FROM folder_files JOIN files ON files.id = folder_files.file_row_id "
                "WHERE folder_files.folder_id = ? ORDER BY folder_files.added_at DESC LIMIT 5",
                (fid,),
            )
        ]
        known = plan.get(key.lower()) or plan.get(name.lower()) or {}
        description = (known.get("description") or "").strip()
        if examples:
            description = (description + " " if description else "") + "Already holds files like: " + ", ".join(examples) + "."
        out[key] = {
            "description": description or f"Files that belong in {key.replace('/', ' / ')}.",
            "keywords": list(dict.fromkeys([*(known.get("keywords") or []), *_name_keywords(name)])),
            "extensions": list(known.get("extensions") or []),
        }
    return out


def exact_keyword_folder(scores: Optional[dict[str, float]]) -> Optional[str]:
    """The folder whose keywords a file names word for word, when exactly one branch of folders does.

    A fallback suggestion for when nothing else placed the file (AI off, or no confident rule): the
    person checks every suggestion before anything is sorted. A hit on a folder and on its parent
    picks the deeper one; hits on unrelated folders suggest nothing.
    """
    hits = [c for c, score in (scores or {}).items() if score >= 100.0]
    if not hits:
        return None
    deepest = max(hits, key=lambda c: c.count("/"))
    return deepest if all(h == deepest or deepest.startswith(h + "/") for h in hits) else None
