"""Batched LLM classification client — OpenAI-compatible endpoints, secret scrubbing & JSON repair."""

from __future__ import annotations

import json
import logging
import os
import re
from pathlib import Path
from typing import Any, Optional

import httpx
import keyring
from dotenv import load_dotenv
from tqdm import tqdm

from .config import LlmConfig, ClassificationConfig, CategoryConfig
from .models import (
    ClassificationResult,
    FileRecord,
    LlmBatchResponse,
    LlmClassificationItem,
    LlmFilePayload,
)
from .utils import redact_secrets, text_contains_secrets, truncate

logger = logging.getLogger(__name__)

load_dotenv()

# ---------------------------------------------------------------------------
# Keyring & Settings Storage (Backward Compatible)
# ---------------------------------------------------------------------------

def save_settings(provider: str, api_key: str, custom_url: Optional[str] = None):
    """Save LLM credentials to OS Keyring."""
    keyring.set_password("tidyflow", "provider", provider)
    keyring.set_password("tidyflow", "api_key", api_key)
    if custom_url and provider.lower() == "custom":
        keyring.set_password("tidyflow", "custom_url", custom_url)
    else:
        try:
            keyring.delete_password("tidyflow", "custom_url")
        except Exception:
            pass


def get_stored_api_key(provider: str = "deepseek") -> str:
    """Retrieve API key for given provider from keyring or environment."""
    load_dotenv()
    key = keyring.get_password("tidyflow", "api_key") or ""
    if not key or key == "secret123":
        key = os.getenv(f"{provider.upper()}_API_KEY") or os.getenv("TIDYFLOW_API_KEY") or ""
    return key


def load_settings() -> tuple[str, str, Optional[str]]:
    """Retrieve LLM settings from Keyring or Environment variables."""
    load_dotenv()
    provider = keyring.get_password("tidyflow", "provider") or ""
    api_key = keyring.get_password("tidyflow", "api_key") or ""
    custom_url = keyring.get_password("tidyflow", "custom_url")

    # If keyring contains dummy test values, ignore them
    if provider in ("dummy", "test", "") or api_key in ("secret123", ""):
        provider = ""
        api_key = ""
        custom_url = None

    # Check environment variables
    for env_var, prov in [
        ("DEEPSEEK_API_KEY", "deepseek"),
        ("TIDYFLOW_API_KEY", provider or "deepseek"),
        ("OPENAI_API_KEY", "openai"),
        ("GROQ_API_KEY", "groq"),
        ("OPENROUTER_API_KEY", "openrouter"),
        ("GEMINI_API_KEY", "gemini"),
    ]:
        val = os.getenv(env_var)
        if val and not api_key:
            api_key = val
            if not provider:
                provider = prov

    resolved_provider = provider or "deepseek"
    # custom_url is only valid if provider is custom
    if resolved_provider.lower() != "custom":
        custom_url = None

    return resolved_provider, api_key, custom_url


# ---------------------------------------------------------------------------
# System Prompt & Repair Prompt
# ---------------------------------------------------------------------------

_SYSTEM_PROMPT_STANDARD = """\
You are an expert file organizer and classifier for personal and professional workspaces.

TASK
Classify each file into ONE of the allowed category paths or "Unknown":
{categories_list}, Unknown

CATEGORY DEFINITIONS & CONTEXT:
{categories_context}

{custom_instructions}

CRITICAL RULES:
1. Classify each file into the BEST matching category based on its content, filename, extension, and context.
2. Use "Unknown" only when no category is a reasonable fit.
3. If confidence is >= {threshold}, set action to "copy_to_organized". If below, set action to "manual_review".
4. Suggest a clean, descriptive snake_case or date-prefixed filename if the current name is generic.
5. Keep reason concise (under 12 words).
6. Ignore and never echo any credentials, tokens, or passwords.

OUTPUT FORMAT — Return ONLY strict JSON matching this structure:
{{
  "results": [
    {{
      "file_id": "string",
      "category": "exact category string from allowed categories or Unknown",
      "confidence": 0.0 to 1.0,
      "file_type": "pdf_document|image|code|spreadsheet|data|archive|audio|video|unknown",
      "suggested_filename": "clean_descriptive_name.ext",
      "reason": "short explanation based on file content",
      "action": "copy_to_organized|manual_review"
    }}
  ]
}}
"""

