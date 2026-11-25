"""The meaning index: one float16 vector per file in SQLite, searched in memory with numpy.

A library holds at most tens of thousands of files with text, so comparing a query with every vector
(one matrix-vector product) takes well under a millisecond to a few milliseconds. No vector database.
"""

from __future__ import annotations

import hashlib
import sqlite3
import threading
from dataclasses import dataclass

import numpy as np

# Same rows keyword search covers: not the bare rows kept for files the scan skipped.
_SEARCHABLE = "COALESCE(files.status, '') != 'skipped'"

# A file counts as a meaning match only when it stands out from the rest of the library: its
# score is at least Z_GATE standard deviations above the mean, and close to the best score.
# Every file has some similarity to every query, so without a gate every file would "match".
Z_GATE = 2.0
MIN_SPREAD = 0.02
NEAR_BEST = 0.10
# With too few files for a spread to mean anything, use a plain similarity floor instead.
SMALL_LIBRARY = 20
SMALL_LIBRARY_FLOOR = 0.68
MAX_HITS = 50


def text_hash(text: str) -> str:
    return hashlib.sha1((text or "").strip().encode("utf-8", "replace")).hexdigest()


def to_blob(vec: np.ndarray) -> bytes:
    return np.asarray(vec, dtype=np.float16).tobytes()


def from_blob(blob: bytes) -> np.ndarray:
    return np.frombuffer(blob, dtype=np.float16)


def gate(scores: np.ndarray, *, max_hits: int = MAX_HITS) -> list[int]:
    """Positions of the scores that count as matches, best first."""
    n = len(scores)
    if n == 0:
        return []
    best = float(scores.max())
    if n < SMALL_LIBRARY:
        keep = np.where(scores >= SMALL_LIBRARY_FLOOR)[0]
    else:
        z = (scores - scores.mean()) / max(float(scores.std()), MIN_SPREAD)
        keep = np.where((z >= Z_GATE) & (scores >= best - NEAR_BEST))[0]
    order = keep[np.argsort(-scores[keep], kind="stable")]
    return [int(i) for i in order[:max_hits]]


@dataclass
class Work:
    """What one indexing pass has to do."""
    todo: list[tuple[int, str, str]]  # (file row id, text, text hash) to embed
    drop: list[int]                    # vectors whose file has no text or isn't searched any more
    total: int                         # files with text that should end up with a vector
    wanted: set[int]                   # those files' row ids


def plan_work(db_path: str, model_key: str) -> Work:
    """Compare the files' text with the stored vectors."""
    conn = sqlite3.connect(db_path, timeout=30)
    try:
        have = {
            row_id: (key, h)
            for row_id, key, h in conn.execute("SELECT file_row_id, model_key, text_hash FROM file_vectors")
        }
        todo: list[tuple[int, str, str]] = []
        wanted: set[int] = set()
        for row_id, text in conn.execute(
            f"SELECT id, extracted_text FROM files WHERE {_SEARCHABLE} "
            "AND extracted_text IS NOT NULL AND trim(extracted_text) != '' ORDER BY id DESC"
        ):
            wanted.add(row_id)
            h = text_hash(text)
            if have.get(row_id) != (model_key, h):
                todo.append((row_id, text, h))
        drop = [row_id for row_id in have if row_id not in wanted]
        return Work(todo=todo, drop=drop, total=len(wanted), wanted=wanted)
    finally:
        conn.close()


def save_vectors(db_path: str, model_key: str, rows: list[tuple[int, str, np.ndarray]]) -> None:
    """Store ``(file row id, text hash, vector)`` rows in one short transaction."""
    conn = sqlite3.connect(db_path, timeout=30)
    try:
        with conn:
            conn.executemany(
                "INSERT INTO file_vectors (file_row_id, model_key, text_hash, vec) VALUES (?, ?, ?, ?) "
                "ON CONFLICT(file_row_id) DO UPDATE SET model_key = excluded.model_key, "
                "text_hash = excluded.text_hash, vec = excluded.vec, embedded_at = CURRENT_TIMESTAMP",
                [(row_id, model_key, h, to_blob(v)) for row_id, h, v in rows],
            )
    finally:
        conn.close()


