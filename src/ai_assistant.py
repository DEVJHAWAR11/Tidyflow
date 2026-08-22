"""AI Assistant module for conversational category planning, verification, and review edits."""

from __future__ import annotations

import json
import logging
import os
import re
from pathlib import Path
from typing import Any, Optional

import httpx

from .llm_provider import (
    _resolve_provider_model,
    _resolve_provider_url,
    _strip_markdown_fences,
    load_settings,
)

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Prompt Builders & Complexity Guidelines
# ---------------------------------------------------------------------------

def _get_complexity_guidelines(complexity_level: str = "medium") -> str:
    level = (complexity_level or "medium").lower().strip()
    if level == "low":
        return """\
CLASSIFICATION COMPLEXITY LEVEL: SIMPLE (BROAD)
- Structure: FLAT STRUCTURE ONLY. Do NOT use subfolders (no "/" in category names).
- Organization: Broad, clean top-level categories (e.g., "Documents", "Media", "Development", "Archives").
- Goal: Rapid, clean decluttering with minimal mental overhead."""
    elif level in ("high", "complex"):
        return """\
CLASSIFICATION COMPLEXITY LEVEL: DETAILED (DEEP HIERARCHY)
- Structure: Multi-level hierarchical categories (1-2 levels of subfolders, e.g., "Documents/Reports", "Documents/Notes", "Media/Photos", "Media/Screenshots", "Development/Source_Code", "Development/Data").
- Date & Project Detection: Include date-aware or project-aware folder hierarchies where relevant based on actual files.
- Keywords & Extensions: Provide precise keywords and targeted file extensions for each category."""
    else:  # medium / balanced (default)
        return """\
CLASSIFICATION COMPLEXITY LEVEL: BALANCED (STANDARD)
- Structure: Well-structured functional categories with 1 level of clean subfolders where logical (e.g., "Documents/General", "Media/Images", "Development/Code", "Archives").
- Keywords & Extensions: Distinct keywords and matching extensions per category."""


def _build_structure_chat_system_prompt(complexity_level: str = "medium") -> str:
    complexity_guide = _get_complexity_guidelines(complexity_level)
    return f"""\
You are TidyFlow AI, an expert workspace organizer, taxonomist, and file structure architect.
Your goal is to help users organize their disorganized directories into clean, intuitive, and tailored category folders.

{complexity_guide}

CRITICAL RULES FOR REFINEMENT & CATEGORY MODIFICATIONS:
1. COMPLETE TAXONOMY REPLACEMENT: The "categories" object in your JSON output will be the EXACT active set of categories in the user's workspace.
2. DELETE / REMOVE REQUESTS: If the user says "remove X", "delete X", "I don't want X", "get rid of X", or "exclude X", you MUST COMPLETELY REMOVE category X from the returned "categories" dictionary. NEVER keep a category the user asked to remove.
3. RENAME / MERGE / SPLIT:
   - If the user asks to rename "X" to "Y", update the key and name to "Y", preserving or updating the description/keywords.
   - If the user asks to split "X" into "Y" and "Z", remove "X" and create "Y" and "Z".
   - If the user asks to merge "A" and "B" into "C", remove "A" and "B" and add "C".
4. ADD NEW CATEGORIES: If the user asks to add a category (e.g., "add a folder for Receipts"), add it alongside the existing valid categories without wiping the rest.
5. COMPLEXITY ADJUSTMENTS:
   - If the user asks for fewer / simpler categories (e.g. "make it simpler", "fewer folders"), consolidate categories into broader buckets according to the Low/Broad complexity level.
   - If the user asks for more granular / detailed categories (e.g. "split by project", "make it more detailed"), break them down into finer categories according to the High/Complex level.
6. AUTO-DISCOVERY FROM FILES: When sample filenames or file inventories are provided, inspect the actual file names, extensions, course codes, client names, and topics present in the directory and create categories specifically tailored to those real files.
7. For each category provide:
   - "name": Clean path/folder name (e.g. "Work/Reports", "Finance/Invoices", "Academic/Lectures", "Photos").
   - "description": 1-2 sentence description of what belongs in this folder.
   - "keywords": 4 to 8 distinct matching keywords (lowercase).
   - "extensions": Target file extensions (e.g. [".pdf", ".docx", ".xlsx", ".png"]) or [] if all extensions are allowed.
   - "active": true
8. Set "is_ready" to true if a concrete category structure is proposed.
9. In "message", provide a friendly, conversational explanation explicitly detailing what changes were made.

OUTPUT FORMAT — Return ONLY strict JSON:
{{
  "message": "Friendly response explaining the proposed organization structure, highlighting key folders, and summarizing changes.",
  "categories": {{
    "Category_Name": {{
      "name": "Category_Name",
      "description": "Short description",
      "keywords": ["kw1", "kw2"],
      "extensions": [".pdf", ".docx"],
      "active": true
    }}
  }},
  "custom_instructions": "Specific rules for file classification if any",
  "is_ready": true
}}
"""


_REVIEW_COMMAND_SYSTEM_PROMPT = """\
You are TidyFlow AI assisting the user with bulk editing classified files in the review dashboard.
The user will provide a command in natural language (e.g., "Move all invoices to Finance/Invoices", "Set files containing 'tax' to Taxes/2026", "Change all .png files to Screenshots", "Create category Travel and move vacation photos there").

TASK:
1. Examine the list of files provided (file_id, filename, current_category, extension).
2. Determine which files match the user's intent.
3. You can assign files to EXISTING categories or introduce a NEW target category if the user asked for one.
4. Output category overrides mapping file_id to the target category.
5. Output optional suggested filename changes if requested.

OUTPUT FORMAT — Return ONLY strict JSON:
{
  "message": "Clear explanation of what was changed (e.g., 'Moved 5 invoice files to Finance/Invoices').",
  "category_overrides": {
    "file_id_1": "Target_Category_Name"
  },
  "filename_overrides": {
    "file_id_1": "suggested_new_filename.ext"
  }
}
"""

