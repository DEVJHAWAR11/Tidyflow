"""FastAPI Backend Server for TidyFlow Universal File Organizer."""

import asyncio
import hashlib
import json
import logging
import os
import re
import shutil
import threading
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Optional

import yaml
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sse_starlette.sse import EventSourceResponse

from .ai_assistant import (
    apply_review_command,
    chat_generate_structure,
    cluster_unrecognized_files,
    inspect_directory,
)
from .applier import apply_decisions, build_auto_approval_decisions, load_decisions, write_copy_manifest
from . import folder_style
from .config import CategoryConfig, TidyConfig, load_config
from .database import DatabaseManager
from .llm_provider import (
    _resolve_provider_model,
    get_llm_error,
    verify_llm_key,
    DEFAULT_MODELS,
    KEY_PAGES,
    KNOWN_PROVIDERS,
    _read_settings,
    ai_enabled,
    check_api_key,
    get_stored_api_key,
    list_provider_models,
    load_settings,
    mask_key,
    remove_api_key,
    save_settings,
    set_ai_enabled,
    set_llm_error,
    set_provider_model,
)
from .main_loop import PipelineCancelledException, Processor, load_records_jsonl, run_pipeline
from .mcp_server import set_allowed_directories
from .models import FileRecord, ReviewDecision
from .scanner import scan_files
from .utils import get_app_data_dir, get_resource_path, work_data_dir

logger = logging.getLogger(__name__)

db = DatabaseManager()
processor = Processor(max_concurrent=5, db=db)
clients: set[asyncio.Queue] = set()
active_cancel_event: Optional[threading.Event] = None

# In-memory latest pipeline results cache
latest_pipeline_data: dict[str, Any] = {
    "records": [],
    "summary": None,
    "input_dir": "",
    "output_dir": "",
    "categories": [],
}


def _latest_run_dir() -> Path:
    return get_app_data_dir() / "latest_run"


def _save_latest_run() -> None:
    """Persist the most recent run so a restart shows the same results, not stale ones."""
    from .main_loop import _save_records_jsonl

    run_dir = _latest_run_dir()
    try:
        run_dir.mkdir(parents=True, exist_ok=True)
        _save_records_jsonl(latest_pipeline_data["records"], run_dir / "records.jsonl")
        summary = latest_pipeline_data.get("summary")
        meta = {
            "input_dir": latest_pipeline_data.get("input_dir", ""),
            "output_dir": latest_pipeline_data.get("output_dir", ""),
            "categories": latest_pipeline_data.get("categories", []),
            "summary": summary.model_dump(mode="json") if summary else None,
        }
        (run_dir / "meta.json").write_text(json.dumps(meta), encoding="utf-8")
    except Exception as e:
        logger.warning("Failed to persist latest run: %s", e)


def _load_latest_run() -> None:
    """Restore the most recent run saved by _save_latest_run, if any."""
    from .models import RunSummary

    run_dir = _latest_run_dir()
    meta_file = run_dir / "meta.json"
    if not meta_file.exists():
        return
    try:
        meta = json.loads(meta_file.read_text(encoding="utf-8"))
        latest_pipeline_data["records"] = load_records_jsonl(run_dir / "records.jsonl")
        latest_pipeline_data["summary"] = RunSummary.model_validate(meta["summary"]) if meta.get("summary") else None
        latest_pipeline_data["input_dir"] = meta.get("input_dir", "")
        latest_pipeline_data["output_dir"] = meta.get("output_dir", "")
        latest_pipeline_data["categories"] = meta.get("categories", [])
    except Exception as e:
        logger.warning("Failed to restore latest run: %s", e)


def _serialize_record(r: FileRecord) -> dict[str, Any]:
    text_snip = r.extracted_text_normalized or r.extracted_text_raw or ""
    return {
        "file_id": r.file_id,
        "filename": r.filename,
        "abs_path": str(r.abs_path),
        "rel_path": str(r.rel_path),
        "extension": r.extension,
        "file_size_bytes": r.file_size_bytes,
        "file_category": r.file_category,
        "category": r.classification.category if r.classification else "Unknown",
        "confidence": r.classification.confidence if r.classification else 0.0,
        "suggested_filename": r.classification.suggested_filename if r.classification else "",
        "reason": r.classification.reason if r.classification else "",
        "action": r.classification.action if r.classification else "manual_review",
        "source": r.classification.source if r.classification else "unknown",
        "thumbnail_b64": r.thumbnail_b64,
        "extracted_text": text_snip[:400] if text_snip else "",
        "duplicate_group_id": r.duplicate_group_id,
        "near_duplicate_group_id": r.near_duplicate_group_id,
        "keyword_scores": r.keyword_scores,
    }


async def broadcast_event(event_type: str, data: Any):
    """Broadcast an SSE event to all connected UI clients."""
    msg = {"type": event_type, "data": data}
    for q in list(clients):
        try:
            await q.put(msg)
        except Exception:
            clients.discard(q)




@asynccontextmanager
async def lifespan(app: FastAPI):
    await db.start()
    await processor.start()

    _load_latest_run()
    asyncio.get_running_loop().run_in_executor(None, verify_llm_key)

    yield
    await processor.stop()
    await db.stop()


app = FastAPI(
    title="TidyFlow Universal File Organizer API",
    version="2.5.0",
    lifespan=lifespan,
)

# Only the app's own window may call this API. Without this, any web page open in a browser on
# this computer could read the file index or change the AI settings.
_APP_ORIGIN = re.compile(r"^(https?://(localhost|127\.0\.0\.1|\[::1\]|tauri\.localhost)(:\d+)?|tauri://localhost)$")


@app.middleware("http")
async def only_the_app_may_call(request, call_next):
    origin = request.headers.get("origin")
    if origin and not _APP_ORIGIN.match(origin):
        return JSONResponse(status_code=403, content={"detail": "This API only answers the TidyFlow app."})
    return await call_next(request)


app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=_APP_ORIGIN.pattern,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# The page must be re-read after an update; its scripts have hashed names and can be cached.
_NO_CACHE = {"Cache-Control": "no-cache"}

