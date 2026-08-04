import os
import hashlib
from typing import Dict, Any, Generator

# Thresholds for heavy mode
HEAVY_MODE_FILE_COUNT = 10000
HEAVY_MODE_TOTAL_SIZE = 10 * 1024 * 1024 * 1024 # 10 GB

def generate_fingerprint(path: str, size: int, mtime: float) -> str:
    """Generates MD5 fingerprint based on path, size, and mtime."""
    hash_str = f"{path}_{size}_{mtime}"
    return hashlib.md5(hash_str.encode('utf-8')).hexdigest()

def profile_directory(target_dir: str) -> Dict[str, Any]:
    """Pre-pass profile to determine scale."""
    total_files = 0
    total_size = 0
    
    def _scan_dir(dir_path):
        nonlocal total_files, total_size
        try:
            with os.scandir(dir_path) as it:
                for entry in it:
                    if entry.is_file(follow_symlinks=False):
                        total_files += 1
                        total_size += entry.stat(follow_symlinks=False).st_size
                    elif entry.is_dir(follow_symlinks=False):
                        _scan_dir(entry.path)
        except PermissionError:
            pass # Skip inaccessible directories
            
    _scan_dir(target_dir)
    
    is_heavy = total_files >= HEAVY_MODE_FILE_COUNT or total_size >= HEAVY_MODE_TOTAL_SIZE
    mode = "heavy_mode" if is_heavy else "light_mode"
    
    return {
        "total_files": total_files,
        "total_size": total_size,
        "mode": mode
    }

def scan_files(target_dir: str) -> Generator[Dict[str, Any], None, None]:
    """Recursively yields file metadata using os.scandir()."""
    try:
        with os.scandir(target_dir) as it:
            for entry in it:
                if entry.is_file(follow_symlinks=False):
                    stat = entry.stat(follow_symlinks=False)
                    yield {
                        "path": entry.path,
                        "size": stat.st_size,
                        "mtime": stat.st_mtime,
                        "fingerprint": generate_fingerprint(entry.path, stat.st_size, stat.st_mtime)
                    }
                elif entry.is_dir(follow_symlinks=False):
                    yield from scan_files(entry.path)
    except PermissionError:
        pass
