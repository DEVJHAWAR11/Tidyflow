"""FastAPI backend with SSE progress streaming, dynamic allow-lists, and search."""

from __future__ import annotations

import asyncio
import json
import logging
from pathlib import Path
from typing import Any, List, Optional

import yaml
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse

from .applier import apply_decisions, load_decisions, write_copy_manifest
from .config import TidyConfig, load_config
from .database import DatabaseManager
from .events import broadcast, clients
from .main_loop import Processor, run_pipeline
from .mcp_server import set_allowed_directories
from .models import ReviewDecision
from .scanner import scan_files

logger = logging.getLogger(__name__)

from contextlib import asynccontextmanager

db = DatabaseManager()
processor = Processor(max_concurrent=5, db=db)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await db.start()
    await processor.start()
    yield
    await processor.stop()
    await db.stop()


app = FastAPI(title="TidyFlow Universal File Organizer API", version="2.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:1420", "http://127.0.0.1:1420", "http://localhost:5173", "*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class ScanRequest(BaseModel):
    path: str
    output_dir: Optional[str] = None
    use_llm: bool = True
    auto_apply: bool = False
    dry_run: bool = True


class RuleUpdate(BaseModel):
    rules: list[dict[str, Any]]


class ApplyRequest(BaseModel):
    decisions_path: str
    output_dir: str
    dry_run: bool = True
    move_mode: bool = False


@app.get("/status")
async def get_status():
    return {"status": "running", "version": "2.0.0"}


@app.post("/scan")
async def trigger_scan(req: ScanRequest):
    input_path = Path(req.path).resolve()
    if not input_path.exists() or not input_path.is_dir():
        return {"error": f"Invalid directory path: {req.path}"}

    out_dir = Path(req.output_dir).resolve() if req.output_dir else (input_path / "Organized").resolve()

    # Dynamically allow source and destination directories — NO hardcoded paths!
    set_allowed_directories([input_path, out_dir])

    # Run background pipeline
    cfg = load_config()
    cfg.input_dir = input_path
    cfg.output_dir = out_dir
    cfg.staging_dir = out_dir / "Staging"

    queued_count = 0
    for f in scan_files(input_path):
        await processor.add_file(f["path"], str(input_path))
        queued_count += 1

    return {
        "message": f"Scan triggered for {input_path}. Queued {queued_count} files.",
        "input_dir": str(input_path),
        "output_dir": str(out_dir),
    }


@app.get("/files")
async def get_files(limit: int = 50, offset: int = 0):
    rows = await db.execute_read(
        "SELECT id, path, status, category, new_path, confidence_score FROM files LIMIT ? OFFSET ?",
        (limit, offset)
    )
    return {"files": [dict(r) for r in rows]}


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


@app.post("/rules")
async def update_rules(rules_req: RuleUpdate):
    rules_path = Path("rules.yaml")
    with open(rules_path, "w", encoding="utf-8") as f:
        yaml.dump({"rules": rules_req.rules}, f)
    return {"message": "Rules updated successfully", "count": len(rules_req.rules)}


@app.post("/apply")
async def apply_review_decisions(req: ApplyRequest):
    decisions_path = Path(req.decisions_path)
    output_dir = Path(req.output_dir)

    if not decisions_path.exists():
        return {"error": f"Decisions file not found: {decisions_path}"}

    decisions = load_decisions(decisions_path)
    # Dynamically allow target directory
    set_allowed_directories([output_dir])

    # Note: records can be loaded from output_dir / file_records.jsonl
    from .main_loop import load_records_jsonl
    records = load_records_jsonl(output_dir / "file_records.jsonl")

    manifest = apply_decisions(
        decisions, records, output_dir,
        dry_run=req.dry_run, move_mode=req.move_mode, db=db
    )

    if not req.dry_run and manifest:
        write_copy_manifest(manifest, output_dir)

    return {
        "status": "success",
        "action": "preview" if req.dry_run else ("moved" if req.move_mode else "copied"),
        "count": len(manifest),
    }


async def event_generator(request: Request):
    q = asyncio.Queue()
    clients.add(q)
    try:
        while True:
            if await request.is_disconnected():
                break
            msg = await q.get()
            yield {"data": json.dumps(msg)}
    finally:
        clients.remove(q)


@app.get("/stream")
async def stream(request: Request):
    return EventSourceResponse(event_generator(request))