_CLUSTER_UNRECOGNIZED_SYSTEM_PROMPT = """\
You are TidyFlow AI, an intelligent workspace organization and file clustering engine.
You are given a list of unclassified or unrecognized files.

TASK:
1. Examine the unclassified files (filename, extension, extracted text/OCR excerpt, reason).
2. Discover common themes and group these files into clean, descriptive cluster categories (e.g. "React_Course", "Invoice_Screenshots", "Configs_and_Data", "Media_Wallpapers", "Archives").
3. Assign each file to the most appropriate cluster category.
4. If a file is completely solitary, assign it to a category like "Misc_Documents" or "Misc_Images".

OUTPUT FORMAT — Return ONLY strict JSON:
{
  "message": "Friendly summary of the clusters discovered (e.g., 'Grouped 18 files into 3 new categories: React_Course, Mobile_Invoices, and Configs.').",
  "clusters": {
    "React_Course": ["file_id_1", "file_id_2"],
    "Mobile_Invoices": ["file_id_3"]
  },
  "category_overrides": {
    "file_id_1": "React_Course",
    "file_id_2": "React_Course",
    "file_id_3": "Mobile_Invoices"
  }
}
"""


# ---------------------------------------------------------------------------
# Deep Directory Inspection for Bespoke Taxonomy Synthesis
# ---------------------------------------------------------------------------

def inspect_directory_files(input_dir: str, max_files: int = 100) -> list[str]:
    """
    Recursively inspect up to `max_files` from input_dir, extracting filenames,
    relative paths, extensions, file sizes, and short content previews for text/PDF files.
    """
    if not input_dir:
        return []

    p = Path(input_dir).resolve()
    if not p.exists() or not p.is_dir():
        return []

    ignored_names = {
        ".git", ".svn", ".hg", "__pycache__", ".pytest_cache", ".venv", "venv",
        "node_modules", ".DS_Store", "Thumbs.db", ".tidyflow",
        "Organized_Output", "organized_output", "Organized", "organized", "Staging", "staging",
    }

    discovered: list[str] = []

    for root, dirs, files in os.walk(p):
        dirs[:] = [d for d in dirs if d not in ignored_names and not d.startswith(".")]
        try:
            rel_root = Path(root).relative_to(p)
        except ValueError:
            rel_root = Path(".")

        for file_name in files:
            if file_name.startswith(".") or file_name in ignored_names:
                continue

            file_path = Path(root) / file_name
            rel_file_path = (rel_root / file_name).as_posix() if str(rel_root) != "." else file_name
            ext = file_path.suffix.lower()

            try:
                size_kb = round(file_path.stat().st_size / 1024, 1)
            except OSError:
                size_kb = 0.0

            preview = ""
            try:
                if ext in {".txt", ".md", ".csv", ".json", ".py", ".js", ".ts", ".html", ".css", ".sql", ".sh", ".yaml", ".yml"}:
                    with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                        snippet = f.read(400).replace("\n", " ").strip()
                        if snippet:
                            preview = f' | Content: "{snippet[:180]}"'
                elif ext == ".pdf":
                    import fitz
                    doc = fitz.open(file_path)
                    if len(doc) > 0:
                        page_text = doc[0].get_text()[:400].replace("\n", " ").strip()
                        if page_text:
                            preview = f' | PDF Content: "{page_text[:180]}"'
                    doc.close()
            except Exception:
                pass

            file_desc = f"{rel_file_path} ({ext.upper() if ext else 'FILE'}, {size_kb} KB){preview}"
            discovered.append(file_desc)

            if len(discovered) >= max_files:
                break

        if len(discovered) >= max_files:
            break

    return discovered


# ---------------------------------------------------------------------------
# Conversational Category Structure Planner & Auto-Discovery
# ---------------------------------------------------------------------------

