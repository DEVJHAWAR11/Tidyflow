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


def _rec(rel_path, category, confidence, source="llm"):
    from src.models import ClassificationResult, FileRecord

    return FileRecord(
        file_id=rel_path,
        abs_path=Path("/x") / rel_path,
        rel_path=Path(rel_path),
        filename=Path(rel_path).name,
        extension=Path(rel_path).suffix,
        file_size_bytes=1,
        classification=ClassificationResult(
            category=category,
            confidence=confidence,
            action="copy_to_organized" if confidence >= 0.85 else "manual_review",
            source=source,
        ),
    )


def test_folder_agreement_promotes_near_misses_that_match_their_folder():
    from src.main_loop import promote_by_folder_agreement

    sure = [_rec(f"dsa/{n}. Lesson/Practice Questions.pdf", "Academic/DSA", 0.9) for n in range(10, 14)]
    videos = [_rec(f"dsa/7. Operators/{n}.mp4", "Media/Video", 0.9, source="extension_rule") for n in range(5)]
    near = _rec("dsa/7. Operators/Practice Questions.pdf", "Academic/DSA", 0.80)
    unsure = _rec("dsa/50. Study/DBMS_Notes.pdf", "Academic/DSA", 0.55)
    other = _rec("dsa/50. Study/Helpful Projects.pdf", "Development/Code", 0.80)
    loose = _rec("ticket.pdf", "Documents", 0.80)

    assert promote_by_folder_agreement(sure + videos + [near, unsure, other, loose], 0.85) == 1
    assert near.classification.action == "copy_to_organized"
    assert near.classification.confidence == 0.85
    # Too unsure, a different folder than its neighbours, or no folder to agree with: still for review
    for rec in (unsure, other, loose):
        assert rec.classification.action == "manual_review"


def test_folder_agreement_needs_a_clear_majority():
    from src.main_loop import promote_by_folder_agreement

    mixed = [_rec(f"stuff/a{n}.pdf", "Documents", 0.9) for n in range(3)]
    mixed += [_rec(f"stuff/b{n}.pdf", "Finance", 0.9) for n in range(2)]
    near = _rec("stuff/c.pdf", "Documents", 0.8)
    assert promote_by_folder_agreement(mixed + [near], 0.85) == 0
    assert near.classification.action == "manual_review"
