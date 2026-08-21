"""Safe file mover and organizer service."""

from __future__ import annotations

import os
import shutil
from pathlib import Path
from typing import Optional, Any
from datetime import datetime

from .mcp_server import copy_file, delete_file, is_path_allowed
from .utils import compute_sha256, resolve_filename_collision


class FileMover:
    """Safely organizes files into categorized directory hierarchies."""

    def __init__(self, db: Any = None):
        self.db = db

    def determine_target_path(self, base_target_dir: str | Path, category: str, original_path: str | Path) -> str:
        """
        Determine target destination path:
        <base_target_dir>/<category>/<filename> (resolving collisions if needed)
        """
        target_dir = Path(base_target_dir) / category
        filename = Path(original_path).name
        sha = compute_sha256(original_path) if os.path.exists(original_path) else "00000000"
        target_path = resolve_filename_collision(target_dir, filename, sha)
        return str(target_path)

    async def safe_copy(self, original_path: str, target_path: str) -> bool:
        """Copies file, verifies SHA-256 integrity, records in DB."""
        if not os.path.exists(original_path):
            raise FileNotFoundError(f"Source file not found: {original_path}")

        if not is_path_allowed(original_path) or not is_path_allowed(target_path):
            raise PermissionError("Path not permitted by security allow-list")

        original_hash = compute_sha256(original_path)

        res = copy_file(original_path, target_path)
        if res != "Success":
            raise RuntimeError(f"Copy operation failed: {res}")

        new_hash = compute_sha256(target_path)
        if original_hash != new_hash:
            delete_file(target_path)
            raise RuntimeError("Hash mismatch after copy. Operation aborted and rolled back.")

        if self.db:
            await self.db.execute_write(
                "UPDATE files SET new_path = ?, status = 'copied' WHERE path = ?",
                (target_path, original_path)
            )

        return True

    async def safe_move(self, original_path: str, target_path: str) -> bool:
        """Copies file, verifies hash, deletes original, records in DB."""
        # First safely copy and verify
        await self.safe_copy(original_path, target_path)

        # Then delete original
        res = delete_file(original_path)
        if res != "Success":
            raise RuntimeError(f"Original deletion failed after copy: {res}")

        if self.db:
            await self.db.execute_write(
                "UPDATE files SET new_path = ?, status = 'moved' WHERE path = ?",
                (target_path, original_path)
            )

        return True
