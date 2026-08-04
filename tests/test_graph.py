import pytest
from src.graph import app

@pytest.mark.asyncio
async def test_graph_fast_path():
    # .txt is in DEFAULT_HEURISTICS ("Documents")
    initial_state = {"file_path": "test_document.txt"}
    
    # Run graph
    result = await app.ainvoke(initial_state)
    
    assert result["category"] == "Documents"
    assert result["needs_review"] is False
    # Should bypass extraction
    assert result.get("extracted_text", "") == ""

@pytest.mark.asyncio
async def test_graph_smart_path():
    # .xyz is not in heuristics, should go to AI
    initial_state = {"file_path": "unknown_file.xyz"}
    
    # We won't actually hit the real PDF because the file doesn't exist,
    # so extraction will fail and flag it for review.
    result = await app.ainvoke(initial_state)
    print("RESULT IS:", result)
    assert result["needs_review"] is True