def chat_generate_structure(
    message: str,
    history: list[dict[str, str]] | None = None,
    current_categories: dict[str, Any] | None = None,
    sample_filenames: list[str] | None = None,
    complexity_level: str = "medium",
    auto_discover: bool = False,
) -> dict[str, Any]:
    """
    Process natural language instruction or auto-discovery trigger to generate or update categories.
    Returns:
        {
            "message": str,
            "categories": dict[str, dict],
            "custom_instructions": str,
            "is_ready": bool,
            "complexity_level": str
        }
    """
    provider, api_key, custom_url = load_settings()

    # If no LLM key, use smart heuristic fallback
    if not api_key:
        return _fallback_heuristic_structure(
            message=message,
            current_categories=current_categories,
            sample_filenames=sample_filenames,
            complexity_level=complexity_level,
            auto_discover=auto_discover,
        )

    base_url = custom_url or _resolve_provider_url(provider, "https://api.deepseek.com/v1")
    url = f"{base_url.rstrip('/')}/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    # Format context for prompt
    context_parts = []
    context_parts.append(f"SELECTED COMPLEXITY LEVEL: {complexity_level.upper()}")

    if current_categories and not auto_discover:
        active_cats = {k: v for k, v in current_categories.items() if v.get("active", True)}
        context_parts.append(f"CURRENT CONFIGURED CATEGORIES ({len(active_cats)} active):\n{json.dumps(active_cats, indent=2)}")

    if sample_filenames:
        context_parts.append(f"ACTUAL DIRECTORY INVENTORY (sample of {len(sample_filenames)} files):\n" + "\n".join(sample_filenames[:60]))

    context_str = "\n\n".join(context_parts) if context_parts else "No existing files/categories provided."

    system_prompt = _build_structure_chat_system_prompt(complexity_level)
    messages = [{"role": "system", "content": system_prompt}]

    # Append history (only if not a fresh auto-discover request)
    if history and not auto_discover:
        for h in history[-8:]:  # keep last 8 turns for context
            role = "assistant" if h.get("role") in ("assistant", "ai") else "user"
            content = h.get("content") or h.get("message") or ""
            if content:
                messages.append({"role": role, "content": content})

    # Current user turn with context
    req_type = "AUTO-DISCOVER DIRECTORY TAXONOMY REQUEST" if auto_discover else "USER INSTRUCTION / EDIT REQUEST"
    user_payload = f"{req_type}:\n{message}\n\nCONTEXT & CURRENT STATE:\n{context_str}"
    messages.append({"role": "user", "content": user_payload})

    try:
        with httpx.Client(timeout=50.0) as client:
            resp = client.post(
                url,
                headers=headers,
                json={
                    "model": _resolve_provider_model(provider),
                    "messages": messages,
                    "temperature": 0.2,
                    "response_format": {"type": "json_object"},
                },
            )
            resp.raise_for_status()
            data = resp.json()
            raw_content = data["choices"][0]["message"]["content"]
            cleaned = _strip_markdown_fences(raw_content)
            parsed = json.loads(cleaned)

            # Validate & normalize category objects
            raw_cats = parsed.get("categories", {})
            normalized_cats: dict[str, dict[str, Any]] = {}

            if isinstance(raw_cats, dict):
                for k, v in raw_cats.items():
                    if isinstance(v, dict):
                        cat_name = v.get("name") or k
                        normalized_cats[cat_name] = {
                            "name": cat_name,
                            "description": v.get("description", ""),
                            "keywords": v.get("keywords", []),
                            "extensions": v.get("extensions", []),
                            "active": v.get("active", True),
                        }
                    elif isinstance(v, str):
                        normalized_cats[k] = {
                            "name": k,
                            "description": v,
                            "keywords": [k.lower()],
                            "extensions": [],
                            "active": True,
                        }
            elif isinstance(raw_cats, list):
                for item in raw_cats:
                    if isinstance(item, dict) and "name" in item:
                        cat_name = item["name"]
                        normalized_cats[cat_name] = {
                            "name": cat_name,
                            "description": item.get("description", ""),
                            "keywords": item.get("keywords", []),
                            "extensions": item.get("extensions", []),
                            "active": item.get("active", True),
                        }

            msg = parsed.get(
                "message",
                f"Generated custom {complexity_level} taxonomy with {len(normalized_cats)} categories."
            )

            return {
                "message": msg,
                "categories": normalized_cats if normalized_cats else (current_categories or {}),
                "custom_instructions": parsed.get("custom_instructions", ""),
                "is_ready": parsed.get("is_ready", True),
                "complexity_level": complexity_level,
            }

    except Exception as exc:
        logger.warning("LLM category generation failed (%s), falling back to heuristic planner", exc)
        return _fallback_heuristic_structure(
            message=message,
            current_categories=current_categories,
            sample_filenames=sample_filenames,
            complexity_level=complexity_level,
            auto_discover=auto_discover,
        )


# ---------------------------------------------------------------------------
# Conversational Review Bulk Edit Assistant
# ---------------------------------------------------------------------------

def apply_review_command(
    command: str,
    files: list[dict[str, Any]],
    categories: list[str] | dict[str, Any] | None = None,
) -> dict[str, Any]:
    """
    Process natural language command to bulk edit categories or filenames in review table.
    Returns:
        {
            "message": str,
            "category_overrides": dict[str, str],
            "filename_overrides": dict[str, str]
        }
    """
    provider, api_key, custom_url = load_settings()

    cat_list = list(categories.keys()) if isinstance(categories, dict) else (categories or [])

    # If no LLM, use regex/rule-based matcher
    if not api_key:
        return _fallback_heuristic_review_command(command, files, cat_list)

    base_url = custom_url or _resolve_provider_url(provider, "https://api.deepseek.com/v1")
    url = f"{base_url.rstrip('/')}/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    # Compact files list for prompt (up to 120 files)
    files_payload = [
        {
            "file_id": f.get("file_id"),
            "filename": f.get("filename"),
            "extension": f.get("extension"),
            "current_category": f.get("category"),
            "reason": f.get("reason", "")[:60],
        }
        for f in files[:120]
    ]

    user_payload = (
        f"USER COMMAND: {command}\n\n"
        f"AVAILABLE CATEGORIES (you may also create a new one if command requests): {json.dumps(cat_list)}\n\n"
        f"FILES TO REVIEW ({len(files_payload)} items):\n{json.dumps(files_payload, indent=2)}"
    )

    try:
        with httpx.Client(timeout=40.0) as client:
            resp = client.post(
                url,
                headers=headers,
                json={
                    "model": _resolve_provider_model(provider),
                    "messages": [
                        {"role": "system", "content": _REVIEW_COMMAND_SYSTEM_PROMPT},
                        {"role": "user", "content": user_payload},
                    ],
                    "temperature": 0.1,
                    "response_format": {"type": "json_object"},
                },
            )
            resp.raise_for_status()
            data = resp.json()
            raw_content = data["choices"][0]["message"]["content"]
            cleaned = _strip_markdown_fences(raw_content)
            parsed = json.loads(cleaned)

            cat_overrides = parsed.get("category_overrides", {})
            fn_overrides = parsed.get("filename_overrides", {})

            # Clean and validate overrides
            valid_cat_overrides = {str(k): str(v) for k, v in cat_overrides.items() if v}
            valid_fn_overrides = {str(k): str(v) for k, v in fn_overrides.items() if v}

            msg = parsed.get(
                "message",
                f"Updated {len(valid_cat_overrides)} files based on your instruction."
            )

            return {
                "message": msg,
                "category_overrides": valid_cat_overrides,
                "filename_overrides": valid_fn_overrides,
            }

    except Exception as exc:
        logger.warning("LLM review edit command failed (%s), using heuristic matching", exc)
        return _fallback_heuristic_review_command(command, files, cat_list)