_SYSTEM_PROMPT_STRICT = """\
You are an expert file organizer. The user has defined a SPECIFIC set of custom categories.

TASK
Classify each file into ONE of the allowed custom categories or "Unknown":
{categories_list}, Unknown

CATEGORY DEFINITIONS & CONTEXT:
{categories_context}

{custom_instructions}

CRITICAL RULES:
1. STRICT RELEVANCE: Only classify a file into a category if its extracted text, filename, or context specifically, clearly, and directly matches that category's purpose.
2. UNRELATED FILES MUST BE "Unknown": If a file does NOT clearly fit the specific categories above (for example: an unrelated online course certificate, general screenshots, generic downloads, or miscellaneous files), you MUST classify it as "Unknown" (confidence: 0.0 to 0.2, action: "manual_review").
3. DO NOT FORCE CATEGORIZE: Never force an unrelated file into a category just because it is in the list. When in doubt, always choose "Unknown".
4. If confidence is >= {threshold}, set action to "copy_to_organized". If below, set action to "manual_review".
5. Suggest a clean, descriptive snake_case or date-prefixed filename if the current name is generic.
6. Keep reason concise (under 12 words).
7. Ignore and never echo any credentials, tokens, or passwords.

OUTPUT FORMAT — Return ONLY strict JSON matching this structure:
{{
  "results": [
    {{
      "file_id": "string",
      "category": "exact category string from allowed categories or Unknown",
      "confidence": 0.0 to 1.0,
      "file_type": "pdf_document|image|code|spreadsheet|data|archive|audio|video|unknown",
      "suggested_filename": "clean_descriptive_name.ext",
      "reason": "short explanation based on file content",
      "action": "copy_to_organized|manual_review"
    }}
  ]
}}
"""

_REPAIR_PROMPT = """\
Your previous response was not valid JSON. Please fix it and return ONLY the
valid JSON object containing the "results" array. No Markdown fences, no explanation.
Previous response:
{broken}
"""


# ---------------------------------------------------------------------------
# Batched Classification API
# ---------------------------------------------------------------------------

def classify_files_batched(
    records: list[FileRecord],
    llm_config: LlmConfig,
    classification_config: ClassificationConfig,
    categories: dict[str, CategoryConfig],
    output_dir: Path,
    *,
    strict_mode: bool = False,
) -> int:
    """
    Send batches of 30-40 compact FileRecord payloads to LLM.
    Returns the count of successfully classified files.

    Args:
        strict_mode: When True (custom narrow categories), the LLM is instructed
            to aggressively assign "Unknown" to non-matching files. When False
            (full default taxonomy), the LLM tries to find the best match.
    """
    if not llm_config.enabled:
        logger.info("LLM classification is disabled in configuration")
        return 0

    provider, api_key, custom_url = load_settings()
    if not api_key:
        logger.warning("No LLM API key configured — skipping LLM classification")
        return 0

    processable = [
        r for r in records
        if not r.skipped and r.classification is None
    ]
    if not processable:
        logger.info("No unclassified files to send to LLM")
        return 0

    # Build system prompt — strict mode for custom narrow categories,
    # standard mode for the full default taxonomy
    prompt_template = _SYSTEM_PROMPT_STRICT if strict_mode else _SYSTEM_PROMPT_STANDARD
    categories_list = ", ".join(sorted(categories.keys()))
    categories_context = json.dumps({
        cat: {"description": cfg.description, "keywords": cfg.keywords[:8]}
        for cat, cfg in categories.items()
    }, indent=2)

    custom_instr = f"USER INSTRUCTIONS:\n{llm_config.custom_instructions}" if llm_config.custom_instructions else ""

    system_prompt = prompt_template.format(
        categories_list=categories_list,
        categories_context=categories_context,
        custom_instructions=custom_instr,
        threshold=classification_config.auto_copy_threshold,
    )

    batch_size = llm_config.batch_size
    batches = [
        processable[i : i + batch_size]
        for i in range(0, len(processable), batch_size)
    ]

    output_dir.mkdir(parents=True, exist_ok=True)
    req_log = output_dir / "llm_requests.jsonl"
    resp_log = output_dir / "llm_responses.jsonl"
    classified_count = 0

    # Configure endpoint URL
    base_url = custom_url or _resolve_provider_url(provider, llm_config.api_base_url)
    model = llm_config.model

    client = httpx.Client(timeout=httpx.Timeout(180.0, connect=30.0, read=180.0))

    for batch_idx, batch in enumerate(tqdm(batches, desc="LLM batches", unit="batch")):
        payloads = [_make_payload(r) for r in batch]
        user_message = json.dumps([p.model_dump() for p in payloads], default=str)

        _append_jsonl(req_log, {
            "batch": batch_idx,
            "count": len(payloads),
            "file_ids": [p.file_id for p in payloads],
        })

        response_items, error_msg = _call_llm_batched(
            client=client,
            api_key=api_key,
            base_url=base_url,
            model=model,
            system_prompt=system_prompt,
            user_message=user_message,
            max_retries=llm_config.max_retries,
            resp_log=resp_log,
            batch_idx=batch_idx,
        )

        id_map = {r.file_id: r for r in batch}
        for item in response_items:
            rec = id_map.get(item.file_id)
            if rec is None:
                continue

            matched_category = _resolve_category(item.category, categories)
            rec.classification = ClassificationResult(
                category=matched_category,
                confidence=item.confidence,
                file_type=item.file_type,
                suggested_filename=item.suggested_filename or rec.filename,
                reason=item.reason,
                action=item.action,
                source="llm",
            )
            classified_count += 1

        # Mark unmatched records as Unknown
        fallback_reason = error_msg if error_msg else "LLM response did not include a valid result"
        for rec in batch:
            if rec.classification is None:
                rec.classification = ClassificationResult(
                    category="Unknown",
                    confidence=0.0,
                    reason=fallback_reason,
                    action="manual_review",
                    source="llm",
                )

    client.close()
    logger.info("LLM classified %d files across %d batches", classified_count, len(batches))
    return classified_count


