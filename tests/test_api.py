import pytest
import httpx
from src.api import app


@pytest.mark.asyncio
async def test_api_status():
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.get("/status")
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "running"
        assert data["version"] == "2.6.1"


@pytest.mark.asyncio
async def test_api_get_files():
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.get("/files?limit=10")
        assert res.status_code == 200
        assert "files" in res.json()


@pytest.mark.asyncio
async def test_api_post_rules():
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.post("/rules", json={"rules": [{"category": "Finance/Invoices", "contains": "invoice"}]})
        assert res.status_code == 200
        assert "successfully" in res.json()["message"]


@pytest.mark.asyncio
async def test_api_cancel_pipeline():
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.post("/pipeline/cancel")
        assert res.status_code == 200
        data = res.json()
        assert data["status"] in ("cancelling", "idle")


@pytest.mark.asyncio
async def test_api_settings():
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.get("/settings")
        assert res.status_code == 200
        data = res.json()
        assert "provider" in data

        # Post update
        post_res = await client.post("/settings", json={
            "provider": "deepseek",
            "model": "deepseek-v4-flash",
            "api_key": "sk-testkey1234567890",
            "auto_copy_threshold": 0.85,
            "max_file_size_mb": 200.0,
        })
        assert post_res.status_code == 200
        assert post_res.json()["status"] == "success"

        # Verify updated
        res2 = await client.get("/settings")
        assert res2.status_code == 200
        data2 = res2.json()
        assert data2["has_key"] is True



@pytest.mark.asyncio
@pytest.mark.parametrize("level", ["low", "medium", "high"])
async def test_pipeline_run_keeps_the_settings_threshold_at_every_detail_level(level, tmp_path, monkeypatch):
    # The detail level shapes the folders only. The auto-sort threshold must stay the one in
    # Settings, which the review screen also uses, or the two disagree about what needs review.
    import src.api as api
    from src.config import TidyConfig
    from src.models import RunSummary

    cfg = TidyConfig()
    cfg.classification.auto_copy_threshold = 0.8
    monkeypatch.setattr(api, "load_config", lambda *a, **k: cfg)
    seen = {}

    def fake_run(config, **kwargs):
        seen["threshold"] = config.classification.auto_copy_threshold
        return [], RunSummary()

    monkeypatch.setattr(api, "run_pipeline", fake_run)
    monkeypatch.setattr(api, "_save_latest_run", lambda: None)
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.post("/pipeline/run", json={"input_dir": str(tmp_path), "complexity_level": level})
    assert res.status_code == 200
    assert seen["threshold"] == 0.8