# ---------------------------------------------------------------------------
# Unrecognized Files Auto-Clustering
# ---------------------------------------------------------------------------

def cluster_unrecognized_files(
    files: list[dict[str, Any]],
    existing_categories: list[str] | None = None,
) -> dict[str, Any]:
    """
    Use LLM to cluster unrecognized files and propose categories.
    Returns:
        {
            "message": str,
            "clusters": dict[str, list[str]],
            "category_overrides": dict[str, str],
        }
    """
    provider, api_key, custom_url = load_settings()

    if not api_key or not files:
        return _fallback_heuristic_clustering(files, existing_categories)

    base_url = custom_url or _resolve_provider_url(provider, "https://api.deepseek.com/v1")
    url = f"{base_url.rstrip('/')}/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    files_payload = [
        {
            "file_id": f.get("file_id"),
            "filename": f.get("filename"),
            "extension": f.get("extension"),
            "file_category": f.get("file_category"),
            "extracted_text": (f.get("extracted_text") or "")[:250],
            "reason": f.get("reason", "")[:60],
        }
        for f in files[:80]
    ]

    user_payload = (
        f"EXISTING CATEGORIES: {json.dumps(existing_categories or [])}\n\n"
        f"UNCLASSIFIED FILES ({len(files_payload)} items):\n{json.dumps(files_payload, indent=2)}"
    )

    try:
        with httpx.Client(timeout=45.0) as client:
            resp = client.post(
                url,
                headers=headers,
                json={
                    "model": _resolve_provider_model(provider),
                    "messages": [
                        {"role": "system", "content": _CLUSTER_UNRECOGNIZED_SYSTEM_PROMPT},
                        {"role": "user", "content": user_payload},
                    ],
                    "temperature": 0.2,
                    "response_format": {"type": "json_object"},
                },
            )
            resp.raise_for_status()
            data = resp.json()
            raw_content = data["choices"][0]["message"]["content"]
            cleaned = _strip_markdown_fences(raw_content)
            parsed = json.loads(cleaned)

            clusters = parsed.get("clusters", {})
            overrides = parsed.get("category_overrides", {})

            # Build overrides from clusters if overrides was empty
            if not overrides and clusters:
                for cat_name, f_ids in clusters.items():
                    for fid in f_ids:
                        overrides[str(fid)] = cat_name

            # Build clusters from overrides if clusters was empty
            if not clusters and overrides:
                for fid, cat_name in overrides.items():
                    clusters.setdefault(cat_name, []).append(str(fid))

            msg = parsed.get(
                "message",
                f"Discovered {len(clusters)} cluster categories across {len(overrides)} files."
            )

            return {
                "message": msg,
                "clusters": clusters,
                "category_overrides": {str(k): str(v) for k, v in overrides.items()},
            }

    except Exception as exc:
        logger.warning("LLM auto-clustering failed (%s), using heuristic clustering", exc)
        return _fallback_heuristic_clustering(files, existing_categories)


def _fallback_heuristic_clustering(
    files: list[dict[str, Any]],
    existing_categories: list[str] | None = None,
) -> dict[str, Any]:
    """Group unrecognized files by extension or filename keywords when LLM is unavailable."""
    clusters: dict[str, list[str]] = {}
    overrides: dict[str, str] = {}

    for f in files:
        file_id = f.get("file_id")
        fname = f.get("filename", "").lower()
        ext = f.get("extension", "").lower()

        if not file_id:
            continue

        if any(w in fname for w in ["screenshot", "screen shot", "capture"]):
            cat = "Screenshots"
        elif any(w in fname for w in ["course", "module", "lecture", "assignment"]):
            cat = "Course_Materials"
        elif any(w in fname for w in ["invoice", "receipt", "bill", "payment"]):
            cat = "Financial_Receipts"
        elif ext in [".py", ".js", ".ts", ".html", ".css", ".sql", ".sh"]:
            cat = "Developer_Files"
        elif ext in [".zip", ".tar", ".gz", ".7z", ".dmg", ".pkg"]:
            cat = "Archives_and_Installers"
        elif ext in [".jpg", ".jpeg", ".png", ".webp", ".heic"]:
            cat = "Unsorted_Images"
        elif ext in [".pdf", ".docx", ".doc", ".txt", ".md"]:
            cat = "Unsorted_Documents"
        else:
            cat = "Other_Items"

        clusters.setdefault(cat, []).append(file_id)
        overrides[file_id] = cat

    return {
        "message": f"Organized {len(files)} unclassified files into {len(clusters)} categories.",
        "clusters": clusters,
        "category_overrides": overrides,
    }


# ---------------------------------------------------------------------------
# Smart Heuristic Structure Planner & Fallback
# ---------------------------------------------------------------------------