# Mount frontend build if available
frontend_dist = get_resource_path("frontend/dist")
if frontend_dist.exists():
    from fastapi.staticfiles import StaticFiles
    from fastapi.responses import FileResponse

    if (frontend_dist / "assets").exists():
        app.mount("/assets", StaticFiles(directory=str(frontend_dist / "assets")), name="assets")

    @app.get("/")
    async def serve_frontend():
        return FileResponse(frontend_dist / "index.html", headers=_NO_CACHE)


@app.get("/events")
async def events_endpoint(request: Request):
    """Server-Sent Events (SSE) stream for real-time progress updates."""
    queue: asyncio.Queue = asyncio.Queue()
    clients.add(queue)

    async def event_generator():
        try:
            while True:
                if await request.is_disconnected():
                    break
                try:
                    msg = await asyncio.wait_for(queue.get(), timeout=15.0)
                    yield {"event": msg.get("type", "message"), "data": json.dumps(msg.get("data", {}))}
                except asyncio.TimeoutError:
                    yield {"event": "ping", "data": ""}
        except asyncio.CancelledError:
            pass
        finally:
            clients.discard(queue)

    return EventSourceResponse(event_generator())


# ---------------------------------------------------------------------------
# Request / Response Models
# ---------------------------------------------------------------------------


class ScanRequest(BaseModel):
    path: str
    output_dir: Optional[str] = None
    use_llm: bool = True
    auto_apply: bool = False
    dry_run: bool = True


class PipelineRunRequest(BaseModel):
    input_dir: str
    output_dir: Optional[str] = None
    use_llm: bool = True
    custom_categories: Optional[dict[str, Any]] = None
    custom_instructions: Optional[str] = None
    complexity_level: Optional[str] = "medium"
    auto_apply: bool = False
    dry_run: bool = True
    # Strict = only file things that clearly match (for narrow, hand-picked folder sets).
    # The guided flow sends a plan meant to cover the whole folder, so it wants best-fit instead.
    strict: bool = False


class AiStructureChatRequest(BaseModel):
    message: str
    history: Optional[list[dict[str, Any]]] = None
    input_dir: Optional[str] = None
    current_categories: Optional[dict[str, Any]] = None
    complexity_level: Optional[str] = "medium"
    auto_discover: Optional[bool] = False


class AiReviewChatRequest(BaseModel):
    command: str
    files: list[dict[str, Any]]
    categories: Optional[list[str]] = None


class AiClusterRequest(BaseModel):
    files: list[dict[str, Any]]
    existing_categories: Optional[list[str]] = None


class CategoryPayload(BaseModel):
    name: str
    description: str = ""
    keywords: list[str] = Field(default_factory=list)
    extensions: list[str] = Field(default_factory=list)
    active: bool = True


class CategoriesUpdateRequest(BaseModel):
    categories: dict[str, Any]
    # The folder this plan is for. Plans are kept per folder so sorting one folder never
    # overwrites another folder's plan or the default categories in config.yaml.
    folder: Optional[str] = None


class ApplyDecisionItem(BaseModel):
    file_id: str
    approved: bool = True
    override_category: Optional[str] = None
    target_filename: Optional[str] = None


class ApplyDirectRequest(BaseModel):
    output_dir: str
    decisions: list[ApplyDecisionItem]
    dry_run: bool = False
    move_mode: bool = False
    # Finder look per category ({"symbol" | "emoji", "color"}), applied on macOS 26+ to folders this creates.
    folder_looks: dict[str, Any] = Field(default_factory=dict)


class SettingsPayload(BaseModel):
    """A change to the settings. Every field is optional; only the ones sent are changed."""
    provider: Optional[str] = None
    api_key: Optional[str] = Field(default=None, max_length=400)
    model: Optional[str] = Field(default=None, max_length=120)
    ai_enabled: Optional[bool] = None
    auto_copy_threshold: Optional[float] = Field(default=None, ge=0.5, le=1.0)
    max_file_size_mb: Optional[float] = Field(default=None, gt=0, le=100_000)


class KeyTestPayload(BaseModel):
    provider: str
    # Leave out to test the key already saved for this provider.
    api_key: Optional[str] = Field(default=None, max_length=400)


# ---------------------------------------------------------------------------
# API Endpoints
# ---------------------------------------------------------------------------


@app.get("/status")
async def get_status():
    provider, api_key, _ = load_settings()
    has_key = bool(api_key.strip())
    return {
        "ai_enabled": ai_enabled(),
        "status": "running",
        "version": "2.5.0",
        "has_llm_key": has_key,
        "llm_error": get_llm_error() if has_key else None,
        "provider": provider,
        "folder_looks_supported": folder_style.is_supported(),
        "active_clients": len(clients),
    }


def _plan_file(folder: str) -> Path:
    key = hashlib.sha1(str(Path(folder).expanduser().resolve()).encode("utf-8")).hexdigest()[:16]
    return get_app_data_dir() / "plans" / f"{key}.json"


@app.get("/categories")
async def get_categories(folder: Optional[str] = None):
    """Return the saved folder plan for `folder`, or the default categories when no folder is given."""
    if folder:
        plan = _plan_file(folder)
        try:
            return {"categories": json.loads(plan.read_text(encoding="utf-8")).get("categories", {})}
        except (OSError, ValueError):
            return {"categories": {}}
    cfg = load_config()
    res = {}
    for cat_name, cat_obj in cfg.categories.items():
        res[cat_name] = {
            "name": cat_name,
            "description": cat_obj.description,
            "keywords": cat_obj.keywords,
            "extensions": cat_obj.extensions,
            "active": True,
        }
    return {"categories": res}


