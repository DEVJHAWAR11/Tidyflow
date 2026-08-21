"""LangGraph workflow definition for single-item graph executions."""

from __future__ import annotations

from pathlib import Path
from typing import Optional, TypedDict

from langgraph.graph import END, StateGraph

from .extractor import extract_all_text
from .file_mover import FileMover
from .llm_provider import LLMProvider, load_settings
from .models import FileRecord
from .rules import RuleEngine
from .scanner import determine_file_category


class GraphState(TypedDict):
    file_path: str
    base_scan_dir: str
    size: int
    category: Optional[str]
    needs_review: bool
    extracted_text: str
    confidence: float
    error: Optional[str]
    retries: int


def scan_node(state: GraphState):
    return {
        "retries": 0,
        "needs_review": False,
        "category": None,
        "extracted_text": "",
        "confidence": 0.0,
        "error": None,
    }


def route_node(state: GraphState):
    file_path = state["file_path"]
    size = state.get("size", 0)

    if size > 50 * 1024 * 1024:
        return {"category": "Large_Files", "needs_review": False, "extracted_text": ""}

    engine = RuleEngine()
    category = engine.evaluate(file_path)
    return {"category": category}


def should_extract(state: GraphState):
    if state.get("category"):
        return "move"
    return "extract"


def extract_node(state: GraphState):
    path = Path(state["file_path"])
    dummy_rec = FileRecord(
        file_id="graph_test",
        abs_path=path.resolve(),
        rel_path=Path(path.name),
        filename=path.name,
        extension=path.suffix.lower(),
        file_size_bytes=state.get("size", 0),
        file_category=determine_file_category(path.suffix.lower()),
    )

    if path.exists():
        extract_all_text([dummy_rec])
        text = dummy_rec.extracted_text_raw or ""
        return {
            "extracted_text": text,
            "confidence": 1.0 if text else 0.0,
            "needs_review": not bool(text),
            "error": None if text else "No text extracted",
        }
    return {
        "extracted_text": "",
        "confidence": 0.0,
        "needs_review": True,
        "error": "File does not exist",
    }


def should_classify(state: GraphState):
    if state.get("needs_review") or not state.get("extracted_text"):
        return "needs_review"
    return "classify_llm"


async def classify_llm_node(state: GraphState):
    provider, api_key, custom_url = load_settings()
    if not api_key:
        return {"needs_review": True, "error": "No LLM API key configured"}

    llm = LLMProvider(provider, api_key, custom_url)
    try:
        res = await llm.classify(state["extracted_text"], is_test=False)
        conf = float(res.get("confidence", 0.0))
        return {
            "category": res.get("category", "Unknown"),
            "confidence": conf,
            "needs_review": conf < 70.0,
        }
    except Exception as e:
        return {"error": str(e), "retries": state.get("retries", 0) + 1}


def route_after_classify(state: GraphState):
    if state.get("error") and state.get("retries", 0) < 3 and not state.get("needs_review"):
        return "classify_llm"
    if state.get("needs_review") or state.get("error"):
        return "needs_review"
    return "move"


def needs_review_node(state: GraphState):
    return {"needs_review": True}


async def move_node(state: GraphState):
    if not state.get("category") or state.get("needs_review") or state.get("error"):
        return state

    mover = FileMover(db=None)
    target_path = mover.determine_target_path(
        base_target_dir=state.get("base_scan_dir", str(Path(state["file_path"]).parent)),
        category=state["category"],
        original_path=state["file_path"],
    )
    try:
        await mover.safe_copy(state["file_path"], target_path)
        return {"error": None}
    except Exception as e:
        return {"error": f"Copy failed: {e}", "needs_review": True}


def checkpoint_node(state: GraphState):
    return state


# Build graph
workflow = StateGraph(GraphState)

workflow.add_node("scan", scan_node)
workflow.add_node("route", route_node)
workflow.add_node("extract", extract_node)
workflow.add_node("classify_llm", classify_llm_node)
workflow.add_node("needs_review", needs_review_node)
workflow.add_node("move", move_node)
workflow.add_node("checkpoint", checkpoint_node)

workflow.set_entry_point("scan")
workflow.add_edge("scan", "route")
workflow.add_conditional_edges("route", should_extract, {"move": "move", "extract": "extract"})
workflow.add_conditional_edges("extract", should_classify, {"needs_review": "needs_review", "classify_llm": "classify_llm"})
workflow.add_conditional_edges("classify_llm", route_after_classify, {"classify_llm": "classify_llm", "needs_review": "needs_review", "move": "move"})
workflow.add_edge("needs_review", "checkpoint")
workflow.add_edge("move", "checkpoint")
workflow.add_edge("checkpoint", END)

app = workflow.compile()