def _fallback_heuristic_structure(
    message: str,
    current_categories: dict[str, Any] | None = None,
    sample_filenames: list[str] | None = None,
    complexity_level: str = "medium",
    auto_discover: bool = False,
) -> dict[str, Any]:
    """
    Intelligent heuristic structure planner supporting edit commands,
    sample filename clustering, and multi-tier complexity levels.
    """
    msg_lower = message.lower()
    complexity = (complexity_level or "medium").lower()

    # 1. Handle user edit commands on existing categories (remove / delete / rename / add / simplify)
    if current_categories and not auto_discover:
        cats = {k: dict(v) for k, v in current_categories.items()}

        # Check for DELETE / REMOVE commands
        delete_matches = re.findall(
            r"(?:remove|delete|drop|exclude|get rid of|stop using)\s+(?:the\s+)?(?:category\s+)?([a-zA-Z0-9_\-\/ ]+?)(?:\s+category|\s+folder|and|\.|$|,)",
            message,
            re.IGNORECASE,
        )
        for target in delete_matches:
            target_clean = target.strip().lower()
            keys_to_remove = [k for k in list(cats.keys()) if target_clean in k.lower() or k.lower() in target_clean]
            for k in keys_to_remove:
                if k in cats:
                    del cats[k]

        # Check for RENAME commands: "rename X to Y" or "change X to Y"
        rename_matches = re.findall(
            r"(?:rename|change)\s+(?:the\s+)?(?:category\s+)?([a-zA-Z0-9_\-\/ ]+?)\s+to\s+([a-zA-Z0-9_\-\/]+)",
            message,
            re.IGNORECASE,
        )
        for old_name, new_name in rename_matches:
            old_clean = old_name.strip().lower()
            new_clean = new_name.strip()
            for k in list(cats.keys()):
                if old_clean in k.lower() or k.lower() in old_clean:
                    val = cats.pop(k)
                    val["name"] = new_clean
                    cats[new_clean] = val

        # Check for ADD commands: "add a new folder for X" or "create X"
        add_matches = re.findall(
            r"(?:add|create|new folder for|make folder for)\s+(?:a\s+)?(?:new\s+)?(?:folder\s+for\s+|category\s+for\s+)?([a-zA-Z0-9_\-\/ ]+?)(?:\s+category|\s+folder|and|\.|$|,)",
            message,
            re.IGNORECASE,
        )
        for new_item in add_matches:
            new_item_clean = re.sub(r"^(?:a|the|new|folder|category|for)\s+", "", new_item.strip(), flags=re.IGNORECASE).strip().replace(" ", "_")
            if new_item_clean and len(new_item_clean) >= 2 and new_item_clean not in cats:
                cats[new_item_clean] = {
                    "name": new_item_clean,
                    "description": f"Files for {new_item_clean}",
                    "keywords": [new_item_clean.lower()],
                    "extensions": [],
                    "active": True,
                }

        # If user asked for simpler / fewer categories
        if any(w in msg_lower for w in ["simpler", "fewer", "consolidate", "minimal"]):
            if len(cats) > 4:
                # Merge into 3 broad categories
                cats = {
                    "Documents": {
                        "name": "Documents",
                        "description": "General text documents, PDFs, and reports",
                        "keywords": ["document", "pdf", "report", "notes", "file"],
                        "extensions": [".pdf", ".docx", ".txt", ".md"],
                        "active": True,
                    },
                    "Media": {
                        "name": "Media",
                        "description": "Photos, illustrations, and recordings",
                        "keywords": ["image", "photo", "screenshot", "video"],
                        "extensions": [".png", ".jpg", ".jpeg", ".mp4", ".mp3"],
                        "active": True,
                    },
                    "Archives_and_Data": {
                        "name": "Archives_and_Data",
                        "description": "Archives, datasets, and code files",
                        "keywords": ["zip", "data", "backup", "archive"],
                        "extensions": [".zip", ".tar", ".gz", ".json", ".csv"],
                        "active": True,
                    },
                }

        if cats:
            return {
                "message": f"Updated your workspace structure. You now have {len(cats)} active categories.",
                "categories": cats,
                "custom_instructions": message,
                "is_ready": True,
                "complexity_level": complexity,
            }

    # 2. Dynamic clustering from sample_filenames if provided
    if sample_filenames and len(sample_filenames) >= 3:
        proposed = _cluster_sample_filenames_heuristically(sample_filenames, complexity)
        if proposed:
            return {
                "message": f"Analyzed {len(sample_filenames)} files in your directory and synthesized a {complexity.title()} taxonomy with {len(proposed)} folders.",
                "categories": proposed,
                "custom_instructions": "",
                "is_ready": True,
                "complexity_level": complexity,
            }

    # 3. Thematic presets by complexity level
    proposed = _generate_thematic_categories(msg_lower, complexity)

    return {
        "message": f"Formulated a {complexity.title()} organization blueprint with {len(proposed)} folders based on your requirements. Please verify below.",
        "categories": proposed,
        "custom_instructions": message if not auto_discover else "",
        "is_ready": True,
        "complexity_level": complexity,
    }


