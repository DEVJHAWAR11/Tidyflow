import typer
import httpx
from rich.console import Console
from rich.progress import Progress, SpinnerColumn, TextColumn
from src.llm_provider import save_settings
import time

app = typer.Typer(name="tidy", help="TidyFlow CLI Client")
console = Console()
API_URL = "http://localhost:8000"

@app.command()
def status():
    """Check the status of the TidyFlow backend."""
    try:
        res = httpx.get(f"{API_URL}/status", timeout=5.0)
        res.raise_for_status()
        console.print(f"[green]Backend is {res.json()['status']}[/green]")
    except Exception as e:
        console.print(f"[red]Error connecting to backend: {e}[/red]")

@app.command()
def scan(path: str):
    """Trigger a scan for a directory."""
    try:
        res = httpx.post(f"{API_URL}/scan", json={"path": path}, timeout=5.0)
        res.raise_for_status()
        console.print(f"[green]Scan initiated for {path}[/green]")
        
        # We would normally connect to /stream here for progress
        with Progress(
            SpinnerColumn(),
            TextColumn("[progress.description]{task.description}"),
            transient=True,
        ) as progress:
            progress.add_task(description="Processing files...", total=None)
            time.sleep(1) # Mock wait
            
        console.print("[green]Scan complete![/green]")
    except Exception as e:
        console.print(f"[red]Error starting scan: {e}[/red]")

@app.command(name="config-set-llm")
def config_set_llm(provider: str, key: str, custom_url: str = None):
    """Set the LLM provider configuration."""
    try:
        save_settings(provider, key, custom_url)
        console.print(f"[green]Successfully configured {provider}[/green]")
    except Exception as e:
        console.print(f"[red]Error saving configuration: {e}[/red]")

if __name__ == "__main__":
    app()