@app.post("/categories")
async def save_categories(req: CategoriesUpdateRequest):
    """Save a folder's plan, or (without a folder) the default categories in config.yaml."""
    if req.folder:
        plan = _plan_file(req.folder)
        try:
            plan.parent.mkdir(parents=True, exist_ok=True)
            plan.write_text(json.dumps({"folder": req.folder, "categories": req.categories}), encoding="utf-8")
        except OSError as e:
            logger.warning("Could not save the folder plan: %s", e)
        return {"status": "success", "categories": req.categories}

    cfg_file = get_app_data_dir() / "config.yaml"
    raw: dict[str, Any] = {}
    if cfg_file.exists():
        try:
            with open(cfg_file, "r", encoding="utf-8") as f:
                raw = yaml.safe_load(f) or {}
        except Exception:
            raw = {}
    elif Path("config.yaml").exists():
        try:
            with open("config.yaml", "r", encoding="utf-8") as f:
                raw = yaml.safe_load(f) or {}
        except Exception:
            raw = {}

    raw["categories"] = req.categories
    try:
        with open(cfg_file, "w", encoding="utf-8") as f:
            yaml.safe_dump(raw, f, sort_keys=False)
    except Exception as e:
        logger.warning("Could not write categories to config.yaml: %s", e)

    return {"status": "success", "categories": req.categories}


def _known_provider(provider: Optional[str]) -> str:
    prov = (provider or "").strip().lower()
    if prov not in KNOWN_PROVIDERS:
        raise HTTPException(status_code=422, detail=f"Unknown AI provider: {provider}")
    return prov


def _settings_snapshot() -> dict:
    """What the Settings page shows. Keys are only ever returned masked."""
    cfg = load_config()
    saved = _read_settings()
    provider, key, _ = load_settings()
    return {
        "provider": provider,
        "model": _resolve_provider_model(provider, cfg.llm.model),
        "ai_enabled": saved["ai_enabled"],
        "has_key": bool(key),
        "masked_key": mask_key(key),
        "providers": [
            {
                "id": p,
                "has_key": bool(get_stored_api_key(p)),
                "masked_key": mask_key(get_stored_api_key(p)),
                # A key from an environment variable can't be removed in the app.
                "from_env": p not in saved["keys"] and bool(get_stored_api_key(p)),
                "model": saved["models"].get(p) or DEFAULT_MODELS[p],
                "key_url": KEY_PAGES[p],
            }
            for p in KNOWN_PROVIDERS
        ],
        "auto_copy_threshold": cfg.classification.auto_copy_threshold,
        "max_file_size_mb": cfg.max_file_size_mb,
    }


def _update_config_yaml(changes: dict[str, Any]) -> None:
    """Merge ``changes`` (nested like config.yaml) into the user's config file."""
    try:
        cfg_file = get_app_data_dir() / "config.yaml"
        data: dict[str, Any] = {}
        source = cfg_file if cfg_file.exists() else Path("config.yaml")
        if source.exists():
            try:
                with open(source, "r", encoding="utf-8") as f:
                    data = yaml.safe_load(f) or {}
            except Exception:
                data = {}
        for section, value in changes.items():
            if isinstance(value, dict):
                data.setdefault(section, {}).update(value)
            else:
                data[section] = value
        with open(cfg_file, "w", encoding="utf-8") as f:
            yaml.safe_dump(data, f, sort_keys=False)
    except Exception as e:
        logger.warning("Could not persist config.yaml: %s", e)


@app.get("/settings")
@app.get("/api/settings")
async def get_settings():
    """Current settings, with every API key masked."""
    return _settings_snapshot()


@app.post("/settings")
@app.post("/api/settings")
async def update_settings(payload: SettingsPayload):
    """Change settings. A new key is tried first and is not saved if the provider refuses it."""
    current, _, _ = load_settings()
    provider = _known_provider(payload.provider) if payload.provider else current
    new_key = (payload.api_key or "").strip()
    checked: Optional[tuple[str, Optional[str]]] = None

    if new_key:
        _known_provider(provider)
        checked = await asyncio.to_thread(check_api_key, provider, new_key)
        if checked[0] == "rejected":
            raise HTTPException(status_code=400, detail=checked[1])
        save_settings(provider, new_key)
    elif payload.provider and provider != current:
        # Each provider has its own key; one provider's key is never sent to another.
        if not get_stored_api_key(provider):
            raise HTTPException(status_code=400, detail="Add a key for this provider first.")
        save_settings(provider, "")

    if payload.model and payload.model.strip():
        set_provider_model(provider, payload.model)
    if payload.ai_enabled is not None:
        set_ai_enabled(payload.ai_enabled)

    changes: dict[str, Any] = {"llm": {"provider": provider, "model": _resolve_provider_model(provider)}}
    if payload.auto_copy_threshold is not None:
        changes["classification"] = {"auto_copy_threshold": payload.auto_copy_threshold}
    if payload.max_file_size_mb is not None:
        changes["max_file_size_mb"] = payload.max_file_size_mb
    _update_config_yaml(changes)

    if checked is not None and ai_enabled():
        ai_error = checked[1]  # the key was tried a moment ago; no need to ask again
        set_llm_error(ai_error)
    else:
        ai_error = await asyncio.to_thread(verify_llm_key)
    return {"status": "success", "message": "Settings updated", "ai_error": ai_error, **_settings_snapshot()}


@app.post("/settings/test")
async def test_api_key(payload: KeyTestPayload):
    """Try a key against its provider without saving anything."""
    provider = _known_provider(payload.provider)
    key = (payload.api_key or "").strip() or get_stored_api_key(provider)
    if not key:
        return {"ok": False, "kind": "missing", "error": "There is no key for this provider yet."}
    kind, message = await asyncio.to_thread(check_api_key, provider, key)
    active, _, _ = load_settings()
    if provider == active and not (payload.api_key or "").strip() and ai_enabled():
        await asyncio.to_thread(verify_llm_key)  # keep the status pill in step with what was just seen
    return {"ok": kind == "ok", "kind": kind, "error": message}


@app.delete("/settings/key")
async def delete_api_key(provider: str):
    """Forget the key saved for one provider."""
    remove_api_key(_known_provider(provider))
    ai_error = await asyncio.to_thread(verify_llm_key)
    return {"status": "success", "ai_error": ai_error, **_settings_snapshot()}


@app.post("/settings/key-page")
async def open_key_page(provider: str):
    """Open the provider's "create an API key" page in the user's web browser."""
    import webbrowser

    url = KEY_PAGES[_known_provider(provider)]
    opened = await asyncio.to_thread(webbrowser.open, url)
    return {"opened": bool(opened), "url": url}