def _cluster_sample_filenames_heuristically(filenames: list[str], complexity: str) -> dict[str, dict[str, Any]]:
    """Synthesize categories from real filenames matching requested complexity."""
    ext_counts: dict[str, int] = {}
    tokens: list[str] = []

    for item in filenames:
        clean_name = item.split(" (")[0] if " (" in item else item
        ext = Path(clean_name).suffix.lower()
        if ext:
            ext_counts[ext] = ext_counts.get(ext, 0) + 1
        # Extract word tokens from filename & preview content
        words = re.findall(r"[a-zA-Z]{3,}", item.lower())
        tokens.extend(words)

    categories: dict[str, dict[str, Any]] = {}

    has_code = any(e in ext_counts for e in [".py", ".ts", ".js", ".html", ".css", ".go", ".rs", ".cpp", ".sh"])
    has_docs = any(e in ext_counts for e in [".pdf", ".docx", ".doc", ".xlsx", ".pptx", ".txt", ".md"])
    has_images = any(e in ext_counts for e in [".png", ".jpg", ".jpeg", ".webp", ".svg", ".heic"])
    has_media = any(e in ext_counts for e in [".mp4", ".mov", ".mkv", ".mp3", ".wav"])
    has_archives = any(e in ext_counts for e in [".zip", ".tar", ".gz", ".7z", ".dmg", ".pkg"])

    has_invoices = any(w in tokens for w in ["invoice", "receipt", "bill", "payment", "tax"])
    has_academic = any(w in tokens for w in ["lecture", "assignment", "homework", "exam", "syllabus", "paper", "lab"])
    has_screenshots = any(w in tokens for w in ["screenshot", "screen shot", "capture"])

    if complexity == "low":
        # 3-4 Flat broad buckets
        if has_docs or has_invoices or has_academic:
            categories["Documents"] = {
                "name": "Documents",
                "description": "General text files, PDFs, reports, and spreadsheets",
                "keywords": ["document", "pdf", "report", "statement", "notes"],
                "extensions": [".pdf", ".docx", ".xlsx", ".txt", ".md"],
                "active": True,
            }
        if has_images or has_media or has_screenshots:
            categories["Media"] = {
                "name": "Media",
                "description": "Images, screenshots, videos, and audio files",
                "keywords": ["photo", "image", "screenshot", "video", "audio"],
                "extensions": [".png", ".jpg", ".jpeg", ".mp4", ".mp3", ".mov"],
                "active": True,
            }
        if has_code:
            categories["Development"] = {
                "name": "Development",
                "description": "Source code scripts, datasets, and configs",
                "keywords": ["code", "script", "data", "json", "config"],
                "extensions": [".py", ".js", ".ts", ".json", ".sql", ".sh"],
                "active": True,
            }
        if has_archives:
            categories["Archives"] = {
                "name": "Archives",
                "description": "Zip files, installers, and compressed packages",
                "keywords": ["zip", "archive", "installer", "backup"],
                "extensions": [".zip", ".tar", ".gz", ".dmg", ".pkg"],
                "active": True,
            }
        if not categories:
            categories["General_Files"] = {
                "name": "General_Files",
                "description": "Organized general workspace items",
                "keywords": [],
                "extensions": [],
                "active": True,
            }

    elif complexity in ("high", "complex"):
        # Granular & Hierarchical
        if has_invoices:
            categories["Finance/Invoices_and_Bills"] = {
                "name": "Finance/Invoices_and_Bills",
                "description": "Vendor invoices, receipts, and payment confirmations",
                "keywords": ["invoice", "receipt", "bill", "payment", "due", "total"],
                "extensions": [".pdf", ".xlsx", ".csv"],
                "active": True,
            }
        if has_academic:
            categories["Academic/Course_Materials"] = {
                "name": "Academic/Course_Materials",
                "description": "Class lectures, slides, and study notes",
                "keywords": ["lecture", "notes", "slide", "syllabus", "chapter"],
                "extensions": [".pdf", ".pptx", ".docx"],
                "active": True,
            }
            categories["Academic/Assignments_and_Labs"] = {
                "name": "Academic/Assignments_and_Labs",
                "description": "Homework submissions, problem sets, and lab reports",
                "keywords": ["assignment", "homework", "lab", "report", "problem"],
                "extensions": [".pdf", ".docx", ".py", ".zip"],
                "active": True,
            }
        if has_screenshots:
            categories["Media/Screenshots"] = {
                "name": "Media/Screenshots",
                "description": "Screen captures and quick recordings",
                "keywords": ["screenshot", "screen shot", "capture"],
                "extensions": [".png", ".jpg", ".jpeg"],
                "active": True,
            }
        if has_images:
            categories["Media/Photos_and_Assets"] = {
                "name": "Media/Photos_and_Assets",
                "description": "High-res photos, design graphics, and visual assets",
                "keywords": ["photo", "camera", "graphic", "asset", "design"],
                "extensions": [".jpg", ".jpeg", ".png", ".webp", ".svg", ".heic"],
                "active": True,
            }
        if has_code:
            categories["Development/Source_Code"] = {
                "name": "Development/Source_Code",
                "description": "Source code scripts, modules, and repositories",
                "keywords": ["import", "function", "class", "def", "const"],
                "extensions": [".py", ".js", ".ts", ".jsx", ".tsx", ".go", ".rs"],
                "active": True,
            }
            categories["Development/Data_and_Configs"] = {
                "name": "Development/Data_and_Configs",
                "description": "Configuration files, schemas, and dataset exports",
                "keywords": ["json", "yaml", "config", "schema", "database", "sql"],
                "extensions": [".json", ".yaml", ".yml", ".sql", ".csv"],
                "active": True,
            }
        if has_docs and not has_invoices and not has_academic:
            categories["Documents/Reports_and_Notes"] = {
                "name": "Documents/Reports_and_Notes",
                "description": "General text documents, PDFs, and notes",
                "keywords": ["report", "document", "notes", "summary"],
                "extensions": [".pdf", ".docx", ".txt", ".md"],
                "active": True,
            }
        if has_archives:
            categories["Archives_and_Installers"] = {
                "name": "Archives_and_Installers",
                "description": "Compressed archives, packages, and installer images",
                "keywords": ["archive", "backup", "installer", "setup", "zip"],
                "extensions": [".zip", ".tar", ".gz", ".dmg", ".pkg"],
                "active": True,
            }
    else:
        # Medium / Balanced (5-7 categories)
        if has_invoices:
            categories["Finance/Invoices"] = {
                "name": "Finance/Invoices",
                "description": "Invoices, bills, and payment records",
                "keywords": ["invoice", "bill", "receipt", "payment"],
                "extensions": [".pdf", ".xlsx", ".csv"],
                "active": True,
            }
        if has_academic:
            categories["Academic/Study_Files"] = {
                "name": "Academic/Study_Files",
                "description": "Lectures, study notes, and assignments",
                "keywords": ["lecture", "assignment", "homework", "notes"],
                "extensions": [".pdf", ".pptx", ".docx"],
                "active": True,
            }
        if has_code:
            categories["Development/Code"] = {
                "name": "Development/Code",
                "description": "Source code, scripts, and configuration files",
                "keywords": ["code", "script", "config", "json"],
                "extensions": [".py", ".js", ".ts", ".json", ".sql"],
                "active": True,
            }
        if has_images or has_screenshots:
            categories["Media/Images"] = {
                "name": "Media/Images",
                "description": "Photos, screenshots, and graphic assets",
                "keywords": ["photo", "image", "screenshot", "capture"],
                "extensions": [".png", ".jpg", ".jpeg", ".webp"],
                "active": True,
            }
        if has_docs:
            categories["Documents/General"] = {
                "name": "Documents/General",
                "description": "PDF documents, reports, and text files",
                "keywords": ["document", "report", "notes", "manual"],
                "extensions": [".pdf", ".docx", ".txt", ".md"],
                "active": True,
            }
        if has_archives:
            categories["Archives"] = {
                "name": "Archives",
                "description": "Compressed packages and installer archives",
                "keywords": ["zip", "archive", "backup", "dmg"],
                "extensions": [".zip", ".tar", ".gz", ".dmg"],
                "active": True,
            }

    return categories


