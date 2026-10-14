"""Compare generative LLM classifiers against OpenRouter decision models.

Workflow:
1. `python scripts/compare_decision_models.py init [--config PATH] [--force]`
   Extracts taxonomy to data/eval/categories.json and creates data/eval/labels.csv
   with file metadata from data/file_records.jsonl.
2. Hand-label files in labels.csv: fill `expected` with a category, Unknown, or "A|B" when either is right.
3. `python scripts/compare_decision_models.py run [--models A,B] [--baseline C] ...`
   Evaluates models against hand-labelled ground truth.
4. Per-file results and markdown comparison reports are saved to data/eval/.
"""

from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import csv
from datetime import datetime, timezone
import json
import os
import random
import re
from pathlib import Path
import statistics
import sys
import time
from typing import Any

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src.config import CategoryConfig, _get_default_category_definitions, load_config
from src.llm_provider import (
    _SYSTEM_PROMPT_STANDARD,
    _SYSTEM_PROMPT_STRICT,
    _make_payload,
    get_stored_api_key,
    _resolve_category,
    _strip_markdown_fences,
)
from src.models import FileRecord

RECORDS = Path("data/file_records.jsonl")
EVAL_DIR = Path("data/eval")
LABELS = Path("data/eval/labels.csv")
CATEGORIES = Path("data/eval/categories.json")
KEY_FILE = Path("data/eval/.openrouter_key")

# The app's redact_secrets() misses credential exports such as a browser's passwords.csv, and
# this script fans each file out to many providers, so such files are judged by name only.
# A "deepseek:" baseline goes to DeepSeek's own API with the app's stored key, exactly as the app
# calls it. That API reports no cost, so it is estimated from tokens at OpenRouter's listed
# price for deepseek-v4.1-flash (USD per token, input / output).
DEEPSEEK_URL = "https://api.deepseek.com/v1/chat/completions"
DEEPSEEK_PRICE = (0.02088e-6, 0.891e-6)

# Providers that only accept a {"text": ...} state rather than arbitrary JSON fields.
_TEXT_STATE_PREFIXES = ("scaledown/",)

_SENSITIVE = re.compile(r"password|passwd|credential|secret|api[_ -]?key|token|private key", re.I)


def _payload(rec: FileRecord) -> Any:
    """App payload minus keyword_scores, with text dropped for credential-looking files."""
    # keyword_scores were computed against whatever taxonomy existed at scan time, which may
    # not be the one being evaluated, so both sides see only filename, type and text.
    payload = _make_payload(rec).model_copy(update={"keyword_scores": {}})
    if _SENSITIVE.search(rec.filename) or _SENSITIVE.search(rec.extracted_text_normalized or ""):
        payload = payload.model_copy(update={"extracted_text": ""})
    return payload


def _get_api_key() -> str:
    """Retrieve OpenRouter API key from env or key file. Never prints the key."""
    key = os.getenv("OPENROUTER_API_KEY", "").strip()
    if not key and KEY_FILE.exists():
        try:
            key = KEY_FILE.read_text(encoding="utf-8").strip()
        except OSError:
            pass
    if not key:
        sys.exit(f"Error: OpenRouter API key not found. Set OPENROUTER_API_KEY or write to {KEY_FILE}.")
    return key


def _post_with_retry(client: httpx.Client, url: str, api_key: str, body: dict[str, Any]) -> tuple[dict[str, Any] | None, float, str]:
    """Execute HTTP POST with 3 retries and exponential backoff (2, 4, 8s)."""
    t0, err = time.perf_counter(), ""
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    for attempt in range(3):
        try:
            resp = client.post(url, headers=headers, json=body, timeout=180.0)
            if resp.status_code == 429 or resp.status_code >= 500:
                err = f"HTTP {resp.status_code}: {resp.text[:200]}"
                if attempt < 2:
                    # Free models allow 20 requests a minute, so a 429 needs a long pause.
                    time.sleep([20, 60][attempt] if resp.status_code == 429 else [2, 4][attempt])
                    continue
                break
            if resp.status_code != 200:
                err = f"HTTP {resp.status_code}: {resp.text[:200]}"
                break
            return resp.json(), time.perf_counter() - t0, ""
        except Exception as exc:
            err = str(exc)[:200]
            if attempt < 2:
                time.sleep([2, 4, 8][attempt])
                continue
            break
    return None, time.perf_counter() - t0, err


