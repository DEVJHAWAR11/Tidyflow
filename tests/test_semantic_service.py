import asyncio
import hashlib
import sqlite3
import stat
import sys
from dataclasses import replace
from pathlib import Path

import pytest
import pytest_asyncio

from src.database import DatabaseManager
from src.semantic import catalog, download, embedder as emb, service as svc_mod, vectors
from src.semantic.service import SemanticService

FAKE = Path(__file__).with_name("fake_llama_server.py")
pytestmark = pytest.mark.skipif(sys.platform == "win32", reason="the fake server runs as a script")

MODEL_BYTES = b"GGUF fake model " * 100


@pytest_asyncio.fixture
async def env(isolated_app_data, monkeypatch, tmp_path):
    FAKE.chmod(FAKE.stat().st_mode | stat.S_IXUSR)
    monkeypatch.setenv("TIDYFLOW_LLAMA_SERVER", str(FAKE))
    monkeypatch.setattr(emb, "work_data_dir", lambda: tmp_path)
    # Tiny stand-in models, served by a fake download server.
    fakes = {
        key: replace(c, size_bytes=len(MODEL_BYTES) + i, sha256=hashlib.sha256(MODEL_BYTES + b"x" * i).hexdigest())
        for i, (key, c) in enumerate(catalog.MODELS.items())
    }
    monkeypatch.setattr(catalog, "MODELS", fakes)
    blobs = {c.url: MODEL_BYTES + b"x" * i for i, c in enumerate(fakes.values())}
    gate = asyncio.Event()
    gate.set()

    real = download.download_model

    async def fake_download(choice, on_progress=None, *, client=None):
        import httpx

        async def handler(request):
            await gate.wait()
            return httpx.Response(200, content=blobs[str(request.url)])

        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as c:
            return await real(choice, on_progress, client=c)

    monkeypatch.setattr(download, "download_model", fake_download)
    # The fake server's word-hash vectors aren't on the real model's similarity scale.
    monkeypatch.setattr(vectors, "MIN_SCORE", 0.3)

    db_path = str(tmp_path / "t.db")
    DatabaseManager(db_path=db_path)
    conn = sqlite3.connect(db_path)
    conn.executemany(
        "INSERT INTO files (id, path, extracted_text, status) VALUES (?, ?, ?, ?)",
        [(i, f"/f{i}.txt", f"filler words number {i} about nothing much", "indexed") for i in range(1, 40)]
        + [(100, "/lease.txt", "tenancy lease for the flat, rent due monthly", "indexed"),
           (101, "/photo.jpg", "", "indexed")],
    )
    conn.commit()
    conn.close()
    events = []

    async def notify(status):
        events.append(status)

    s = SemanticService(db_path, notify)
    yield s, db_path, events, gate
    await s.shutdown()


async def _settle(s):
    for _ in range(200):
        if s._download_task is None or s._download_task.done():
            break
        await asyncio.sleep(0.02)
    await s.wait_for_index()


@pytest.mark.asyncio
async def test_off_by_default(env):
    s, *_ = env
    await s.startup()
    st = s.status()
    assert st["enabled"] is False and st["phase"] == "off"
    assert [m["key"] for m in st["models"]] == ["q8_0", "bf16"]
    assert await s.lookup("rent agreement") == (None, "off")


@pytest.mark.asyncio
async def test_enable_downloads_indexes_and_finds(env):
    s, db_path, events, _ = env
    await s.enable("q8_0")
    await _settle(s)
    st = s.status()
    assert st["phase"] == "ready", st
    assert st["index"] == {"done": 40, "total": 40, "vectors": 40}
    assert {e["phase"] for e in events} >= {"downloading", "indexing", "ready"}
    assert vectors.count_vectors(db_path, catalog.MODELS["q8_0"].fingerprint) == 40

    # Indexing left the engine running; once it has stopped, a search starts it and asks again.
    await s.embedder.stop()
    hits, why = await s.lookup("lease rent")
    assert why == "warming" and hits is None
    await s._warm_task
    hits, why = await s.lookup("lease rent")
    assert why == "ok"
    assert hits and hits[0][0] == 100
    assert await s.lookup("ab") == (None, "short")


@pytest.mark.asyncio
async def test_kick_only_embeds_changed_text(env):
    s, db_path, _, _ = env
    await s.enable("q8_0")
    await _settle(s)
    conn = sqlite3.connect(db_path)
    conn.execute("UPDATE files SET extracted_text = 'invoice from the plumber' WHERE id = 5")
    conn.execute("DELETE FROM files WHERE id = 6")
    conn.execute("UPDATE files SET extracted_text = '' WHERE id = 7")
    conn.commit()
    conn.close()
    calls = []
    real_embed = emb.Embedder.embed

    async def counting(self, texts):
        calls.append(len(texts))
        return await real_embed(self, texts)

    emb.Embedder.embed = counting
    try:
        s.kick()
        await s.wait_for_index()
    finally:
        emb.Embedder.embed = real_embed
    assert calls == [1]
    assert s.status()["index"]["vectors"] == 38


@pytest.mark.asyncio
async def test_restart_keeps_the_index_and_settings(env):
    s, db_path, _, _ = env
    await s.enable("q8_0")
    await _settle(s)
    await s.shutdown()
    s2 = SemanticService(db_path)
    try:
        await s2.startup()
        await s2.wait_for_index()
        assert s2.status()["phase"] == "ready"
        assert len(s2.matrix) == 40
        assert not s2.status()["engine_running"]  # nothing to embed, so the engine wasn't started
    finally:
        await s2.shutdown()