def _generate_thematic_categories(msg_lower: str, complexity: str) -> dict[str, dict[str, Any]]:
    """Generate default objective categories when no filenames are provided."""
    # Development / Code focused request
    if any(w in msg_lower for w in ["developer", "code", "programming", "script", "software", "source"]):
        if complexity == "low":
            return {
                "Source_Code": {
                    "name": "Source_Code",
                    "description": "Source code files and scripts",
                    "keywords": ["code", "script", "python", "js", "ts", "cpp"],
                    "extensions": [".py", ".js", ".ts", ".jsx", ".tsx", ".html", ".css", ".rs", ".go"],
                    "active": True,
                },
                "Data_and_Configs": {
                    "name": "Data_and_Configs",
                    "description": "Configuration files, databases, and datasets",
                    "keywords": ["data", "json", "yaml", "config", "sql", "database"],
                    "extensions": [".json", ".yaml", ".yml", ".sql", ".db", ".sqlite"],
                    "active": True,
                },
                "Documentation": {
                    "name": "Documentation",
                    "description": "Technical notes, guides, and specifications",
                    "keywords": ["readme", "api", "docs", "guide", "notes"],
                    "extensions": [".md", ".txt", ".pdf"],
                    "active": True,
                },
            }
        else:
            return {
                "Development/Source_Code": {
                    "name": "Development/Source_Code",
                    "description": "Application source code, scripts, and modules",
                    "keywords": ["import", "function", "class", "def", "const", "export"],
                    "extensions": [".py", ".js", ".ts", ".jsx", ".tsx", ".html", ".css", ".rs", ".go", ".cpp", ".c"],
                    "active": True,
                },
                "Development/Data_and_Configs": {
                    "name": "Development/Data_and_Configs",
                    "description": "Database exports, schema files, JSON/YAML datasets",
                    "keywords": ["json", "yaml", "schema", "database", "dump", "export", "config"],
                    "extensions": [".json", ".yaml", ".yml", ".xml", ".sql", ".db", ".sqlite"],
                    "active": True,
                },
                "Development/Documentation": {
                    "name": "Development/Documentation",
                    "description": "API specifications, architecture guides, and Markdown notes",
                    "keywords": ["readme", "api", "architecture", "specification", "guide", "documentation"],
                    "extensions": [".md", ".txt", ".pdf"],
                    "active": True,
                },
                "Cold_Storage/Archives": {
                    "name": "Cold_Storage/Archives",
                    "description": "Compressed source bundles and release packages",
                    "keywords": ["archive", "backup", "tar", "zip", "dist", "release"],
                    "extensions": [".zip", ".tar", ".gz", ".tar.gz", ".7z", ".rar"],
                    "active": True,
                },
            }

    # Media / Photos focused request
    if any(w in msg_lower for w in ["photo", "image", "media", "video", "audio", "recording", "design"]):
        if complexity == "low":
            return {
                "Photos": {
                    "name": "Photos",
                    "description": "Images, photos, and camera shots",
                    "keywords": ["photo", "picture", "camera", "image"],
                    "extensions": [".jpg", ".jpeg", ".png", ".heic", ".raw", ".tiff"],
                    "active": True,
                },
                "Recordings": {
                    "name": "Recordings",
                    "description": "Video clips, screen recordings, and audio tracks",
                    "keywords": ["video", "audio", "recording", "screen recording", "podcast"],
                    "extensions": [".mp4", ".mov", ".mkv", ".mp3", ".wav", ".m4a"],
                    "active": True,
                },
                "Design_Assets": {
                    "name": "Design_Assets",
                    "description": "Vector icons, illustrations, and design files",
                    "keywords": ["icon", "logo", "vector", "asset", "design"],
                    "extensions": [".svg", ".ai", ".psd", ".fig"],
                    "active": True,
                },
            }
        else:
            return {
                "Media/Photos": {
                    "name": "Media/Photos",
                    "description": "Photography, high-resolution camera captures, and image shots",
                    "keywords": ["photo", "picture", "camera", "portrait", "landscape"],
                    "extensions": [".jpg", ".jpeg", ".png", ".heic", ".raw", ".tiff"],
                    "active": True,
                },
                "Media/Design_Assets": {
                    "name": "Media/Design_Assets",
                    "description": "Vector graphics, SVG icons, Figma/PSD files, and illustrations",
                    "keywords": ["icon", "logo", "vector", "illustration", "asset", "design"],
                    "extensions": [".svg", ".ai", ".psd", ".eps", ".fig"],
                    "active": True,
                },
                "Media/Recordings": {
                    "name": "Media/Recordings",
                    "description": "Screen recordings, video captures, demos, and clips",
                    "keywords": ["screen recording", "screencast", "recording", "video", "capture"],
                    "extensions": [".mp4", ".mov", ".mkv", ".webm", ".avi"],
                    "active": True,
                },
                "Media/Audio": {
                    "name": "Media/Audio",
                    "description": "Voice memos, podcasts, audio tracks, and sound effects",
                    "keywords": ["audio", "recording", "podcast", "soundtrack", "music"],
                    "extensions": [".mp3", ".wav", ".flac", ".m4a", ".aac"],
                    "active": True,
                },
            }

    # Standard general taxonomy by complexity
    if complexity == "low":
        return {
            "Documents": {
                "name": "Documents",
                "description": "General text files, PDFs, reports, and spreadsheets",
                "keywords": ["document", "pdf", "report", "notes", "file"],
                "extensions": [".pdf", ".docx", ".xlsx", ".txt", ".md"],
                "active": True,
            },
            "Media": {
                "name": "Media",
                "description": "Photos, illustrations, videos, and audio recordings",
                "keywords": ["photo", "image", "screenshot", "video", "audio"],
                "extensions": [".png", ".jpg", ".jpeg", ".mp4", ".mp3", ".heic"],
                "active": True,
            },
            "Development": {
                "name": "Development",
                "description": "Source code scripts, datasets, and configs",
                "keywords": ["code", "script", "data", "json", "config"],
                "extensions": [".py", ".js", ".ts", ".json", ".sql", ".sh"],
                "active": True,
            },
            "Archives": {
                "name": "Archives",
                "description": "Zip files, installers, and compressed packages",
                "keywords": ["zip", "archive", "installer", "backup"],
                "extensions": [".zip", ".tar", ".gz", ".dmg", ".pkg"],
                "active": True,
            },
        }
    elif complexity in ("high", "complex"):
        return {
            "Documents/Reports_and_Notes": {
                "name": "Documents/Reports_and_Notes",
                "description": "Text documents, research reports, and notes",
                "keywords": ["report", "document", "notes", "summary", "memo"],
                "extensions": [".pdf", ".docx", ".txt", ".md"],
                "active": True,
            },
            "Documents/Spreadsheets": {
                "name": "Documents/Spreadsheets",
                "description": "Data tables, financial models, and tracking sheets",
                "keywords": ["spreadsheet", "budget", "forecast", "tracking", "data"],
                "extensions": [".xlsx", ".xls", ".csv", ".tsv"],
                "active": True,
            },
            "Media/Photos": {
                "name": "Media/Photos",
                "description": "Photography, camera captures, and image shots",
                "keywords": ["photo", "picture", "camera", "portrait", "landscape"],
                "extensions": [".jpg", ".jpeg", ".png", ".heic", ".raw"],
                "active": True,
            },
            "Media/Screenshots": {
                "name": "Media/Screenshots",
                "description": "Screen captures and quick recordings",
                "keywords": ["screenshot", "screen shot", "capture", "snip"],
                "extensions": [".png", ".jpg", ".webp"],
                "active": True,
            },
            "Development/Source_Code": {
                "name": "Development/Source_Code",
                "description": "Source code files, scripts, and modules",
                "keywords": ["import", "function", "class", "def", "const"],
                "extensions": [".py", ".js", ".ts", ".jsx", ".tsx", ".go", ".rs"],
                "active": True,
            },
            "Development/Data_and_Configs": {
                "name": "Development/Data_and_Configs",
                "description": "Configuration files, schemas, and dataset exports",
                "keywords": ["json", "yaml", "config", "schema", "database", "sql"],
                "extensions": [".json", ".yaml", ".yml", ".sql", ".csv"],
                "active": True,
            },
            "Archives_and_Installers": {
                "name": "Archives_and_Installers",
                "description": "Compressed archives, packages, and installer images",
                "keywords": ["archive", "backup", "installer", "setup", "zip"],
                "extensions": [".zip", ".tar", ".gz", ".dmg", ".pkg"],
                "active": True,
            },
        }
    else:
        # Medium / Balanced (default)
        return {
            "Documents/General": {
                "name": "Documents/General",
                "description": "General text, PDFs, and Office documents",
                "keywords": ["document", "report", "notes"],
                "extensions": [".pdf", ".docx", ".txt"],
                "active": True,
            },
            "Media/Images": {
                "name": "Media/Images",
                "description": "Photos, illustrations, and graphic assets",
                "keywords": ["photo", "image", "screenshot"],
                "extensions": [".png", ".jpg", ".jpeg", ".heic"],
                "active": True,
            },
            "Development/Code": {
                "name": "Development/Code",
                "description": "Scripts, datasets, and programming files",
                "keywords": ["code", "script", "json", "python"],
                "extensions": [".py", ".js", ".ts", ".json"],
                "active": True,
            },
            "Archives": {
                "name": "Archives",
                "description": "Zip files, installers, and compressed packages",
                "keywords": ["zip", "tar", "archive", "installer"],
                "extensions": [".zip", ".tar", ".gz", ".dmg"],
                "active": True,
            },
        }


