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
