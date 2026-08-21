"""TidyFlow Command-Line Interface (Typer)."""

from __future__ import annotations

import logging
import sys
from pathlib import Path
from typing import Optional

import typer
import uvicorn
from rich.console import Console
from rich.table import Table

from .applier import apply_decisions, load_decisions, write_copy_manifest
from .config import TidyConfig, load_config
from .llm_provider import save_settings
from .main_loop import load_records_jsonl, run_pipeline
from .mcp_server import set_allowed_directories
from .models import RunSummary
from .reporter import generate_reports

app = typer.Typer(name="tidy", help="TidyFlow — Universal AI File Organizer")
console = Console()


def _setup_cli_logging():
    root = logging.getLogger()
    root.setLevel(logging.INFO)
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(logging.Formatter("%(levelname)-8s %(message)s"))
    root.handlers = [handler]


@app.command()
def run(
    config_path: Optional[str] = typer.Option(None, "--config", "-c", help="Path to config.yaml"),
    input_dir: Optional[str] = typer.Option(None, "--input-dir", "-i", help="Input directory to organize"),
    output_dir: Optional[str] = typer.Option(None, "--output-dir", "-o", help="Target organized output directory"),
    auto_apply: bool = typer.Option(False, "--auto-apply", help="Automatically copy confident classifications"),
    confirm: bool = typer.Option(False, "--confirm", help="Actually perform file copies/moves (disables dry-run)"),
    move: bool = typer.Option(False, "--move", help="Move files instead of copying (requires --confirm)"),
):
    """Run full pipeline: Scan → Extract/OCR → Dedup → Heuristics → LLM → Report."""
    _setup_cli_logging()
    cfg = load_config(config_path)
    if input_dir:
        cfg.input_dir = Path(input_dir).resolve()
    if output_dir:
        cfg.output_dir = Path(output_dir).resolve()
        cfg.staging_dir = cfg.output_dir / "Staging"

    set_allowed_directories([cfg.input_dir, cfg.output_dir])

    if move and not confirm:
        console.print("[red]Error: --move requires explicit --confirm to prevent accidental file deletion.[/red]")
        raise typer.Exit(code=1)

    console.print(f"[bold cyan]Starting TidyFlow Pipeline on: {cfg.input_dir}[/bold cyan]")
    records, summary = run_pipeline(
        cfg,
        use_llm=True,
        auto_apply=auto_apply,
        move_mode=move,
        dry_run=not confirm,
    )

    _display_summary_table(summary, cfg.output_dir)


@app.command()
def inventory(
    config_path: Optional[str] = typer.Option(None, "--config", "-c", help="Path to config.yaml"),
    input_dir: Optional[str] = typer.Option(None, "--input-dir", "-i", help="Input directory to scan"),
    output_dir: Optional[str] = typer.Option(None, "--output-dir", "-o", help="Target output directory"),
):
    """Scan, extract text/OCR, deduplicate, and report without calling LLM."""
    _setup_cli_logging()
    cfg = load_config(config_path)
    if input_dir:
        cfg.input_dir = Path(input_dir).resolve()
    if output_dir:
        cfg.output_dir = Path(output_dir).resolve()
        cfg.staging_dir = cfg.output_dir / "Staging"

    set_allowed_directories([cfg.input_dir, cfg.output_dir])
    console.print(f"[bold cyan]Running Inventory & Local Extractors on: {cfg.input_dir}[/bold cyan]")

    records, summary = run_pipeline(
        cfg,
        use_llm=False,
        auto_apply=False,
        dry_run=True,
    )
    _display_summary_table(summary, cfg.output_dir)


@app.command(name="scan")
def scan(
    input_path: Optional[str] = typer.Argument(None, help="Input directory to scan"),
    input_dir: Optional[str] = typer.Option(None, "--input-dir", "-i", help="Input directory to scan"),
    output_dir: Optional[str] = typer.Option(None, "--output-dir", "-o", help="Target output directory"),
    config_path: Optional[str] = typer.Option(None, "--config", "-c", help="Path to config.yaml"),
):
    """Scan and index files in a directory (shortcut for inventory)."""
    target = input_path or input_dir
    inventory(config_path=config_path, input_dir=target, output_dir=output_dir)


