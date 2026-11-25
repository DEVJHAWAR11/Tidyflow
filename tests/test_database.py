import pytest
import asyncio
import os
import sqlite3
from src.database import DatabaseManager

DB_PATH = "data/test_tidyflow.db"

@pytest.fixture(autouse=True)
def clean_db():
    for ext in ["", "-wal", "-shm"]:
        if os.path.exists(DB_PATH + ext):
            try:
                os.remove(DB_PATH + ext)
            except PermissionError:
                pass
    yield
    for ext in ["", "-wal", "-shm"]:
        if os.path.exists(DB_PATH + ext):
            try:
                os.remove(DB_PATH + ext)
            except PermissionError:
                pass

@pytest.mark.asyncio
async def test_database_init_and_crash_recovery():
    # Setup a DB directly using the manager, then insert a 'processing' item
    db1 = DatabaseManager(db_path=DB_PATH)
    await db1.start()
    await db1.execute_write("INSERT INTO files (path, status) VALUES (?, ?)", ("test_path.txt", "processing"))
    await db1.stop()

    # Now init a new manager; it should run the crash recovery reconciliation
    db2 = DatabaseManager(db_path=DB_PATH)
    
    # Check that status was updated to pending
    rows = await db2.execute_read("SELECT status FROM files WHERE path=?", ("test_path.txt",))
    assert len(rows) == 1
    assert rows[0]['status'] == 'pending'

@pytest.mark.asyncio
async def test_single_writer_coroutine():
    db = DatabaseManager(db_path=DB_PATH)
    await db.start()
    
    # Queue a bunch of writes
    for i in range(50):
        await db.execute_write("INSERT INTO files (path, category) VALUES (?, ?)", (f"file_{i}.txt", "test"))
        
    # Wait for the writer to flush by stopping it
    await db.stop()
    
    # Read the data back
    rows = await db.execute_read("SELECT COUNT(*) as count FROM files")
    assert rows[0]['count'] == 50


@pytest.mark.asyncio
async def test_one_failed_write_does_not_lose_the_rest_of_its_batch(tmp_path):
    db = DatabaseManager(db_path=tmp_path / "t.db")
    await db.start()
    await db.execute_write("INSERT INTO files (path) VALUES (?)", ("a.txt",))
    await db.execute_write("INSERT INTO files (path) VALUES (?)", ("a.txt",))  # breaks UNIQUE(path)
    await db.execute_write("INSERT INTO files (path) VALUES (?)", ("b.txt",))
    await db.stop()

    rows = await db.execute_read("SELECT path FROM files ORDER BY path")
    assert [r["path"] for r in rows] == ["a.txt", "b.txt"]


@pytest.mark.asyncio
async def test_writes_queued_behind_a_failed_one_are_still_saved(tmp_path):
    db = DatabaseManager(db_path=tmp_path / "t.db")
    await db.start()
    await db.execute_write("INSERT INTO no_such_table VALUES (1)")
    await asyncio.sleep(0)  # the writer takes that write and starts saving it
    await db.execute_write("INSERT INTO files (path) VALUES (?)", ("later.txt",))
    await db.stop()

    rows = await db.execute_read("SELECT path FROM files")
    assert [r["path"] for r in rows] == ["later.txt"]
