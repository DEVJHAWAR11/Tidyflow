import tempfile
from pathlib import Path
from src.mcp_server import (
    is_path_allowed,
    set_allowed_directories,
    list_files,
    copy_file,
    delete_file,
    move_file,
)


def test_mcp_dynamic_allow_list():
    with tempfile.TemporaryDirectory() as temp_dir:
        safe_dir = Path(temp_dir) / "safe"
        safe_dir.mkdir()

        unsafe_dir = Path(temp_dir) / "unsafe"
        unsafe_dir.mkdir()

        set_allowed_directories([str(safe_dir)])

        assert is_path_allowed(str(safe_dir)) is True
        assert is_path_allowed(str(safe_dir / "doc.pdf")) is True
        assert is_path_allowed(str(unsafe_dir)) is False
        assert is_path_allowed(str(unsafe_dir / "doc.pdf")) is False

        # Copy in safe dir
        src = safe_dir / "src.txt"
        src.write_text("safe content")
        dest = safe_dir / "dest.txt"

        assert copy_file(str(src), str(dest)) == "Success"
        assert dest.exists()

        # Copy to unsafe destination
        unsafe_dest = unsafe_dir / "dest.txt"
        assert "Error" in copy_file(str(src), str(unsafe_dest))

        # List files
        assert "src.txt" in list_files(str(safe_dir))
        assert "Error" in list_files(str(unsafe_dir))

        # Delete file
        assert delete_file(str(dest)) == "Success"
        assert not dest.exists()
