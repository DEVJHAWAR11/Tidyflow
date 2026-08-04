import pytest
from fastapi.testclient import TestClient
from src.api import app

client = TestClient(app)

def test_status():
    # By using TestClient, startup/shutdown events aren't triggered automatically
    # unless using with TestClient(app) as client:
    with TestClient(app) as c:
        response = c.get("/status")
        assert response.status_code == 200
        assert response.json()["status"] == "running"

def test_post_rules():
    with TestClient(app) as c:
        response = c.post("/rules", json={"rules": [{"category": "Test", "extensions": [".txt"]}]})
        assert response.status_code == 200
        assert "successfully" in response.json()["message"]

def test_get_files():
    with TestClient(app) as c:
        response = c.get("/files?limit=10")
        assert response.status_code == 200
        assert "files" in response.json()
