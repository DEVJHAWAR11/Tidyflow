"""Settings: one key per AI provider, tried before it is saved, and an API only the app may call."""

import json

import pytest
from fastapi.testclient import TestClient

import src.api as api
import src.llm_provider as llm


@pytest.fixture
def client():
    return TestClient(api.app)


def _saved(app_dir):
    return json.loads((app_dir / "settings.json").read_text())


def test_each_provider_keeps_its_own_key(client, isolated_app_data):
    assert client.post("/settings", json={"provider": "deepseek", "api_key": "sk-deepseek-0001"}).status_code == 200
    body = client.post("/settings", json={"provider": "openai", "api_key": "sk-openai-0002"}).json()

    assert body["provider"] == "openai" and body["has_key"] is True
    assert _saved(isolated_app_data)["keys"] == {"deepseek": "sk-deepseek-0001", "openai": "sk-openai-0002"}
    assert llm.load_settings()[:2] == ("openai", "sk-openai-0002")

    # Going back to DeepSeek uses DeepSeek's key again, without typing it.
    assert client.post("/settings", json={"provider": "deepseek"}).json()["provider"] == "deepseek"
    assert llm.load_settings()[:2] == ("deepseek", "sk-deepseek-0001")


def test_switching_to_a_provider_without_a_key_is_refused(client):
    client.post("/settings", json={"provider": "deepseek", "api_key": "sk-deepseek-0001"})
    res = client.post("/settings", json={"provider": "groq"})

    assert res.status_code == 400
    # The DeepSeek key was not handed to Groq, and DeepSeek is still the one in use.
    assert llm.load_settings()[:2] == ("deepseek", "sk-deepseek-0001")
    assert llm.get_stored_api_key("groq") == ""


def test_a_refused_key_is_not_saved(client, monkeypatch):
    client.post("/settings", json={"provider": "deepseek", "api_key": "sk-good-0001"})
    monkeypatch.setattr(api, "check_api_key", lambda *a, **k: ("rejected", "Your AI key was rejected."))

    res = client.post("/settings", json={"provider": "deepseek", "api_key": "sk-bad-9999"})

    assert res.status_code == 400 and "rejected" in res.json()["detail"]
    assert llm.load_settings()[1] == "sk-good-0001"


def test_a_key_that_cannot_be_checked_is_saved_with_a_warning(client, monkeypatch):
    monkeypatch.setattr(api, "check_api_key", lambda *a, **k: ("problem", "Couldn't reach the AI service."))
    monkeypatch.setattr(llm, "check_api_key", lambda *a, **k: ("problem", "Couldn't reach the AI service."))

    body = client.post("/settings", json={"provider": "gemini", "api_key": "g-key-0001"}).json()

    assert body["has_key"] is True and body["ai_error"] == "Couldn't reach the AI service."
    assert client.get("/status").json()["llm_error"] == "Couldn't reach the AI service."


def test_a_key_can_be_removed_and_keys_are_only_shown_masked(client):
    client.post("/settings", json={"provider": "deepseek", "api_key": "sk-deepseek-secret-0001"})
    shown = client.get("/settings").json()
    assert "sk-deepseek-secret-0001" not in json.dumps(shown)
    assert shown["masked_key"] == "sk-d…0001"

    body = client.request("DELETE", "/settings/key", params={"provider": "deepseek"}).json()

    assert body["has_key"] is False
    assert client.get("/status").json()["has_llm_key"] is False


def test_ai_can_be_switched_off_without_losing_the_key(client):
    client.post("/settings", json={"provider": "deepseek", "api_key": "sk-deepseek-0001"})

    off = client.post("/settings", json={"ai_enabled": False}).json()
    assert off["ai_enabled"] is False and off["has_key"] is False
    assert llm.load_settings()[1] == ""  # nothing is sent to the provider while it is off

    on = client.post("/settings", json={"ai_enabled": True}).json()
    assert on["has_key"] is True and llm.load_settings()[1] == "sk-deepseek-0001"


def test_the_model_is_remembered_per_provider(client):
    client.post("/settings", json={"provider": "deepseek", "api_key": "k-00000001", "model": "deepseek-v4-pro"})
    client.post("/settings", json={"provider": "openai", "api_key": "k-00000002", "model": "gpt-4o"})

    assert llm._resolve_provider_model("openai") == "gpt-4o"
    assert llm._resolve_provider_model("deepseek", "something-else") == "deepseek-v4-pro"
    assert client.post("/settings", json={"provider": "deepseek"}).json()["model"] == "deepseek-v4-pro"


@pytest.mark.parametrize("change", [
    {"provider": "bogus", "api_key": "k"},
    {"auto_copy_threshold": 5},
    {"auto_copy_threshold": 0.1},
    {"max_file_size_mb": -1},
])
def test_bad_values_are_refused(client, change):
    assert client.post("/settings", json=change).status_code == 422


def test_a_key_from_another_provider_in_the_environment_is_not_used(monkeypatch):
    monkeypatch.setenv("DEEPSEEK_API_KEY", "sk-env-deepseek")
    llm.save_settings("openai", "")
    assert llm.load_settings()[:2] == ("openai", "")
    assert llm.get_stored_api_key("deepseek") == "sk-env-deepseek"


def test_an_old_single_key_file_still_works(isolated_app_data):
    (isolated_app_data / "settings.json").write_text(json.dumps({"provider": "deepseek", "api_key": "sk-old-0001", "custom_url": None}))
    assert llm.load_settings()[:2] == ("deepseek", "sk-old-0001")
    llm.save_settings("groq", "gsk-new-0002")
    assert _saved(isolated_app_data)["keys"] == {"deepseek": "sk-old-0001", "groq": "gsk-new-0002"}


def test_testing_a_key_saves_nothing(client, monkeypatch, isolated_app_data):
    monkeypatch.setattr(api, "check_api_key", lambda *a, **k: ("rejected", "Your AI key was rejected."))
    body = client.post("/settings/test", json={"provider": "openai", "api_key": "sk-bad"}).json()
    assert body == {"ok": False, "kind": "rejected", "error": "Your AI key was rejected."}
    assert not (isolated_app_data / "settings.json").exists()
    assert client.post("/settings/test", json={"provider": "openai"}).json()["kind"] == "missing"


def test_only_the_app_may_call_the_api(client):
    assert client.get("/settings", headers={"Origin": "https://evil.example"}).status_code == 403
    assert client.post("/settings", json={"ai_enabled": False}, headers={"Origin": "https://evil.example"}).status_code == 403
    assert client.get("/settings", headers={"Origin": "null"}).status_code == 403
    for origin in ("http://localhost:1420", "http://127.0.0.1:8000", "tauri://localhost"):
        res = client.get("/settings", headers={"Origin": origin})
        assert res.status_code == 200 and res.headers["access-control-allow-origin"] == origin
    assert client.get("/settings").status_code == 200  # the app's own page sends no Origin on a GET
