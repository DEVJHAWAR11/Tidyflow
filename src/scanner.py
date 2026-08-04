import os
import hashlib
from typing import Dict, Any, Generator, Optional
import pathspec

# Thresholds for heavy mode
HEAVY_MODE_FILE_COUNT = 10000
HEAVY_MODE_TOTAL_SIZE = 10 * 1024 * 1024 * 1024 # 10 GB

def generate_fingerprint(path: str, size: int, mtime: float) -> str:
    """Generates MD5 fingerprint based on path, size, and mtime."""
    hash_str = f"{path}_{size}_{mtime}"
    return hashlib.md5(hash_str.encode('utf-8')).hexdigest()

def get_ignore_spec(target_dir: str) -> Optional[pathspec.PathSpec]:
    ignore_path = os.path.join(target_dir, ".tidyignore")
    if os.path.exists(ignore_path):
        with open(ignore_path, "r") as f:
            return pathspec.PathSpec.from_lines(pathspec.patterns.GitWildMatchPattern, f)
    return None

def profile_directory(target_dir: str) -> Dict[str, Any]:
    """Pre-pass profile to determine scale."""
    total_files = 0
    total_size = 0
    spec = get_ignore_spec(target_dir)
    
    def _scan_dir(dir_path):
        nonlocal total_files, total_size
        try:
            with os.scandir(dir_path) as it:
                for entry in it:
                    rel_path = os.path.relpath(entry.path, target_dir)
                    rel_path_posix = rel_path.replace("\\", "/")
                    
                    if spec and spec.match_file(rel_path_posix):
                        continue
                        
                    if entry.is_file(follow_symlinks=False):
                        total_files += 1
                        total_size += entry.stat(follow_symlinks=False).st_size
                    elif entry.is_dir(follow_symlinks=False):
                        if spec and spec.match_file(rel_path_posix + "/"):
                            continue
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

def scan_files(target_dir: str, spec: Optional[pathspec.PathSpec] = None, base_dir: str = None) -> Generator[Dict[str, Any], None, None]:
    """Recursively yields file metadata using os.scandir()."""
    if spec is None:
        spec = get_ignore_spec(target_dir)
    if base_dir is None:
        base_dir = target_dir
        
    try:
        with os.scandir(target_dir) as it:
            for entry in it:
                rel_path = os.path.relpath(entry.path, base_dir)
                rel_path_posix = rel_path.replace("\\", "/")
                
                if spec and spec.match_file(rel_path_posix):
                    continue
                    
                if entry.is_file(follow_symlinks=False):
                    stat = entry.stat(follow_symlinks=False)
                    yield {
                        "path": entry.path,
                        "size": stat.st_size,
                        "mtime": stat.st_mtime,
                        "fingerprint": generate_fingerprint(entry.path, stat.st_size, stat.st_mtime)
                    }
                elif entry.is_dir(follow_symlinks=False):
                    if spec and spec.match_file(rel_path_posix + "/"):
                        continue
                    yield from scan_files(entry.path, spec, base_dir)
    except PermissionError:
        pass
