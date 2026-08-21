import pytest
from src.api import db, app
import httpx


@pytest.mark.asyncio
async def test_costs_endpoint():
    await db.start()
    # Clear previous test token logs
    await db.execute_write("DELETE FROM token_logs")
    await db.log_tokens("openai", "gpt-4o", 100, 50, 0.05)
    await db.log_tokens("anthropic", "claude-3-5-sonnet", 200, 100, 0.02)
    await db.stop()

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        response = await c.get("/costs")
        assert response.status_code == 200
        data = response.json()
        assert "costs" in data
        assert len(data["costs"]) > 0
        assert round(data["costs"][0]["total_cost"], 2) == 0.07
