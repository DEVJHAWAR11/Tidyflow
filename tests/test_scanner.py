import os
import pytest
import tempfile
from pathlib import Path
from src.scanner import profile_directory, scan_files, generate_fingerprint

def test_profile_and_scan():
    with tempfile.TemporaryDirectory() as temp_dir:
        # Create some dummy files
        file1_path = Path(temp_dir) / "file1.txt"
        file1_path.write_text("Hello")
        
        file2_path = Path(temp_dir) / "sub" / "file2.txt"
        file2_path.parent.mkdir()
        file2_path.write_text("World!")
        
        # Profile
        profile = profile_directory(temp_dir)
        assert profile["total_files"] == 2
        assert profile["total_size"] == 5 + 6 # "Hello" is 5, "World!" is 6
        assert profile["mode"] == "light_mode"
        
        # Scan
        scanned_files = list(scan_files(temp_dir))
        assert len(scanned_files) == 2
        
        # Check that paths and fingerprints are correctly generated
        paths = [f["path"] for f in scanned_files]
        assert str(file1_path) in paths
        assert str(file2_path) in paths
        
        for f in scanned_files:
            assert f["fingerprint"] == generate_fingerprint(f["path"], f["size"], f["mtime"])
