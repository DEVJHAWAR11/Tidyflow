import pytest
from pathlib import Path
from src.graph import app
from src.mcp_server import set_allowed_directories


@pytest.mark.asyncio
async def test_graph_fast_path(tmp_path):
    # Create test script in temp dir
    test_script = tmp_path / "test_script.py"
    test_script.write_text("print('hello')")

    set_allowed_directories([tmp_path])
    initial_state = {
        "file_path": str(test_script),
        "base_scan_dir": str(tmp_path),
    }

    result = await app.ainvoke(initial_state)

    assert result["category"] == "Development/Code"
    assert result.get("error") is None
    assert result.get("needs_review") is False
    assert result.get("extracted_text", "") == ""


@pytest.mark.asyncio
async def test_graph_smart_path():
    # Non-existent .xyz is not in heuristics and has no text, should flag review
    initial_state = {"file_path": "unknown_file.xyz"}

    result = await app.ainvoke(initial_state)
    assert result["needs_review"] is True