@app.get("/settings/models")
async def provider_models(provider: str):
    """The models this provider offers to the saved key ([] without a key or when it can't be reached)."""
    prov = _known_provider(provider)
    key = get_stored_api_key(prov)
    models = await asyncio.to_thread(list_provider_models, prov, key) if key else []
    return {"provider": prov, "models": models}


# ---------------------------------------------------------------------------
# File System & Directory Picker Endpoints
# ---------------------------------------------------------------------------

class CreateDirRequest(BaseModel):
    parent_path: str
    name: str


class BrowseNativeRequest(BaseModel):
    prompt: Optional[str] = "Select Folder"
    initial_dir: Optional[str] = None


def pick_native_directory(prompt: str = "Select Folder", initial_dir: Optional[str] = None) -> Optional[str]:
    """Trigger OS-native folder chooser dialog across macOS, Windows, and Linux."""
    import subprocess
    import sys

    if sys.platform == "darwin":
        init_clause = f'default location POSIX file "{initial_dir}"' if initial_dir and os.path.exists(initial_dir) else ""
        script = f'''
        try
            set chosenFolder to choose folder with prompt "{prompt}" {init_clause}
            return POSIX path of chosenFolder
        on error number -128
            return "CANCELLED"
        end try
        '''
        try:
            res = subprocess.run(["osascript", "-e", script], capture_output=True, text=True, timeout=120)
            out = res.stdout.strip()
            if out == "CANCELLED" or res.returncode != 0:
                return None
            return out.rstrip("/")
        except Exception as e:
            logger.warning("macOS native folder picker error: %s", e)
            return None

    elif sys.platform.startswith("win"):
        # Primary: Tkinter with topmost flag brings the native Win32 dialog immediately to the foreground
        try:
            import tkinter as tk
            from tkinter import filedialog

            root = tk.Tk()
            root.withdraw()
            root.attributes("-topmost", True)
            folder = filedialog.askdirectory(
                title=prompt,
                initialdir=initial_dir if initial_dir and os.path.exists(initial_dir) else None,
            )
            root.destroy()
            if folder:
                return str(Path(folder).resolve())
            return None
        except Exception as tk_err:
            logger.warning("Windows tkinter folder picker error: %s, attempting PowerShell fallback", tk_err)

        # Fallback: PowerShell in STA mode with topmost form owner
        init = f"$f.SelectedPath = '{initial_dir}';" if initial_dir and os.path.exists(initial_dir) else ""
        script = f'''
        Add-Type -AssemblyName System.Windows.Forms
        $f = New-Object System.Windows.Forms.FolderBrowserDialog
        $f.Description = "{prompt}"
        $f.ShowNewFolderButton = $true
        {init}
        $form = New-Object System.Windows.Forms.Form
        $form.TopMost = $true
        $form.Visible = $false
        if ($f.ShowDialog($form) -eq [System.Windows.Forms.DialogResult]::OK) {{
            Write-Output $f.SelectedPath
        }} else {{
            Write-Output "CANCELLED"
        }}
        $form.Dispose()
        '''
        try:
            res = subprocess.run(["powershell", "-Sta", "-Command", script], capture_output=True, text=True, timeout=120)
            out = res.stdout.strip()
            if out == "CANCELLED" or res.returncode != 0:
                return None
            return out
        except Exception as e:
            logger.warning("Windows native folder picker error: %s", e)
            return None

    else:
        # Linux - try zenity first, then tkinter
        try:
            cmd = ["zenity", "--file-selection", "--directory", f"--title={prompt}"]
            if initial_dir and os.path.exists(initial_dir):
                cmd.append(f"--filename={initial_dir}")
            res = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
            if res.returncode == 0 and res.stdout.strip():
                return res.stdout.strip()
        except Exception:
            pass

        try:
            import tkinter as tk
            from tkinter import filedialog
            root = tk.Tk()
            root.withdraw()
            root.attributes("-topmost", True)
            folder = filedialog.askdirectory(title=prompt, initialdir=initial_dir)
            root.destroy()
            return folder if folder else None
        except Exception as e:
            logger.warning("Linux native folder picker error: %s", e)
            return None


@app.get("/fs/quick-locations")
async def get_quick_locations():
    """Return user's primary system directories."""
    home = Path.home()
    candidates = [
        {"name": "Downloads", "path": str(home / "Downloads"), "icon": "download"},
        {"name": "Desktop", "path": str(home / "Desktop"), "icon": "desktop"},
        {"name": "Documents", "path": str(home / "Documents"), "icon": "file-text"},
        {"name": "Pictures", "path": str(home / "Pictures"), "icon": "image"},
        {"name": "Home", "path": str(home), "icon": "home"},
    ]
    locs = [c for c in candidates if os.path.exists(c["path"])]
    return {"locations": locs, "home": str(home)}


@app.get("/fs/list-directory")
async def list_directory(path: Optional[str] = None, show_hidden: bool = False):
    """List subdirectories of a given path for in-browser directory browsing."""
    target = Path(path).resolve() if path and path.strip() else Path.home()
    if not target.exists():
        target = Path.home()

    if not target.is_dir():
        target = target.parent

    parent = str(target.parent) if target.parent != target else None

    subdirs = []
    try:
        for entry in os.scandir(target):
            try:
                if entry.is_dir(follow_symlinks=False):
                    if not show_hidden and entry.name.startswith("."):
                        continue
                    if entry.name in ("$RECYCLE.BIN", "System Volume Information"):
                        continue
                    if entry.name == "Library" and target == Path.home():
                        continue
                    subdirs.append({
                        "name": entry.name,
                        "path": entry.path,
                        "is_dir": True,
                    })
            except (PermissionError, OSError):
                continue
    except (PermissionError, OSError) as e:
        raise HTTPException(status_code=403, detail=f"Permission denied: {str(e)}")

    subdirs.sort(key=lambda x: x["name"].lower())

    return {
        "current_path": str(target),
        "parent_path": parent,
        "directories": subdirs,
        "exists": True,
    }


