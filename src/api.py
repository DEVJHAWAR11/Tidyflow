"""FastAPI Backend Server for TidyFlow Universal File Organizer."""

import asyncio
import json
import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Optional

import yaml
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sse_starlette.sse import EventSourceResponse

from .ai_assistant import (
    apply_review_command,
    chat_generate_structure,
    cluster_unrecognized_files,
)
from .applier import apply_decisions, build_auto_approval_decisions, load_decisions, write_copy_manifest
from .config import CategoryConfig, TidyConfig, load_config
from .database import DatabaseManager
from .llm_provider import (
    _resolve_provider_model,
    get_stored_api_key,
    load_settings,
    save_settings,
)
from .main_loop import Processor, load_records_jsonl, run_pipeline
from .mcp_server import set_allowed_directories
from .models import FileRecord, ReviewDecision
from .scanner import scan_files

logger = logging.getLogger(__name__)

db = DatabaseManager()
processor = Processor(max_concurrent=5, db=db)
clients: set[asyncio.Queue] = set()

# In-memory latest pipeline results cache
latest_pipeline_data: dict[str, Any] = {
    "records": [],
    "summary": None,
    "input_dir": "",
    "output_dir": "",
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

    # Seed / index existing records from disk if database has 0 files
    try:
        count_res = await db.execute_read("SELECT count(*) as count FROM files")
        current_count = count_res[0]["count"] if count_res else 0
        if current_count == 0:
            candidate_paths = [
                Path("/Users/arpan/test files/Organized_Output"),
                Path("./Organized_Output"),
                Path.home() / "Desktop" / "Organized_Output",
                Path.home() / "Downloads" / "Organized_Output",
            ]
            for cand in candidate_paths:
                rec_file = cand / "file_records.jsonl"
                if rec_file.exists():
                    loaded = load_records_jsonl(rec_file)
                    if loaded:
                        indexed_count = await db.index_records(loaded)
                        logger.info("Auto-indexed %d records into database from %s", indexed_count, rec_file)
                        break
    except Exception as e:
        logger.warning("Error auto-indexing records on startup: %s", e)

    yield
    await processor.stop()
    await db.stop()


app = FastAPI(
    title="TidyFlow Universal File Organizer API",
    version="2.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount frontend build if available
frontend_dist = Path(__file__).parent.parent / "frontend" / "dist"
if frontend_dist.exists():
    from fastapi.staticfiles import StaticFiles
    app.mount("/assets", StaticFiles(directory=str(frontend_dist / "assets")), name="assets")

    @app.get("/")
    async def serve_frontend():
        from fastapi.responses import FileResponse
        return FileResponse(frontend_dist / "index.html")


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
    auto_apply: bool = False
    dry_run: bool = True


class AiStructureChatRequest(BaseModel):
    message: str
    history: Optional[list[dict[str, Any]]] = None
    input_dir: Optional[str] = None
    current_categories: Optional[dict[str, Any]] = None


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


class SettingsPayload(BaseModel):
    provider: str = "deepseek"
    api_key: Optional[str] = None
    model: Optional[str] = None
    auto_copy_threshold: float = 0.85
    max_file_size_mb: float = 200.0


# ---------------------------------------------------------------------------
# API Endpoints
# ---------------------------------------------------------------------------


@app.get("/status")
async def get_status():
    provider, api_key, _ = load_settings()
    has_key = bool(api_key.strip())
    return {
        "status": "running",
        "version": "2.0.0",
        "has_llm_key": has_key,
        "provider": provider,
        "active_clients": len(clients),
    }


@app.get("/categories")
async def get_categories():
    """Return configured categories taxonomy."""
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
    """Update or add categories in config.yaml."""
    cfg_file = Path("config.yaml")
    raw: dict[str, Any] = {}
    if cfg_file.exists():
        with open(cfg_file, "r", encoding="utf-8") as f:
            raw = yaml.safe_load(f) or {}

    raw["categories"] = req.categories
    with open(cfg_file, "w", encoding="utf-8") as f:
        yaml.safe_dump(raw, f, sort_keys=False)

    return {"status": "success", "categories": req.categories}


@app.get("/settings")
async def get_settings():
    """Get current configuration and masked API key."""
    cfg = load_config()
    provider, key, _ = load_settings()
    if not provider:
        provider = cfg.llm.provider
    masked_key = f"{key[:4]}...{key[-4:]}" if len(key) > 8 else ("••••••••" if key else "")
    model = _resolve_provider_model(provider, cfg.llm.model)

    return {
        "provider": provider,
        "model": model,
        "has_key": bool(key),
        "masked_key": masked_key,
        "auto_copy_threshold": cfg.classification.auto_copy_threshold,
        "max_file_size_mb": cfg.max_file_size_mb,
    }


@app.post("/settings")
async def update_settings(payload: SettingsPayload):
    """Save LLM credentials and configuration settings."""
    if payload.api_key and payload.api_key.strip():
        save_settings(payload.provider, payload.api_key.strip())
        # Also update .env
        env_path = Path(".env")
        lines = []
        if env_path.exists():
            lines = env_path.read_text(encoding="utf-8").splitlines()

        key_var = f"{payload.provider.upper()}_API_KEY"
        new_lines = [l for l in lines if not l.startswith(f"{key_var}=") and not l.startswith("TIDYFLOW_API_KEY=")]
        new_lines.append(f"{key_var}={payload.api_key.strip()}")
        new_lines.append(f"TIDYFLOW_API_KEY={payload.api_key.strip()}")
        env_path.write_text("\n".join(new_lines) + "\n", encoding="utf-8")

    # Update config.yaml
    cfg_file = Path("config.yaml")
    if cfg_file.exists():
        with open(cfg_file, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f) or {}
        data.setdefault("llm", {})["provider"] = payload.provider
        target_model = _resolve_provider_model(payload.provider, payload.model)
        data["llm"]["model"] = target_model
        data.setdefault("classification", {})["auto_copy_threshold"] = payload.auto_copy_threshold
        data["max_file_size_mb"] = payload.max_file_size_mb
        with open(cfg_file, "w", encoding="utf-8") as f:
            yaml.safe_dump(data, f, sort_keys=False)

    return {"status": "success", "message": "Settings updated"}


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
        tell application "System Events"
            activate
            try
                set chosenFolder to choose folder with prompt "{prompt}" {init_clause}
                return POSIX path of chosenFolder
            on error number -128
                return "CANCELLED"
            end try
        end tell
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
        init = f"$f.SelectedPath = '{initial_dir}';" if initial_dir and os.path.exists(initial_dir) else ""
        script = f'''
        Add-Type -AssemblyName System.Windows.Forms
        $f = New-Object System.Windows.Forms.FolderBrowserDialog
        $f.Description = "{prompt}"
        {init}
        if ($f.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {{
            Write-Output $f.SelectedPath
        }} else {{
            Write-Output "CANCELLED"
        }}
        '''
        try:
            res = subprocess.run(["powershell", "-Command", script], capture_output=True, text=True, timeout=120)
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
    target = Path(req.path).resolve()
    if not target.exists():
        raise HTTPException(status_code=404, detail=f"Path not found: {req.path}")

    import sys
    import subprocess

    try:
        if sys.platform == "darwin":
            # On macOS, `open -R` reveals and highlights the specific file in Finder
            if req.reveal and target.is_file():
                cmd = ["open", "-R", str(target)]
            else:
                cmd = ["open", str(target if target.is_dir() else target.parent)]
            subprocess.Popen(cmd)
            return {"status": "success", "message": f"Revealed in Finder: {target.name}"}

        elif sys.platform.startswith("win"):
            if req.reveal and target.is_file():
                cmd = ["explorer.exe", f"/select,{str(target)}"]
            else:
                cmd = ["explorer.exe", str(target if target.is_dir() else target.parent)]
            subprocess.Popen(cmd)
            return {"status": "success", "message": "Opened in File Explorer"}

        else:
            # Linux (freedesktop / xdg-open)
            try:
                if req.reveal and target.is_file():
                    subprocess.Popen([
                        "dbus-send", "--session", "--dest=org.freedesktop.FileManager1",
                        "--type=method_call", "/org/freedesktop/FileManager1",
                        "org.freedesktop.FileManager1.ShowItems",
                        f"array:string:file://{target}", "string:"
                    ])
                    return {"status": "success", "message": "Revealed in File Manager"}
            except Exception:
                pass

            folder = target if target.is_dir() else target.parent
            subprocess.Popen(["xdg-open", str(folder)])
            return {"status": "success", "message": "Opened in File Manager"}

    except Exception as e:
        logger.error("Failed to open path in file explorer: %s", e)
        raise HTTPException(status_code=500, detail=f"Failed to open in file manager: {str(e)}")


@app.post("/pipeline/run")
async def run_pipeline_endpoint(req: PipelineRunRequest):
    """Run full TidyFlow pipeline and return rich structured JSON results."""
    input_path = Path(req.input_dir).resolve()
    if not input_path.exists() or not input_path.is_dir():
        raise HTTPException(status_code=400, detail=f"Directory not found: {req.input_dir}")

    out_path = Path(req.output_dir).resolve() if req.output_dir else (input_path / "Organized_Output").resolve()
    out_path.mkdir(parents=True, exist_ok=True)

    # Dynamic MCP security allow list
    set_allowed_directories([input_path, out_path])

    cfg = load_config()
    cfg.input_dir = input_path
    cfg.output_dir = out_path
    cfg.staging_dir = out_path / "Staging"
    cfg.llm.enabled = req.use_llm
    if req.custom_instructions:
        cfg.llm.custom_instructions = req.custom_instructions

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

    # Execute pipeline in worker thread to prevent event loop blocking
    records, summary = await asyncio.to_thread(
        run_pipeline,
        cfg,
        use_llm=req.use_llm,
        auto_apply=req.auto_apply,
        dry_run=req.dry_run,
        db=db,
        strict_mode=is_custom_categories,
    )

    # Transform records into JSON serializable format for UI
    file_list = []
    for r in records:
        text_snip = r.extracted_text_normalized or r.extracted_text_raw or ""
        file_list.append({
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
        })

    latest_pipeline_data["records"] = records
    latest_pipeline_data["summary"] = summary
    latest_pipeline_data["input_dir"] = str(input_path)
    latest_pipeline_data["output_dir"] = str(out_path)

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
        "report_html_path": str(out_path / "review_report.html"),
    }


@app.get("/pipeline/latest")
async def get_latest_pipeline_results():
    """Retrieve in-memory results from the most recent run."""
    records = latest_pipeline_data.get("records", [])
    summary = latest_pipeline_data.get("summary")
    out_path = latest_pipeline_data.get("output_dir", "")

    needs_disk_load = (
        not records
        or sum(1 for r in records if r.classification and r.classification.category != "Unknown") == 0
    )
    if needs_disk_load:
        candidate_paths = []
        if out_path:
            candidate_paths.append(Path(out_path))
        candidate_paths.extend([
            Path("/Users/arpan/test files/Organized_Output"),
            Path("./Organized_Output"),
            Path.home() / "Desktop" / "Organized_Output",
            Path.home() / "Downloads" / "Organized_Output",
        ])
        for cand in candidate_paths:
            records_file = cand / "file_records.jsonl"
            if records_file.exists():
                loaded = load_records_jsonl(records_file)
                if loaded:
                    records = loaded
                    out_path = str(cand)
                    try:
                        await db.index_records(records)
                    except Exception:
                        pass
                    break

    file_list = []
    for r in records:
        text_snip = r.extracted_text_normalized or r.extracted_text_raw or ""
        file_list.append({
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
        })

    return {
        "status": "success",
        "input_dir": latest_pipeline_data.get("input_dir", ""),
        "output_dir": out_path,
        "summary": summary.model_dump() if summary else None,
        "files": file_list,
    }


@app.post("/pipeline/apply-direct")
async def apply_decisions_direct(req: ApplyDirectRequest):
    """Directly apply decisions from the UI without exporting to CSV."""
    out_dir = Path(req.output_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    set_allowed_directories([out_dir])

    # Load FileRecords from cache or disk
    records = latest_pipeline_data.get("records")
    if not records:
        candidate_paths = [
            out_dir,
            Path("/Users/arpan/test files/Organized_Output"),
            Path("./Organized_Output"),
        ]
        for cp in candidate_paths:
            records_file = cp / "file_records.jsonl"
            if records_file.exists():
                records = load_records_jsonl(records_file)
                break
        if not records:
            raise HTTPException(status_code=400, detail="No active file records found to apply decisions.")

    id_to_record = {r.file_id: r for r in records}

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

    manifest = apply_decisions(
        decisions=decisions,
        records=records,
        output_dir=out_dir,
        dry_run=req.dry_run,
        move_mode=req.move_mode,
        db=db,
    )

    if not req.dry_run and manifest:
        write_copy_manifest(manifest, out_dir)

    action_label = "simulated" if req.dry_run else ("moved" if req.move_mode else "copied")
    return {
        "status": "success",
        "action": action_label,
        "applied_count": len(manifest),
        "manifest": [m.model_dump() for m in manifest],
        "output_dir": str(out_dir),
    }


@app.get("/search")
async def search_files(q: str):
    if not q or not q.strip():
        return {"results": []}
    results = await db.search(q.strip())
    return {"results": [dict(r) for r in results]}


@app.get("/costs")
async def get_costs():
    rows = await db.execute_read(
        "SELECT date(timestamp) as day, sum(cost_usd) as total_cost, sum(prompt_tokens) as prompt_tokens, sum(completion_tokens) as completion_tokens FROM token_logs GROUP BY day ORDER BY day DESC"
    )
    return {"costs": [dict(r) for r in rows]}


@app.get("/files")
async def get_files(limit: int = 50, offset: int = 0):
    rows = await db.execute_read(
        "SELECT id, path, status, category, new_path, confidence_score FROM files LIMIT ? OFFSET ?",
        (limit, offset)
    )
    return {"files": [dict(r) for r in rows]}


@app.post("/rules")
async def update_rules(rules_req: dict[str, Any]):
    rules_path = Path("rules.yaml")
    rules_list = rules_req.get("rules", [])
    with open(rules_path, "w", encoding="utf-8") as f:
        yaml.dump({"rules": rules_list}, f)
    return {"message": "Rules updated successfully", "count": len(rules_list)}


@app.post("/ai/chat-structure")
async def ai_chat_structure_endpoint(req: AiStructureChatRequest):
    """Generate or refine category structure and rules via natural language."""
    sample_filenames = []
    if req.input_dir:
        try:
            p = Path(req.input_dir).resolve()
            if p.exists() and p.is_dir():
                sample_filenames = [
                    f.name
                    for f in p.iterdir()
                    if f.is_file() and not f.name.startswith(".")
                ][:50]
        except Exception:
            pass

    result = await asyncio.to_thread(
        chat_generate_structure,
        message=req.message,
        history=req.history,
        current_categories=req.current_categories,
        sample_filenames=sample_filenames,
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
