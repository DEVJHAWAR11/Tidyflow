"""SQLite WAL database manager with async single-writer queue and FTS5 search."""

from __future__ import annotations

import asyncio
import difflib
import html
import logging
import re
import sqlite3
import sys
from pathlib import Path
from typing import Any, List, Tuple

from . import library
from .utils import get_app_data_dir

logger = logging.getLogger(__name__)

# Columns of the full-text index, in order. Changing this list rebuilds the index on next start.
_FTS_COLUMNS = ("path", "new_path", "suggested_filename", "extracted_text", "category")
# How much a match in each of those columns counts: a file's name beats the text inside it.
_FTS_WEIGHTS = (4.0, 6.0, 6.0, 1.0, 3.0)
_MARK_OPEN, _MARK_CLOSE = "\x02", "\x03"
# Rows search looks at: not the bare rows kept for files the scan skipped.
_SEARCHABLE = "COALESCE(files.status, '') != 'skipped'"

# File kinds offered as a filter on the search page.
SEARCH_KINDS: dict[str, frozenset[str]] = {
    "documents": frozenset({".pdf", ".doc", ".docx", ".txt", ".md", ".rtf", ".pages", ".odt", ".epub", ".tex"}),
    "images": frozenset({".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp", ".tif", ".tiff", ".heic", ".heif", ".svg"}),
    "sheets": frozenset({".xls", ".xlsx", ".csv", ".tsv", ".numbers", ".ods"}),
    "slides": frozenset({".ppt", ".pptx", ".key", ".odp"}),
    "media": frozenset({".mp4", ".mov", ".m4v", ".avi", ".mkv", ".webm", ".mp3", ".wav", ".m4a", ".flac", ".aac", ".ogg"}),
    "archives": frozenset({".zip", ".rar", ".7z", ".tar", ".gz", ".bz2", ".xz", ".dmg", ".iso"}),
}


def _disk_identity(path: str) -> tuple[int | None, int | None]:
    """The (device, inode) pair that names a file on disk however it is renamed, or Nones."""
    try:
        st = Path(path).stat()
    except OSError:
        return None, None
    return st.st_dev, st.st_ino


def file_kind(extension: str | None) -> str:
    ext = (extension or "").lower()
    return next((kind for kind, exts in SEARCH_KINDS.items() if ext in exts), "other")