@app.post("/fs/create-directory")
async def create_directory(req: CreateDirRequest):
    """Create a new folder inside parent_path."""
    parent = Path(req.parent_path).resolve()
    if not parent.exists() or not parent.is_dir():
        raise HTTPException(status_code=400, detail="Parent directory does not exist")

    clean_name = req.name.strip().replace("/", "_").replace("\\", "_")
    if not clean_name:
        raise HTTPException(status_code=400, detail="Invalid directory name")

    new_dir = parent / clean_name
    try:
        new_dir.mkdir(parents=False, exist_ok=True)
        return {"status": "success", "path": str(new_dir), "name": clean_name}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create directory: {str(e)}")


@app.post("/fs/browse-native")
async def browse_native_directory(req: BrowseNativeRequest):
    """Trigger native OS folder picker popup."""
    chosen = await asyncio.to_thread(
        pick_native_directory,
        prompt=req.prompt or "Select Folder",
        initial_dir=req.initial_dir,
    )
    if chosen:
        return {"status": "success", "path": chosen, "cancelled": False}
    return {"status": "cancelled", "path": None, "cancelled": True}


class OpenPathRequest(BaseModel):
    path: str
    reveal: bool = True


@app.post("/fs/open-path")
async def open_path_endpoint(req: OpenPathRequest):
    """Open or reveal a file/folder in the OS native File Explorer or Finder."""
    raw_path = (req.path or "").strip()
    if not raw_path:
        raise HTTPException(status_code=400, detail="Path cannot be empty")

    target = Path(raw_path).resolve()

    # If target does not exist directly on disk, try resolving against DB (e.g. if file was moved or renamed)
    if not target.exists():
        try:
            row = await db.execute_read(
                "SELECT new_path, path FROM files WHERE path = ? OR new_path = ? LIMIT 1",
                (raw_path, raw_path)
            )
            if row:
                candidate = row[0].get("new_path") or row[0].get("path")
                if candidate and Path(candidate).resolve().exists():
                    target = Path(candidate).resolve()
        except Exception as db_err:
            logger.warning("Error checking DB for moved path %s: %s", raw_path, db_err)

    if not target.exists():
        raise HTTPException(status_code=404, detail=f"Path not found: {raw_path}")

    import sys
    import subprocess
    import os

    try:
        if sys.platform == "darwin":
            if req.reveal:
                if target.is_file():
                    cmd = ["open", "-R", str(target)]
                else:
                    cmd = ["open", str(target)]
                subprocess.Popen(cmd)
                return {"status": "success", "message": f"Revealed in Finder: {target.name}"}
            else:
                # Open directly in default application (Preview, etc.)
                cmd = ["open", str(target)]
                subprocess.Popen(cmd)
                return {"status": "success", "message": f"Opened: {target.name}"}

        elif sys.platform.startswith("win"):
            norm_target = os.path.normpath(str(target))
            if req.reveal:
                if target.is_file():
                    # On Windows, explorer.exe /select,"C:\path\to\file" opens Explorer and selects the exact file.
                    subprocess.Popen(f'explorer.exe /select,"{norm_target}"', shell=True)
                else:
                    subprocess.Popen(f'explorer.exe "{norm_target}"', shell=True)
                return {"status": "success", "message": f"Revealed in File Explorer: {target.name}"}
            else:
                # Open directly with OS default application (PDF reader, Word, Photos, etc.)
                if target.is_file():
                    subprocess.Popen(f'cmd.exe /c start "" "{norm_target}"', shell=True)
                else:
                    subprocess.Popen(f'explorer.exe "{norm_target}"', shell=True)
                return {"status": "success", "message": f"Opened with default app: {target.name}"}

        else:
            # Linux (freedesktop / xdg-open)
            if req.reveal:
                try:
                    if target.is_file():
                        subprocess.Popen([
                            "dbus-send", "--session", "--dest=org.freedesktop.FileManager1",
                            "--type=method_call", "/org/freedesktop/FileManager1",
                            "org.freedesktop.FileManager1.ShowItems",
                            f"array:string:file://{target}", "string:"
                        ])
                        return {"status": "success", "message": f"Revealed in File Manager: {target.name}"}
                except Exception:
                    pass

                folder = target if target.is_dir() else target.parent
                subprocess.Popen(["xdg-open", str(folder)])
                return {"status": "success", "message": "Opened containing folder"}
            else:
                subprocess.Popen(["xdg-open", str(target)])
                return {"status": "success", "message": f"Opened: {target.name}"}

    except Exception as e:
        logger.error("Failed to open path in file explorer: %s", e)
        raise HTTPException(status_code=500, detail=f"Failed to open in file manager: {str(e)}")


