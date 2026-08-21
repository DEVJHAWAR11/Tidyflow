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
    _resolve_provider_url,
    _strip_markdown_fences,
    load_settings,
)

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Prompt Templates
# ---------------------------------------------------------------------------

_STRUCTURE_CHAT_SYSTEM_PROMPT = """\
You are TidyFlow AI, an expert workspace organizer and taxonomy architect.
Your goal is to help users organize their disorganized directories into clean, intuitive, and tailored category folders.

TASK:
1. Analyze the user's instructions, conversation history, existing category setup, and any sample filenames from their directory.
2. Formulate a structured set of category folders (usually 3 to 7 categories) perfectly suited to their needs.
3. For each category provide:
   - "name": Clean path/folder name (e.g. "Work/Client_Alpha", "Finance/Invoices", "College/Assignments", "Photos/2026"). Use "/" for subfolders if hierarchy is appropriate.
   - "description": 1-2 sentence description of what belongs in this folder.
   - "keywords": 4 to 8 distinct matching keywords (lowercase).
   - "extensions": Target file extensions (e.g. [".pdf", ".docx", ".xlsx", ".png"]) or [] if all extensions are allowed.
   - "active": true
4. Extract any specific behavioral rules into "custom_instructions" (e.g., "Put all screenshots in Temp_Screenshots; route invoices to Taxes/2026").
5. Return a friendly, conversational message summarizing the structure and asking the user to verify or request any tweaks before organizing.
6. Set "is_ready" to true if a concrete category structure is proposed.

OUTPUT FORMAT — Return ONLY strict JSON:
{
  "message": "Friendly response explaining the proposed organization structure, highlighting key folders, and asking the user to verify.",
  "categories": {
    "Category_Name": {
      "name": "Category_Name",
      "description": "Short description",
      "keywords": ["kw1", "kw2"],
      "extensions": [".pdf", ".docx"],
      "active": true
    }
  },
  "custom_instructions": "Specific rules for file classification",
  "is_ready": true
}
"""

