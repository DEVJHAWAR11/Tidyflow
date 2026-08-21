"""Tests for File System & Directory Picker Endpoints."""

import pytest
from pathlib import Path
from fastapi.testclient import TestClient
from src.api import app


@pytest.fixture
def client():
    return TestClient(app)


def test_quick_locations(client):
    """Verify quick locations returns existing system paths."""
    res = client.get("/fs/quick-locations")
    assert res.status_code == 200
    data = res.json()
    assert "locations" in data
    assert "home" in data
    assert len(data["locations"]) > 0


def test_list_directory_home(client):
    """Verify listing home directory returns subdirectories."""
    res = client.get("/fs/list-directory")
    assert res.status_code == 200
    data = res.json()
    assert data["exists"] is True
    assert "directories" in data
    assert "current_path" in data
    assert isinstance(data["directories"], list)


def test_create_directory_and_list(client, tmp_path):
    """Verify creating a subfolder and listing it."""
    # List empty tmp dir
    res = client.get(f"/fs/list-directory?path={tmp_path}")
    assert res.status_code == 200
    assert len(res.json()["directories"]) == 0

    # Create folder
    create_res = client.post("/fs/create-directory", json={
        "parent_path": str(tmp_path),
        "name": "Test_Organized_Folder",
    })
    assert create_res.status_code == 200
    assert create_res.json()["status"] == "success"
    assert (tmp_path / "Test_Organized_Folder").exists()

    # List again
    res2 = client.get(f"/fs/list-directory?path={tmp_path}")
    assert res2.status_code == 200
    dirs = [d["name"] for d in res2.json()["directories"]]
    assert "Test_Organized_Folder" in dirs


def test_open_path_nonexistent(client):
    """Verify 404 on nonexistent path."""
    res = client.post("/fs/open-path", json={"path": "/nonexistent/random/folder/12345"})
    assert res.status_code == 404


from unittest.mock import patch


def test_open_path_existing(client, tmp_path):
    """Verify 200 on existing directory."""
    test_file = tmp_path / "sample.txt"
    test_file.write_text("hello world")
    with patch("subprocess.Popen") as mock_popen:
        res = client.post("/fs/open-path", json={"path": str(test_file), "reveal": False})
        assert res.status_code == 200
        assert res.json()["status"] == "success"
        assert mock_popen.called