@app.post("/pipeline/run")
async def run_pipeline_endpoint(req: PipelineRunRequest):
    """Run full TidyFlow pipeline and return rich structured JSON results."""
    input_path = Path(req.input_dir).resolve()
    if not input_path.exists() or not input_path.is_dir():
        raise HTTPException(status_code=400, detail=f"Directory not found: {req.input_dir}")

    # Only resolve the output folder here; it is created when files are actually organized.
    out_path = Path(req.output_dir).resolve() if req.output_dir else (input_path / "Organized_Output").resolve()

    # Dynamic MCP security allow list
    set_allowed_directories([input_path, out_path])

    cfg = load_config()
    cfg.input_dir = input_path
    cfg.output_dir = out_path
    cfg.staging_dir = out_path / "Staging"
    cfg.llm.enabled = req.use_llm
    if req.custom_instructions:
        cfg.llm.custom_instructions = req.custom_instructions

    # Tune auto_copy_threshold based on complexity_level
    lvl = (req.complexity_level or "medium").lower()
    if lvl == "low":
        cfg.classification.auto_copy_threshold = 0.70
    elif lvl == "high":
        cfg.classification.auto_copy_threshold = 0.90
    elif lvl == "complex":
        cfg.classification.auto_copy_threshold = 0.92
    else:
        cfg.classification.auto_copy_threshold = 0.85

    # Determine if user passed custom narrow categories (strict LLM mode)
    is_custom_categories = bool(req.custom_categories)

    if req.custom_categories:
        cats = {}
        for k, v in req.custom_categories.items():
            if isinstance(v, dict):
                cats[k] = CategoryConfig(
                    description=v.get("description", ""),
                    keywords=v.get("keywords", []),
                    extensions=v.get("extensions", []),
                )
        if cats:
            cfg.categories = cats

    await broadcast_event("pipeline_start", {"input_dir": str(input_path), "output_dir": str(out_path)})

    loop = asyncio.get_running_loop()

    def sync_progress_callback(stage: str, message: str, done: Optional[int] = None, total: Optional[int] = None):
        payload: dict[str, Any] = {"stage": stage, "message": message}
        if done is not None and total is not None:
            payload.update(done=done, total=total)
        try:
            asyncio.run_coroutine_threadsafe(
                broadcast_event("pipeline_progress", payload),
                loop,
            )
        except Exception:
            pass

    global active_cancel_event
    active_cancel_event = threading.Event()

    try:
        # Execute pipeline in worker thread to prevent event loop blocking
        records, summary = await asyncio.to_thread(
            run_pipeline,
            cfg,
            use_llm=req.use_llm,
            auto_apply=req.auto_apply,
            dry_run=req.dry_run,
            db=db,
            strict_mode=req.strict and is_custom_categories,
            progress_callback=sync_progress_callback,
            cancellation_token=active_cancel_event,
        )
    except PipelineCancelledException:
        logger.info("Pipeline execution safely cancelled by user.")
        await broadcast_event("pipeline_cancelled", {"message": "Pipeline cancelled by user."})
        return {"status": "cancelled", "files": [], "summary": None}
    except Exception as e:
        logger.exception("Pipeline execution failed: %s", e)
        await broadcast_event("pipeline_error", {"error": str(e)})
        raise HTTPException(status_code=500, detail=f"Pipeline execution error: {str(e)}")
    finally:
        active_cancel_event = None

    file_list = [_serialize_record(r) for r in records if not r.skipped]

    latest_pipeline_data["records"] = records
    latest_pipeline_data["summary"] = summary
    latest_pipeline_data["input_dir"] = str(input_path)
    latest_pipeline_data["output_dir"] = str(out_path)
    latest_pipeline_data["categories"] = sorted(cfg.categories.keys())
    _save_latest_run()

    await broadcast_event("pipeline_complete", {
        "total_scanned": summary.total_scanned,
        "output_dir": str(out_path),
    })

    return {
        "status": "success",
        "input_dir": str(input_path),
        "output_dir": str(out_path),
        "summary": summary.model_dump(),
        "files": file_list,
        "categories": latest_pipeline_data["categories"],
        "report_html_path": str(out_path / "review_report.html"),
    }


@app.post("/pipeline/cancel")
async def cancel_pipeline():
    """Immediately halt any active running pipeline execution."""
    global active_cancel_event
    if active_cancel_event is not None:
        active_cancel_event.set()
        logger.info("Cancellation signal dispatched to active pipeline.")
        await broadcast_event("pipeline_cancelled", {"message": "Pipeline cancellation requested."})
        return {"status": "cancelling", "message": "Cancellation request dispatched"}
    return {"status": "idle", "message": "No active pipeline running"}


@app.post("/pipeline/clear")
async def clear_pipeline(folder: Optional[str] = None):
    """Forget the current sort (results, saved run, and `folder`'s plan). Files and undo info are untouched."""
    if folder:
        _plan_file(folder).unlink(missing_ok=True)
    if active_cancel_event is not None:
        active_cancel_event.set()
    latest_pipeline_data.update(records=[], summary=None, input_dir="", output_dir="", categories=[])
    shutil.rmtree(_latest_run_dir(), ignore_errors=True)
    return {"status": "cleared"}


@app.get("/pipeline/latest")
async def get_latest_pipeline_results():
    """Return the most recent run (kept in memory, restored from disk on startup)."""
    summary = latest_pipeline_data.get("summary")
    return {
        "status": "success",
        "input_dir": latest_pipeline_data.get("input_dir", ""),
        "output_dir": latest_pipeline_data.get("output_dir", ""),
        "summary": summary.model_dump() if summary else None,
        "files": [_serialize_record(r) for r in latest_pipeline_data.get("records", []) if not r.skipped],
        "categories": latest_pipeline_data.get("categories", []),
    }


@app.post("/pipeline/apply-direct")
async def apply_decisions_direct(req: ApplyDirectRequest):
    """Directly apply decisions from the UI without exporting to CSV."""
    out_dir = Path(req.output_dir).resolve()
    created_out_dir = not out_dir.exists()
    out_dir.mkdir(parents=True, exist_ok=True)

    set_allowed_directories([out_dir])

    # Load FileRecords from cache or disk
    records = latest_pipeline_data.get("records")
    if not records:
        raise HTTPException(status_code=400, detail="No scan results found. Please scan the folder again.")

    id_to_record = {r.file_id: r for r in records}
    looks_existed = {(out_dir / c).resolve() for c in req.folder_looks if (out_dir / c).exists()}

    # Convert incoming UI decision items to ReviewDecision models
    decisions: list[ReviewDecision] = []
    for item in req.decisions:
        rec = id_to_record.get(item.file_id)
        orig_cat = (rec.classification.category if rec and rec.classification else "Unknown")
        orig_conf = (rec.classification.confidence if rec and rec.classification else 0.0)
        decisions.append(
            ReviewDecision(
                file_id=item.file_id,
                approved=item.approved,
                override_category=item.override_category,
                override_filename=item.target_filename,
                original_category=orig_cat,
                original_confidence=orig_conf,
            )
        )

    # Organize in a worker thread so the server keeps answering, and report progress as it goes.
    loop = asyncio.get_running_loop()
    last_sent = [0.0]

    def on_progress(done: int, total: int) -> None:
        now = loop.time()
        if done < total and now - last_sent[0] < 0.1:
            return  # a few updates a second is plenty
        last_sent[0] = now
        asyncio.run_coroutine_threadsafe(broadcast_event("apply_progress", {"done": done, "total": total}), loop)

    manifest = await asyncio.to_thread(
        apply_decisions,
        decisions=decisions,
        records=records,
        output_dir=out_dir,
        dry_run=req.dry_run,
        move_mode=req.move_mode,
        db=db,
        progress_callback=on_progress,
    )

    if not req.dry_run and manifest and req.folder_looks:
        folder_style.style_new_folders(out_dir, req.folder_looks, looks_existed)

    if not req.dry_run and manifest:
        audit_dir = work_data_dir() / "manifests"
        audit_dir.mkdir(parents=True, exist_ok=True)
        write_copy_manifest(manifest, audit_dir)
        if getattr(req, "export_reports", False):
            write_copy_manifest(manifest, out_dir)

    if not req.dry_run:
        _save_last_apply(manifest, out_dir, created_out_dir)
        # These results are used up; a restart must not offer them for review again.
        latest_pipeline_data.update(records=[], summary=None, input_dir="", output_dir="", categories=[])
        shutil.rmtree(_latest_run_dir(), ignore_errors=True)
    if created_out_dir and not manifest:
        # Nothing was organized, so don't leave an empty folder behind.
        try:
            out_dir.rmdir()
        except OSError:
            pass

    action_label = "simulated" if req.dry_run else ("moved" if req.move_mode else "copied")
    return {
        "status": "success",
        "action": action_label,
        "applied_count": len(manifest),
        "manifest": [m.model_dump() for m in manifest],
        "output_dir": str(out_dir),
    }


