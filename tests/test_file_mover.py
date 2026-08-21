import pytest
import tempfile
from pathlib import Path
from src.database import DatabaseManager
from src.file_mover import FileMover
from src.mcp_server import set_allowed_directories


@pytest.mark.asyncio
async def test_safe_copy_and_move():
    with tempfile.TemporaryDirectory() as temp_dir:
        db_path = str(Path(temp_dir) / "test.db")
        db = DatabaseManager(db_path=db_path)
        await db.start()

        mover = FileMover(db)

        safe_dir = Path(temp_dir) / "safe"
        safe_dir.mkdir()
        set_allowed_directories([str(safe_dir)])

        src_file = safe_dir / "test.txt"
        src_file.write_text("Hello Tidyflow safe file mover")

        target_file = safe_dir / "copied_target.txt"

        # Safe Copy
        success = await mover.safe_copy(str(src_file), str(target_file))
        assert success is True
        assert src_file.exists()
        assert target_file.exists()

        # Safe Move
        moved_target = safe_dir / "moved_target.txt"
        success_move = await mover.safe_move(str(src_file), str(moved_target))
        assert success_move is True
        assert not src_file.exists()
        assert moved_target.exists()

        await db.stop()


def test_target_path_collision(tmp_path):
    src_file = tmp_path / "test.txt"
    src_file.write_text("content")

    mover = FileMover(None)
    target = mover.determine_target_path(tmp_path, "Finance/Invoices", src_file)
    assert "Finance" in target and "Invoices" in target
    assert "test.txt" in target
