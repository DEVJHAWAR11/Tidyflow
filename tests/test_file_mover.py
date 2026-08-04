import pytest
import tempfile
import os
from pathlib import Path
from src.database import DatabaseManager
from src.file_mover import FileMover
from src.mcp_server import set_allowed_directories

@pytest.fixture(autouse=True)
def setup_teardown():
    # Make sure we use a test db for tests
    db = DatabaseManager(db_path=":memory:")
    yield
    if hasattr(db, 'conn') and db.conn:
        db.conn.close()

@pytest.mark.asyncio
async def test_safe_move():
    with tempfile.TemporaryDirectory() as temp_dir:
        db_path = str(Path(temp_dir) / "test.db")
        db = DatabaseManager(db_path=db_path)
        await db.start()
        
        mover = FileMover(db)
        
        # setup allowed dirs
        safe_dir = Path(temp_dir) / "safe"
        safe_dir.mkdir()
        set_allowed_directories([str(safe_dir)])
        
        src_file = safe_dir / "test.txt"
        src_file.write_text("Hello world")
        
        # Add to DB
        await db.execute_write("INSERT INTO files (path, status) VALUES (?, ?)", (str(src_file), "pending"))
        
        target_file = safe_dir / "target.txt"
        
        # Move
        success = await mover.safe_move(str(src_file), str(target_file))
        
        assert success is True
        assert not src_file.exists()
        assert target_file.exists()
        
        # Flush DB and close connection to avoid PermissionError on Windows
        await db.stop()
        
        # Check DB manually
        import sqlite3
        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row
        rows = conn.execute("SELECT status, new_path FROM files WHERE path = ?", (str(src_file),)).fetchall()
        conn.close()
        
        assert len(rows) > 0

def test_target_path():
    with tempfile.TemporaryDirectory() as temp_dir:
        src_file = Path(temp_dir) / "test.txt"
        src_file.write_text("hello")
        
        mover = FileMover(None)
        target = mover.determine_target_path(temp_dir, "Documents", str(src_file))
        
        # It should contain Documents/YYYY/MM/test.txt
        assert "Documents" in target
        assert "test.txt" in target