def _last_apply_file() -> Path:
    return get_app_data_dir() / "last_apply.json"


def _save_last_apply(manifest: list, output_dir: Path, created_output_dir: bool = False) -> None:
    data = {
        "output_dir": str(output_dir),
        "created_output_dir": created_output_dir,
        "entries": [m.model_dump(mode="json") for m in manifest],
    }
    try:
        _last_apply_file().write_text(json.dumps(data), encoding="utf-8")
    except Exception as e:
        logger.warning("Failed to save undo information: %s", e)


@app.get("/pipeline/undo-last")
async def get_undo_last():
    """Report whether the most recent organize can be undone."""
    f = _last_apply_file()
    if not f.exists():
        return {"available": False, "count": 0}
    try:
        entries = json.loads(f.read_text(encoding="utf-8"))["entries"]
    except Exception:
        return {"available": False, "count": 0}
    return {"available": bool(entries), "count": len(entries)}


@app.post("/pipeline/undo-last")
async def undo_last_apply():
    """Reverse the most recent organize: delete the copies we made, or move moved files back."""
    from .utils import compute_sha256

    f = _last_apply_file()
    if not f.exists():
        raise HTTPException(status_code=400, detail="There is nothing to undo.")
    data = json.loads(f.read_text(encoding="utf-8"))
    entries = data.get("entries", [])
    output_root = Path(data["output_dir"]) if data.get("output_dir") else None

    restored, skipped = 0, 0
    touched_dirs: set[Path] = set()
    for e in entries:
        dest = Path(e["destination_path"])
        orig = Path(e["original_path"])
        # Only touch a file that is still exactly what we put there.
        if not dest.exists() or compute_sha256(dest) != e["sha256"]:
            skipped += 1
            continue
        try:
            if e.get("operation") == "move":
                if orig.exists():
                    skipped += 1
                    continue
                orig.parent.mkdir(parents=True, exist_ok=True)
                shutil.move(str(dest), str(orig))
            else:
                dest.unlink()
            touched_dirs.add(dest.parent)
            restored += 1
        except OSError as exc:
            logger.warning("Undo failed for %s: %s", dest, exc)
            skipped += 1

    # Remove category folders we emptied, walking up nested ones but never past the output folder.
    for d in sorted(touched_dirs, key=lambda p: len(p.parts), reverse=True):
        while d.exists() and (output_root is None or (d != output_root and output_root in d.parents)):
            try:
                if any(d.iterdir()):
                    break
                d.rmdir()
            except OSError:
                break
            d = d.parent

    # The output folder itself goes too, but only if organizing created it and it is now empty.
    if output_root and data.get("created_output_dir") and output_root.is_dir():
        try:
            if not any(output_root.iterdir()):
                output_root.rmdir()
        except OSError:
            pass

    f.unlink(missing_ok=True)
    return {"status": "success", "restored": restored, "skipped": skipped}


def _current_path(row: dict) -> Path | None:
    """Where an indexed file is now: its organized place, or its original one; None if it is gone."""
    for key in ("new_path", "path"):
        value = row.get(key)
        if value and Path(value).is_file():
            return Path(value)
    return None


@app.get("/search")
async def search_files(
    q: str,
    limit: int = 30,
    offset: int = 0,
    category: Optional[str] = None,
    kind: Optional[str] = None,
    organized: Optional[bool] = None,
):
    """One page of files matching ``q``, with counts for the filters and a corrected spelling if one was used."""
    if not q or not q.strip():
        return {"results": [], "total": 0, "facets": None, "corrected": None}
    page = await db.search_page(
        q.strip(), limit=limit, offset=offset, category=category or None, kind=kind or None, organized=organized
    )
    live, gone = [], []
    for r in page["results"]:
        # Point at wherever the file is now (organized copy, or back at its original place after an
        # undo) and drop rows whose file is gone everywhere.
        row = dict(r)
        row.pop("fingerprint", None)
        if row.get("new_path") and not Path(row["new_path"]).exists():
            row["new_path"] = None
        current = _current_path(row)
        if current is None:
            gone.append(row["id"])
            continue
        row["current_path"] = str(current)
        row["name"] = current.name
        try:
            row["modified"] = current.stat().st_mtime
        except OSError:
            row["modified"] = None
        live.append(row)
    for row_id in gone:
        await db.execute_write("DELETE FROM files WHERE id = ?", (row_id,))
    return {
        "results": live,
        "total": max(page.get("total", len(live)) - len(gone), len(live)),
        "facets": page.get("facets"),
        "corrected": page.get("corrected"),
    }


