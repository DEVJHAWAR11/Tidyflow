import pytest
import os
import tempfile
from pathlib import Path
from src.scanner import scan_files, profile_directory
from src.graph import route_node

def test_ignore_list():
    with tempfile.TemporaryDirectory() as temp_dir:
        ignore_file = Path(temp_dir) / ".tidyignore"
        ignore_file.write_text("*.log\nignore_dir/")
        
        # files to create
        (Path(temp_dir) / "test.txt").write_text("hello")
        (Path(temp_dir) / "app.log").write_text("skip me")
        
        ignore_dir = Path(temp_dir) / "ignore_dir"
        ignore_dir.mkdir()
        (ignore_dir / "secret.txt").write_text("skip me too")
        
        keep_dir = Path(temp_dir) / "keep_dir"
        keep_dir.mkdir()
        (keep_dir / "keep.txt").write_text("keep me")
        
        files = list(scan_files(temp_dir))
        
        # Should only find test.txt and keep_dir/keep.txt, and .tidyignore!
        paths = [Path(f["path"]).name for f in files]
        
        assert "test.txt" in paths
        assert "keep.txt" in paths
        assert ".tidyignore" in paths
        assert "app.log" not in paths
        assert "secret.txt" not in paths

def test_large_file_routing():
    # 51 MB
    state = {"file_path": "big.mp4", "size": 51 * 1024 * 1024}
    res = route_node(state)
    assert res.get("category") == "Large Files"
    
    # 49 MB
    state = {"file_path": "small.mp4", "size": 49 * 1024 * 1024}
    res = route_node(state)
    assert res.get("category") != "Large Files"
