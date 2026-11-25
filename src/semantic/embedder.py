"""Run the embedding model in a llama.cpp ``llama-server`` helper process.

The helper is a separate process, like the macOS OCR helper: a crash there can't take the app down,
and stopping it gives back all of its memory (about 540 MB for the Q8_0 model). It listens only on
127.0.0.1 with a random API key made for each start, so other programs and web pages can't use it.
It is started when indexing or searching needs it and stops after a few idle minutes.
"""

from __future__ import annotations

import asyncio
import logging
import os
import secrets
import shutil
import socket
import subprocess
import sys
import time
from pathlib import Path
from typing import Optional

import httpx
import numpy as np

from .. import utils
from ..utils import get_resource_path, work_data_dir

logger = logging.getLogger(__name__)

EXE = "llama-server.exe" if sys.platform == "win32" else "llama-server"

# Files hold at most 4 KB of extracted text, so one input is at most ~4,100 tokens. The batch
# must hold a whole input or the server refuses it; one slot is as fast as four (see the spike).
CTX_TOKENS = 4608
IDLE_SECONDS = 300
START_TIMEOUT = 120.0
# Longest text sent for one file; the extractor already stops near 4 KB.
MAX_CHARS = 6000

QUERY_PREFIX = "task: search result | query: "
DOC_PREFIX = "title: none | text: "


class EmbedderError(Exception):
    """The helper can't be found, started, or answered with an error."""


def find_server_binary() -> Optional[Path]:
    """The bundled llama-server, or one on PATH when running from source."""
    override = os.environ.get("TIDYFLOW_LLAMA_SERVER")
    if override:
        return Path(override) if Path(override).is_file() else None
    bundled = get_resource_path(f"bin/llama/{EXE}")
    if bundled.is_file():
        return bundled
    on_path = shutil.which("llama-server")
    return Path(on_path) if on_path else None


def query_text(query: str) -> str:
    return QUERY_PREFIX + query.strip()


def document_text(text: str) -> str:
    return DOC_PREFIX + (text or "").strip()[:MAX_CHARS]


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _pid_file() -> Path:
    return utils.get_app_data_dir() / "llama-server.pid"


def _kill_stale_helper() -> None:
    """Stop a helper left running by a TidyFlow that quit without stopping it."""
    path = _pid_file()
    try:
        pid = int(path.read_text().strip())
    except (OSError, ValueError):
        return
    path.unlink(missing_ok=True)
    try:
        if sys.platform == "win32":
            out = subprocess.run(["tasklist", "/FI", f"PID eq {pid}", "/FO", "CSV", "/NH"],
                                 capture_output=True, text=True, timeout=10).stdout
            if EXE.lower() in out.lower():
                subprocess.run(["taskkill", "/PID", str(pid), "/F"], capture_output=True, timeout=10)
        else:
            name = subprocess.run(["ps", "-p", str(pid), "-o", "comm="], capture_output=True, text=True,
                                  timeout=10).stdout.strip()
            if name.endswith("llama-server"):
                os.kill(pid, 15)
    except Exception as e:  # never block startup on this
        logger.debug("Could not check for a stale llama-server: %s", e)


