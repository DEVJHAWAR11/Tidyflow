"""Rules TidyFlow learns from where the person puts files.

Each time a file lands in a folder other than the one TidyFlow suggested (on the review screen, on the
New files screen, or by cutting and pasting it in the Library), that is a correction. When two or more
corrections into one folder share a word in their names, and no file in an unrelated folder has that
word, TidyFlow offers a rule: "files with *airtel* in the name go to Finance / Bills". A rule is used
only once the person accepts it, and it suggests; it never moves anything by itself.

Rules are kept by folder id, so they follow a folder that is renamed or moved. Every function takes an
open ``sqlite3.Connection`` and leaves committing to the caller.
"""

from __future__ import annotations

import re
import sqlite3
from collections import Counter
from pathlib import Path
from typing import Iterable, Optional

from .library import find_folder_path, folder_paths

# Corrections that must agree before a rule is offered.
MIN_AGREEING = 2
# Words too common in file names to say where a file belongs.
STOP_WORDS = frozenset(
    """
    the and for with from new old copy final draft version untitled document doc docs file files
    scan scanned img image images photo pic screenshot screen shot export download downloads edit
    edited part page pages notes note pdf jpg jpeg png heic txt docx xlsx pptx csv zip
    jan feb mar apr may jun jul aug sep sept oct nov dec january february march april june july
    august september october november december mon tue wed thu fri sat sun today
    """.split()
)


def words(name: str) -> set[str]:
    """The words in a file name that could name what it is: letters only, three or more of them."""
    return {w for w in re.findall(r"[a-z]+", Path(name).stem.lower()) if 3 <= len(w) <= 30 and w not in STOP_WORDS}


def _related(a: str, b: str) -> bool:
    """The same folder, or one inside the other."""
    return a == b or a.startswith(b + "/") or b.startswith(a + "/")


def record(conn: sqlite3.Connection, moves: Iterable[tuple[int, Optional[int], int]]) -> int:
    """Remember corrections: ``(file_row_id, from_folder_id or None, to_folder_id)``."""
    rows = [(f, frm, to) for f, frm, to in moves if frm != to]
    conn.executemany(
        "INSERT INTO corrections (file_row_id, from_folder_id, to_folder_id) VALUES (?, ?, ?)", rows
    )
    return len(rows)


def record_by_path(conn: sqlite3.Connection, items: Iterable[tuple[str, Optional[str], str]]) -> int:
    """Corrections given as ``(file path, suggested folder path or None, chosen folder path)``.

    Run after the files were sorted, so the chosen folders exist. A choice that matches the suggestion
    (ignoring case) is not a correction.
    """
    moves = []
    for path, suggested, chosen in items:
        if suggested and suggested.strip().lower().replace(" / ", "/") == chosen.strip().lower().replace(" / ", "/"):
            continue
        row = conn.execute("SELECT id FROM files WHERE path = ?", (path,)).fetchone()
        to = find_folder_path(conn, chosen)
        if row is None or to is None:
            continue
        moves.append((row[0], find_folder_path(conn, suggested) if suggested else None, to))
    return record(conn, moves)


def _members(conn: sqlite3.Connection) -> list[tuple[int, int, str]]:
    """``(folder_id, file_row_id, file name)`` for every file in a folder."""
    return [
        (r[0], r[1], Path(r[2]).name)
        for r in conn.execute(
            "SELECT folder_files.folder_id, files.id, files.path FROM folder_files "
            "JOIN files ON files.id = folder_files.file_row_id"
        )
    ]


def suggestions(conn: sqlite3.Connection, limit: int = 3) -> list[dict]:
    """Rules worth offering, best first.

    Only corrections whose file is still in the folder it was put in count, so an undone sort or a file
    moved on again teaches nothing.
    """
    paths = folder_paths(conn)
    members = _members(conn)
    in_folder = {(fid, file_id) for fid, file_id, _ in members}
    taken = {r[0].lower() for r in conn.execute("SELECT contains FROM learned_rules")}
    dismissed = {(r[0], r[1].lower()) for r in conn.execute("SELECT folder_id, contains FROM dismissed_rules")}

    corrected: dict[int, dict[int, str]] = {}
    for to_id, file_id, path in conn.execute(
        "SELECT corrections.to_folder_id, files.id, files.path FROM corrections "
        "JOIN files ON files.id = corrections.file_row_id"
    ):
        if to_id in paths and (to_id, file_id) in in_folder:
            corrected.setdefault(to_id, {})[file_id] = Path(path).name

    found: dict[str, dict] = {}
    for fid, files in corrected.items():
        counts = Counter(w for name in files.values() for w in words(name))
        for word, n in counts.items():
            if n < MIN_AGREEING or word in taken or (fid, word) in dismissed:
                continue
            here = 0
            clash = False
            for other, _file_id, name in members:
                if word not in name.lower():
                    continue
                if other == fid:
                    here += 1
                elif other in paths and not _related(paths[other], paths[fid]):
                    clash = True
                    break
            if clash:
                continue
            best = found.get(word)
            if best is None or (n, here) > (best["corrections"], best["matching"]):
                found[word] = {
                    "folder_id": fid,
                    "folder": paths[fid],
                    "contains": word,
                    "corrections": n,
                    "matching": here,
                    "examples": sorted(name for name in files.values() if word in name.lower())[:3],
                }
    ranked = sorted(found.values(), key=lambda s: (-s["corrections"], -s["matching"], s["contains"]))
    return ranked[:limit]


