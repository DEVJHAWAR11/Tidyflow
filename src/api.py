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

from .applier import apply_decisions, build_auto_approval_decisions, load_decisions, write_copy_manifest
from .config import CategoryConfig, TidyConfig, load_config
from .database import DatabaseManager
from .llm_provider import get_stored_api_key, save_settings
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
    auto_apply: bool = False
    dry_run: bool = True


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
    stored_key = get_stored_api_key("deepseek") or os.getenv("DEEPSEEK_API_KEY") or ""
    has_key = bool(stored_key.strip())
    return {
        "status": "running",
        "version": "2.0.0",
        "has_llm_key": has_key,
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
    provider = cfg.llm.provider
    key = get_stored_api_key(provider) or os.getenv(f"{provider.upper()}_API_KEY") or os.getenv("TIDYFLOW_API_KEY") or ""
    masked_key = f"{key[:4]}...{key[-4:]}" if len(key) > 8 else ("••••••••" if key else "")

    return {
        "provider": provider,
        "model": cfg.llm.model,
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
        if payload.model:
            data["llm"]["model"] = payload.model
        data.setdefault("classification", {})["auto_copy_threshold"] = payload.auto_copy_threshold
        data["max_file_size_mb"] = payload.max_file_size_mb
        with open(cfg_file, "w", encoding="utf-8") as f:
            yaml.safe_dump(data, f, sort_keys=False)

    return {"status": "success", "message": "Settings updated"}


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

    # Convert incoming UI decision items to ReviewDecision models
    decisions: list[ReviewDecision] = []
    for item in req.decisions:
        decisions.append(
            ReviewDecision(
                file_id=item.file_id,
                approved=item.approved,
                override_category=item.override_category,
                target_filename=item.target_filename,
            )
        )

    # Load FileRecords from cache or disk
    records = latest_pipeline_data.get("records")
    if not records:
        records_file = out_dir / "file_records.jsonl"
        if records_file.exists():
            records = load_records_jsonl(records_file)
        else:
            raise HTTPException(status_code=400, detail="No active file records found to apply decisions.")

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
