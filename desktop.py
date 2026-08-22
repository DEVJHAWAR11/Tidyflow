"""
TidyFlow Desktop Application Entrypoint.

Launches the unified FastAPI backend server in a background thread
and displays the React frontend in a native desktop window via pywebview.
"""

from __future__ import annotations

import argparse
import io
import logging
import multiprocessing
import os
import socket
import sys
import threading
import time
import webbrowser
from typing import Optional

# PyInstaller GUI safety on Windows: sys.stdout and sys.stderr are None when console=False
if sys.stdout is None:
    sys.stdout = io.StringIO()
elif hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

if sys.stderr is None:
    sys.stderr = io.StringIO()
elif hasattr(sys.stderr, "reconfigure"):
    try:
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

import httpx
import uvicorn
import src.api  # Direct import to assist PyInstaller dependency tracing

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("tidyflow.desktop")


def find_available_port(start_port: int = 8000, max_attempts: int = 50) -> int:
    """Find an open TCP port starting from start_port."""
    for port in range(start_port, start_port + max_attempts):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind(("127.0.0.1", port))
                return port
            except OSError:
                continue
    return start_port


class ServerThread(threading.Thread):
    """Background thread running uvicorn server."""

    def __init__(self, host: str, port: int):
        super().__init__(daemon=True)
        self.host = host
        self.port = port
        self.server: Optional[uvicorn.Server] = None
        self._stopped = threading.Event()
        self.loop: Optional[asyncio.AbstractEventLoop] = None

    def run(self):
        import asyncio
        self.loop = asyncio.new_event_loop()
        asyncio.set_event_loop(self.loop)

        from src.api import app

        config = uvicorn.Config(
            app=app,
            host=self.host,
            port=self.port,
            log_level="warning",
            access_log=False,
            loop="asyncio",
        )
        self.server = uvicorn.Server(config=config)
        try:
            self.loop.run_until_complete(self.server.serve())
        except Exception as e:
            logger.error("Server error: %s", e)
        finally:
            self._stopped.set()

    def stop(self):
        if self.server:
            self.server.should_exit = True
            self._stopped.wait(timeout=3.0)


def wait_for_server(url: str, timeout: float = 10.0) -> bool:
    """Poll the backend server until it responds or timeout is reached."""
    start = time.time()
    while time.time() - start < timeout:
        try:
            resp = httpx.get(url, timeout=1.0)
            if resp.status_code in (200, 404):
                return True
        except Exception:
            pass
        time.sleep(0.15)
    return False


def main():
    multiprocessing.freeze_support()

    parser = argparse.ArgumentParser(description="TidyFlow Universal AI File Organizer - Desktop")
    parser.add_argument("--host", default="127.0.0.1", help="Server host (default: 127.0.0.1)")
    parser.add_argument("--port", type=int, default=8000, help="Port (default: 8000, or auto-selected)")
    parser.add_argument("--debug", action="store_true", help="Enable webview developer tools")
    parser.add_argument("--no-gui", action="store_true", help="Run without pywebview (open in browser instead)")
    args = parser.parse_args()

    port = find_available_port(args.port)
    host = args.host
    url = f"http://{host}:{port}"

    logger.info("Starting TidyFlow backend server on %s...", url)
    server_thread = ServerThread(host=host, port=port)
    server_thread.start()

    if not wait_for_server(url, timeout=10.0):
        logger.warning("Server took longer than expected to respond, continuing launch...")

    # Launch GUI
    if not args.no_gui:
        try:
            import webview

            logger.info("Opening TidyFlow desktop window...")
            webview.create_window(
                title="TidyFlow",
                url=url,
                width=1280,
                height=840,
                min_size=(960, 640),
                text_select=True,
            )

            # Start GUI loop (blocks until window is closed)
            gui_engine = "edgechromium" if sys.platform == "win32" else None
            try:
                webview.start(debug=args.debug, gui=gui_engine, private_mode=False)
            except Exception as gui_err:
                logger.warning("Could not start with %s GUI engine: %s. Retrying with default...", gui_engine, gui_err)
                webview.start(debug=args.debug)
        except ImportError:
            logger.warning("pywebview is not installed. Falling back to default web browser.")
            webbrowser.open(url)
            try:
                while True:
                    time.sleep(1)
            except KeyboardInterrupt:
                pass
        except Exception as e:
            logger.error("Failed to launch pywebview window: %s. Opening browser fallback.", e)
            webbrowser.open(url)
            try:
                while True:
                    time.sleep(1)
            except KeyboardInterrupt:
                pass
    else:
        logger.info("Opening browser at %s", url)
        webbrowser.open(url)
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            pass

    logger.info("Shutting down TidyFlow...")
    server_thread.stop()
    sys.exit(0)


if __name__ == "__main__":
    main()

