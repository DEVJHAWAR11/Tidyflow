"""Keep tests away from the real user's TidyFlow settings, API key, folder plan and run history."""

import pytest

import src.api
import src.config
import src.llm_provider
import src.rules
import src.utils


@pytest.fixture(autouse=True)
def isolated_app_data(tmp_path_factory, monkeypatch):
    app_dir = tmp_path_factory.mktemp("tidyflow-appdata")
    for module in (src.utils, src.api, src.config, src.llm_provider, src.rules):
        monkeypatch.setattr(module, "get_app_data_dir", lambda: app_dir)
    # API keys set by a test must not leak into the next one.
    for var in ("TIDYFLOW_API_KEY", "DEEPSEEK_API_KEY", "OPENAI_API_KEY", "GROQ_API_KEY",
                "OPENROUTER_API_KEY", "GEMINI_API_KEY"):
        monkeypatch.delenv(var, raising=False)
    # Don't read a real key from the repo's .env either.
    monkeypatch.setattr(src.llm_provider, "load_dotenv", lambda *a, **k: False)
    # Never try a key against a real AI service from a test; a test that cares sets its own answer.
    for module in (src.api, src.llm_provider):
        monkeypatch.setattr(module, "check_api_key", lambda *a, **k: ("ok", None))
    monkeypatch.setattr(src.api, "list_provider_models", lambda *a, **k: [])
    src.llm_provider.set_llm_error(None)
    return app_dir
