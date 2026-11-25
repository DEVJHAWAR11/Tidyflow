"""Download a model file: resumable, checked against its SHA-256 before it is used."""

from __future__ import annotations

import asyncio
import hashlib
import logging
import os
import shutil
from pathlib import Path
from typing import Awaitable, Callable, Optional

import httpx

from .catalog import ModelChoice, model_path

logger = logging.getLogger(__name__)

CHUNK = 1 << 20
# Room to leave on the disk beyond the model itself.
SPARE_BYTES = 200 * 1024 * 1024

Progress = Callable[[int, int], Awaitable[None] | None]


class DownloadError(Exception):
    """A download that can't finish; the message is shown to the user as is."""


def part_path(choice: ModelChoice) -> Path:
    return model_path(choice).with_name(model_path(choice).name + ".part")


def _hash_file(path: Path) -> "hashlib._Hash":
    digest = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(CHUNK), b""):
            digest.update(block)
    return digest


async def download_model(
    choice: ModelChoice,
    on_progress: Optional[Progress] = None,
    *,
    client: Optional[httpx.AsyncClient] = None,
) -> Path:
    """Fetch ``choice`` into the models folder and return its path.

    A cancelled or broken download leaves its ``.part`` file, and the next call carries on from
    there. The finished file only takes its real name once its SHA-256 matches, so a file under
    the real name is always complete.
    """
    final = model_path(choice)
    part = part_path(choice)
    have = part.stat().st_size if part.exists() else 0
    if have > choice.size_bytes:
        part.unlink()
        have = 0

    free = shutil.disk_usage(final.parent).free
    if free < choice.size_bytes - have + SPARE_BYTES:
        need = (choice.size_bytes - have + SPARE_BYTES) / 1e6
        raise DownloadError(f"Not enough disk space: the model needs about {need:,.0f} MB free.")

    async def report(done: int) -> None:
        if on_progress is not None:
            result = on_progress(done, choice.size_bytes)
            if asyncio.iscoroutine(result):
                await result

    digest = await asyncio.to_thread(_hash_file, part) if have else hashlib.sha256()
    owns_client = client is None
    client = client or httpx.AsyncClient(follow_redirects=True, timeout=httpx.Timeout(30.0, read=60.0))
    try:
        if have < choice.size_bytes:
            headers = {"Range": f"bytes={have}-"} if have else {}
            async with client.stream("GET", choice.url, headers=headers) as resp:
                if resp.status_code == 200 and have:
                    # The server ignored the range: start over.
                    have = 0
                    digest = hashlib.sha256()
                    part.unlink(missing_ok=True)
                elif resp.status_code not in (200, 206):
                    raise DownloadError(f"The download server answered {resp.status_code}. Try again later.")
                await report(have)
                with open(part, "ab") as f:
                    async for block in resp.aiter_bytes(CHUNK):
                        f.write(block)
                        digest.update(block)
                        have += len(block)
                        if have > choice.size_bytes:
                            break
                        await report(have)
                    f.flush()
                    os.fsync(f.fileno())
    except httpx.HTTPError as e:
        raise DownloadError("The download was interrupted. Check your connection and try again; it will resume.") from e
    finally:
        if owns_client:
            await client.aclose()

    if have != choice.size_bytes or digest.hexdigest() != choice.sha256:
        part.unlink(missing_ok=True)
        raise DownloadError("The downloaded model didn't match its checksum, so it was deleted. Try again.")
    os.replace(part, final)
    await report(have)
    return final


def remove_model_files(choice: ModelChoice) -> int:
    """Delete the model and any half-finished download; returns the bytes freed."""
    freed = 0
    for path in (model_path(choice), part_path(choice)):
        try:
            freed += path.stat().st_size
            path.unlink()
        except FileNotFoundError:
            pass
    return freed
