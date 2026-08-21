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
                    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)

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
        """Full-text search across indexed files."""
        sql = """
            SELECT files.id, files.path, files.category, snippet(files_fts, 1, '<b>', '</b>', '...', 10) as snippet
            FROM files_fts
            JOIN files ON files.id = files_fts.rowid
            WHERE files_fts MATCH ?
            ORDER BY rank
            LIMIT 20
        """
        return await self.execute_read(sql, (query,))

    async def log_tokens(self, provider: str, model: str, prompt_tokens: int, completion_tokens: int, cost_usd: float):
        """Record LLM token usage and estimated cost."""
        await self.execute_write(
            "INSERT INTO token_logs (provider, model, prompt_tokens, completion_tokens, cost_usd) VALUES (?, ?, ?, ?, ?)",
            (provider, model, prompt_tokens, completion_tokens, cost_usd)
        )