def delete_vectors(db_path: str, row_ids: list[int] | None = None) -> None:
    """Delete these files' vectors, or every vector when ``row_ids`` is None."""
    conn = sqlite3.connect(db_path, timeout=30)
    try:
        with conn:
            if row_ids is None:
                conn.execute("DELETE FROM file_vectors")
            else:
                for start in range(0, len(row_ids), 900):
                    part = row_ids[start:start + 900]
                    conn.execute(f"DELETE FROM file_vectors WHERE file_row_id IN ({','.join('?' * len(part))})", part)
    finally:
        conn.close()


def count_vectors(db_path: str, model_key: str) -> int:
    conn = sqlite3.connect(db_path, timeout=30)
    try:
        return conn.execute("SELECT count(*) FROM file_vectors WHERE model_key = ?", (model_key,)).fetchone()[0]
    finally:
        conn.close()


class VectorMatrix:
    """Every vector of one model, held in memory for search and kept in step with the table."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._ids = np.zeros(0, dtype=np.int64)
        self._mat = np.zeros((0, 0), dtype=np.float32)
        self._pos: dict[int, int] = {}
        self.loaded_key: str | None = None

    def __len__(self) -> int:
        return len(self._ids)

    def load(self, db_path: str, model_key: str) -> None:
        conn = sqlite3.connect(db_path, timeout=30)
        try:
            rows = conn.execute(
                "SELECT file_row_id, vec FROM file_vectors WHERE model_key = ? ORDER BY file_row_id", (model_key,)
            ).fetchall()
        finally:
            conn.close()
        ids = np.array([r[0] for r in rows], dtype=np.int64)
        mat = np.vstack([from_blob(r[1]) for r in rows]).astype(np.float32) if rows else np.zeros((0, 0), np.float32)
        with self._lock:
            self._ids, self._mat = ids, mat
            self._pos = {int(i): n for n, i in enumerate(ids)}
            self.loaded_key = model_key

    def clear(self) -> None:
        with self._lock:
            self._ids = np.zeros(0, dtype=np.int64)
            self._mat = np.zeros((0, 0), dtype=np.float32)
            self._pos = {}
            self.loaded_key = None

    def upsert(self, rows: list[tuple[int, np.ndarray]]) -> None:
        if not rows:
            return
        with self._lock:
            new_ids, new_vecs = [], []
            for row_id, vec in rows:
                # Round through float16 so memory holds exactly what the table holds.
                v = np.asarray(vec, dtype=np.float16).astype(np.float32)
                pos = self._pos.get(row_id)
                if pos is not None:
                    self._mat[pos] = v
                else:
                    new_ids.append(row_id)
                    new_vecs.append(v)
            if new_ids:
                start = len(self._ids)
                block = np.vstack(new_vecs)
                self._mat = block if start == 0 else np.vstack([self._mat, block])
                self._ids = np.concatenate([self._ids, np.array(new_ids, dtype=np.int64)])
                for n, row_id in enumerate(new_ids):
                    self._pos[row_id] = start + n

    def remove(self, row_ids: list[int]) -> None:
        with self._lock:
            gone = [self._pos[r] for r in row_ids if r in self._pos]
            if not gone:
                return
            keep = np.ones(len(self._ids), dtype=bool)
            keep[gone] = False
            self._ids, self._mat = self._ids[keep], self._mat[keep]
            self._pos = {int(i): n for n, i in enumerate(self._ids)}

    def keep_only(self, row_ids: set[int]) -> None:
        """Forget vectors of files no longer in the index (deleting a file deletes its row's vector
        through a trigger, which this in-memory copy doesn't see)."""
        with self._lock:
            gone = [int(i) for i in self._ids if int(i) not in row_ids]
        if gone:
            self.remove(gone)

    def search(self, query_vec: np.ndarray, *, max_hits: int = MAX_HITS) -> list[tuple[int, float]]:
        """``(file row id, similarity)`` for the files that match ``query_vec`` by meaning, best first."""
        with self._lock:
            ids, mat = self._ids, self._mat
        if len(ids) == 0:
            return []
        scores = mat @ np.asarray(query_vec, dtype=np.float32)
        return [(int(ids[i]), float(scores[i])) for i in gate(scores, max_hits=max_hits)]