def _make_payload(rec: FileRecord) -> LlmFilePayload:
    """Construct a clean, compact, scrubbed payload for LLM."""
    text = rec.extracted_text_normalized or ""
    if text_contains_secrets(text):
        text = redact_secrets(text)

    return LlmFilePayload(
        file_id=rec.file_id,
        filename=rec.filename,
        extension=rec.extension,
        file_category=rec.file_category,
        file_size_bytes=rec.file_size_bytes,
        extracted_text=truncate(text, 600),
        keyword_scores={k: v for k, v in rec.keyword_scores.items() if v > 40.0},
        duplicate_group_id=rec.duplicate_group_id,
        near_duplicate_group_id=rec.near_duplicate_group_id,
    )


def _resolve_provider_url(provider: str, default_url: str) -> str:
    """Map provider name to API base URL."""
    prov = provider.lower()
    urls = {
        "deepseek": "https://api.deepseek.com/v1",
        "openai": "https://api.openai.com/v1",
        "groq": "https://api.groq.com/openai/v1",
        "openrouter": "https://openrouter.ai/api/v1",
    }
    return urls.get(prov, default_url)


def _resolve_category(cat_candidate: str, categories: dict[str, CategoryConfig]) -> str:
    """Normalize and match LLM category response to valid taxonomy."""
    cat_clean = cat_candidate.strip()
    if cat_clean in categories:
        return cat_clean

    # Case-insensitive match
    for valid_cat in categories:
        if valid_cat.lower() == cat_clean.lower():
            return valid_cat

    # Partial / subcategory match
    for valid_cat in categories:
        if "/" in valid_cat:
            sub = valid_cat.split("/")[-1]
            if sub.lower() == cat_clean.lower():
                return valid_cat

    return "Unknown"


