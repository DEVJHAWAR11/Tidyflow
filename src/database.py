"""SQLite WAL database manager with async single-writer queue and FTS5 search."""

from __future__ import annotations

import asyncio
import logging
import sqlite3
from pathlib import Path
from typing import Any, List, Tuple

logger = logging.getLogger(__name__)


class DatabaseManager:
    """Async SQLite database manager with WAL mode and background write batching."""

    def __init__(self, db_path: str | Path = "data/tidyflow.db"):
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

            # FTS5 Virtual Table
            conn.execute("""
                CREATE VIRTUAL TABLE IF NOT EXISTS files_fts USING fts5(
                    path, extracted_text, category,
                    content='files', content_rowid='id'
                )
            """)

            # Triggers for FTS sync
            conn.execute("""
                CREATE TRIGGER IF NOT EXISTS files_ai AFTER INSERT ON files BEGIN
                    INSERT INTO files_fts(rowid, path, extracted_text, category)
                    VALUES (new.id, new.path, new.extracted_text, new.category);
                END;
            """)
            conn.execute("""
                CREATE TRIGGER IF NOT EXISTS files_ad AFTER DELETE ON files BEGIN
                    INSERT INTO files_fts(files_fts, rowid, path, extracted_text, category)
                    VALUES('delete', old.id, old.path, old.extracted_text, old.category);
                END;
            """)
            conn.execute("""
                CREATE TRIGGER IF NOT EXISTS files_au AFTER UPDATE ON files BEGIN
                    INSERT INTO files_fts(files_fts, rowid, path, extracted_text, category)
                    VALUES('delete', old.id, old.path, old.extracted_text, old.category);
                    INSERT INTO files_fts(rowid, path, extracted_text, category)
                    VALUES (new.id, new.path, new.extracted_text, new.category);
                END;
            """)

            # Indexes
            conn.execute("CREATE INDEX IF NOT EXISTS idx_fingerprint ON files(fingerprint)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_status ON files(status)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_category ON files(category)")

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
                        await asyncio.to_thread(self._execute_batch, self.db_path, batch)
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
                    await asyncio.to_thread(self._execute_batch, self.db_path, batch)
                    batch.clear()
        finally:
            pass

    def sync_index_records(self, records: Any) -> int:
        """Synchronously batch insert or update FileRecord items into SQLite and sync FTS5."""
        if not records:
            return 0
        conn = sqlite3.connect(self.db_path)
        try:
            cursor = conn.cursor()
            batch = []
            for r in records:
                if getattr(r, "skipped", False):
                    continue
                file_id = getattr(r, "file_id", "")
                path = str(getattr(r, "abs_path", getattr(r, "path", "")))
                if not path:
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
                    extension, suggested_filename, reason
                ))

            if batch:
                cursor.executemany("""
                    INSERT INTO files (
                        file_id, path, fingerprint, status, category, new_path,
                        confidence_score, extracted_text, thumbnail_b64, file_size_bytes,
                        extension, suggested_filename, reason
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(path) DO UPDATE SET
                        file_id = excluded.file_id,
                        fingerprint = excluded.fingerprint,
                        status = excluded.status,
                        category = excluded.category,
                        new_path = excluded.new_path,
                        confidence_score = excluded.confidence_score,
                        extracted_text = excluded.extracted_text,
                        thumbnail_b64 = COALESCE(excluded.thumbnail_b64, files.thumbnail_b64),
                        file_size_bytes = excluded.file_size_bytes,
                        extension = excluded.extension,
                        suggested_filename = excluded.suggested_filename,
                        reason = excluded.reason,
                        last_updated = CURRENT_TIMESTAMP
                """, batch)
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
        conn = sqlite3.connect(db_path)
        try:
            cursor = conn.cursor()
            for query, params in batch:
                cursor.execute(query, params)
            conn.commit()
        except sqlite3.Error as e:
            logger.error("Database batch write error: %s", e)
            conn.rollback()
            raise
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
        """Full-text search across indexed files with FTS5 and LIKE fallback."""
        clean_query = query.strip()
        if not clean_query:
            return []

        def _search():
            import re
            conn = sqlite3.connect(self.db_path)
            try:
                conn.row_factory = sqlite3.Row
                cursor = conn.cursor()

                # 1. Sanitize query into FTS5 tokens
                tokens = re.findall(r'[A-Za-z0-9_]+', clean_query)
                results = []

                if tokens:
                    fts_syntax = " AND ".join(f'"{tok}"*' for tok in tokens)
                    try:
                        sql_fts = """
                            SELECT files.id, files.file_id, files.path, files.category,
                                   files.confidence_score, files.extracted_text,
                                   files.thumbnail_b64, files.file_size_bytes, files.extension,
                                   files.suggested_filename, files.reason,
                                   snippet(files_fts, -1, '<b>', '</b>', '...', 12) as snippet
                            FROM files_fts
                            JOIN files ON files.id = files_fts.rowid
                            WHERE files_fts MATCH ?
                            ORDER BY rank
                            LIMIT 30
                        """
                        cursor.execute(sql_fts, (fts_syntax,))
                        rows = cursor.fetchall()
                        for row in rows:
                            d = dict(row)
                            if not d.get("snippet") and d.get("extracted_text"):
                                d["snippet"] = _make_like_snippet(d["extracted_text"], clean_query)
                            results.append(d)
                    except sqlite3.OperationalError as e:
                        logger.warning("FTS MATCH error for '%s': %s", fts_syntax, e)

                # 2. Fallback to LIKE search if FTS returned 0 results
                if not results:
                    like_param = f"%{clean_query}%"
                    sql_like = """
                        SELECT id, file_id, path, category, confidence_score, extracted_text,
                               thumbnail_b64, file_size_bytes, extension, suggested_filename, reason,
                               '' as snippet
                        FROM files
                        WHERE path LIKE ? OR category LIKE ? OR extracted_text LIKE ?
                        ORDER BY id DESC
                        LIMIT 30
                    """
                    cursor.execute(sql_like, (like_param, like_param, like_param))
                    rows = cursor.fetchall()
                    for row in rows:
                        d = dict(row)
                        src_text = d.get("extracted_text") or d.get("path") or ""
                        d["snippet"] = _make_like_snippet(src_text, clean_query)
                        results.append(d)

                return results
            finally:
                conn.close()

        return await asyncio.to_thread(_search)

    async def log_tokens(self, provider: str, model: str, prompt_tokens: int, completion_tokens: int, cost_usd: float):
        """Record LLM token usage and estimated cost."""
        await self.execute_write(
            "INSERT INTO token_logs (provider, model, prompt_tokens, completion_tokens, cost_usd) VALUES (?, ?, ?, ?, ?)",
            (provider, model, prompt_tokens, completion_tokens, cost_usd)
        )


def _make_like_snippet(text: str, query: str, max_len: int = 160) -> str:
    """Generate snippet with <b> highlighting for LIKE search fallback."""
    import re
    if not text or not query:
        return ""
    tokens = [re.escape(t) for t in re.findall(r'[A-Za-z0-9_]+', query) if t]
    if not tokens:
        return text[:max_len] + ("..." if len(text) > max_len else "")

    pattern = re.compile(f"({'|'.join(tokens)})", re.IGNORECASE)
    match = pattern.search(text)
    if not match:
        return text[:max_len] + ("..." if len(text) > max_len else "")

    start = max(0, match.start() - 40)
    end = min(len(text), match.end() + 80)
    snippet = text[start:end]
    if start > 0:
        snippet = "..." + snippet
    if end < len(text):
        snippet = snippet + "..."
    return pattern.sub(r"<b>\1</b>", snippet)