@app.get("/search/stats")
async def search_stats():
    """How many files the search covers, and the folders holding the most of them."""
    return await db.search_stats()


async def _indexed_file(row_id: int) -> dict:
    rows = await db.execute_read(
        "SELECT id, path, new_path, fingerprint, reason, substr(extracted_text, 1, 20000) AS extracted_text "
        "FROM files WHERE id = ?",
        (row_id,),
    )
    if not rows:
        raise HTTPException(status_code=404, detail="No such file")
    return dict(rows[0])


@app.get("/search/file/{row_id}")
async def search_file_details(row_id: int):
    """The text found inside one indexed file and why it was filed where it is."""
    row = await _indexed_file(row_id)
    return {"id": row["id"], "extracted_text": row.get("extracted_text") or "", "reason": row.get("reason") or ""}


@app.get("/search/preview/{row_id}")
async def search_file_preview(row_id: int, size: int = 640):
    """A sharp preview of one indexed file, made on first request and then cached."""
    from fastapi.responses import FileResponse
    from .previews import get_preview

    # Only files in the index can be previewed, never an arbitrary path.
    row = await _indexed_file(row_id)
    current = _current_path(row)
    if current is None:
        raise HTTPException(status_code=404, detail="No such file")
    key = row.get("fingerprint")
    if not key:
        stat = current.stat()
        key = hashlib.sha256(f"{current}|{stat.st_size}|{stat.st_mtime_ns}".encode()).hexdigest()
    out = await asyncio.to_thread(get_preview, current, key, size)
    if out is None:
        raise HTTPException(status_code=404, detail="No preview for this file")
    return FileResponse(out, media_type="image/webp", headers={"Cache-Control": "private, max-age=86400"})


@app.get("/costs")
async def get_costs():
    rows = await db.execute_read(
        "SELECT date(timestamp) as day, sum(cost_usd) as total_cost, sum(prompt_tokens) as prompt_tokens, sum(completion_tokens) as completion_tokens FROM token_logs GROUP BY day ORDER BY day DESC"
    )
    return {"costs": [dict(r) for r in rows]}


@app.get("/preview/{file_id}")
async def file_preview(file_id: str, size: int = 640):
    """A sharp preview of one file from the current scan, made on first request and then cached."""
    from fastapi.responses import FileResponse
    from .previews import get_preview

    # Only files from the current results can be previewed, never an arbitrary path.
    rec = next((r for r in latest_pipeline_data.get("records") or [] if r.file_id == file_id), None)
    if rec is None or rec.skipped or not rec.sha256 or not Path(rec.abs_path).is_file():
        raise HTTPException(status_code=404, detail="No such file")
    out = await asyncio.to_thread(get_preview, Path(rec.abs_path), rec.sha256, size)
    if out is None:
        raise HTTPException(status_code=404, detail="No preview for this file")
    # The id changes when the file's contents do, so the browser can keep the image.
    return FileResponse(out, media_type="image/webp", headers={"Cache-Control": "private, max-age=604800"})


@app.get("/files")
async def get_files(limit: int = 50, offset: int = 0):
    rows = await db.execute_read(
        "SELECT id, path, status, category, new_path, confidence_score FROM files LIMIT ? OFFSET ?",
        (limit, offset)
    )
    return {"files": [dict(r) for r in rows]}


@app.post("/rules")
async def update_rules(rules_req: dict[str, Any]):
    rules_path = get_app_data_dir() / "rules.yaml"
    rules_list = rules_req.get("rules", [])
    with open(rules_path, "w", encoding="utf-8") as f:
        yaml.dump({"rules": rules_list}, f)
    return {"message": "Rules updated successfully", "count": len(rules_list)}


@app.post("/ai/chat-structure")
async def ai_chat_structure_endpoint(req: AiStructureChatRequest):
    """Generate or refine category structure and rules via natural language or auto-discovery."""
    sample_filenames: list[str] = []
    inventory_summary = ""
    if req.input_dir:
        try:
            sample_filenames, inventory_summary = await asyncio.to_thread(
                inspect_directory,
                input_dir=req.input_dir,
                sample_size=80,
            )
        except Exception as e:
            logger.warning(f"Error inspecting directory {req.input_dir}: {e}")

    result = await asyncio.to_thread(
        chat_generate_structure,
        message=req.message,
        history=req.history,
        current_categories=req.current_categories,
        sample_filenames=sample_filenames,
        complexity_level=req.complexity_level or "medium",
        auto_discover=bool(req.auto_discover),
        inventory_summary=inventory_summary,
    )
    return result


@app.post("/ai/review-chat")
async def ai_review_chat_endpoint(req: AiReviewChatRequest):
    """Apply bulk category/filename adjustments to review table via natural language."""
    result = await asyncio.to_thread(
        apply_review_command,
        command=req.command,
        files=req.files,
        categories=req.categories,
    )
    return result


@app.post("/ai/cluster-unrecognized")
async def ai_cluster_endpoint(req: AiClusterRequest):
    """Analyze unrecognized files and discover cluster categories with AI."""
    result = await asyncio.to_thread(
        cluster_unrecognized_files,
        files=req.files,
        existing_categories=req.existing_categories,
    )
    return result


@app.get("/stream")
async def message_stream(request: Request):
    """Server-Sent Events endpoint for real-time progress and logs."""
    async def event_generator():
        q = asyncio.Queue()
        clients.add(q)
        try:
            while True:
                if await request.is_disconnected():
                    break
                try:
                    msg = await asyncio.wait_for(q.get(), timeout=15.0)
                    yield {"data": json.dumps(msg)}
                except asyncio.TimeoutError:
                    # Ping / keep-alive
                    yield {"data": json.dumps({"type": "ping"})}
        finally:
            clients.discard(q)

    return EventSourceResponse(event_generator())


# Catch-all route for static assets in dist root and SPA routing
if frontend_dist.exists():
    @app.get("/{full_path:path}")
    async def serve_spa_catchall(full_path: str):
        file_path = frontend_dist / full_path
        if file_path.is_file():
            return FileResponse(file_path)
        return FileResponse(frontend_dist / "index.html", headers=_NO_CACHE)
