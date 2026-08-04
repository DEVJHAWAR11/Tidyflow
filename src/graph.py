import operator
from typing import TypedDict, Annotated, Optional, Dict, Any, List
from langgraph.graph import StateGraph, END
from src.rules import RuleEngine
from src.extractor import extract_text_from_pdf, extract_text_from_image
from src.llm_provider import LLMProvider, load_settings

class GraphState(TypedDict):
    file_path: str
    size: int
    category: Optional[str]
    needs_review: bool
    extracted_text: str
    confidence: float
    error: Optional[str]
    retries: int

def scan_node(state: GraphState):
    # Initialize state
    return {"retries": 0, "needs_review": False, "category": None, "extracted_text": "", "confidence": 0.0, "error": None}

def route_node(state: GraphState):
    # Stage 4 rules
    file_path = state["file_path"]
    size = state.get("size", 0)
    
    if size > 50 * 1024 * 1024:
        return {"category": "Large Files", "needs_review": False, "extracted_text": ""}

    engine = RuleEngine()
    category = engine.evaluate(state["file_path"])
    return {"category": category}

def should_extract(state: GraphState):
    # this is a conditional edge. if our rule engine already figured out the category, 
    # we return "move" to skip the slow AI steps. otherwise, we say "extract" to read its text.
    if state.get("category"):
        return "move"
    return "extract"

def extract_node(state: GraphState):
    path = state["file_path"].lower()
    if path.endswith(".pdf"):
        res = extract_text_from_pdf(state["file_path"])
    elif path.endswith((".png", ".jpg", ".jpeg")):
        res = extract_text_from_image(state["file_path"])
    else:
        # Unsupported for extraction, goes to needs_review
        return {"needs_review": True, "error": "Unsupported file type for extraction"}
        
    return {
        "extracted_text": res.get("text", ""),
        "confidence": res.get("confidence", 0.0),
        "needs_review": res.get("needs_review", False),
        "error": res.get("error")
    }

def should_classify(state: GraphState):
    if state.get("needs_review"):
        return "needs_review"
    if not state.get("extracted_text"):
        return "needs_review"
    return "classify_llm"

async def classify_llm_node(state: GraphState):
    provider, api_key, custom_url = load_settings()
    if not api_key:
        return {"needs_review": True, "error": "No LLM API key configured"}
        
    llm = LLMProvider(provider, api_key, custom_url)
    try:
        # test mode bypasses real network call for standard graph testing
        res = await llm.classify(state["extracted_text"], is_test=True)
        return {
            "category": res.get("category"),
            "confidence": res.get("confidence", 0.0),
            "needs_review": res.get("confidence", 0.0) < 70.0
        }
    except Exception as e:
        return {"error": str(e), "retries": state.get("retries", 0) + 1}

def route_after_classify(state: GraphState):
    # this checks if the llm failed. if we haven't retried 3 times yet, we tell the graph 
    # to loop back to classify_llm and try again. this is how we survive random api glitches.
    if state.get("error") and state.get("retries", 0) < 3 and not state.get("needs_review"):
        return "classify_llm" # Retry
    if state.get("needs_review") or state.get("error"):
        return "needs_review"
    return "move"

def needs_review_node(state: GraphState):
    # Flag file for manual review
    return {"needs_review": True}

def move_node(state: GraphState):
    # In stage 7 we just mock the MCP move protocol until Stage 9 is fully integrated
    return state

def checkpoint_node(state: GraphState):
    # Save to database
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
