# TidyFlow 2.0 — Universal AI File Organizer

TidyFlow is a robust, privacy-first, agentic AI file organization system. It scans messy personal and professional directories (Downloads, Desktop, Shared Drives), extracts multi-format content, eliminates duplicates, classifies files via fast-path heuristics and batched LLM intelligence, and safely organizes files into clean directory hierarchies.

---

## 🚀 Key Features & Capabilities

1. **Universal File Type Support**:
   - **PDFs**: Direct text extraction via PyMuPDF (`pymupdf`), page thumbnail rendering, and OCR fallback for scanned documents.
   - **Images** (`.png`, `.jpg`, `.jpeg`, `.webp`, `.bmp`, `.tiff`, `.gif`, `.heic`): Pillow metadata, thumbnail generation, perceptual hashing (`pHash`), and PaddleOCR integration.
   - **Plain Text / Code / Data** (`.txt`, `.md`, `.json`, `.csv`, `.py`, `.js`, `.ts`, `.html`, `.sql`, etc.): Direct text read (first 2-4 KB) with automated secret scrubbing.
   - **Office Documents** (`.docx`, `.xlsx`, `.pptx`): Embedded XML text extraction without heavy external office dependencies.
   - **Archives / Binaries / Media** (`.zip`, `.tar`, `.exe`, `.mp4`, `.mp3`): High-speed rule and metadata inspection.

2. **Categorization & Custom Taxonomy**:
   - Configurable category hierarchy in `config.yaml` (`Finance/Invoices`, `Finance/Receipts`, `Legal/Contracts`, `Work/Documents`, `Personal/Photos`, `Development/Code`, `Archives`, `Large_Files`, etc.).
   - Fast-path heuristic bypass (`rapidfuzz`) to save LLM tokens and API costs on obvious matches.
   - Custom user rules in `rules.yaml` (regex patterns, filename contains, extensions).

3. **Safety-First File Operations**:
   - **Safe Copy by Default**: Original files are never modified or deleted by default. Files are copied to `organized_output/<Category>/<filename>`.
   - **Collision Resolution**: Automatically appends hash snippet `filename_<sha256[:8]>.ext` if destination already contains a file with the same name.
   - **Integrity Verification**: Verifies SHA-256 post-copy; rolls back and deletes target on any mismatch.
   - **Optional Move Mode**: `--move` is supported only when explicitly accompanied by `--confirm`.
   - **Dynamic Sandboxing (MCP)**: Strict dynamic allow-list verification based on active source and target paths with zero hardcoded machine paths.

4. **Batched LLM Classifier & Secret Redaction**:
   - Batches 30–40 files per API request to avoid rate limits and minimize costs.
   - Automatically scrubs API keys (OpenAI, Google, GitHub), passwords, and auth tokens before LLM transmission.
   - Pydantic v2 validation with automatic repair retry prompt on malformed JSON responses.
   - Multi-provider support: DeepSeek, OpenAI, Groq, OpenRouter, Gemini.

5. **Deduplication & Local Caching**:
   - **Exact Duplicates**: Grouped by SHA-256.
   - **Near Duplicates**: Perceptual hashing (`imagehash.phash`) with Union-Find clustering.
   - **Persistent OCR Cache**: Keyed by SHA-256 (`ocr_cache.json`).

6. **Interactive HTML Review & Dual Interfaces**:
   - **Interactive HTML Report**: Dark-mode self-contained `review_report.html` with thumbnails, filtering, search, category overrides, and decision export.
   - **FastAPI Backend & SSE**: Real-time progress streaming for Tauri / React desktop UI.
   - **Typer CLI**: `tidy run`, `tidy inventory`, `tidy report`, `tidy apply`, `tidy serve`, `tidy config-set-llm`.

---

## 🛠️ CLI Quickstart

### 1. Run Full Organization Pipeline
```bash
# Scan, extract text, deduplicate, classify with LLM, and generate reports
python3 -m src.cli run --input-dir /path/to/messy_folder --output-dir /path/to/organized_folder

# Or automatically copy high-confidence files (>= 85% confidence)
python3 -m src.cli run --input-dir /path/to/folder --output-dir /path/to/organized --auto-apply --confirm
```

### 2. Run Local Inventory (No LLM Calls)
```bash
python3 -m src.cli inventory --input-dir /path/to/folder --output-dir /path/to/output
```

### 3. Open Interactive Review Report & Apply Decisions
```bash
# 1. Open the generated review report in your browser
open /path/to/output/review_report.html

# 2. Review and export decisions to review_decisions.csv, then apply:
python3 -m src.cli apply --decisions review_decisions.csv --output-dir /path/to/organized --confirm
```

### 4. Configure LLM API Key
```bash
python3 -m src.cli config-set-llm deepseek YOUR_API_KEY
# or
python3 -m src.cli config-set-llm openai YOUR_API_KEY
```

### 5. Launch FastAPI Backend Service
```bash
python3 -m src.cli serve --host 127.0.0.1 --port 8000
```

---

## 🧪 Running Unit Tests

```bash
python3 -m pytest tests/ -v
```