def _correct(row: dict[str, Any]) -> bool:
    """`expected` may list several acceptable categories separated by "|"."""
    return row["predicted"] in row["expected"].split("|")


def _metrics(rows: list[dict[str, Any]], threshold: float) -> dict[str, Any]:
    """Calculate classification performance and calibration metrics (pure function)."""
    n = len(rows)
    if n == 0:
        return {"n": 0, "errors": 0, "accuracy": 0.0, "coverage": 0.0, "auto_precision": None,
                "auto_copy_count": 0, "auto_copy_wrong": 0, "ece": 0.0, "p50_latency": 0.0, "total_cost": None, "cost_per_1k": None}
    errors = sum(1 for r in rows if r.get("error"))
    accuracy = sum(1 for r in rows if _correct(r)) / n
    auto = [r for r in rows if r["predicted"] != "Unknown" and r["confidence"] >= threshold]
    auto_correct = sum(1 for r in auto if _correct(r))
    cov = len(auto) / n
    bins: list[list[dict[str, Any]]] = [[] for _ in range(10)]
    for r in rows:
        bins[min(int(max(0.0, min(1.0, float(r.get("confidence", 0.0)))) * 10), 9)].append(r)
    ece = sum(
        (len(b) / n) * abs((sum(1 for r in b if _correct(r)) / len(b)) - (sum(float(r.get("confidence", 0.0)) for r in b) / len(b)))
        for b in bins if b
    )
    latencies = [r["latency_s"] for r in rows if r.get("latency_s") is not None]
    costs = [float(r["cost"]) for r in rows if r.get("cost") is not None]
    total_cost = sum(costs) if costs else None
    return {
        "n": n, "errors": errors, "accuracy": accuracy, "coverage": cov,
        "auto_precision": (auto_correct / len(auto)) if auto else None,
        "auto_copy_count": len(auto), "auto_copy_wrong": len(auto) - auto_correct,
        "ece": ece, "p50_latency": statistics.median(latencies) if latencies else 0.0,
        "total_cost": total_cost,
        "cost_per_1k": (total_cost / len(costs) * 1000.0) if (total_cost is not None and costs) else None,
    }