@pytest.mark.asyncio
async def test_disable_keeps_files_and_remove_deletes_them(env):
    s, db_path, _, _ = env
    await s.enable("q8_0")
    await _settle(s)
    st = await s.disable()
    assert st["phase"] == "off" and st["enabled"] is False
    assert catalog.is_downloaded(catalog.MODELS["q8_0"])
    assert await s.lookup("lease") == (None, "off")
    st = await s.remove()
    assert st["freed_bytes"] > 0
    assert not catalog.is_downloaded(catalog.MODELS["q8_0"])
    assert vectors.count_vectors(db_path, catalog.MODELS["q8_0"].fingerprint) == 0


@pytest.mark.asyncio
async def test_switching_model_reindexes_and_frees_the_old_file(env):
    s, db_path, _, _ = env
    await s.enable("q8_0")
    await _settle(s)
    await s.enable("bf16")
    await _settle(s)
    assert s.status()["phase"] == "ready"
    assert not catalog.is_downloaded(catalog.MODELS["q8_0"])
    assert catalog.is_downloaded(catalog.MODELS["bf16"])
    assert vectors.count_vectors(db_path, catalog.MODELS["bf16"].fingerprint) == 40
    assert vectors.count_vectors(db_path, catalog.MODELS["q8_0"].fingerprint) == 0


@pytest.mark.asyncio
async def test_cancel_download_turns_it_off_and_keeps_the_part(env):
    s, _, _, gate = env
    gate.clear()
    await s.enable("q8_0")
    assert s.status()["phase"] == "downloading"
    st = await s.cancel_download()
    assert st["phase"] == "off" and not st["enabled"]
    gate.set()


@pytest.mark.asyncio
async def test_missing_engine_is_reported(env, monkeypatch):
    s, *_ = env
    monkeypatch.setenv("TIDYFLOW_LLAMA_SERVER", "/nonexistent/llama-server")
    assert s.status()["engine_available"] is False
    await s.enable("q8_0")
    await _settle(s)
    st = s.status()
    assert st["phase"] == "error" and "isn't installed" in st["error"]


@pytest.mark.asyncio
async def test_switching_model_during_a_download(env):
    s, _, _, gate = env
    gate.clear()
    await s.enable("q8_0")
    assert s.status()["phase"] == "downloading"
    await s.enable("bf16")
    gate.set()
    await _settle(s)
    st = s.status()
    assert st["phase"] == "ready" and st["model"] == "bf16"
    assert catalog.is_downloaded(catalog.MODELS["bf16"])
    assert not catalog.is_downloaded(catalog.MODELS["q8_0"])


@pytest.mark.asyncio
async def test_engine_that_cannot_start_is_reported_once(env, monkeypatch):
    s, *_ = env
    await s.enable("q8_0")
    await _settle(s)
    await s.embedder.stop()
    monkeypatch.setenv("FAKE_LLAMA_FAIL", "start")
    assert await s.lookup("lease rent") == (None, "warming")
    await s._warm_task
    st = s.status()
    assert st["phase"] == "error" and "stopped while starting" in st["error"]
    # Searches now say it failed and don't start the engine again on every query.
    assert await s.lookup("lease rent") == (None, "failed")
    s.warm()
    assert s._warm_task.done()
    # Try again in Settings clears it.
    monkeypatch.delenv("FAKE_LLAMA_FAIL")
    await s.enable()
    assert s.status()["phase"] == "ready"


@pytest.mark.asyncio
async def test_cancelling_a_switch_goes_back_to_the_old_model(env):
    s, _, _, gate = env
    await s.enable("q8_0")
    await _settle(s)
    gate.clear()
    await s.enable("bf16")
    assert s.status()["phase"] == "downloading"
    st = await s.cancel_download()
    gate.set()
    assert st["enabled"] and st["model"] == "q8_0" and st["phase"] == "ready"
    await _settle(s)
    assert len(s.matrix) == 40


@pytest.mark.asyncio
async def test_a_slow_query_is_finished_for_the_retry(env, monkeypatch):
    s, *_ = env
    await s.enable("q8_0")
    await _settle(s)
    real_embed = emb.Embedder.embed

    async def slow(self, texts):
        await asyncio.sleep(0.3)
        return await real_embed(self, texts)

    monkeypatch.setattr(emb.Embedder, "embed", slow)
    monkeypatch.setattr(svc_mod, "QUERY_WAIT", 0.05)
    assert await s.lookup("lease rent") == (None, "warming")
    await asyncio.sleep(0.4)
    hits, why = await s.lookup("lease rent")
    assert why == "ok" and hits[0][0] == 100


@pytest.mark.asyncio
async def test_indexing_waits_while_a_search_is_waiting(env):
    s, *_ = env
    await s.enable("q8_0")
    await _settle(s)
    s._queries_idle.clear()
    import sqlite3 as _sq

    conn = _sq.connect(s.db_path)
    conn.execute("UPDATE files SET extracted_text = 'a brand new invoice text here' WHERE id = 3")
    conn.commit()
    conn.close()
    s.kick()
    await asyncio.sleep(0.3)
    assert s.status()["phase"] == "indexing" and s.status()["index"]["done"] == 39
    s._queries_idle.set()
    await s.wait_for_index()
    assert s.status()["phase"] == "ready"
