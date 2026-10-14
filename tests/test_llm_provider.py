import pytest
import os
from src.llm_provider import LLMProvider, load_settings, save_settings

def test_settings_storage():
    orig_prov, orig_key, orig_url = load_settings()
    try:
        save_settings("custom", "test_key_123", "http://localhost:8000")
        provider, api_key, custom_url = load_settings()
        assert provider == "custom"
        assert api_key == "test_key_123"
        assert custom_url == "http://localhost:8000"
    finally:
        save_settings(orig_prov, orig_key, orig_url)
    
@pytest.mark.asyncio
async def test_llm_provider_deepseek():
    # Only test if api key is available in env
    provider, api_key, custom_url = load_settings()
    if api_key and provider == "deepseek":
        llm = LLMProvider(provider, api_key, custom_url)
        res = await llm.classify("Test document", is_test=True)
        assert "category" in res
        assert "filename" in res
        assert "confidence" in res


def test_payload_never_carries_a_saved_logins_table():
    from pathlib import Path
    from src.llm_provider import _make_payload
    from src.models import FileRecord

    raw = '"url","username","password"\n"https://example.com","me","hunter2"\n'
    rec = FileRecord(
        file_id="x", abs_path=Path("/tmp/export.csv"), rel_path=Path("export.csv"), filename="export.csv",
        extension=".csv", file_size_bytes=len(raw), file_category="data",
        extracted_text_raw=raw, extracted_text_normalized=raw.lower(),
    )
    assert _make_payload(rec).extracted_text == ""