def _fallback_heuristic_review_command(
    command: str,
    files: list[dict[str, Any]],
    categories: list[str],
) -> dict[str, Any]:
    """Execute keyword-based search & replace on review table."""
    cmd_lower = command.lower()
    cat_overrides: dict[str, str] = {}

    # Look for matching target category in command
    target_cat = None
    for cat in categories:
        if cat.lower() in cmd_lower or cat.split("/")[-1].lower() in cmd_lower:
            target_cat = cat
            break

    if not target_cat:
        # Fallback to creating a new category name from command
        if "to " in cmd_lower:
            target_cat = command.split("to ")[-1].strip().title().replace(" ", "_")
        else:
            target_cat = "Custom_Group"

    # Match files by keyword or extension mentioned in command
    keywords = [w for w in re.findall(r"[a-zA-Z0-9_\.]+", cmd_lower) if len(w) > 2 and w not in ["move", "change", "set", "all", "files", "to", "category", "and", "the", "with"]]

    for f in files:
        file_id = f.get("file_id")
        fname = f.get("filename", "").lower()
        fext = f.get("extension", "").lower()
        fcat = f.get("category", "").lower()

        matched = False
        for kw in keywords:
            if kw.startswith(".") and fext == kw:
                matched = True
                break
            elif kw in fname or kw in fcat:
                matched = True
                break

        if matched and file_id:
            cat_overrides[file_id] = target_cat

    return {
        "message": f"Matched and updated {len(cat_overrides)} files to '{target_cat}'.",
        "category_overrides": cat_overrides,
        "filename_overrides": {},
    }
