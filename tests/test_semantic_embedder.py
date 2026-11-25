import asyncio
import os
import stat
import sys
from pathlib import Path

import numpy as np
import pytest

from src.semantic import embedder as emb

FAKE = Path(__file__).with_name("fake_llama_server.py")

pytestmark = pytest.mark.skipif(sys.platform == "win32", reason="the fake server runs as a script")


@pytest.fixture
def fake_server(monkeypatch, tmp_path):
    FAKE.chmod(FAKE.stat().st_mode | stat.S_IXUSR)
    monkeypatch.setenv("TIDYFLOW_LLAMA_SERVER", str(FAKE))
    monkeypatch.setattr(emb, "work_data_dir", lambda: tmp_path)
    model = tmp_path / "model.gguf"
    model.write_bytes(b"gguf")
    return model


def test_find_binary_uses_override(monkeypatch, tmp_path):
    monkeypatch.setenv("TIDYFLOW_LLAMA_SERVER", str(tmp_path / "missing"))
    assert emb.find_server_binary() is None
    monkeypatch.setenv("TIDYFLOW_LLAMA_SERVER", str(FAKE))
    assert emb.find_server_binary() == FAKE


def test_prompts_follow_the_model_card():
    assert emb.query_text("  rent agreement ") == "task: search result | query: rent agreement"
    assert emb.document_text("hello") == "title: none | text: hello"
    assert len(emb.document_text("x" * 10_000)) == len("title: none | text: ") + emb.MAX_CHARS


@pytest.mark.asyncio
async def test_embeds_unit_vectors_and_stops(fake_server, isolated_app_data):
    e = emb.Embedder(fake_server)
    try:
        v = await e.embed([emb.document_text("rent agreement"), emb.document_text("blood test")])
        assert v.shape == (2, 768)
        assert np.allclose(np.linalg.norm(v, axis=1), 1.0)
        q = await e.embed([emb.query_text("rent")])
        assert (v @ q[0]).argmax() == 0
        assert e.running
        assert (isolated_app_data / "llama-server.pid").exists()
    finally:
        await e.stop()
    assert not e.running
    assert not (isolated_app_data / "llama-server.pid").exists()


@pytest.mark.asyncio
async def test_requests_need_the_key(fake_server, isolated_app_data):
    import httpx

    e = emb.Embedder(fake_server)
    try:
        await e.start()
        async with httpx.AsyncClient(base_url=e._base) as c:
            r = await c.post("/v1/embeddings", json={"input": ["x"]})
        assert r.status_code == 401
    finally:
        await e.stop()


@pytest.mark.asyncio
async def test_too_long_inputs_are_shortened(fake_server, isolated_app_data, monkeypatch):
    monkeypatch.setenv("FAKE_LLAMA_MAX_CHARS", "500")
    e = emb.Embedder(fake_server)
    try:
        v = await e.embed(["short", "y " * 600])
        assert v.shape == (2, 768)
    finally:
        await e.stop()


@pytest.mark.asyncio
async def test_start_failure_is_reported(fake_server, isolated_app_data, monkeypatch):
    monkeypatch.setenv("FAKE_LLAMA_FAIL", "start")
    e = emb.Embedder(fake_server)
    with pytest.raises(emb.EmbedderError, match="stopped while starting"):
        await e.start()
    assert not e.running


@pytest.mark.asyncio
async def test_missing_binary_or_model(fake_server, isolated_app_data, monkeypatch, tmp_path):
    e = emb.Embedder(tmp_path / "nope.gguf")
    with pytest.raises(emb.EmbedderError, match="model file is missing"):
        await e.start()
    monkeypatch.setenv("TIDYFLOW_LLAMA_SERVER", str(tmp_path / "missing"))
    with pytest.raises(emb.EmbedderError, match="isn't installed"):
        await emb.Embedder(fake_server).start()


@pytest.mark.asyncio
async def test_idle_helper_stops_unless_held(fake_server, isolated_app_data, monkeypatch):
    e = emb.Embedder(fake_server, idle_seconds=0.3)
    try:
        async with e.hold():
            await e.embed(["a"])
            await asyncio.sleep(0.8)
            assert e.running
        await asyncio.sleep(1.0)
        assert not e.running
        # It starts again when needed.
        await e.embed(["b"])
        assert e.running
    finally:
        await e.stop()


@pytest.mark.asyncio
async def test_restarts_after_a_crash(fake_server, isolated_app_data):
    e = emb.Embedder(fake_server)
    try:
        await e.start()
        first = e._proc.pid
        e._proc.kill()
        e._proc.wait()
        # The next call sees the helper is gone and starts a new one.
        v = await e.embed(["a"])
        assert v.shape == (1, 768)
        assert e._proc.pid != first
    finally:
        await e.stop()


@pytest.mark.asyncio
async def test_a_helper_left_by_a_force_quit_is_stopped(fake_server, isolated_app_data):
    import subprocess

    port = emb._free_port()
    orphan = subprocess.Popen([str(FAKE), "--embeddings", "--host", "127.0.0.1", "--port", str(port), "--api-key", "k"])
    try:
        (isolated_app_data / "llama-server.pid").write_text(str(orphan.pid))
        emb.kill_stale_helper()
        # Only processes named llama-server are stopped; the fake one runs as python, so it stays.
        assert orphan.poll() is None
        assert not (isolated_app_data / "llama-server.pid").exists()
    finally:
        orphan.kill()
        orphan.wait()