def _cmd_init(args: argparse.Namespace) -> None:
    """Initialize evaluation data directory, categories taxonomy, and labels CSV."""
    if LABELS.exists() and not args.force:
        sys.exit(f"Labels file already exists at {LABELS}. Use --force to overwrite.")
    if not RECORDS.exists():
        sys.exit(f"Records file not found: {RECORDS}")

    raw_cats = load_config(args.config).categories if args.config else _get_default_category_definitions()
    taxonomy = {
        name: {
            "description": (cat.description if isinstance(cat, CategoryConfig) else cat.get("description", "")) or "",
            "keywords": list(cat.keywords if isinstance(cat, CategoryConfig) else cat.get("keywords", []))[:8],
        }
        for name, cat in raw_cats.items() if name != "Unknown"
    }
    EVAL_DIR.mkdir(parents=True, exist_ok=True)
    CATEGORIES.write_text(json.dumps(taxonomy, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    rows = []
    with open(RECORDS, "r", encoding="utf-8") as f:
        for line in f:
            if not line.strip():
                continue
            try:
                rec = FileRecord.model_validate_json(line)
            except Exception:
                continue
            if not rec.skipped:
                snip = " ".join((rec.extracted_text_normalized or "").split())[:120]
                prev = rec.classification.category if rec.classification and rec.classification.category else ""
                rows.append({"file_id": rec.file_id, "filename": rec.filename, "text_snippet": snip, "previous_guess": prev, "expected": ""})

    with open(LABELS, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["file_id", "filename", "text_snippet", "previous_guess", "expected"])
        w.writeheader()
        w.writerows(rows)

    allowed = sorted(list(taxonomy.keys()) + ["Unknown"])
    print(f"Initialized {len(rows)} rows at {LABELS}\nTaxonomy saved to {CATEGORIES}")
    print(f"Allowed category names (+ Unknown):\n  {', '.join(allowed)}")
    print(f"Instruction: Fill 'expected' in {LABELS} with one of those names (or A|B when either is right); rows left blank are skipped.")


def _eval_baseline(
    client: httpx.Client, api_key: str, baseline: str, eval_items: list[tuple[FileRecord, str]],
    payload_map: dict[str, Any], categories: dict[str, dict[str, Any]], threshold: float, strict: bool,
) -> list[dict[str, Any]]:
    """Run a generative baseline in batches of 15, like the app does."""
    direct = baseline.startswith("deepseek:")
    model = baseline.removeprefix("deepseek:")
    if direct:
        api_key = get_stored_api_key("deepseek")
        if not api_key:
            sys.exit("No DeepSeek API key stored in the app settings.")
    prompt_tpl = _SYSTEM_PROMPT_STRICT if strict else _SYSTEM_PROMPT_STANDARD
    cats_ctx = json.dumps({c: {"description": i["description"], "keywords": i["keywords"][:8]} for c, i in categories.items()}, indent=2)
    sys_prompt = prompt_tpl.format(categories_list=", ".join(sorted(categories.keys())), categories_context=cats_ctx, custom_instructions="", threshold=threshold)
    cat_cfgs = {k: CategoryConfig(description=v["description"], keywords=v["keywords"]) for k, v in categories.items()}
    batches, results, prev_m = [eval_items[i : i + 15] for i in range(0, len(eval_items), 15)], [], 0

    for batch in batches:
        body = {
            "model": model, "messages": [{"role": "system", "content": sys_prompt}, {"role": "user", "content": json.dumps([payload_map[r.file_id].model_dump() for r, _ in batch], default=str)}],
            "temperature": 0.1, "max_tokens": 1500, "response_format": {"type": "json_object"},
        }
        if not direct:
            # The app's prompt expects a direct JSON answer; thinking would eat the 1500-token budget.
            body |= {"usage": {"include": True}, "reasoning": {"enabled": False}}
        url = DEEPSEEK_URL if direct else "https://openrouter.ai/api/v1/chat/completions"
        data, wall_time, err = _post_with_retry(client, url, api_key, body)
        lat = wall_time / len(batch)
        usage = (data or {}).get("usage")
        cost = None
        if isinstance(usage, dict) and usage.get("cost") is not None:
            cost = float(usage["cost"]) / len(batch)
        elif direct and isinstance(usage, dict):
            cost = (usage.get("prompt_tokens", 0) * DEEPSEEK_PRICE[0] + usage.get("completion_tokens", 0) * DEEPSEEK_PRICE[1]) / len(batch)

        parsed_items: dict[str, dict[str, Any]] = {}
        if data:
            try:
                choice = data["choices"][0]
                content = choice["message"].get("content")
                if not content:
                    # Reasoning models can spend the whole token budget thinking and return nothing.
                    raise ValueError(f"empty content (finish_reason={choice.get('finish_reason')})")
                p = json.loads(_strip_markdown_fences(content))
                parsed_items = {it["file_id"]: it for it in (p.get("results", []) if isinstance(p, dict) else (p if isinstance(p, list) else [])) if isinstance(it, dict) and "file_id" in it}
            except Exception as exc:
                err = f"JSON parse error: {exc}"

        for rec, exp in batch:
            hit = rec.file_id in parsed_items
            it = parsed_items.get(rec.file_id, {})
            pred = _resolve_category(str(it.get("category", "")), cat_cfgs) if hit else "Unknown"
            conf = float(it.get("confidence", 0.0)) if hit else 0.0
            results.append({
                "file_id": rec.file_id, "filename": rec.filename, "expected": exp, "predicted": pred,
                "confidence": max(0.0, min(1.0, conf / 100.0 if conf > 1.0 else conf)),
                "probabilities": None, "margin": None, "latency_s": lat, "cost": cost, "error": None if hit else (err or "missing"),
            })

        if len(results) // 10 > prev_m or len(results) == len(eval_items):
            prev_m = len(results) // 10
            print(f"[{baseline}] {len(results)}/{len(eval_items)}")
    return results


def _eval_single_decision(
    client: httpx.Client, api_key: str, model: str, rec: FileRecord, payload: Any, expected: str, questions: dict[str, Any],
) -> dict[str, Any]:
    """Execute a single decision model API request with backoff."""
    state: Any = {"filename": rec.filename, "extension": rec.extension, "kind": payload.file_category,
                  "size_bytes": rec.file_size_bytes, "extracted_text": payload.extracted_text}
    if model.startswith(_TEXT_STATE_PREFIXES):
        state = {"text": "\n".join(f"{k}: {v}" for k, v in state.items())}
    body = {"model": model, "questions": questions, "state": state}
    data, lat, err = _post_with_retry(client, "https://openrouter.ai/api/alpha/decisions", api_key, body)
    if not data:
        return {"file_id": rec.file_id, "filename": rec.filename, "expected": expected, "predicted": "Unknown", "confidence": 0.0, "probabilities": None, "margin": None, "latency_s": lat, "cost": None, "error": err or "request failed"}

    usage = data.get("usage")
    cost = float(usage["cost"]) if isinstance(usage, dict) and usage.get("cost") is not None else None
    ans = data.get("answers", {}).get("category", {})
    choice, probs = ans.get("choice", "Unknown"), ans.get("probabilities")
    conf = float(probs[choice]) if (probs and isinstance(probs, dict) and choice in probs) else float(ans.get("confidence") or 0.0)
    sp = sorted([float(v) for v in probs.values()], reverse=True) if (probs and isinstance(probs, dict)) else []
    margin = (sp[0] - sp[1]) if len(sp) >= 2 else (1.0 if len(sp) == 1 else None)

    return {"file_id": rec.file_id, "filename": rec.filename, "expected": expected, "predicted": choice,
            "confidence": max(0.0, min(1.0, conf / 100.0 if conf > 1.0 else conf)), "probabilities": probs, "margin": margin, "latency_s": lat, "cost": cost, "error": None}


def _eval_decision_model(
    client: httpx.Client, api_key: str, model: str, eval_items: list[tuple[FileRecord, str]],
    payload_map: dict[str, Any], questions: dict[str, Any], concurrency: int,
) -> list[dict[str, Any]]:
    """Run decision model concurrently across files."""
    total, results = len(eval_items), [None] * len(eval_items)
    with ThreadPoolExecutor(max_workers=concurrency) as executor:
        f_map = {executor.submit(_eval_single_decision, client, api_key, model, r, payload_map[r.file_id], exp, questions): i for i, (r, exp) in enumerate(eval_items)}
        for count, f in enumerate(as_completed(f_map), start=1):
            i = f_map[f]
            try:
                results[i] = f.result()
            except Exception as exc:
                r, exp = eval_items[i]
                results[i] = {"file_id": r.file_id, "filename": r.filename, "expected": exp, "predicted": "Unknown", "confidence": 0.0, "probabilities": None, "margin": None, "latency_s": 0.0, "cost": None, "error": str(exc)[:200]}
            if count % 10 == 0 or count == total:
                print(f"[{model}] {count}/{total}")
    return [r for r in results if r is not None]


def _build_report(
    eval_items: list[tuple[FileRecord, str]], model_results: dict[str, list[dict[str, Any]]],
    threshold: float, strict: bool, categories: dict[str, dict[str, Any]],
) -> str:
    """Generate Markdown report comparing models and summarizing disagreements."""
    summaries = sorted(
        [(m, _metrics(rows, threshold)) for m, rows in model_results.items()],
        key=lambda it: (it[1]["auto_precision"] if it[1]["auto_precision"] is not None else -1.0, it[1]["accuracy"]),
        reverse=True,
    )
    lines = [
        "# Model Evaluation Report", "",
        f"- **Date**: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')}",
        f"- **Labelled files**: {len(eval_items)}",
        f"- **Auto-copy threshold**: {threshold:.2f}",
        f"- **Strict mode**: {strict}",
        f"- **Taxonomy**: {', '.join(sorted(categories.keys()))}", "",
        "| model | acc | auto-copy coverage | auto-copy precision | ECE | p50 latency | cost/1k files | errors |",
        "| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |",
    ]
    for m, s in summaries:
        prec = f"{s['auto_precision'] * 100:.1f}%" if s["auto_precision"] is not None else "N/A"
        cost = f"${s['cost_per_1k']:.4f}" if s["cost_per_1k"] is not None else "N/A"
        lines.append(f"| {m} | {s['accuracy'] * 100:.1f}% | {s['coverage'] * 100:.1f}% | {prec} | {s['ece']:.3f} | {s['p50_latency']:.2f}s | {cost} | {s['errors']} |")

    lines.extend(["", "### Auto-Copy Analysis (Files filed automatically without review)"])
    for m, s in summaries:
        lines.append(f"- **{m}**: {s['auto_copy_wrong']} wrong out of {s['auto_copy_count']} auto-copied files (silently misfiled)")

    lines.extend(["", "## Disagreements"])
    f_map = {(m, r["file_id"]): r for m, rows in model_results.items() for r in rows}
    disagreements = []
    for rec, exp in eval_items:
        wrong = [f"{m}: {f_map[(m, rec.file_id)]['predicted']} ({f_map[(m, rec.file_id)]['confidence']:.2f})"
                 for m in model_results if (m, rec.file_id) in f_map and not _correct(f_map[(m, rec.file_id)])]
        if wrong:
            disagreements.append(f"{rec.filename} — expected {exp} — {', '.join(wrong)}")
        if len(disagreements) >= 40:
            break
    lines.extend([f"- {d}" for d in disagreements] if disagreements else ["- None (all models matched expected labels)"])
    return "\n".join(lines) + "\n"


def _cmd_run(args: argparse.Namespace) -> None:
    """Run model evaluation against ground-truth labels."""
    if not CATEGORIES.exists() or not LABELS.exists():
        sys.exit(f"Missing {CATEGORIES} or {LABELS}. Run 'init' subcommand first.")

    categories: dict[str, dict[str, Any]] = json.loads(CATEGORIES.read_text(encoding="utf-8"))
    allowed = set(categories.keys()) | {"Unknown"}
    labelled, bad = [], []
    with open(LABELS, "r", encoding="utf-8") as f:
        for idx, row in enumerate(csv.DictReader(f), start=2):
            exp = (row.get("expected") or "").strip()
            if not exp:
                continue
            if set(exp.split("|")) <= allowed:
                labelled.append(row)
            else:
                bad.append(f"Line {idx} ({row.get('filename')}): invalid '{exp}'")

    if bad:
        sys.exit("Validation error: Invalid expected categories in labels.csv:\n" + "\n".join(bad))
    if not labelled:
        sys.exit("No labelled rows with non-empty 'expected' found in labels.csv.")

    records_map: dict[str, FileRecord] = {}
    if not RECORDS.exists():
        sys.exit(f"Records file {RECORDS} not found.")
    with open(RECORDS, "r", encoding="utf-8") as f:
        for line in f:
            if line.strip():
                try:
                    rec = FileRecord.model_validate_json(line)
                except Exception:
                    continue
                records_map[rec.file_id] = rec

    eval_items = []
    for r in labelled:
        if r["file_id"] not in records_map:
            print(f"Warning: file_id {r['file_id']} ({r.get('filename')}) missing from {RECORDS}; skipping.")
        else:
            eval_items.append((records_map[r["file_id"]], r["expected"].strip()))

    if args.limit and 0 < args.limit < len(eval_items):
        # A fixed-seed random sample, so runs are comparable and no single folder dominates.
        eval_items = random.Random(args.seed).sample(eval_items, args.limit)
    if not eval_items:
        sys.exit("No valid evaluation records found.")

    api_key = _get_api_key()
    if args.models:
        decision_models = [m.strip() for m in args.models.split(",") if m.strip()]
    else:
        try:
            resp = httpx.get("https://openrouter.ai/api/v1/models?output_modalities=decisions", headers={"Authorization": f"Bearer {api_key}"}, timeout=30.0)
            resp.raise_for_status()
            # Respan models judge chat transcripts and reject any other state shape.
            decision_models = [m["id"] for m in resp.json().get("data", []) if "id" in m and not m["id"].startswith("respan/")]
        except Exception as exc:
            sys.exit(f"Failed to query OpenRouter decision models: {exc}")

    baselines = [b.strip() for b in (args.baseline or "").split(",") if b.strip() and b.strip().lower() != "none"]
    if not decision_models and not baselines:
        sys.exit("No models to evaluate (no decision models found and baseline disabled).")

    print(f"Evaluating {len(eval_items)} file(s).")
    if baselines:
        print(f"Baseline models: {', '.join(baselines)}")
    print(f"Decision models ({len(decision_models)}):\n" + "\n".join(f"  - {m}" for m in decision_models))

    threshold = args.threshold if args.threshold is not None else getattr(load_config().classification, "auto_copy_threshold", 0.85)
    payload_map = {rec.file_id: _payload(rec) for rec, _ in eval_items}
    inst_suffix = (" Pick Unknown unless the file clearly and directly matches a folder's purpose." if args.strict
                   else " Pick the closest folder even if the fit is partial; pick Unknown only if the file is unreadable and its name gives no hint.")
    criteria = {n: i.get("description", "") + (f" Typical keywords: {', '.join(i.get('keywords', []))}" if i.get("keywords") else "") for n, i in categories.items()}
    criteria["Unknown"] = "Does not fit any of the other folders."
    questions = {"category": {"type": "choice", "instructions": "Which folder should this file be filed into? Judge by its filename, extension and extracted text." + inst_suffix, "criteria": criteria}}

    model_results: dict[str, list[dict[str, Any]]] = {}
    with httpx.Client(timeout=180.0) as client:
        for baseline in baselines:
            print(f"\n--- Running Baseline: {baseline} ---")
            model_results[baseline] = _eval_baseline(client, api_key, baseline, eval_items, payload_map, categories, threshold, args.strict)
        for d_model in decision_models:
            print(f"\n--- Running Decision Model: {d_model} ---")
            workers = 1 if d_model.endswith(":free") else args.concurrency
            model_results[d_model] = _eval_decision_model(client, api_key, d_model, eval_items, payload_map, questions, workers)

    ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    results_path, report_path = EVAL_DIR / f"results_{ts}.jsonl", EVAL_DIR / f"report_{ts}.md"
    with open(results_path, "w", encoding="utf-8") as f:
        for model_name, rows in model_results.items():
            for r in rows:
                f.write(json.dumps({"model": model_name, **r}, default=str, ensure_ascii=False) + "\n")

    report_content = _build_report(eval_items, model_results, threshold, args.strict, categories)
    report_path.write_text(report_content, encoding="utf-8")
    print("\n" + report_content)
    print(f"Results written to: {results_path}\nReport written to: {report_path}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Evaluate classification and decision models against ground truth.")
    sub = parser.add_subparsers(dest="subcommand", required=True)

    init_p = sub.add_parser("init", help="Initialize evaluation labels and categories")
    init_p.add_argument("--config", type=Path, default=None, help="Path to config.yaml")
    init_p.add_argument("--force", action="store_true", help="Overwrite existing labels.csv")

    run_p = sub.add_parser("run", help="Run evaluation against labelled files")
    run_p.add_argument("--models", type=str, default=None, help="Comma-separated decision models")
    run_p.add_argument("--baseline", type=str, default="deepseek:deepseek-chat",
                       help="Comma-separated generative models; 'deepseek:<model>' uses DeepSeek's own API, others go through OpenRouter; 'none' skips")
    run_p.add_argument("--threshold", type=float, default=None, help="Auto-copy threshold")
    run_p.add_argument("--limit", type=int, default=None, help="Evaluate a random sample of this many files")
    run_p.add_argument("--seed", type=int, default=0, help="Random seed for --limit sampling")
    run_p.add_argument("--concurrency", type=int, default=8, help="Concurrency for decision models")
    run_p.add_argument("--strict", action="store_true", help="Enable strict mode")

    args = parser.parse_args()
    try:
        {"init": _cmd_init, "run": _cmd_run}[args.subcommand](args)
    except KeyboardInterrupt:
        print("\nInterrupted by user. Exiting.", file=sys.stderr)
        sys.exit(130)


if __name__ == "__main__":
    main()
