import pytest
import tempfile
import asyncio
from pathlib import Path
from src.database import DatabaseManager
from src.main_loop import Processor
from src.mcp_server import set_allowed_directories

@pytest.fixture(autouse=True)
def setup_teardown():
    # Make sure we use a test db for tests
    db = DatabaseManager(db_path=":memory:")
    yield
    if hasattr(db, 'conn') and db.conn:
        db.conn.close()

@pytest.mark.asyncio
async def test_e2e_flow():
    with tempfile.TemporaryDirectory() as temp_dir:
        db_path = str(Path(temp_dir) / "test.db")
        
        processor = Processor(max_concurrent=2)
        processor.db = DatabaseManager(db_path=db_path)
        await processor.start()
        
        test_file = Path(temp_dir) / "test.pdf"
        test_file.write_text("dummy pdf")
        set_allowed_directories([temp_dir])
        
        await processor.add_file(str(test_file))
        await asyncio.wait_for(processor.queue.join(), timeout=5.0)
        
        assert processor.processed_count == 1
        
        await processor.stop()
