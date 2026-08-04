import asyncio
from typing import List
from src.graph import app
from src.database import DatabaseManager

class Processor:
    def __init__(self, max_concurrent: int = 5):
        self.queue = asyncio.Queue()
        self.semaphore = asyncio.Semaphore(max_concurrent)
        self.db = DatabaseManager()
        self._workers = []
        self.processed_count = 0

    async def add_file(self, file_path: str):
        await self.queue.put(file_path)

    async def _worker(self):
        while True:
            file_path = await self.queue.get()
            try:
                async with self.semaphore:
                    # kick off the langgraph pipeline for this file
                    initial_state = {"file_path": file_path}
                    result = await app.ainvoke(initial_state)
                    
                    # stash what we figured out into the database
                    await self.db.execute_write(
                        "INSERT OR IGNORE INTO files (path, extracted_text, category) VALUES (?, ?, ?)",
                        (
                            str(result.get("file_path")), 
                            str(result.get("extracted_text", ""))[:100], 
                            str(result.get("category", "unknown"))
                        )
                    )
                    self.processed_count += 1
            except asyncio.CancelledError:
                break
            except Exception as e:
                print(f"Error processing {file_path}: {e}")
            finally:
                self.queue.task_done()

    async def start(self, num_workers: int = 5):
        await self.db.start()
        for _ in range(num_workers):
            task = asyncio.create_task(self._worker())
            self._workers.append(task)

    async def stop(self):
        await self.queue.join()
        for task in self._workers:
            task.cancel()
        await asyncio.gather(*self._workers, return_exceptions=True)
        await self.db.stop()
