"""SHA-256 exact-duplicate and perceptual-hash near-duplicate detection."""

from __future__ import annotations

import logging
from collections import defaultdict

import imagehash
from PIL import Image
from tqdm import tqdm

from .models import FileRecord

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Exact Duplicate Grouping (by SHA-256)
# ---------------------------------------------------------------------------

def assign_exact_duplicate_groups(records: list[FileRecord]) -> int:
    """
    Group files by SHA-256. If two or more files share a hash, they receive
    the same duplicate_group_id (f"dup_{sha[:10]}").

    Returns the count of duplicate groups (groups with >1 file).
    """
    sha_map: dict[str, list[FileRecord]] = defaultdict(list)
    for rec in records:
        if rec.skipped or not rec.sha256:
            continue
        sha_map[rec.sha256].append(rec)

    dup_count = 0
    for sha, group in sha_map.items():
        if len(group) > 1:
            group_id = f"dup_{sha[:10]}"
            for rec in group:
                rec.duplicate_group_id = group_id
            dup_count += 1

    logger.info("Identified %d exact duplicate groups", dup_count)
    return dup_count


# ---------------------------------------------------------------------------
# Perceptual Hashing (Images)
# ---------------------------------------------------------------------------

def compute_perceptual_hashes(records: list[FileRecord]) -> None:
    """Compute imagehash.phash for every non-skipped image record."""
    image_records = [
        r for r in records
        if not r.skipped and r.file_category == "image"
    ]
    for rec in tqdm(image_records, desc="Perceptual hashing", unit="img"):
        try:
            img = Image.open(rec.abs_path)
            if rec.extension == ".gif":
                img.seek(0)
            h = imagehash.phash(img)
            rec.perceptual_hash = str(h)
            img.close()
        except Exception as exc:
            msg = f"Perceptual hash error for {rec.filename}: {exc}"
            logger.warning(msg)
            rec.processing_errors.append(msg)


# ---------------------------------------------------------------------------
# Near-Duplicate Clustering (Union-Find)
# ---------------------------------------------------------------------------

class _UnionFind:
    """Disjoint Set / Union-Find data structure with path compression."""

    def __init__(self) -> None:
        self._parent: dict[str, str] = {}

    def find(self, x: str) -> str:
        if x not in self._parent:
            self._parent[x] = x
        while self._parent[x] != x:
            self._parent[x] = self._parent[self._parent[x]]
            x = self._parent[x]
        return x

    def union(self, a: str, b: str) -> None:
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            self._parent[ra] = rb


def assign_near_duplicate_groups(
    records: list[FileRecord],
    *,
    hamming_threshold: int = 8,
) -> int:
    """
    Cluster image records by perceptual-hash similarity using Union-Find.
    Images with Hamming distance <= hamming_threshold are grouped together.

    Returns the count of near-duplicate groups.
    """
    hashed = [
        r for r in records
        if not r.skipped and r.perceptual_hash is not None
    ]
    if not hashed:
        return 0

    uf = _UnionFind()

    for i in tqdm(range(len(hashed)), desc="Near-duplicate clustering", unit="pair"):
        try:
            h_i = imagehash.hex_to_hash(hashed[i].perceptual_hash)
        except Exception:
            continue
        for j in range(i + 1, len(hashed)):
            try:
                h_j = imagehash.hex_to_hash(hashed[j].perceptual_hash)
                if (h_i - h_j) <= hamming_threshold:
                    uf.union(hashed[i].file_id, hashed[j].file_id)
            except Exception:
                continue

    groups: dict[str, list[FileRecord]] = defaultdict(list)
    for rec in hashed:
        root = uf.find(rec.file_id)
        groups[root].append(rec)

    near_dup_count = 0
    for root, members in groups.items():
        if len(members) > 1:
            gid = f"near_{root[:10]}"
            for rec in members:
                rec.near_duplicate_group_id = gid
            near_dup_count += 1

    logger.info("Identified %d near-duplicate groups", near_dup_count)
    return near_dup_count
