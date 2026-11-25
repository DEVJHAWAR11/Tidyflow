"""Run the embedding model in a llama.cpp ``llama-server`` helper process.

The helper is a separate process, like the macOS OCR helper: a crash there can't take the app down,
and stopping it gives back all of its memory (about 540 MB for the Q8_0 model). It listens only on
127.0.0.1 with a random API key made for each start, so other programs and web pages can't use it.
It is started when indexing or searching needs it and stops after a few idle minutes.
"""

from __future__ import annotations

import asyncio
import atexit
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


def _key_file() -> Path:
    return utils.get_app_data_dir() / "llama-server.key"


_NO_WINDOW = {"creationflags": getattr(subprocess, "CREATE_NO_WINDOW", 0)} if sys.platform == "win32" else {}


def _process_name(pid: int) -> str:
    """The program name of a running process, or "" if there is none."""
    if sys.platform == "win32":
        out = subprocess.run(["tasklist", "/FI", f"PID eq {pid}", "/FO", "CSV", "/NH"],
                             capture_output=True, text=True, timeout=10, **_NO_WINDOW).stdout
        return out.split(",")[0].strip('" \r\n') if f'"{pid}"' in out else ""
    return subprocess.run(["ps", "-p", str(pid), "-o", "comm="], capture_output=True, text=True,
                          timeout=10).stdout.strip()


def kill_stale_helper() -> None:
    """Stop a helper left running by a TidyFlow that was force-quit or crashed.

    The pid file holds the helper's pid and the pid of the TidyFlow that started it. A helper whose
    TidyFlow is still running belongs to another open copy of the app and is left alone.
    """
    path = _pid_file()
    try:
        parts = path.read_text().split()
        helper = int(parts[0])
        owner = int(parts[1]) if len(parts) > 1 else None
    except (OSError, ValueError, IndexError):
        return
    try:
        if owner == os.getpid():
            return
        if owner is not None and _process_name(owner):
            return  # its TidyFlow is still open
        path.unlink(missing_ok=True)
        if not _process_name(helper).lower().endswith(EXE.lower()):
            return  # that pid is now some other program
        if sys.platform == "win32":
            subprocess.run(["taskkill", "/PID", str(helper), "/F"], capture_output=True, timeout=10, **_NO_WINDOW)
        else:
            os.kill(helper, 15)
    except Exception as e:  # never block startup on this
        logger.debug("Could not check for a stale llama-server: %s", e)


# Helpers started by this process, stopped when it exits even if the server's shutdown never ran
# (the desktop window closes the app after a few seconds whether or not the server has stopped).
_LIVE: set[subprocess.Popen] = set()


@atexit.register
def _stop_helpers_at_exit() -> None:
    for proc in list(_LIVE):
        if proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=3)
            except subprocess.TimeoutExpired:
                proc.kill()
    _LIVE.clear()


def _child_env() -> dict:
    env = dict(os.environ)
    if sys.platform == "win32" and hasattr(sys, "_MEIPASS"):
        # The helper sits in a subfolder of the packaged app; let it find the Visual C++ runtime
        # DLLs that PyInstaller placed in the app's own folder.
        env["PATH"] = sys._MEIPASS + os.pathsep + env.get("PATH", "")
    return env


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
            await asyncio.to_thread(kill_stale_helper)
            port = _free_port()
            self._key = secrets.token_urlsafe(24)
            self._base = f"http://127.0.0.1:{port}"
            # The key goes in a file only this user can read, not on the command line where any
            # program on the computer could see it.
            key_file = _key_file()
            fd = os.open(key_file, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            with os.fdopen(fd, "w") as f:
                f.write(self._key + "\n")
            log_dir = work_data_dir() / "logs"
            log_dir.mkdir(parents=True, exist_ok=True)
            self._log = open(log_dir / "llama-server.log", "w", encoding="utf-8", errors="replace")
            args = [
                str(binary), "-m", str(self.model_file), "--embeddings",
                "--host", "127.0.0.1", "--port", str(port), "--api-key-file", str(key_file),
                "--no-webui", "--offline",
                "-c", str(CTX_TOKENS), "-np", "1", "-b", str(CTX_TOKENS), "-ub", str(CTX_TOKENS),
            ]
            try:
                self._proc = subprocess.Popen(
                    args, stdout=self._log, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL,
                    env=_child_env(), **_NO_WINDOW,
                )
            except OSError as e:
                raise EmbedderError(f"Couldn't start the search-by-meaning engine: {e}") from e
            _LIVE.add(self._proc)
            try:
                _pid_file().write_text(f"{self._proc.pid} {os.getpid()}")
            except OSError:
                pass
            self._client = httpx.AsyncClient(
                base_url=self._base, headers={"Authorization": f"Bearer {self._key}"},
                timeout=httpx.Timeout(10.0, read=300.0),
            )
            deadline = time.monotonic() + START_TIMEOUT
            try:
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
            except asyncio.CancelledError:
                # Cancelled half-way (e.g. the app is closing): don't leave a helper with nothing to stop it.
                await self._stop_locked()
                raise
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
            _LIVE.discard(proc)
            # Another Embedder (after a model switch) may already have written its own pid there.
            path = _pid_file()
            try:
                if path.read_text().split()[0] == str(proc.pid):
                    path.unlink()
            except (OSError, ValueError, IndexError):
                pass
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
