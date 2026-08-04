import pytest
from fastapi.testclient import TestClient
from src.api import app, db
import asyncio

client = TestClient(app)

@pytest.mark.asyncio
async def test_costs_endpoint():
    # Insert some mock token logs directly
    await db.start()
    await db.log_tokens("openai", "gpt-4o", 100, 50, 0.05)
    await db.log_tokens("anthropic", "claude-3-5-sonnet", 200, 100, 0.02)
    await db.stop() # Flush writes
    
    with TestClient(app) as c:
        response = c.get("/costs")
        assert response.status_code == 200
        data = response.json()
        assert "costs" in data
        assert len(data["costs"]) > 0
        assert data["costs"][0]["total_cost"] == 0.07
