import hashlib
from dataclasses import replace

import httpx
import pytest

from src.semantic import catalog, download

BLOB = bytes(range(256)) * 4000  # ~1 MB


def _choice():
    return replace(
        catalog.MODELS["q8_0"], filename="test-model.gguf", size_bytes=len(BLOB),
        sha256=hashlib.sha256(BLOB).hexdigest(),
    )


def _client(handler):
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


def _serve(blob, *, honour_range=True, seen=None):
    def handler(request):
        if seen is not None:
            seen.append(request.headers.get("range"))
        rng = request.headers.get("range")
        if rng and honour_range:
            start = int(rng.split("=")[1].rstrip("-"))
            return httpx.Response(206, content=blob[start:])
        return httpx.Response(200, content=blob)
    return handler


@pytest.mark.asyncio
async def test_download_checks_and_renames(isolated_app_data):
    choice = _choice()
    progress = []
    async with _client(_serve(BLOB)) as client:
        path = await download.download_model(choice, lambda d, t: progress.append((d, t)), client=client)
    assert path.read_bytes() == BLOB
    assert not download.part_path(choice).exists()
    assert catalog.is_downloaded(choice)
    assert progress[-1] == (len(BLOB), len(BLOB))


@pytest.mark.asyncio
async def test_download_resumes_from_part_file(isolated_app_data):
    choice = _choice()
    download.part_path(choice).write_bytes(BLOB[:300_000])
    seen = []
    async with _client(_serve(BLOB, seen=seen)) as client:
        path = await download.download_model(choice, client=client)
    assert seen == ["bytes=300000-"]
    assert path.read_bytes() == BLOB


@pytest.mark.asyncio
async def test_download_starts_over_when_range_is_ignored(isolated_app_data):
    choice = _choice()
    download.part_path(choice).write_bytes(BLOB[:300_000])
    async with _client(_serve(BLOB, honour_range=False)) as client:
        path = await download.download_model(choice, client=client)
    assert path.read_bytes() == BLOB


@pytest.mark.asyncio
async def test_bad_checksum_deletes_the_file(isolated_app_data):
    choice = _choice()
    bad = b"x" * len(BLOB)
    async with _client(_serve(bad)) as client:
        with pytest.raises(download.DownloadError, match="checksum"):
            await download.download_model(choice, client=client)
    assert not download.part_path(choice).exists()
    assert not catalog.model_path(choice).exists()


@pytest.mark.asyncio
async def test_server_error_is_reported(isolated_app_data):
    choice = _choice()
    async with _client(lambda r: httpx.Response(503)) as client:
        with pytest.raises(download.DownloadError, match="503"):
            await download.download_model(choice, client=client)


@pytest.mark.asyncio
async def test_connection_drop_keeps_the_part_file(isolated_app_data):
    choice = _choice()

    def handler(request):
        raise httpx.ConnectError("offline")

    async with _client(handler) as client:
        with pytest.raises(download.DownloadError, match="resume"):
            await download.download_model(choice, client=client)


@pytest.mark.asyncio
async def test_not_enough_space(isolated_app_data, monkeypatch):
    choice = _choice()
    monkeypatch.setattr(download.shutil, "disk_usage", lambda p: type("U", (), {"free": 10})())
    with pytest.raises(download.DownloadError, match="disk space"):
        await download.download_model(choice)


def test_remove_model_files(isolated_app_data):
    choice = _choice()
    catalog.model_path(choice).write_bytes(b"abc")
    download.part_path(choice).write_bytes(b"de")
    assert download.remove_model_files(choice) == 5
    assert download.remove_model_files(choice) == 0
