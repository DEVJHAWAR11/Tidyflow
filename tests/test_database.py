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
