"""Secure filesystem operations tool with dynamic path allow-lists."""

from __future__ import annotations

import os
import shutil
from pathlib import Path
from typing import List, Union

try:
    from fastmcp import FastMCP
    app = FastMCP("tidyflow-mcp-fs")
except Exception:
    class _DummyFastMCP:
        def tool(self):
            def decorator(func):
                return func
            return decorator
        def run(self):
            pass
    app = _DummyFastMCP()

# Dynamically configured allow-list of directories
ALLOWED_DIRECTORIES: List[Path] = []


def set_allowed_directories(dirs: List[Union[str, Path]]) -> None:
    """Set the list of allowed root directories for filesystem operations."""
    global ALLOWED_DIRECTORIES
    ALLOWED_DIRECTORIES = [Path(d).resolve() for d in dirs]


def is_path_allowed(path_str: Union[str, Path]) -> bool:
    """Check if a path falls within the configured allowed directories."""
    if not ALLOWED_DIRECTORIES:
        return False

    try:
        path = Path(path_str).resolve()
        for allowed in ALLOWED_DIRECTORIES:
            if allowed == path or allowed in path.parents:
                return True
    except Exception:
        return False
    return False


@app.tool()
def list_files(path: str) -> str:
    """List directory contents within allowed paths."""
    if not is_path_allowed(path):
        return f"Error: Path {path} is not in the allow-list"
    try:
        items = os.listdir(path)
        return "\n".join(items)
    except Exception as e:
        return f"Error: {e}"


def _landing_path(source: str, destination: str) -> Path:
    """Where a copy or move of ``source`` ends up: ``destination``, or inside it when it is a folder."""
    dest = Path(destination)
    return dest / Path(source).name if dest.is_dir() else dest


def _remove_partial(path: Path) -> None:
    """Take away a file this tool started writing but could not finish."""
    try:
        if path.is_file():
            path.unlink()
    except OSError:
        pass


@app.tool()
def copy_file(source: str, destination: str) -> str:
    """Copy a file from source to destination within allowed directories. An existing file is never replaced."""
    if not is_path_allowed(source) or not is_path_allowed(destination):
        return "Error: One or both paths are not in the allow-list"
    target = _landing_path(source, destination)
    if os.path.lexists(target):
        return f"Error: {target} already exists"
    try:
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
        return "Success"
    except Exception as e:
        _remove_partial(target)
        return f"Error: {e}"


@app.tool()
def delete_file(path: str) -> str:
    """Delete a file within allowed directories."""
    if not is_path_allowed(path):
        return f"Error: Path {path} is not in the allow-list"
    try:
        if os.path.exists(path):
            os.remove(path)
        return "Success"
    except Exception as e:
        return f"Error: {e}"


@app.tool()
def move_file(source: str, destination: str) -> str:
    """Move a file within allowed directories. An existing file is never replaced."""
    if not is_path_allowed(source) or not is_path_allowed(destination):
        return "Error: One or both paths are not in the allow-list"
    target = _landing_path(source, destination)
    if os.path.lexists(target):
        return f"Error: {target} already exists"
    try:
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(source, target)
        return "Success"
    except Exception as e:
        if os.path.exists(source):  # the move didn't finish, so whatever reached the target is a partial copy
            _remove_partial(target)
        return f"Error: {e}"


if __name__ == "__main__":
    app.run()
