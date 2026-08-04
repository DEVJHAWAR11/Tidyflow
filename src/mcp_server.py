import os
import shutil
from pathlib import Path
from typing import List
from fastmcp import FastMCP

app = FastMCP("tidyflow-mcp-fs")

# list of folders we're actually allowed to touch
ALLOWED_DIRECTORIES: List[Path] = []

def set_allowed_directories(dirs: List[str]):
    global ALLOWED_DIRECTORIES
    ALLOWED_DIRECTORIES = [Path(d).resolve() for d in dirs]

def is_path_allowed(path_str: str) -> bool:
    """Check if the path is within the allowed directories."""
    # this just makes sure we have safe folders configured. if not, it blocks everything
    if not ALLOWED_DIRECTORIES:
        return False
        
    path = Path(path_str).resolve()
    for allowed in ALLOWED_DIRECTORIES:
        try:
            if allowed in path.parents or allowed == path:
                return True
        except Exception:
            pass
    return False

@app.tool()
def list_files(path: str) -> str:
    # just grabs all the files in the folder you ask for
    if not is_path_allowed(path):
        return f"Error: Path {path} is not in the allow-list"
    try:
        items = os.listdir(path)
        return "\n".join(items)
    except Exception as e:
        return f"Error: {e}"

@app.tool()
def copy_file(source: str, destination: str) -> str:
    # literally just copies a file, but we double check it's a safe path first
    # mcp server checks if the path is allowed before touching anything, this is the safety part
    if not is_path_allowed(source) or not is_path_allowed(destination):
        return "Error: One or both paths are not in the allow-list"
    try:
        Path(destination).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)
        return "Success"
    except Exception as e:
        return f"Error: {e}"

@app.tool()
def delete_file(path: str) -> str:
    # trashes the file, used after we safely copy it somewhere else
    if not is_path_allowed(path):
        return f"Error: Path {path} is not in the allow-list"
    try:
        os.remove(path)
        return "Success"
    except Exception as e:
        return f"Error: {e}"

if __name__ == "__main__":
    app.run()
