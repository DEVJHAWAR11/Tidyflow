import asyncio
import yaml
from pathlib import Path
from fastapi import FastAPI, Request
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse
from src.database import DatabaseManager

app = FastAPI(title="TidyFlow API")
db = DatabaseManager()

class RuleUpdate(BaseModel):
    rules: list

@app.on_event("startup")
async def startup():
    await db.start()

@app.on_event("shutdown")
async def shutdown():
    await db.stop()

@app.get("/status")
async def get_status():
    return {"status": "running"}

@app.post("/scan")
async def trigger_scan(request: Request):
    data = await request.json()
    path = data.get("path")
    # this just pretends to scan for now, later it drops the folder into our queue
    return {"message": f"Scan triggered for {path}"}

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

async def event_generator():
    # this fakes a live stream of what the graph is doing for our ui
    for i in range(3):
        await asyncio.sleep(0.1)
        yield {"data": f"Processed file {i}"}

@app.get("/stream")
async def stream():
    return EventSourceResponse(event_generator())