_REVIEW_COMMAND_SYSTEM_PROMPT = """\
You are TidyFlow AI assisting the user with bulk editing classified files.
The user will provide a command in natural language (e.g., "Move all invoices to Finance/Invoices", "Set files containing 'tax' to Taxes/2026", "Change all .png files to Screenshots").

TASK:
1. Examine the list of files provided (file_id, filename, current_category, extension).
2. Determine which files match the user's intent.
3. Output category overrides mapping file_id to the target category.
4. Output optional suggested filename changes if requested.

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
# Conversational Category Structure Planner
# ---------------------------------------------------------------------------

def chat_generate_structure(
    message: str,
    history: list[dict[str, str]] | None = None,
    current_categories: dict[str, Any] | None = None,
    sample_filenames: list[str] | None = None,
) -> dict[str, Any]:
    """
    Process natural language instruction to generate or update categories.
    Returns:
        {
            "message": str,
            "categories": dict[str, dict],
            "custom_instructions": str,
            "is_ready": bool
        }
    """
    provider, api_key, custom_url = load_settings()

    # If no LLM key, use smart heuristic fallback
    if not api_key:
        return _fallback_heuristic_structure(message, current_categories, sample_filenames)

    base_url = custom_url or _resolve_provider_url(provider, "https://api.deepseek.com/v1")
    url = f"{base_url.rstrip('/')}/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    # Format context for prompt
    context_parts = []
    if current_categories:
        context_parts.append(f"CURRENT CONFIGURED CATEGORIES:\n{json.dumps(current_categories, indent=2)}")
    if sample_filenames:
        context_parts.append(f"SAMPLE FILENAMES IN DIRECTORY (first {len(sample_filenames)} files):\n" + "\n".join(sample_filenames[:40]))

    context_str = "\n\n".join(context_parts) if context_parts else "No existing files/categories provided."

    messages = [{"role": "system", "content": _STRUCTURE_CHAT_SYSTEM_PROMPT}]

    # Append history
    if history:
        for h in history[-8:]:  # keep last 8 turns for context
            role = "assistant" if h.get("role") in ("assistant", "ai") else "user"
            content = h.get("content") or h.get("message") or ""
            if content:
                messages.append({"role": role, "content": content})

    # Current user turn with context
    user_payload = f"USER REQUEST:\n{message}\n\nCONTEXT:\n{context_str}"
    messages.append({"role": "user", "content": user_payload})

    try:
        with httpx.Client(timeout=45.0) as client:
            resp = client.post(
                url,
                headers=headers,
                json={
                    "model": "deepseek-chat" if provider == "deepseek" else "gpt-4o-mini",
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

            return {
                "message": parsed.get("message", "Here is your custom organization structure. Please review before proceeding."),
                "categories": normalized_cats if normalized_cats else (current_categories or {}),
                "custom_instructions": parsed.get("custom_instructions", message),
                "is_ready": parsed.get("is_ready", True),
            }

    except Exception as exc:
        logger.warning("LLM category generation failed (%s), falling back to heuristic planner", exc)
        return _fallback_heuristic_structure(message, current_categories, sample_filenames)


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

    # Compact files list for prompt
    files_payload = [
        {
            "file_id": f.get("file_id"),
            "filename": f.get("filename"),
            "extension": f.get("extension"),
            "current_category": f.get("category"),
            "reason": f.get("reason", "")[:60],
        }
        for f in files[:80]  # cap at 80 files for prompt efficiency
    ]

    user_payload = (
        f"USER COMMAND: {command}\n\n"
        f"AVAILABLE CATEGORIES: {json.dumps(cat_list)}\n\n"
        f"FILES TO REVIEW ({len(files_payload)} items):\n{json.dumps(files_payload, indent=2)}"
    )

    try:
        with httpx.Client(timeout=35.0) as client:
            resp = client.post(
                url,
                headers=headers,
                json={
                    "model": "deepseek-chat" if provider == "deepseek" else "gpt-4o-mini",
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
                    "model": "deepseek-chat" if provider == "deepseek" else "gpt-4o-mini",
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
# Fallback Heuristic Generators (Offline / API Key Missing)
# ---------------------------------------------------------------------------

def _fallback_heuristic_structure(
    message: str,
    current_categories: dict[str, Any] | None = None,
    sample_filenames: list[str] | None = None,
) -> dict[str, Any]:
    """Generate smart categories using keyword rules when LLM is unavailable."""
    msg_lower = message.lower()
    proposed: dict[str, dict[str, Any]] = {}

    # Detect preset themes
    if any(w in msg_lower for w in ["student", "academic", "university", "college", "lecture", "homework", "study"]):
        proposed = {
            "Academic/Lecture_Notes": {
                "name": "Academic/Lecture_Notes",
                "description": "Lecture slides, class notes, and summaries",
                "keywords": ["lecture", "notes", "chapter", "slide", "class", "syllabus"],
                "extensions": [".pdf", ".pptx", ".docx", ".md", ".txt"],
                "active": True,
            },
            "Academic/Assignments": {
                "name": "Academic/Assignments",
                "description": "Homework, problem sets, and essays",
                "keywords": ["assignment", "homework", "lab", "essay", "report", "submission"],
                "extensions": [".pdf", ".docx", ".py", ".zip"],
                "active": True,
            },
            "Academic/Research_Papers": {
                "name": "Academic/Research_Papers",
                "description": "Academic papers, journal articles, and reading material",
                "keywords": ["paper", "journal", "doi", "abstract", "ieee", "arxiv"],
                "extensions": [".pdf"],
                "active": True,
            },
        }
    elif any(w in msg_lower for w in ["freelance", "client", "contract", "agency", "consulting"]):
        proposed = {
            "Client_Work/Contracts_and_NDAs": {
                "name": "Client_Work/Contracts_and_NDAs",
                "description": "Client agreements, NDAs, statements of work",
                "keywords": ["contract", "agreement", "nda", "sow", "proposal", "terms"],
                "extensions": [".pdf", ".docx"],
                "active": True,
            },
            "Client_Work/Invoices_and_Billing": {
                "name": "Client_Work/Invoices_and_Billing",
                "description": "Invoices, payment receipts, and estimates",
                "keywords": ["invoice", "bill", "payment", "estimate", "due", "receipt"],
                "extensions": [".pdf", ".xlsx", ".csv"],
                "active": True,
            },
            "Client_Work/Deliverables": {
                "name": "Client_Work/Deliverables",
                "description": "Client project files, assets, and reports",
                "keywords": ["deliverable", "final", "draft", "asset", "design", "presentation"],
                "extensions": [".pdf", ".png", ".jpg", ".zip", ".pptx"],
                "active": True,
            },
        }
    elif any(w in msg_lower for w in ["code", "developer", "software", "programming", "scripts", "repo"]):
        proposed = {
            "Development/Source_Code": {
                "name": "Development/Source_Code",
                "description": "Source code files and scripts",
                "keywords": ["import", "def", "class", "function", "const", "return"],
                "extensions": [".py", ".ts", ".js", ".tsx", ".jsx", ".go", ".rs", ".cpp", ".sh"],
                "active": True,
            },
            "Development/Data_and_Configs": {
                "name": "Development/Data_and_Configs",
                "description": "Datasets, databases, and configuration files",
                "keywords": ["config", "data", "json", "yaml", "database", "schema"],
                "extensions": [".json", ".yaml", ".yml", ".sql", ".csv", ".db", ".sqlite"],
                "active": True,
            },
            "Development/Documentation": {
                "name": "Development/Documentation",
                "description": "Technical specs, READMEs, and API docs",
                "keywords": ["readme", "doc", "specification", "api", "architecture"],
                "extensions": [".md", ".txt", ".pdf"],
                "active": True,
            },
        }
    elif any(w in msg_lower for w in ["screenshot", "downloads", "cleanup", "declutter"]):
        proposed = {
            "Screenshots": {
                "name": "Screenshots",
                "description": "Screen captures and visual recordings",
                "keywords": ["screen shot", "screenshot", "capture", "cleanshot"],
                "extensions": [".png", ".jpg", ".jpeg", ".webp"],
                "active": True,
            },
            "Documents/PDFs": {
                "name": "Documents/PDFs",
                "description": "Downloaded PDF documents",
                "keywords": ["manual", "guide", "statement", "form"],
                "extensions": [".pdf"],
                "active": True,
            },
            "Installers_and_Archives": {
                "name": "Installers_and_Archives",
                "description": "Zip archives, disk images, installer packages",
                "keywords": ["installer", "setup", "archive", "zip", "dmg"],
                "extensions": [".zip", ".dmg", ".tar", ".gz", ".pkg"],
                "active": True,
            },
        }
    else:
        # Extract custom terms from user prompt
        words = re.findall(r"[a-zA-Z0-9_\-]+", message)
        custom_cats = [w.capitalize() for w in words if len(w) > 4 and w.lower() not in ["organize", "files", "folder", "folders", "create", "category", "categories", "please", "system", "want"]]

        if custom_cats:
            for cat in custom_cats[:4]:
                cat_name = f"Custom/{cat}"
                proposed[cat_name] = {
                    "name": cat_name,
                    "description": f"Files matching '{cat}' topic and related documents",
                    "keywords": [cat.lower(), f"{cat.lower()}s"],
                    "extensions": [],
                    "active": True,
                }
            proposed["Other/Unclassified"] = {
                "name": "Other/Unclassified",
                "description": "General files and miscellaneous items",
                "keywords": [],
                "extensions": [],
                "active": True,
            }
        else:
            proposed = current_categories or {
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
                "Finance/Receipts_and_Bills": {
                    "name": "Finance/Receipts_and_Bills",
                    "description": "Invoices, payment receipts, and financial statements",
                    "keywords": ["receipt", "invoice", "statement", "total"],
                    "extensions": [".pdf", ".csv", ".xlsx"],
                    "active": True,
                },
            }

    return {
        "message": f"I've tailored a custom organization plan with {len(proposed)} folders based on your requirements. Please verify the categories below before we organize.",
        "categories": proposed,
        "custom_instructions": message,
        "is_ready": True,
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
            target_cat = command.split("to ")[-1].strip().title()
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
