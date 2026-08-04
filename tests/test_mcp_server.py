import os
import tempfile
from pathlib import Path
from src.mcp_server import is_path_allowed, set_allowed_directories, list_files, copy_file, delete_file

def test_mcp_server_tools():
    with tempfile.TemporaryDirectory() as temp_dir:
        safe_dir = Path(temp_dir) / "safe"
        safe_dir.mkdir()
        
        unsafe_dir = Path(temp_dir) / "unsafe"
        unsafe_dir.mkdir()
        
        # Test allow list configuration
        set_allowed_directories([str(safe_dir)])
        
        assert is_path_allowed(str(safe_dir)) is True
        assert is_path_allowed(str(safe_dir / "file.txt")) is True
        assert is_path_allowed(str(unsafe_dir)) is False
        assert is_path_allowed(str(unsafe_dir / "file.txt")) is False
        
        # Test copy file tool (safe)
        source = safe_dir / "src.txt"
        source.write_text("hello")
        dest = safe_dir / "dest.txt"
        
        res = copy_file(str(source), str(dest))
        assert res == "Success"
        assert dest.exists()
        assert dest.read_text() == "hello"
        
        # Test copy file tool (unsafe destination)
        unsafe_dest = unsafe_dir / "dest.txt"
        res = copy_file(str(source), str(unsafe_dest))
        assert "Error" in res
        assert not unsafe_dest.exists()
        
        # Test list files (safe)
        res = list_files(str(safe_dir))
        assert "src.txt" in res
        
        # Test list files (unsafe)
        res = list_files(str(unsafe_dir))
        assert "Error" in res
        
        # Test delete file (safe)
        res = delete_file(str(dest))
        assert res == "Success"
        assert not dest.exists()
        
        # Test delete file (unsafe)
        unsafe_file = unsafe_dir / "bad.txt"
        unsafe_file.write_text("bad")
        res = delete_file(str(unsafe_file))
        assert "Error" in res
        assert unsafe_file.exists()
