import asyncio
from typing import Set

clients: Set[asyncio.Queue] = set()

def broadcast(data: dict):
    for q in clients:
        q.put_nowait(data)
