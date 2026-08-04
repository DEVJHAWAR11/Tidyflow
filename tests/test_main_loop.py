import pytest
import asyncio
import tempfile
from pathlib import Path
from src.main_loop import Processor
from src.database import DatabaseManager

@pytest.fixture(autouse=True)
def setup_teardown():
    # Make sure we use a test db for tests
    db = DatabaseManager(db_path=":memory:")
    yield
    if hasattr(db, 'conn') and db.conn:
        db.conn.close()

@pytest.mark.asyncio
async def test_processor_concurrency():
    with tempfile.TemporaryDirectory() as temp_dir:
        db_path = str(Path(temp_dir) / "test_tidyflow.db")
        
        # Create 50 dummy files
        files = []
        for i in range(50):
            p = Path(temp_dir) / f"file_{i}.txt"
            p.write_text("dummy text")
            files.append(str(p))
            
        processor = Processor(max_concurrent=5)
        processor.db = DatabaseManager(db_path=db_path)
        
        await processor.start(num_workers=5)
        
        for f in files:
            await processor.add_file(f)
            
        # Wait for all files to be processed
        # A timeout just in case it hangs
        await asyncio.wait_for(processor.queue.join(), timeout=10.0)
        
        assert processor.processed_count == 50
        
        await processor.stop()
        
        # Verify db contents
        rows = await processor.db.execute_read("SELECT COUNT(*) as count FROM files")
        assert rows[0]["count"] == 50
