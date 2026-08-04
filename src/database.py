import sqlite3
import asyncio
import logging
from typing import List, Tuple, Any
from pathlib import Path

logger = logging.getLogger(__name__)

class DatabaseManager:
    def __init__(self, db_path: str = "data/tidyflow.db"):
        self.db_path = db_path
        self.write_queue = None
        self.writer_task = None
        self._init_db()

    def _init_db(self):
        Path(self.db_path).parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(self.db_path)
        try:
            # Enable WAL mode for concurrent reads while writing
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("PRAGMA synchronous=NORMAL")
            
            # Create files table with required schema
            conn.execute("""
                CREATE TABLE IF NOT EXISTS files (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
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
            
            # Indexes for fast lookup
            conn.execute("CREATE INDEX IF NOT EXISTS idx_fingerprint ON files(fingerprint)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_status ON files(status)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_category ON files(category)")
            
            # Crash recovery reconciliation: anything 'processing' is reset to 'pending'
            conn.execute("UPDATE files SET status='pending' WHERE status='processing'")
            conn.commit()
        finally:
            conn.close()
            
    async def start(self):
        """Starts the single-writer coroutine."""
        if self.write_queue is None:
            self.write_queue = asyncio.Queue()
        self.writer_task = asyncio.create_task(self._writer_loop())
        
    async def stop(self):
        """Stops the single-writer coroutine and ensures all pending writes are committed."""
        if self.writer_task:
            if self.write_queue:
                await self.write_queue.put(None) # Poison pill
            await self.writer_task
            self.writer_task = None
            self.write_queue = None
            
    async def _writer_loop(self):
        batch = []
        try:
            while True:
                # Wait for at least one item
                item = await self.write_queue.get()
                if item is None:
                    # Flush remaining batch
                    if batch:
                        await asyncio.to_thread(self._execute_batch, self.db_path, batch)
                    self.write_queue.task_done()
                    break
                    
                batch.append(item)
                self.write_queue.task_done()
                
                # Try to pull more items immediately if available to batch them (max 100)
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
                    # Execute batch in a separate thread so we don't block the async event loop
                    await asyncio.to_thread(self._execute_batch, self.db_path, batch)
                    batch.clear()
        finally:
            pass

    def _execute_batch(self, db_path: str, batch: List[Tuple[str, tuple]]):
        conn = sqlite3.connect(db_path)
        try:
            cursor = conn.cursor()
            for query, params in batch:
                cursor.execute(query, params)
            conn.commit()
        except sqlite3.Error as e:
            logger.error(f"Database batch write error: {e}")
            conn.rollback()
            raise
        finally:
            conn.close()

    async def execute_write(self, query: str, params: tuple = ()):
        """Queues a write operation to be batched and executed by the single writer coroutine."""
        if self.write_queue is None:
            self.write_queue = asyncio.Queue()
        await self.write_queue.put((query, params))

    async def execute_read(self, query: str, params: tuple = ()) -> List[dict]:
        """Executes a read operation immediately (reads can be concurrent in WAL mode)."""
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
