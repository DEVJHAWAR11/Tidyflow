"""Search by meaning, start to finish: the user's choice, the download, indexing, and query lookups.

One ``SemanticService`` lives in the API process. Its ``status()`` is what the Settings card and the
Search page show, and every change to it is sent to the app over the existing SSE stream.
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections import OrderedDict
from typing import Any, Awaitable, Callable, Optional

import numpy as np

from . import catalog, download, vectors
from .embedder import Embedder, EmbedderError, document_text, find_server_binary, query_text

logger = logging.getLogger(__name__)

BATCH = 16
# Give the scanner and the UI room between batches; indexing is background work.
PAUSE_BETWEEN_BATCHES = 0.05
MIN_QUERY_CHARS = 3
QUERY_CACHE = 128
# How long a search waits for a query vector before answering with keyword results only.
QUERY_WAIT = 3.0
NOTIFY_EVERY = 0.25

Notify = Callable[[dict], Awaitable[None]]


class SemanticService:
    def __init__(self, db_path: str, notify: Optional[Notify] = None):
        self.db_path = db_path
        self.notify = notify
        self.matrix = vectors.VectorMatrix()
        self.embedder: Optional[Embedder] = None
        self.phase = "off"  # off, needs_download, downloading, indexing, ready, error
        self.error: Optional[str] = None
        self.download_done = 0
        self.download_total = 0
        self.index_done = 0
        self.index_total = 0
        self._download_task: Optional[asyncio.Task] = None
        self._index_task: Optional[asyncio.Task] = None
        self._index_again = False
        self._warm_task: Optional[asyncio.Task] = None
        self._queries: OrderedDict[str, np.ndarray] = OrderedDict()
        self._last_notify = 0.0
        self._notify_pending: Optional[asyncio.Task] = None

    # ------------------------------------------------------------------
    # State
    # ------------------------------------------------------------------

    @property
    def prefs(self) -> dict:
        return catalog.load_prefs()

    @property
    def choice(self) -> catalog.ModelChoice:
        return catalog.MODELS[self.prefs["model"]]

    def status(self) -> dict[str, Any]:
        prefs = self.prefs
        models = []
        for c in catalog.MODELS.values():
            models.append({
                "key": c.key, "label": c.label, "filename": c.filename, "size_bytes": c.size_bytes,
                "blurb": c.blurb, "recommended": c.recommended, "downloaded": catalog.is_downloaded(c),
            })
        return {
            "enabled": prefs["enabled"],
            "model": prefs["model"],
            "phase": self.phase,
            "error": self.error,
            "engine_available": find_server_binary() is not None,
            "download": {"done": self.download_done, "total": self.download_total},
            "index": {"done": self.index_done, "total": self.index_total, "vectors": len(self.matrix)},
            "engine_running": bool(self.embedder and self.embedder.running),
            "models": models,
        }

    def _set(self, phase: str, error: Optional[str] = None) -> None:
        self.phase = phase
        self.error = error

    async def _changed(self, force: bool = False) -> None:
        """Tell the app; progress updates are spaced out so a fast download doesn't flood it."""
        if self.notify is None:
            return
        now = time.monotonic()
        if force or now - self._last_notify >= NOTIFY_EVERY:
            self._last_notify = now
            try:
                await self.notify(self.status())
            except Exception as e:  # a closed client must not stop the work
                logger.debug("Could not send semantic status: %s", e)
        elif self._notify_pending is None or self._notify_pending.done():
            async def later():
                await asyncio.sleep(NOTIFY_EVERY)
                await self._changed(force=True)
            self._notify_pending = asyncio.create_task(later())

    def _embedder_for(self, choice: catalog.ModelChoice) -> Embedder:
        path = catalog.model_path(choice)
        if self.embedder is None or self.embedder.model_file != path:
            old = self.embedder
            self.embedder = Embedder(path)
            if old is not None:
                asyncio.create_task(old.stop())
        return self.embedder

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    async def startup(self) -> None:
        """At app start: pick up where the user left off, without starting the engine yet."""
        prefs = self.prefs
        if not prefs["enabled"]:
            self._set("off")
            return
        choice = self.choice
        if not catalog.is_downloaded(choice):
            # A download was interrupted by quitting: carry on.
            self._start_download(choice)
            return
        await asyncio.to_thread(self.matrix.load, self.db_path, choice.fingerprint)
        self._set("ready")
        self.kick()

    async def shutdown(self) -> None:
        for task in (self._download_task, self._index_task, self._warm_task):
            if task is not None and not task.done():
                task.cancel()
        for task in (self._download_task, self._index_task, self._warm_task):
            if task is not None:
                try:
                    await task
                except (asyncio.CancelledError, Exception):
                    pass
        if self.embedder is not None:
            await self.embedder.stop()

    async def enable(self, model: Optional[str] = None) -> dict:
        model = model or self.prefs["model"]
        if model not in catalog.MODELS:
            raise ValueError(f"Unknown model: {model}")
        switching = model != self.prefs["model"]
        catalog.save_prefs(enabled=True, model=model)
        choice = catalog.MODELS[model]
        if switching:
            await self._cancel_index()
            self.matrix.clear()
            self._queries.clear()
        if not catalog.is_downloaded(choice):
            self._start_download(choice)
        else:
            if self.matrix.loaded_key != choice.fingerprint:
                await asyncio.to_thread(self.matrix.load, self.db_path, choice.fingerprint)
            self._set("ready")
            self.kick()
        await self._changed(force=True)
        return self.status()

    async def disable(self) -> dict:
        """Turn it off. The model and the index stay, so turning it back on is instant."""
        catalog.save_prefs(enabled=False)
        await self._cancel_download()
        await self._cancel_index()
        if self.embedder is not None:
            await self.embedder.stop()
        self._set("off")
        await self._changed(force=True)
        return self.status()

    async def remove(self) -> dict:
        """Turn it off and delete every model file and every vector."""
        await self.disable()
        freed = sum(download.remove_model_files(c) for c in catalog.MODELS.values())
        await asyncio.to_thread(vectors.delete_vectors, self.db_path, None)
        self.matrix.clear()
        self._queries.clear()
        self.embedder = None
        self.index_done = self.index_total = 0
        await self._changed(force=True)
        return {**self.status(), "freed_bytes": freed}

    # ------------------------------------------------------------------
    # Download
    # ------------------------------------------------------------------

    def _start_download(self, choice: catalog.ModelChoice) -> None:
        if self._download_task is not None and not self._download_task.done():
            return
        self._set("downloading")
        self.download_done = download.part_path(choice).stat().st_size if download.part_path(choice).exists() else 0
        self.download_total = choice.size_bytes
        self._download_task = asyncio.create_task(self._download(choice))

    async def _download(self, choice: catalog.ModelChoice) -> None:
        async def progress(done: int, total: int) -> None:
            self.download_done, self.download_total = done, total
            await self._changed()

        try:
            await download.download_model(choice, progress)
        except asyncio.CancelledError:
            raise
        except download.DownloadError as e:
            self._set("error", str(e))
            await self._changed(force=True)
            return
        except Exception as e:
            logger.exception("Model download failed")
            self._set("error", f"The download failed: {e}")
            await self._changed(force=True)
            return
        # The model in use changed only if the user didn't pick another meanwhile.
        if self.prefs["model"] != choice.key or not self.prefs["enabled"]:
            return
        # Free the space of a model the user moved away from.
        for other in catalog.MODELS.values():
            if other.key != choice.key:
                download.remove_model_files(other)
        await asyncio.to_thread(self.matrix.load, self.db_path, choice.fingerprint)
        self._set("ready")
        await self._changed(force=True)
        self.kick()

    async def _cancel_download(self) -> None:
        task, self._download_task = self._download_task, None
        if task is not None and not task.done():
            task.cancel()
            try:
                await task
            except (asyncio.CancelledError, Exception):
                pass

    async def cancel_download(self) -> dict:
        """Stop downloading (the part already fetched is kept for later) and turn the feature off."""
        return await self.disable()

    # ------------------------------------------------------------------
    # Indexing
    # ------------------------------------------------------------------

    def kick(self) -> None:
        """Bring the index up to date with the files' text, now or right after the current pass."""
        prefs = self.prefs
        if not prefs["enabled"] or not catalog.is_downloaded(self.choice):
            return
        if self._index_task is not None and not self._index_task.done():
            self._index_again = True
            return
        self._index_again = False
        self._index_task = asyncio.create_task(self._index_loop())

    async def _cancel_index(self) -> None:
        task, self._index_task = self._index_task, None
        self._index_again = False
        if task is not None and not task.done():
            task.cancel()
            try:
                await task
            except (asyncio.CancelledError, Exception):
                pass

    async def wait_for_index(self) -> None:
        """For tests and the CLI: wait until indexing is finished."""
        while self._index_task is not None and not self._index_task.done():
            await asyncio.gather(self._index_task, return_exceptions=True)

    async def _index_loop(self) -> None:
        while True:
            await self._index_pass()
            if not self._index_again:
                return
            self._index_again = False

    async def _index_pass(self) -> None:
        choice = self.choice
        key = choice.fingerprint
        try:
            if self.matrix.loaded_key != key:
                await asyncio.to_thread(self.matrix.load, self.db_path, key)
            work = await asyncio.to_thread(vectors.plan_work, self.db_path, key)
            if work.drop:
                await asyncio.to_thread(vectors.delete_vectors, self.db_path, work.drop)
                self.matrix.remove(work.drop)
            self.matrix.keep_only(work.wanted)
            self.index_total = work.total
            self.index_done = work.total - len(work.todo)
            if not work.todo:
                await asyncio.to_thread(_drop_other_models, self.db_path, key)
                self._set("ready")
                await self._changed(force=True)
                return
            self._set("indexing")
            await self._changed(force=True)
            embedder = self._embedder_for(choice)
            async with embedder.hold():
                for start in range(0, len(work.todo), BATCH):
                    batch = work.todo[start:start + BATCH]
                    vecs = await embedder.embed([document_text(text) for _, text, _ in batch])
                    rows = [(row_id, h, v) for (row_id, _, h), v in zip(batch, vecs)]
                    await asyncio.to_thread(vectors.save_vectors, self.db_path, key, rows)
                    self.matrix.upsert([(row_id, v) for row_id, _, v in rows])
                    self.index_done += len(batch)
                    await self._changed()
                    await asyncio.sleep(PAUSE_BETWEEN_BATCHES)
            await asyncio.to_thread(_drop_other_models, self.db_path, key)
            self._set("ready")
            await self._changed(force=True)
        except asyncio.CancelledError:
            raise
        except EmbedderError as e:
            logger.warning("Indexing for search by meaning stopped: %s", e)
            self._set("error", str(e))
            await self._changed(force=True)
        except Exception as e:
            logger.exception("Indexing for search by meaning failed")
            self._set("error", f"Indexing failed: {e}")
            await self._changed(force=True)

    # ------------------------------------------------------------------
    # Search
    # ------------------------------------------------------------------

    @property
    def searchable(self) -> bool:
        prefs = self.prefs
        return (
            prefs["enabled"] and len(self.matrix) > 0 and self.matrix.loaded_key == self.choice.fingerprint
            and catalog.is_downloaded(self.choice)
        )

    def warm(self) -> None:
        """Start the engine ahead of a search, e.g. when the Search page opens."""
        if not self.searchable:
            return
        embedder = self._embedder_for(self.choice)
        if embedder.running or (self._warm_task is not None and not self._warm_task.done()):
            return

        async def go():
            try:
                await embedder.start()
            except EmbedderError as e:
                logger.warning("Could not start the search-by-meaning engine: %s", e)
            await self._changed(force=True)

        self._warm_task = asyncio.create_task(go())

    async def lookup(self, query: str) -> tuple[Optional[list[tuple[int, float]]], str]:
        """Files matching ``query`` by meaning, and what happened.

        The second value is ``"ok"``, ``"off"`` (not turned on or no index yet), ``"short"``
        (query too short to mean much), ``"warming"`` (the engine is starting; ask again
        shortly) or ``"failed"``. Only ``"ok"`` comes with hits.
        """
        q = " ".join(query.split())
        if not self.searchable:
            return None, "off"
        if len(q) < MIN_QUERY_CHARS:
            return None, "short"
        key = q.lower()
        vec = self._queries.get(key)
        if vec is None:
            embedder = self._embedder_for(self.choice)
            if not embedder.running:
                self.warm()
                return None, "warming"
            try:
                vec = (await asyncio.wait_for(embedder.embed([query_text(q)]), QUERY_WAIT))[0]
            except asyncio.TimeoutError:
                return None, "warming"
            except EmbedderError as e:
                logger.warning("Meaning lookup failed: %s", e)
                return None, "failed"
            self._queries[key] = vec
            while len(self._queries) > QUERY_CACHE:
                self._queries.popitem(last=False)
        else:
            self._queries.move_to_end(key)
        return self.matrix.search(vec), "ok"


def _drop_other_models(db_path: str, key: str) -> None:
    import sqlite3

    conn = sqlite3.connect(db_path, timeout=30)
    try:
        with conn:
            conn.execute("DELETE FROM file_vectors WHERE model_key != ?", (key,))
    finally:
        conn.close()
