import os
import hashlib
from pathlib import Path
from datetime import datetime
from src.mcp_server import copy_file, delete_file, is_path_allowed
from src.database import DatabaseManager

class FileMover:
    def __init__(self, db: DatabaseManager):
        self.db = db

    def _get_hash(self, path: str) -> str:
        sha256 = hashlib.sha256()
        with open(path, "rb") as f:
            for block in iter(lambda: f.read(65536), b""):
                sha256.update(block)
        return sha256.hexdigest()

    def determine_target_path(self, base_target_dir: str, category: str, original_path: str) -> str:
        """Logic: <base_target_dir>/<category>/YYYY-MM-DD_<filename>"""
        stat = os.stat(original_path)
        # creation time
        dt = datetime.fromtimestamp(stat.st_ctime)
        date_str = dt.strftime("%Y-%m-%d")
        
        filename = Path(original_path).name
        # Add date prefix if not already present (to prevent 2026-08-04_2026-08-04_img.png on re-runs)
        if not filename.startswith(date_str):
            filename = f"{date_str}_{filename}"
            
        target_dir = Path(base_target_dir) / category
        return str(target_dir / filename)

    async def safe_move(self, original_path: str, target_path: str) -> bool:
        """Copies file, verifies hash, deletes original, logs to DB."""
        if not os.path.exists(original_path):
            raise FileNotFoundError(f"Source missing: {original_path}")

        # MCP check
        if not is_path_allowed(original_path) or not is_path_allowed(target_path):
            raise PermissionError("Path not allowed by MCP rules")

        original_hash = self._get_hash(original_path)
        
        # Copy via MCP Server func directly (for testing)
        res = copy_file(original_path, target_path)
        if res != "Success":
            raise RuntimeError(f"Copy failed: {res}")
            
        # Verify
        new_hash = self._get_hash(target_path)
        if original_hash != new_hash:
            # Hash mismatch, delete the bad copy
            delete_file(target_path)
            raise RuntimeError("Hash mismatch after copy. Move aborted.")
            
        # Delete original
        res = delete_file(original_path)
        if res != "Success":
            raise RuntimeError(f"Original deletion failed: {res}")
            
        # Update DB for undo support
        if self.db:
            await self.db.execute_write(
                "UPDATE files SET new_path = ?, status = 'moved' WHERE path = ?",
                (target_path, original_path)
            )
        
        return True