class Embedder:
    """One llama-server helper for one model file, started on demand."""

    def __init__(self, model_file: Path, *, idle_seconds: float = IDLE_SECONDS):
        self.model_file = Path(model_file)
        self.idle_seconds = idle_seconds
        self._proc: Optional[subprocess.Popen] = None
        self._base = ""
        self._key = ""
        self._client: Optional[httpx.AsyncClient] = None
        self._lock = asyncio.Lock()
        self._last_used = 0.0
        self._holds = 0
        self._idle_task: Optional[asyncio.Task] = None
        self._log = None

    @property
    def running(self) -> bool:
        return self._proc is not None and self._proc.poll() is None

    def hold(self) -> "_Hold":
        """Keep the helper running for a stretch of work, e.g. one indexing pass."""
        return _Hold(self)

    async def start(self) -> None:
        async with self._lock:
            if self.running:
                return
            await self._stop_locked()
            binary = find_server_binary()
            if binary is None:
                raise EmbedderError("The search-by-meaning engine (llama-server) isn't installed with this copy of TidyFlow.")
            if not self.model_file.is_file():
                raise EmbedderError("The model file is missing. Download it again in Settings.")
            _kill_stale_helper()
            port = _free_port()
            self._key = secrets.token_urlsafe(24)
            self._base = f"http://127.0.0.1:{port}"
            log_dir = work_data_dir() / "logs"
            log_dir.mkdir(parents=True, exist_ok=True)
            self._log = open(log_dir / "llama-server.log", "w", encoding="utf-8", errors="replace")
            args = [
                str(binary), "-m", str(self.model_file), "--embeddings",
                "--host", "127.0.0.1", "--port", str(port), "--api-key", self._key,
                "--no-webui", "--offline",
                "-c", str(CTX_TOKENS), "-np", "1", "-b", str(CTX_TOKENS), "-ub", str(CTX_TOKENS),
            ]
            kwargs: dict = {"stdout": self._log, "stderr": subprocess.STDOUT, "stdin": subprocess.DEVNULL}
            if sys.platform == "win32":
                kwargs["creationflags"] = getattr(subprocess, "CREATE_NO_WINDOW", 0)
            try:
                self._proc = subprocess.Popen(args, **kwargs)
            except OSError as e:
                raise EmbedderError(f"Couldn't start the search-by-meaning engine: {e}") from e
            try:
                _pid_file().write_text(str(self._proc.pid))
            except OSError:
                pass
            self._client = httpx.AsyncClient(
                base_url=self._base, headers={"Authorization": f"Bearer {self._key}"},
                timeout=httpx.Timeout(10.0, read=300.0),
            )
            deadline = time.monotonic() + START_TIMEOUT
            while True:
                if self._proc.poll() is not None:
                    code = self._proc.returncode
                    await self._stop_locked()
                    raise EmbedderError(f"The search-by-meaning engine stopped while starting (exit code {code}).")
                try:
                    r = await self._client.get("/health")
                    if r.status_code == 200 and r.json().get("status") == "ok":
                        break
                except (httpx.HTTPError, ValueError):
                    pass
                if time.monotonic() > deadline:
                    await self._stop_locked()
                    raise EmbedderError("The search-by-meaning engine took too long to start.")
                await asyncio.sleep(0.2)
            self._last_used = time.monotonic()
            if self._idle_task is None or self._idle_task.done():
                self._idle_task = asyncio.create_task(self._stop_when_idle())
            logger.info("llama-server ready on %s with %s", self._base, self.model_file.name)

    async def embed(self, texts: list[str]) -> np.ndarray:
        """Unit-length float32 vectors for ``texts`` (already prefixed for query or document)."""
        if not texts:
            return np.zeros((0, 0), dtype=np.float32)
        await self.start()
        self._last_used = time.monotonic()
        try:
            out = await self._post(texts)
        except _TooLong:
            # One input was over the batch size: send them one by one, halving any that still is.
            rows = []
            for text in texts:
                while True:
                    try:
                        rows.append((await self._post([text]))[0])
                        break
                    except _TooLong:
                        if len(text) < 200:
                            raise EmbedderError("A text could not be embedded.")
                        text = text[: len(text) // 2]
            out = np.vstack(rows)
        finally:
            self._last_used = time.monotonic()
        if not np.isfinite(out).all():
            raise EmbedderError("The model returned an invalid vector.")
        norms = np.linalg.norm(out, axis=1, keepdims=True)
        norms[norms == 0] = 1.0
        return (out / norms).astype(np.float32)

    async def _post(self, texts: list[str]) -> np.ndarray:
        assert self._client is not None
        try:
            r = await self._client.post("/v1/embeddings", json={"input": texts})
        except httpx.HTTPError as e:
            if not self.running:
                await self.stop()
            raise EmbedderError("The search-by-meaning engine stopped answering.") from e
        if r.status_code != 200:
            body = r.text[:300]
            if "too large" in body:
                raise _TooLong(body)
            raise EmbedderError(f"The search-by-meaning engine answered {r.status_code}: {body}")
        data = sorted(r.json()["data"], key=lambda d: d["index"])
        return np.array([d["embedding"] for d in data], dtype=np.float32)

    async def stop(self) -> None:
        async with self._lock:
            await self._stop_locked()
        if self._idle_task is not None and self._idle_task is not asyncio.current_task():
            self._idle_task.cancel()
            self._idle_task = None

    async def _stop_locked(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None
        proc, self._proc = self._proc, None
        if proc is not None and proc.poll() is None:
            proc.terminate()
            try:
                await asyncio.to_thread(proc.wait, 10)
            except subprocess.TimeoutExpired:
                proc.kill()
                await asyncio.to_thread(proc.wait)
        if proc is not None:
            _pid_file().unlink(missing_ok=True)
        if self._log is not None:
            self._log.close()
            self._log = None

    async def _stop_when_idle(self) -> None:
        try:
            while self.running:
                await asyncio.sleep(min(30.0, self.idle_seconds))
                if self._holds == 0 and time.monotonic() - self._last_used >= self.idle_seconds:
                    logger.info("Stopping idle llama-server")
                    async with self._lock:
                        await self._stop_locked()
                    return
        except asyncio.CancelledError:
            pass


class _TooLong(Exception):
    pass


class _Hold:
    def __init__(self, embedder: Embedder):
        self.embedder = embedder

    async def __aenter__(self):
        self.embedder._holds += 1
        return self.embedder

    async def __aexit__(self, *exc):
        self.embedder._holds -= 1
        self.embedder._last_used = time.monotonic()
