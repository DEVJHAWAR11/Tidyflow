import asyncio
import yaml
from pathlib import Path
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse
from src.database import DatabaseManager
from src.main_loop import Processor
from src.scanner import scan_files
from src.mcp_server import set_allowed_directories
from src.events import clients
import json

app = FastAPI(title="TidyFlow API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:1420", "http://127.0.0.1:1420", "http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)
db = DatabaseManager()
processor = Processor(max_concurrent=5)

class RuleUpdate(BaseModel):
    rules: list

@app.on_event("startup")
async def startup():
    await processor.start()

@app.on_event("shutdown")
async def shutdown():
    await processor.stop()

@app.get("/status")
async def get_status():
    return {"status": "running"}

@app.post("/scan")
async def trigger_scan(request: Request):
    data = await request.json()
    path = data.get("path")
    
    if not path or not Path(path).exists() or not Path(path).is_dir():
        return {"error": "Invalid directory path"}
        
    set_allowed_directories([
        path,
        "C:/Users/KIIT0001/Desktop/TidyFlow/Organized"
    ])
        
    queued_count = 0
    for file_data in scan_files(path):
        await processor.add_file(file_data["path"], path)
        queued_count += 1
        
    return {"message": f"Scan triggered for {path}. Queued {queued_count} files."}

@app.get("/files")
async def get_files(limit: int = 50, offset: int = 0):
    rows = await db.execute_read(
        "SELECT id, path, status, category FROM files LIMIT ? OFFSET ?",
        (limit, offset)
    )
    # turn the raw database rows into plain python dictionaries so fastapis json sender doesn't freak out
    return {"files": [dict(r) for r in rows]}

@app.get("/costs")
async def get_costs():
    rows = await db.execute_read(
        "SELECT date(timestamp) as day, sum(cost_usd) as total_cost FROM token_logs GROUP BY day ORDER BY day DESC"
    )
    return {"costs": [dict(r) for r in rows]}

@app.post("/rules")
async def update_rules(rules: RuleUpdate):
    rules_path = Path("rules.yaml")
    with open(rules_path, "w") as f:
        yaml.dump({"rules": rules.rules}, f)
    return {"message": "Rules updated successfully"}

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