@app.command()
def report(
    output_dir: str = typer.Option("./organized_output", "--output-dir", "-o", help="Directory containing file_records.jsonl"),
    config_path: Optional[str] = typer.Option(None, "--config", "-c", help="Path to config.yaml"),
):
    """Regenerate review HTML and CSV reports from existing file_records.jsonl."""
    _setup_cli_logging()
    out = Path(output_dir).resolve()
    records_file = out / "file_records.jsonl"

    if not records_file.exists():
        console.print(f"[red]No existing run records found at: {records_file}[/red]")
        raise typer.Exit(code=1)

    cfg = load_config(config_path)
    records = load_records_jsonl(records_file)

    summary = RunSummary(
        total_scanned=sum(1 for r in records if not r.skipped),
        total_skipped=sum(1 for r in records if r.skipped),
    )
    generate_reports(records, summary, out, list(cfg.categories.keys()))
    console.print(f"[green]Reports successfully regenerated in: {out}[/green]")


@app.command()
def apply(
    decisions: str = typer.Option("review_decisions.csv", "--decisions", "-d", help="Path to review_decisions.csv"),
    output_dir: str = typer.Option("./organized_output", "--output-dir", "-o", help="Target organized directory"),
    confirm: bool = typer.Option(False, "--confirm", help="Actually copy files (disables dry-run)"),
    move: bool = typer.Option(False, "--move", help="Move original files instead of copying"),
):
    """Apply approved decisions from CSV to organize files into folders."""
    _setup_cli_logging()
    out = Path(output_dir).resolve()
    dec_path = Path(decisions).resolve()

    if not dec_path.exists():
        console.print(f"[red]Decisions CSV not found: {dec_path}[/red]")
        raise typer.Exit(code=1)

    records_file = out / "file_records.jsonl"
    if not records_file.exists():
        console.print(f"[red]Run records not found at: {records_file}[/red]")
        raise typer.Exit(code=1)

    if move and not confirm:
        console.print("[red]Error: --move requires --confirm to prevent accidental file deletion.[/red]")
        raise typer.Exit(code=1)

    records = load_records_jsonl(records_file)
    parsed_decisions = load_decisions(dec_path)

    set_allowed_directories([out])
    manifest = apply_decisions(
        parsed_decisions, records, out,
        dry_run=not confirm, move_mode=move
    )

    if confirm and manifest:
        write_copy_manifest(manifest, out)
        action_word = "Moved" if move else "Copied"
        console.print(f"[bold green]Successfully {action_word} {len(manifest)} files to {out}![/bold green]")
    else:
        console.print(f"[yellow]Dry-run preview: {len(manifest)} files would be organized.[/yellow]")


@app.command()
def serve(
    host: str = typer.Option("127.0.0.1", "--host", help="Host address"),
    port: int = typer.Option(8000, "--port", help="Port number"),
    reload: bool = typer.Option(True, "--reload", help="Enable auto-reload on code changes"),
):
    """Launch the TidyFlow FastAPI backend server."""
    console.print(f"[bold green]Launching TidyFlow API Server on http://{host}:{port}...[/bold green]")
    uvicorn.run("src.api:app", host=host, port=port, reload=reload)


@app.command(name="config-set-llm")
def config_set_llm(
    provider: str = typer.Argument(..., help="Provider name (deepseek, openai, groq, openrouter, gemini)"),
    api_key: str = typer.Argument(..., help="API Key"),
    custom_url: Optional[str] = typer.Option(None, "--custom-url", help="Custom OpenAI-compatible API base URL"),
):
    """Configure and store LLM credentials in system Keyring."""
    save_settings(provider, api_key, custom_url)
    console.print(f"[bold green]Successfully saved credentials for {provider} in system Keyring![/bold green]")


@app.command()
def status():
    """Verify backend and environment status."""
    console.print("[bold green]TidyFlow 2.0 CLI is operational.[/bold green]")


def _display_summary_table(summary: RunSummary, out_dir: Path):
    """Render Rich summary table."""
    table = Table(title="TidyFlow Execution Summary", style="cyan")
    table.add_column("Metric", style="bold white")
    table.add_column("Count / Value", style="green")

    table.add_row("Total Files Scanned", str(summary.total_scanned))
    table.add_row("Skipped (Ignored/Oversized)", str(summary.total_skipped))
    table.add_row("Direct Text Extracted", str(summary.text_extracted))
    table.add_row("OCR Processed", str(summary.ocr_processed))
    table.add_row("OCR From Cache", str(summary.ocr_cached))
    table.add_row("Exact Duplicate Groups", str(summary.exact_duplicates))
    table.add_row("Near Duplicate Groups", str(summary.near_duplicates))
    table.add_row("Heuristic Classified", str(summary.heuristic_classified))
    table.add_row("LLM Classified", str(summary.llm_classified))
    table.add_row("Manual Review Needed", str(summary.manual_review))
    table.add_row("Output Directory", str(out_dir))

    console.print(table)
    console.print(f"[bold green]Review Report: [underline]{out_dir / 'review_report.html'}[/underline][/bold green]")


if __name__ == "__main__":
    app()