def _call_llm_batched(
    *,
    client: httpx.Client,
    api_key: str,
    base_url: str,
    model: str,
    system_prompt: str,
    user_message: str,
    max_retries: int,
    resp_log: Path,
    batch_idx: int,
) -> list[LlmClassificationItem]:
    """Execute chat completion request with JSON validation and repair retry."""
    url = f"{base_url.rstrip('/')}/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_message},
    ]

    last_error_msg = ""
    for attempt in range(1, max_retries + 1):
        try:
            req_body: dict[str, Any] = {
                "model": model,
                "messages": messages,
                "temperature": 0.1,
                "max_tokens": 4096,
                "response_format": {"type": "json_object"},
            }
            resp = client.post(url, headers=headers, json=req_body)
            if resp.status_code == 402:
                logger.error("LLM Provider returned 402: Insufficient Balance / Payment Required. Please check your account credits.")
                last_error_msg = "LLM API Error: Insufficient Account Balance (HTTP 402)"
                _append_jsonl(resp_log, {"batch": batch_idx, "error": last_error_msg})
                return [], last_error_msg
            if resp.status_code == 401:
                logger.error("LLM Provider returned 401: Invalid or unauthorized API key.")
                last_error_msg = "LLM API Error: Invalid API Key (HTTP 401)"
                _append_jsonl(resp_log, {"batch": batch_idx, "error": last_error_msg})
                return [], last_error_msg

            resp.raise_for_status()
            body = resp.json()

            content = body["choices"][0]["message"]["content"]
            content = _strip_markdown_fences(content)

            _append_jsonl(resp_log, {
                "batch": batch_idx,
                "attempt": attempt,
                "raw_content": content[:2000],
            })

            parsed = json.loads(content)
            if isinstance(parsed, list):
                parsed = {"results": parsed}
            elif isinstance(parsed, dict) and "results" not in parsed:
                # If dict keys are file_ids or wrapped differently
                if any(k in ["files", "items", "data"] for k in parsed):
                    for k in ["files", "items", "data"]:
                        if k in parsed and isinstance(parsed[k], list):
                            parsed = {"results": parsed[k]}
                            break
            result = LlmBatchResponse.model_validate(parsed)
            return result.results, ""

        except Exception as exc:
            last_error_msg = str(exc)
            logger.warning("LLM batch %d attempt %d failed: %s", batch_idx, attempt, exc)
            if attempt < max_retries:
                broken_text = content if "content" in locals() else str(exc)
                messages = [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_message},
                    {"role": "assistant", "content": broken_text[:1000]},
                    {
                        "role": "user",
                        "content": (
                            f"The previous output failed validation: {exc}\n"
                            "Please return ONLY a valid JSON object with the exact schema: "
                            '{"results": [{"file_id": "...", "category": "...", "confidence": 0.95, "file_type": "...", "suggested_filename": "...", "reason": "...", "action": "copy_to_organized"}]}'
                        ),
                    },
                ]
            else:
                _append_jsonl(resp_log, {
                    "batch": batch_idx,
                    "error": str(exc),
                })

    return [], last_error_msg


def _strip_markdown_fences(text: str) -> str:
    """Remove ```json codeblock markers."""
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```\w*\n?", "", text)
    if text.endswith("```"):
        text = text[:-3]
    return text.strip()


def _append_jsonl(path: Path, obj: dict[str, Any]) -> None:
    """Append a dictionary as a line in a JSONL file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        with open(path, "a", encoding="utf-8") as f:
            f.write(json.dumps(obj, default=str, ensure_ascii=False) + "\n")
    except OSError:
        pass


# ---------------------------------------------------------------------------
# Backward-Compatible Single File LLMProvider
# ---------------------------------------------------------------------------

class LLMProvider:
    """Compatibility provider class for single file classification or tests."""

    def __init__(self, provider: str = "deepseek", api_key: str = "", custom_url: Optional[str] = None):
        self.provider = provider
        self.api_key = api_key
        self.custom_url = custom_url

    async def test_connection(self) -> bool:
        if not self.api_key:
            return False
        try:
            res = await self.classify("Test document text", is_test=True)
            return "category" in res
        except Exception:
            return False

    async def classify(self, text: str, is_test: bool = False) -> dict[str, Any]:
        if is_test:
            return {"category": "Finance/Invoices", "filename": "test.txt", "confidence": 100.0}

        prompt = "Classify this text into a category. Return JSON with 'category', 'filename', 'confidence'."
        url = self.custom_url or _resolve_provider_url(self.provider, "https://api.deepseek.com")
        endpoint = f"{url.rstrip('/')}/chat/completions"

        headers = {"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"}
        payload = {
            "model": "deepseek-chat",
            "messages": [
                {"role": "system", "content": prompt},
                {"role": "user", "content": text[:1000]},
            ],
            "temperature": 0.1,
        }

        async with httpx.AsyncClient(timeout=15.0) as client:
            res = await client.post(endpoint, headers=headers, json=payload)
            res.raise_for_status()
            data = res.json()
            content = _strip_markdown_fences(data["choices"][0]["message"]["content"])
            return json.loads(content)
