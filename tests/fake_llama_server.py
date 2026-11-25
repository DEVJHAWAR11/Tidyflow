#!/usr/bin/env python3
"""A stand-in for llama-server in tests: same flags, /health and /v1/embeddings, no model.

Each word of the input adds to a few fixed dimensions picked from its hash, so texts that share
words get similar vectors. FAKE_LLAMA_FAIL=start makes it exit at once; FAKE_LLAMA_MAX_CHARS
makes longer inputs fail the way the real server does when an input is over the batch size.
"""

import hashlib
import json
import math
import os
import re
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

DIMS = 768


def arg(name, default=None):
    if name in sys.argv:
        return sys.argv[sys.argv.index(name) + 1]
    return default


def vector(text):
    v = [0.0] * DIMS
    for word in re.findall(r"\w+", text.lower()):
        if word in {"task", "search", "result", "query", "title", "none", "text"}:
            continue
        h = hashlib.sha256(word.encode()).digest()
        for i in range(4):
            v[int.from_bytes(h[i * 2:i * 2 + 2], "big") % DIMS] += 1.0
    v[0] += 0.05  # never all zero
    n = math.sqrt(sum(x * x for x in v))
    return [x / n for x in v]


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, code, body):
        data = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _authorized(self):
        key = arg("--api-key")
        if arg("--api-key-file"):
            with open(arg("--api-key-file")) as f:
                key = f.read().strip()
        return self.headers.get("Authorization") == f"Bearer {key}"

    def do_GET(self):
        if self.path == "/health":
            return self._send(200, {"status": "ok"})
        self._send(404, {})

    def do_POST(self):
        if not self._authorized():
            return self._send(401, {"error": {"message": "Invalid API Key"}})
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        inputs = body["input"] if isinstance(body["input"], list) else [body["input"]]
        limit = int(os.environ.get("FAKE_LLAMA_MAX_CHARS", "0") or 0)
        if limit and any(len(t) > limit for t in inputs):
            return self._send(500, {"error": {"message": "input (9999 tokens) is too large to process."}})
        self._send(200, {"data": [{"index": i, "embedding": vector(t)} for i, t in enumerate(inputs)]})


if __name__ == "__main__":
    if os.environ.get("FAKE_LLAMA_FAIL") == "start":
        sys.exit(3)
    assert "--embeddings" in sys.argv and arg("--host") == "127.0.0.1"
    ThreadingHTTPServer(("127.0.0.1", int(arg("--port"))), Handler).serve_forever()