class DatabaseManager:
    """Async SQLite database manager with WAL mode and background write batching."""

    def __init__(self, db_path: str | Path = "data/tidyflow.db"):
        if db_path == "data/tidyflow.db" and getattr(sys, "frozen", False):
            self.db_path = str(get_app_data_dir() / "tidyflow.db")
        else:
            self.db_path = str(db_path)
        self.write_queue: asyncio.Queue | None = None
        self.writer_task: asyncio.Task | None = None
        self._init_db()

    def _init_db(self):
        if self.db_path != ":memory:":
            Path(self.db_path).parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(self.db_path)
        try:
            if self.db_path != ":memory:":
                conn.execute("PRAGMA journal_mode=WAL")
                conn.execute("PRAGMA synchronous=NORMAL")

            # Files table
            conn.execute("""
                CREATE TABLE IF NOT EXISTS files (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    file_id TEXT,
                    path TEXT UNIQUE NOT NULL,
                    fingerprint TEXT,
                    status TEXT DEFAULT 'pending',
                    category TEXT,
                    new_path TEXT,
                    confidence_score REAL,
                    extracted_text TEXT,
                    thumbnail_b64 TEXT,
                    file_size_bytes INTEGER DEFAULT 0,
                    extension TEXT,
                    suggested_filename TEXT,
                    reason TEXT,
                    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)

            # Auto-migrate columns if missing
            for col, col_type in [
                ("thumbnail_b64", "TEXT"),
                ("file_size_bytes", "INTEGER DEFAULT 0"),
                ("extension", "TEXT"),
                ("suggested_filename", "TEXT"),
                ("reason", "TEXT"),
                # Which file this is on disk, so a rename or move in Finder can be followed.
                ("dev", "INTEGER"),
                ("inode", "INTEGER"),
                # Set while the file can't be found anywhere; cleared when it turns up again.
                ("missing_since", "TIMESTAMP"),
            ]:
                try:
                    conn.execute(f"ALTER TABLE files ADD COLUMN {col} {col_type}")
                except sqlite3.OperationalError:
                    pass

            # Token logs table
            conn.execute("""
                CREATE TABLE IF NOT EXISTS token_logs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    provider TEXT,
                    model TEXT,
                    prompt_tokens INTEGER,
                    completion_tokens INTEGER,
                    cost_usd REAL,
                    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)

            # FTS5 Virtual Table. It covers the original path, where the file is now, the name
            # TidyFlow gave it, the text inside and its folder.
            fts_cols = [r[1] for r in conn.execute("PRAGMA table_info(files_fts)").fetchall()]
            rebuild_fts = False
            if fts_cols and fts_cols != list(_FTS_COLUMNS):
                # An older index (it lacked the new name and place): drop it and build it again.
                for trig in ("files_ai", "files_ad", "files_au"):
                    conn.execute(f"DROP TRIGGER IF EXISTS {trig}")
                conn.execute("DROP TABLE IF EXISTS files_fts_vocab")
                conn.execute("DROP TABLE files_fts")
                rebuild_fts = True
            cols = ", ".join(_FTS_COLUMNS)
            new_vals = ", ".join(f"new.{c}" for c in _FTS_COLUMNS)
            old_vals = ", ".join(f"old.{c}" for c in _FTS_COLUMNS)
            conn.execute(f"""
                CREATE VIRTUAL TABLE IF NOT EXISTS files_fts USING fts5(
                    {cols},
                    content='files', content_rowid='id'
                )
            """)
            # The words in the index, used to suggest a spelling when a search finds nothing.
            conn.execute("CREATE VIRTUAL TABLE IF NOT EXISTS files_fts_vocab USING fts5vocab(files_fts, 'row')")

            # Triggers for FTS sync
            conn.execute(f"""
                CREATE TRIGGER IF NOT EXISTS files_ai AFTER INSERT ON files BEGIN
                    INSERT INTO files_fts(rowid, {cols}) VALUES (new.id, {new_vals});
                END;
            """)
            conn.execute(f"""
                CREATE TRIGGER IF NOT EXISTS files_ad AFTER DELETE ON files BEGIN
                    INSERT INTO files_fts(files_fts, rowid, {cols}) VALUES('delete', old.id, {old_vals});
                END;
            """)
            conn.execute(f"""
                CREATE TRIGGER IF NOT EXISTS files_au AFTER UPDATE ON files BEGIN
                    INSERT INTO files_fts(files_fts, rowid, {cols}) VALUES('delete', old.id, {old_vals});
                    INSERT INTO files_fts(rowid, {cols}) VALUES (new.id, {new_vals});
                END;
            """)
            if rebuild_fts:
                conn.execute("INSERT INTO files_fts(files_fts) VALUES('rebuild')")

            # Indexes
            conn.execute("CREATE INDEX IF NOT EXISTS idx_fingerprint ON files(fingerprint)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_status ON files(status)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_category ON files(category)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_dev_inode ON files(dev, inode)")

            # TidyFlow folders, the folders TidyFlow scans, and the Library's undo log.
            library.ensure_schema(conn)

            # Search by meaning: one vector per file, made from its extracted_text (src/semantic).
            conn.execute("""
                CREATE TABLE IF NOT EXISTS file_vectors (
                    file_row_id INTEGER PRIMARY KEY,
                    model_key TEXT NOT NULL,
                    text_hash TEXT NOT NULL,
                    vec BLOB NOT NULL,
                    embedded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            conn.execute("""
                CREATE TRIGGER IF NOT EXISTS files_vectors_ad AFTER DELETE ON files BEGIN
                    DELETE FROM file_vectors WHERE file_row_id = old.id;
                END;
            """)

            # Crash recovery
            conn.execute("UPDATE files SET status='pending' WHERE status='processing'")
            conn.commit()
        finally:
            conn.close()

    async def start(self):
        """Start the background single-writer task."""
        self.write_queue = asyncio.Queue()
        if self.writer_task is None or self.writer_task.done():
            self.writer_task = asyncio.create_task(self._writer_loop())

    async def stop(self):
        """Flush pending writes and cleanly terminate writer task."""
        if self.writer_task and not self.writer_task.done():
            if self.write_queue:
                await self.write_queue.put(None)  # Poison pill
            try:
                await self.writer_task
            except Exception:
                pass
            self.writer_task = None
            self.write_queue = None

    async def _writer_loop(self):
        batch = []
        try:
            while True:
                item = await self.write_queue.get()
                if item is None:
                    if batch:
                        await self._flush(batch)
                    self.write_queue.task_done()
                    break

                batch.append(item)
                self.write_queue.task_done()

                # Pull more available items up to 100
                while not self.write_queue.empty() and len(batch) < 100:
                    try:
                        item = self.write_queue.get_nowait()
                        if item is None:
                            self.write_queue.put_nowait(None)
                            self.write_queue.task_done()
                            break
                        batch.append(item)
                        self.write_queue.task_done()
                    except asyncio.QueueEmpty:
                        break

                if batch:
                    await self._flush(batch)
                    batch.clear()
        finally:
            pass

    async def _flush(self, batch: List[Tuple[str, tuple]]) -> None:
        """Save ``batch``. The writer has to outlive any write that fails, or the ones queued after it are lost."""
        try:
            await asyncio.to_thread(self._execute_batch, self.db_path, batch)
        except Exception as e:
            logger.error("Database writer could not save %d writes: %s", len(batch), e)

    def sync_index_records(self, records: Any) -> int:
        """Synchronously batch insert or update FileRecord items into SQLite and sync FTS5.

        A rescan keeps what organizing did: a file that was copied or moved, and whose contents
        haven't changed, keeps its ``new_path`` and status. Skipped files get a bare ``skipped`` row,
        so a later look for new files doesn't offer them again; search and the Library hide them.
        """
        if not records:
            return 0
        conn = sqlite3.connect(self.db_path)
        try:
            cursor = conn.cursor()
            batch = []
            skipped_rows = []
            for r in records:
                file_id = getattr(r, "file_id", "")
                path = str(getattr(r, "abs_path", getattr(r, "path", "")))
                if not path:
                    continue
                dev, inode = _disk_identity(path)
                if getattr(r, "skipped", False):
                    skipped_rows.append((file_id, path, getattr(r, "extension", "") or Path(path).suffix.lower(),
                                         getattr(r, "file_size_bytes", 0) or 0, dev, inode))
                    continue
                fingerprint = getattr(r, "sha256", "")
                status = "scanned"
                classification = getattr(r, "classification", None)
                category = classification.category if classification else getattr(r, "category", "Unknown")
                confidence = classification.confidence if classification else getattr(r, "confidence", 0.0)
                suggested_filename = (
                    classification.suggested_filename
                    if classification and hasattr(classification, "suggested_filename")
                    else getattr(r, "suggested_filename", "")
                )
                reason = (
                    classification.reason
                    if classification and hasattr(classification, "reason")
                    else getattr(r, "reason", "")
                )
                new_path = ""
                extracted_text = (
                    getattr(r, "extracted_text_normalized", None)
                    or getattr(r, "extracted_text_raw", None)
                    or getattr(r, "extracted_text", "")
                    or ""
                )
                thumbnail_b64 = getattr(r, "thumbnail_b64", None)
                file_size_bytes = getattr(r, "file_size_bytes", 0)
                extension = getattr(r, "extension", "")
                if not extension and path:
                    extension = Path(path).suffix.lower()

                batch.append((
                    file_id, path, fingerprint, status, category, new_path,
                    confidence, extracted_text, thumbnail_b64, file_size_bytes,
                    extension, suggested_filename, reason, dev, inode
                ))

            if batch:
                # Organizing results survive a rescan while the file is unchanged.
                kept = "files.status IN ('copied', 'moved') AND files.fingerprint = excluded.fingerprint"
                cursor.executemany(f"""
                    INSERT INTO files (
                        file_id, path, fingerprint, status, category, new_path,
                        confidence_score, extracted_text, thumbnail_b64, file_size_bytes,
                        extension, suggested_filename, reason, dev, inode
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(path) DO UPDATE SET
                        file_id = excluded.file_id,
                        fingerprint = excluded.fingerprint,
                        status = CASE WHEN {kept} THEN files.status ELSE excluded.status END,
                        category = excluded.category,
                        new_path = CASE WHEN {kept} THEN files.new_path ELSE excluded.new_path END,
                        dev = excluded.dev,
                        inode = excluded.inode,
                        missing_since = NULL,
                        confidence_score = excluded.confidence_score,
                        extracted_text = excluded.extracted_text,
                        thumbnail_b64 = COALESCE(excluded.thumbnail_b64, files.thumbnail_b64),
                        file_size_bytes = excluded.file_size_bytes,
                        extension = excluded.extension,
                        suggested_filename = excluded.suggested_filename,
                        reason = excluded.reason,
                        last_updated = CURRENT_TIMESTAMP
                """, batch)
            if skipped_rows:
                # A file seen before keeps its row; only a new one gets a "skipped" row.
                cursor.executemany(
                    "INSERT OR IGNORE INTO files (file_id, path, status, extension, file_size_bytes, dev, inode) "
                    "VALUES (?, ?, 'skipped', ?, ?, ?, ?)",
                    skipped_rows,
                )
            conn.commit()
            return len(batch)
        except Exception as e:
            logger.error("Failed to batch index records: %s", e)
            conn.rollback()
            raise
        finally:
            conn.close()

    async def index_records(self, records: Any) -> int:
        """Async wrapper to batch index records."""
        return await asyncio.to_thread(self.sync_index_records, records)

    @staticmethod
    def _execute_batch(db_path: str, batch: List[Tuple[str, tuple]]):
        """Run the queued writes in one transaction.

        Each write was queued on its own, so one that fails must not take the others with it: the
        batch is then rolled back and run again one write at a time, and only the failing one is dropped.
        """
        conn = sqlite3.connect(db_path)
        try:
            try:
                for query, params in batch:
                    conn.execute(query, params)
                conn.commit()
                return
            except sqlite3.Error as e:
                conn.rollback()
                if len(batch) == 1:
                    logger.error("Database write failed and was dropped: %s", e)
                    return
                logger.warning("A batch of %d database writes failed (%s); retrying them one at a time", len(batch), e)
            for query, params in batch:
                try:
                    conn.execute(query, params)
                    conn.commit()
                except sqlite3.Error as e:
                    conn.rollback()
                    logger.error("Database write failed and was dropped: %s", e)
        finally:
            conn.close()

    async def execute_write(self, query: str, params: tuple = ()):
        """Queue a write operation for the single writer worker."""
        try:
            curr_loop = asyncio.get_running_loop()
        except RuntimeError:
            curr_loop = None

        if self.write_queue is None:
            self.write_queue = asyncio.Queue()
        elif curr_loop is not None and getattr(self.write_queue, "_loop", None) not in (None, curr_loop):
            self.write_queue = asyncio.Queue()

        if self.writer_task is None or self.writer_task.done():
            self.writer_task = asyncio.create_task(self._writer_loop())
        await self.write_queue.put((query, params))

    async def execute_read(self, query: str, params: tuple = ()) -> List[dict]:
        """Execute a read query immediately."""
        def _read():
            conn = sqlite3.connect(self.db_path)
            try:
                conn.row_factory = sqlite3.Row
                cursor = conn.cursor()
                cursor.execute(query, params)
                return [dict(row) for row in cursor.fetchall()]
            finally:
                conn.close()
        return await asyncio.to_thread(_read)

    async def search(self, query: str) -> List[dict]:
        """The first page of matches for ``query`` (see ``search_page``)."""
        return (await self.search_page(query))["results"]

    async def search_page(
        self,
        query: str,
        *,
        limit: int = 30,
        offset: int = 0,
        category: str | None = None,
        kind: str | None = None,
        organized: bool | None = None,
        folder: int | str | None = None,
        include_subfolders: bool = True,
        ids_only: bool = False,
        meaning: list[tuple[int, float]] | None = None,
    ) -> dict:
        """One page of files matching ``query``, best first, with counts for the filters.

        ``folder`` keeps files in that TidyFlow folder (and its subfolders, unless
        ``include_subfolders`` is false), or with ``"unsorted"`` files in no folder. Each result
        lists the TidyFlow folders it is in; ``facets["folders"]`` counts matches per top-level
        folder and ``facets["unsorted"]`` those in none. ``ids_only`` returns just
        ``{"ids", "total"}``: every match after the filters, for acting on all of them.

        Whole words and word beginnings are matched through the full-text index, with names ranked
        above the text inside a file. Names are also matched anywhere inside a word, and a search
        that finds nothing is tried again with the closest spelling found in the index.

        ``meaning`` is ``(row id, similarity)`` for files that match by meaning (see
        ``src/semantic``). Those not already found by their words come after every word match, in
        that order, marked ``"match": "meaning"``; filters, counts and paging treat them like any
        other match. ``ids_only`` leaves them out, so acting on "all matches" only takes files that
        contain the words.

        Returns ``{"results", "total", "facets", "corrected", "meaning_total"}``. ``facets`` counts
        every match before the filters; ``corrected`` is the query that was searched instead, if
        any; ``meaning_total`` is how many of ``total`` matched by meaning alone.
        Snippets are HTML-escaped and wrap matches in ``<mark>``.
        """
        clean_query = query.strip()
        empty = {
            "results": [], "total": 0, "corrected": None, "meaning_total": 0,
            "facets": {"categories": {}, "kinds": {}, "organized": 0, "unorganized": 0, "folders": [], "unsorted": 0},
        }
        if not clean_query:
            return {"ids": [], "total": 0} if ids_only else empty
        limit = max(1, min(int(limit), 100))
        offset = max(0, int(offset))

        def _search() -> dict:
            conn = sqlite3.connect(self.db_path)
            try:
                conn.row_factory = sqlite3.Row
                tokens = re.findall(r"\w+", clean_query)
                matches: dict[int, sqlite3.Row] = {}  # insertion order is the ranking
                light = "files.id, files.category, files.extension, files.new_path, files.status"

                def fts_expr(toks: list[str]) -> str:
                    return " AND ".join(f'"{t}"*' for t in toks)

                def run_fts(toks: list[str]) -> None:
                    weights = ", ".join(str(w) for w in _FTS_WEIGHTS)
                    try:
                        rows = conn.execute(
                            f"SELECT {light} FROM files_fts JOIN files ON files.id = files_fts.rowid "
                            f"WHERE files_fts MATCH ? AND {_SEARCHABLE} ORDER BY bm25(files_fts, {weights}) LIMIT 2000",
                            (fts_expr(toks),),
                        ).fetchall()
                    except sqlite3.OperationalError as e:
                        logger.warning("FTS MATCH error for %r: %s", toks, e)
                        return
                    for row in rows:
                        matches.setdefault(row["id"], row)

                def run_like(columns: tuple[str, ...]) -> None:
                    like = "%" + clean_query.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
                    where = " OR ".join(f"{c} LIKE ? ESCAPE '\\'" for c in columns)
                    rows = conn.execute(
                        f"SELECT {light} FROM files WHERE ({where}) AND {_SEARCHABLE} ORDER BY id DESC LIMIT 500",
                        (like,) * len(columns),
                    ).fetchall()
                    for row in rows:
                        matches.setdefault(row["id"], row)

                used_tokens = tokens
                corrected = None
                if tokens:
                    run_fts(tokens)
                # Names also match in the middle of a word ("voice" finds "invoice.pdf").
                run_like(("path", "new_path", "suggested_filename"))
                if not matches:
                    run_like(("extracted_text", "category"))
                if not matches and tokens:
                    fixed = [_closest_word(conn, t) or t for t in tokens]
                    if fixed != [t.lower() for t in tokens]:
                        run_fts(fixed)
                        if matches:
                            used_tokens, corrected = fixed, " ".join(fixed)

                # Files that match by meaning but not by their words come after every word match.
                by_meaning: dict[int, float] = {}
                extra = [(rid, score) for rid, score in (meaning or []) if rid not in matches]
                if extra:
                    marks = ",".join("?" * len(extra))
                    found = {
                        r["id"]: r
                        for r in conn.execute(
                            f"SELECT {light} FROM files WHERE id IN ({marks}) AND {_SEARCHABLE}", [r for r, _ in extra]
                        )
                    }
                    for rid, score in extra:
                        if rid in found:
                            matches[rid] = found[rid]
                            by_meaning[rid] = score

                # TidyFlow folders: the tree, and which folders each match is in.
                tree = {
                    r[0]: {"id": r[0], "name": r[1], "parent_id": r[2], "is_real": bool(r[3])}
                    for r in conn.execute("SELECT id, name, parent_id, disk_path FROM folders")
                }

                def trail(fid: int) -> list[dict]:
                    out: list[dict] = []
                    node = tree.get(fid)
                    while node is not None and len(out) < 32:
                        out.insert(0, node)
                        node = tree.get(node["parent_id"]) if node["parent_id"] is not None else None
                    return out

                member: dict[int, list[int]] = {}
                match_ids = list(matches)
                for start in range(0, len(match_ids), 900):
                    part = match_ids[start:start + 900]
                    marks = ",".join("?" * len(part))
                    for file_row_id, folder_id in conn.execute(
                        f"SELECT file_row_id, folder_id FROM folder_files WHERE file_row_id IN ({marks})", part
                    ):
                        if folder_id in tree:
                            member.setdefault(file_row_id, []).append(folder_id)

                scope: set[int] | None = None
                if isinstance(folder, int):
                    scope = {folder}
                    if include_subfolders:
                        frontier = [folder]
                        while frontier:
                            frontier = [f["id"] for f in tree.values() if f["parent_id"] in frontier and f["id"] not in scope]
                            scope.update(frontier)

                # Counts for the filter chips, over every match.
                facets = {"categories": {}, "kinds": {}, "organized": 0, "unorganized": 0}
                top_counts: dict[int, int] = {}
                unsorted = 0
                kept: list[int] = []
                for row_id, row in matches.items():
                    in_folders = member.get(row_id, [])
                    tops = {t[0]["id"] for t in (trail(f) for f in in_folders) if t}
                    for top in tops:
                        top_counts[top] = top_counts.get(top, 0) + 1
                    if not in_folders:
                        unsorted += 1
                    cat = row["category"] or "Unknown"
                    row_kind = file_kind(row["extension"])
                    is_organized = bool(row["new_path"]) and row["status"] in ("copied", "moved")
                    facets["categories"][cat] = facets["categories"].get(cat, 0) + 1
                    facets["kinds"][row_kind] = facets["kinds"].get(row_kind, 0) + 1
                    facets["organized" if is_organized else "unorganized"] += 1
                    if category and cat != category:
                        continue
                    if kind and row_kind != kind:
                        continue
                    if organized is not None and is_organized != organized:
                        continue
                    if folder == "unsorted" and in_folders:
                        continue
                    if scope is not None and not scope.intersection(in_folders):
                        continue
                    kept.append(row_id)

                facets["folders"] = sorted(
                    ({**tree[fid], "count": n} for fid, n in top_counts.items()),
                    key=lambda f: (-f["count"], f["name"].lower()),
                )
                for f in facets["folders"]:
                    f.pop("parent_id", None)
                facets["unsorted"] = unsorted
                if ids_only:
                    words = [rid for rid in kept if rid not in by_meaning]
                    return {"ids": words[:5000], "total": len(words)}
                meaning_total = sum(1 for rid in kept if rid in by_meaning)

                page_ids = kept[offset:offset + limit]
                if not page_ids:
                    return {"results": [], "total": len(kept), "facets": facets, "corrected": corrected,
                            "meaning_total": meaning_total}

                marks = ",".join("?" * len(page_ids))
                rows = {
                    r["id"]: dict(r)
                    for r in conn.execute(
                        "SELECT id, file_id, path, new_path, status, category, confidence_score, fingerprint, "
                        "thumbnail_b64, file_size_bytes, extension, suggested_filename, reason, "
                        f"substr(extracted_text, 1, 20000) AS extracted_text FROM files WHERE id IN ({marks})",
                        page_ids,
                    )
                }
                snippets: dict[int, str] = {}
                if used_tokens:
                    try:
                        text_col = _FTS_COLUMNS.index("extracted_text")
                        for r in conn.execute(
                            f"SELECT rowid, snippet(files_fts, {text_col}, '{_MARK_OPEN}', '{_MARK_CLOSE}', '…', 16) AS s "
                            f"FROM files_fts WHERE files_fts MATCH ? AND rowid IN ({marks})",
                            (fts_expr(used_tokens), *page_ids),
                        ):
                            snippets[r["rowid"]] = r["s"] or ""
                    except sqlite3.OperationalError as e:
                        logger.warning("FTS snippet error: %s", e)

                results = []
                for row_id in page_ids:
                    d = rows.get(row_id)
                    if d is None:
                        continue
                    text = d.pop("extracted_text") or ""
                    raw = snippets.get(row_id)
                    if row_id in by_meaning:
                        # No words to point at: show how the file's text begins.
                        d["match"] = "meaning"
                        d["meaning_score"] = round(by_meaning[row_id], 4)
                        d["snippet"] = _make_like_snippet(" ".join(text.split()), "", max_len=200)
                    elif raw is not None and _MARK_OPEN in raw:
                        d["match"] = "words"
                        d["snippet"] = _marked_html(raw)
                    else:
                        d["match"] = "words"
                        d["snippet"] = _make_like_snippet(text, " ".join(used_tokens) or clean_query)
                    d["has_text"] = bool(text.strip())
                    d["folders"] = sorted(
                        (
                            {
                                "id": fid,
                                "name": tree[fid]["name"],
                                "is_real": tree[fid]["is_real"],
                                # Where it sits in the tree, e.g. "Finance / Bills".
                                "label": " / ".join(n["name"] for n in trail(fid)),
                            }
                            for fid in member.get(row_id, [])
                        ),
                        key=lambda f: f["label"].lower(),
                    )
                    results.append(d)
                return {"results": results, "total": len(kept), "facets": facets, "corrected": corrected,
                        "meaning_total": meaning_total}
            finally:
                conn.close()

        return await asyncio.to_thread(_search)

    async def search_stats(self) -> dict:
        """How much the search covers: file counts and the folders with the most files."""
        def _stats() -> dict:
            conn = sqlite3.connect(self.db_path)
            try:
                files, with_text = conn.execute(
                    "SELECT count(*), coalesce(sum(extracted_text IS NOT NULL AND trim(extracted_text) != ''), 0) "
                    f"FROM files WHERE {_SEARCHABLE}"
                ).fetchone()
                cats = conn.execute(
                    "SELECT category, count(*) FROM files WHERE category IS NOT NULL AND category NOT IN ('', 'Unknown') "
                    "GROUP BY category ORDER BY count(*) DESC LIMIT 8"
                ).fetchall()
                return {"files": files, "with_text": with_text, "categories": [{"name": c, "count": n} for c, n in cats]}
            finally:
                conn.close()
        return await asyncio.to_thread(_stats)

    async def log_tokens(self, provider: str, model: str, prompt_tokens: int, completion_tokens: int, cost_usd: float):
        """Record LLM token usage and estimated cost."""
        await self.execute_write(
            "INSERT INTO token_logs (provider, model, prompt_tokens, completion_tokens, cost_usd) VALUES (?, ?, ?, ?, ?)",
            (provider, model, prompt_tokens, completion_tokens, cost_usd)
        )


def _marked_html(text: str) -> str:
    """Escape ``text`` for HTML and turn the match markers into ``<mark>`` tags."""
    return html.escape(text, quote=False).replace(_MARK_OPEN, "<mark>").replace(_MARK_CLOSE, "</mark>")


def _make_like_snippet(text: str, query: str, max_len: int = 160) -> str:
    """A short, HTML-escaped piece of ``text`` around the first match, with matches in ``<mark>``."""
    if not text:
        return ""
    text = text.replace(_MARK_OPEN, "").replace(_MARK_CLOSE, "")
    tokens = [re.escape(t) for t in re.findall(r"\w+", query or "") if t]
    pattern = re.compile(f"({'|'.join(tokens)})", re.IGNORECASE) if tokens else None
    match = pattern.search(text) if pattern else None
    if not match:
        return html.escape(text[:max_len], quote=False) + ("…" if len(text) > max_len else "")

    start = max(0, match.start() - 40)
    end = min(len(text), match.end() + 80)
    snippet = pattern.sub(f"{_MARK_OPEN}\\1{_MARK_CLOSE}", text[start:end])
    return ("…" if start > 0 else "") + _marked_html(snippet) + ("…" if end < len(text) else "")


def _closest_word(conn: sqlite3.Connection, token: str) -> str | None:
    """The indexed word nearest to a misspelt ``token``; None if it is already a word or nothing is close."""
    tok = token.lower()
    if len(tok) < 4 or tok.isdigit():
        return None
    try:
        # Already a word, or the beginning of one: nothing to fix.
        if conn.execute(
            "SELECT 1 FROM files_fts_vocab WHERE term >= ? AND term < ? LIMIT 1", (tok, tok + "￿")
        ).fetchone():
            return None
        # Typos rarely hit the first letter, which keeps the list to compare against short.
        candidates = dict(
            conn.execute(
                "SELECT term, doc FROM files_fts_vocab WHERE term >= ? AND term < ? AND length(term) BETWEEN ? AND ?",
                (tok[0], tok[0] + "￿", len(tok) - 2, len(tok) + 2),
            ).fetchall()
        )
    except sqlite3.OperationalError as e:
        logger.debug("Spelling lookup failed: %s", e)
        return None
    close = difflib.get_close_matches(tok, candidates.keys(), n=5, cutoff=0.75)
    if not close:
        return None
    # Among near-equal spellings prefer the word found in more files.
    best = difflib.SequenceMatcher(None, tok, close[0]).ratio()
    near = [w for w in close if difflib.SequenceMatcher(None, tok, w).ratio() >= best - 0.05]
    return max(near, key=lambda w: candidates[w])
