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
        assert data["version"] == "2.0.0"


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