def rules(conn: sqlite3.Connection) -> list[dict]:
    """The rules the person accepted, for folders that still exist."""
    paths = folder_paths(conn)
    return [
        {"id": r[0], "folder_id": r[1], "folder": paths[r[1]], "contains": r[2], "created_at": r[3]}
        for r in conn.execute("SELECT id, folder_id, contains, created_at FROM learned_rules ORDER BY contains")
        if r[1] in paths
    ]


def rule_dicts(conn: sqlite3.Connection) -> list[dict]:
    """The accepted rules in the rule engine's shape: ``{"category": "Finance/Bills", "contains": "airtel"}``."""
    return [{"category": r["folder"], "contains": r["contains"], "learned": True} for r in rules(conn)]


def add_rule(conn: sqlite3.Connection, folder_id: int, contains: str) -> dict:
    from .library_ops import LibraryError, _log

    word = contains.strip().lower()
    paths = folder_paths(conn)
    if folder_id not in paths:
        raise LibraryError("That folder doesn't exist any more.", 404)
    if not word or len(word) > 60:
        raise LibraryError("A rule needs a word to look for in file names.", 422)
    existing = conn.execute(
        "SELECT folder_id FROM learned_rules WHERE contains = ? COLLATE NOCASE", (word,)
    ).fetchone()
    if existing:
        where = paths.get(existing[0], "another folder").replace("/", " / ")
        raise LibraryError(f"Files with “{word}” in the name already go to {where}.", 409)
    rule_id = conn.execute(
        "INSERT INTO learned_rules (folder_id, contains) VALUES (?, ?)", (folder_id, word)
    ).lastrowid
    name = paths[folder_id].rsplit("/", 1)[-1]
    _log(conn, "add_rule", f"Learned: “{word}” goes to {name}", {"rule_id": rule_id})
    return {"id": rule_id, "folder_id": folder_id, "folder": paths[folder_id], "contains": word}


def remove_rule(conn: sqlite3.Connection, rule_id: int) -> dict:
    from .library_ops import LibraryError, _log

    row = conn.execute(
        "SELECT id, folder_id, contains, created_at FROM learned_rules WHERE id = ?", (rule_id,)
    ).fetchone()
    if row is None:
        raise LibraryError("That rule is gone already.", 404)
    conn.execute("DELETE FROM learned_rules WHERE id = ?", (rule_id,))
    # Taking a rule back also means "don't offer it again".
    conn.execute("INSERT OR IGNORE INTO dismissed_rules (folder_id, contains) VALUES (?, ?)", (row[1], row[2]))
    _log(conn, "remove_rule", f"Forgot the rule for “{row[2]}”", {"rule": list(row)})
    return {"removed": rule_id}


def undo(conn: sqlite3.Connection, kind: str, payload: dict) -> None:
    """Take back ``add_rule`` or ``remove_rule`` (called by ``library_ops.undo_last``)."""
    if kind == "add_rule":
        conn.execute("DELETE FROM learned_rules WHERE id = ?", (payload["rule_id"],))
    else:
        rule_id, folder_id, contains, created_at = payload["rule"]
        conn.execute(
            "DELETE FROM dismissed_rules WHERE folder_id = ? AND contains = ?", (folder_id, contains)
        )
        conn.execute(
            "INSERT OR IGNORE INTO learned_rules (id, folder_id, contains, created_at) VALUES (?, ?, ?, ?)",
            (rule_id, folder_id, contains, created_at),
        )


def dismiss(conn: sqlite3.Connection, folder_id: int, contains: str) -> dict:
    conn.execute(
        "INSERT OR IGNORE INTO dismissed_rules (folder_id, contains) VALUES (?, ?)",
        (folder_id, contains.strip().lower()),
    )
    return {"dismissed": True}

