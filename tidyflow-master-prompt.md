# MASTER BUILD PROMPT — TIDYFLOW
### (Autonomous File Organizer Agent — Full End-to-End Build Instructions)

You are an autonomous coding agent. You will build this entire project, stage by stage, exactly as specified below. Do not deviate from the tech stack. Do not invent libraries or APIs that don't exist — if unsure whether something exists, say so instead of guessing. Do not skip stages. Do not merge stages. Complete and verify each stage before moving to the next.

---

## PROJECT OVERVIEW (read this before starting — this is what you're building and why)

**Problem:** Personal and work folders (Downloads, Desktop, shared drives) accumulate thousands to millions of unorganized files — PDFs, images, screenshots, documents — with unclear names and no structure. Manually sorting and renaming these files is time-consuming and impractical at scale.

**What Tidyflow does:** An agentic AI system that scans a target folder, decides for each file whether it can be sorted instantly by simple rules or needs deeper understanding, extracts text from unclear files (direct PDF text extraction or OCR), uses an LLM to classify and rename genuinely ambiguous files, then safely moves everything into an organized folder structure. It must work correctly whether the folder has 50 files or 1,000,000+ files, without crashing, fully undoable, and resumable if interrupted at any point — behavior adapts automatically based on scale (see Stage 2 profiling step), the user never configures this manually.

---

## 0. BEFORE YOU START — ASK THE USER ONLY THESE THINGS

Do not ask anything else. Do not ask for design decisions — they are all specified below. Ask ONLY:

1. **Project name** (default if not given: `tidyflow`)
2. **GitHub repo details** — should you create a new repo and push to it? If yes, ask for: GitHub username, repo name, and a Personal Access Token (or confirmation they'll authenticate another way). If no, just build locally and skip git push steps.
3. **LLM API key(s)** — ask which provider(s) they want to test with first (Gemini / Groq / DeepSeek / OpenRouter / other), and the API key for that provider. Store it in a local `.env` file — **never commit this file**, add it to `.gitignore` immediately in Stage 0.
4. **A test folder path** — a real folder on their machine with some files in it, to use for testing as stages are built.

Once you have these four things, proceed through every stage without stopping to ask further questions, unless something is truly blocking (e.g. a required library fails to install).

---

## 1. GLOBAL RULES (apply to the entire project, every stage)

### Tech stack — do not substitute or add anything not listed here
```
Language:              Python 3.11+
Orchestration:          LangGraph
Backend:                FastAPI
CLI:                    Typer
File Scanning:          os.scandir / pathlib
PDF Text Extraction:    PyMuPDF (fitz)
OCR:                    Tesseract (pytesseract)
File System Boundary:   Custom minimal MCP filesystem server
Concurrency:            asyncio + uvloop (event loop), Semaphore, ProcessPoolExecutor (CPU-bound work)
Database:               SQLite (WAL mode)
Full-text Search:       SQLite FTS5
Vector Search:          simple cosine similarity by default; FAISS if profiler selects "heavy mode"
Dedup (small scale):    exact content hash
Dedup (large scale):    Bloom filter + LSH (only in "heavy mode")
Secret Storage:         Python `keyring` library (OS credential manager)
Terminal UI:            rich
Frontend (final stage): Tauri (Rust shell) + React — required toolchain: Node.js + Rust (via rustup)
```

### GitHub commit rules
- Commit after every completed stage (or meaningful sub-step within a stage)
- Commit messages must be **short, casual, human-written style** — like a person quickly describing what they did, NOT conventional-commit format
  - ✅ Good: `added the file scanner, works on my test folder`
  - ✅ Good: `fixed the thing where duplicate files werent being caught`
  - ❌ Bad: `feat: implement file scanning module`
  - ❌ Bad: `fix(scanner): resolve duplicate detection bug`
- No emojis, no ticket numbers, no jargon — just plain description

### Documentation rule — applies ONLY to Stages 3, 7, 8, and 10
These are the ONLY stages that need a companion doc file, because they cover the four things the user needs to deeply understand (MCP, LangGraph, OS/concurrency concepts, FastAPI). No other stage gets this doc treatment — keep other stages to normal minimal code comments.

**These docs are for the user's personal learning/reference only. They must NEVER be committed to GitHub — the `docs/` folder is gitignored (see Stage 0). Confirm this folder never appears in any commit.**

For each of Stages 3, 7, 8, 10, create a file `docs/stageX_<topic>.md` using this exact structure:

```markdown
# Stage X: [Topic Name]

## Why We're Building This
[3-5 plain-English sentences: what problem this part of the system solves, 
why it's needed, no jargon]

## What It Actually Does
[Plain-English walkthrough of the behavior/flow, written for someone who 
has never seen this code before]

## Code Walkthrough
[Paste the actual code in chunks of 5-10 lines. After EACH chunk, explain 
in plain, simple language what it's doing and why — as if explaining to 
someone who has zero background in this specific concept]

## Interview Questions
[5-8 questions an interviewer might realistically ask about THIS SPECIFIC 
topic only — e.g. for Stage 8 only ask about semaphores/concurrency, not 
about LangGraph. Each answer must be explained as if teaching a sixteen-
year-old who knows nothing about the topic — use a simple analogy first, 
then the technical explanation]
```

### Code comment rule — applies ONLY to code written in Stages 3, 7, 8, and 10
In these specific files only, comments must be written in casual, plain, human language — not formal docstring English. Sound like someone explaining it to a friend, slightly imperfect grammar is fine.

- ✅ Good: `# this just makes sure only 5 things run at once, so we dont overload the api`
- ✅ Good: `# mcp server checks if the path is allowed before touching anything, this is the safety part`
- ❌ Bad: `# Acquire semaphore to limit concurrent execution to MAX_WORKERS`

All other stages (0, 1, 2, 4, 5, 6, 9, 11, 12, 13, 14, 15, 16) get normal, minimal, professional code comments only — no special doc file, no casual-language requirement. Stage 17 produces no code at all, so this rule doesn't apply to it — it has its own explanation-style requirements defined in its own section.

### Verification rule
After each stage, run a basic test proving that stage works (even a simple manual test script) before committing and moving to the next stage. Never proceed on unverified code.

### Deployment model — no hosting, ever
- FastAPI runs on `localhost` on the user's own machine only — it is never deployed to a cloud server. There is no hosted backend.
- CLI gets packaged with PyInstaller into a single executable for distribution — no install steps required
- Tauri (Stage 15) compiles to a native desktop app for Windows/Mac/Linux that talks to `http://localhost:8000` on the same device — never over the internet. The Rust side of Tauri is used ONLY for native OS integration (window, native folder-picker dialog) — all real logic stays in Python/FastAPI, called over HTTP exactly like the CLI does
- Distribution happens via GitHub Releases (free, unlimited) — not any paid hosting service
- Because this is BYOK (Stage 6), the developer never holds a shared API key and never gets billed for other people's usage — infrastructure cost stays $0 regardless of how many people use it

---

## 2. STAGE-BY-STAGE BUILD PLAN

### Stage 0 — Project Init & GitHub Setup
- Create project folder structure (`/src`, `/docs`, `/tests`, `/data`)
- Initialize git repo, create `.gitignore` (must include `.env`, `__pycache__`, `*.db`, `venv/`, `docs/`, `interview-prep/`)
- Set up virtual environment, `requirements.txt`
- Create GitHub repo and push initial commit (only if user provided credentials in Step 0)
- **No doc file for this stage**

### Stage 1 — Database Foundation
- SQLite schema: `files` table (path, fingerprint, status, category, new_path, confidence_score, extracted_text, last_updated)
- Enable WAL mode, add indexes on `fingerprint`, `status`, `category`
- Single-writer coroutine pattern for batched commits
- **Crash recovery reconciliation**: on every app startup, run `UPDATE files SET status='pending' WHERE status='processing'` — any file that was mid-flight during a crash gets automatically re-queued, nothing is lost or stuck forever
- **No doc file**

### Stage 2 — File Scanner & Profiling Engine
- `os.scandir()`-based recursive scanner
- Metadata fingerprint: `MD5(path + size + mtime)`
- Profiling pre-pass: count files + total size, before full scan begins
- Strategy selector: sets a config flag (`light_mode` / `heavy_mode`) based on profile results — this flag controls which optional components activate later (dedup method, search method)
- **No doc file**

### Stage 3 — MCP Filesystem Server ⭐ (DOC REQUIRED)
- Build a minimal custom MCP-compliant server exposing filesystem tools: `list_files`, `copy_file`, `delete_file`
- Server enforces an **allow-list of directories** — any operation outside approved paths is rejected at the server level, not just in application code
- This is the ONLY component allowed to physically touch the filesystem for copies/deletes going forward
- Note: there is deliberately no single `move_file` tool — the safe-move protocol in Stage 9 always does `copy_file` → verify → `delete_file` as separate steps, never a raw move, because a plain move/rename isn't guaranteed atomic across drives
- Write `docs/stage3_mcp_server.md` per the template above

### Stage 4 — Fast Path Rule Engine & Custom Segregation Rules
- Extension-based and filename-pattern-based instant classification
- **Custom user rules**: a simple `rules.yaml` (or `.json`) config the user can edit — lets them define things like "organize invoices by date" or "anything with 'resume' in the name goes to /Career" — this always runs BEFORE any AI classification
- **Priority order for every file**: user-defined rules (highest) → fast path heuristics → AI classification (lowest, only when nothing else matched)
- Files matching known rules or user rules skip everything downstream and go straight to the move queue
- **No doc file**

### Stage 5 — Extraction Engine
- PyMuPDF: extract text from page 1 of text-layer PDFs
- If no usable text found: render page 1 as an image, run Tesseract OCR
- Capture Tesseract's confidence score; if below threshold, flag file as `needs_review` and stop — do not send low-confidence garbage text downstream
- **No doc file**

### Stage 6 — LLM Provider Layer
- Build a provider-agnostic interface: `classify(text) -> {category, filename, confidence}`
- Implement adapters for: Gemini, Groq, DeepSeek, OpenRouter, and a generic "custom OpenAI-compatible endpoint" option
- Settings storage: API key + selected provider saved via `keyring` (OS credential manager), never plaintext
- On save, perform one test call to confirm the key/provider works before accepting it
- **No doc file**

### Stage 7 — LangGraph Orchestration ⭐ (DOC REQUIRED)
- Build the actual state graph tying Stages 2–6 together:
  - Nodes: `scan`, `route`, `extract`, `classify_llm`, `needs_review`, `move`, `checkpoint`
  - `route` node checks in this exact order: Stage 4 custom user rules first, then Stage 4 fast-path heuristics, then falls through to the smart path (extract → classify_llm) only if nothing matched — same priority order defined in Stage 4, don't re-decide it here
  - `move` node does NOT call a single "move" operation — it triggers the full Stage 9 safe-move protocol (`copy_file` → checksum verify → `delete_file`) through the Stage 3 MCP server's actual tools
  - Conditional edges: fast path skips extract/classify entirely; smart path goes through the full chain
  - Include a retry edge for transient failures
- Write `docs/stage7_langgraph.md` per the template above

### Stage 8 — Concurrency & Fault Tolerance ⭐ (DOC REQUIRED)
- `asyncio.Semaphore` to bound concurrent LLM/OCR calls
- `ProcessPoolExecutor` (capped at `os.cpu_count()`) for CPU-bound PDF/OCR work
- Bounded `asyncio.Queue` between pipeline stages for backpressure
- Circuit breaker: trips on repeated API failures, reroutes files to a deferred queue
- Exponential backoff on retryable errors
- On 429/quota-exhausted: checkpoint progress to SQLite, pause cleanly, surface a clear message (see Stage 10 for how this reaches the user)
- **Configurable concurrency cap**: expose the max-parallel-operations number as a config value (not hardcoded) — spinning disks (HDD/network drives) need lower parallelism than SSD/NVMe, so this should be tunable rather than one-size-fits-all
- **Structured logging**: log every file's stage transitions as structured (JSON) log lines, not plain print statements — include throughput (files/sec) so progress is genuinely observable during a long run, not a black box
- Write `docs/stage8_concurrency.md` per the template above

### Stage 9 — Safe Move, Sharded Folders & Undo
- Move protocol: copy file to destination (via MCP server) → verify checksum matches → delete original (via MCP server) → log to manifest
- Auto-shard destination folders (e.g. by date) to avoid huge flat directories
- `undo_manifest.json`: LIFO log of every move; undo command reverts in reverse order
- **No redo feature**
- **No doc file**

### Stage 10 — FastAPI Backend ⭐ (DOC REQUIRED)
- Endpoints: `POST /scan`, `GET /status`, `GET /search`, `POST /undo`, `GET/POST /settings`, `POST /pause`, `POST /resume`
- `/settings` handles provider + API key configuration (calls Stage 6 logic)
- `/status` must surface pause/quota-exhaustion messages clearly (e.g. "12,400 of 20,000 files done — provider quota reached, resume anytime")
- Write `docs/stage10_fastapi.md` per the template above

### Stage 11 — CLI Client
- Typer-based CLI that calls the FastAPI endpoints (never bypasses the backend, never calls internal functions directly)
- Commands: `scan <folder>`, `status`, `search <query>`, `undo`, `settings`
- **No doc file**

> **MILESTONE:** After Stage 11, you have a complete, working, end-to-end system. Verify it fully on the user's test folder before continuing.

### Stage 12 — Scale Features (heavy mode only)
- If `heavy_mode` flag is set (from Stage 2 profiler): activate Bloom filter for exact-dup pre-check, LSH bucketing for near-duplicate images
- If `light_mode`: skip these entirely, use simple exact-hash dedup
- **No doc file**

### Stage 13 — Hybrid Search / Retrieval
- SQLite FTS5 for keyword search over filenames/extracted text
- Generate embeddings from each file's already-stored `extracted_text` + `category` (from Stage 1's schema) at indexing time — never re-read the original file, the understanding is already saved. Store vectors in a dedicated `embeddings` table (file id + vector) or directly in the FAISS index file when `heavy_mode` is active
- Simple cosine similarity search by default; swap to FAISS (HNSW index) automatically if `heavy_mode` is active
- Combine both result sets, return top matches
- **No doc file**

### Stage 14 — Budget Caps & Cost Dashboard
- Config: max LLM calls or max $ spend per run
- Real-time counter during a run; once cap is hit, fall back to heuristic-only classification for remaining files, flag them `needs_review` instead of blocking
- **No doc file**

### Stage 15 — Tauri + React UI (final layer)
- React frontend (built with Vite) calling the same FastAPI endpoints from Stage 10 — no new backend logic, no business logic in Rust
- Tauri's Rust shell handles only: native window, app icon/menu, and the native folder-picker dialog (returns a real filesystem path to pass to `/scan`)
- Screens: folder picker + scan trigger, live progress view (poll or WebSocket against `/status`), settings (provider/API key via `/settings`), search bar (`/search`), undo button (`/undo`)
- Use Tauri's built-in bundler to produce installers for Windows/Mac/Linux
- **No doc file**

### Stage 16 — End-to-End Test & Final README
- Full run against the user's test folder using the Tauri app (or CLI if Tauri isn't built yet)
- Write a top-level `README.md` for GitHub with this exact scoping:
  - Problem statement + what the project does (brief, whole-system level)
  - Explicitly state this is an **agentic AI project**
  - **Architecture section covers ONLY the user's tech stack in depth**: LangGraph (agentic orchestration/routing), FastAPI (backend API layer), MCP Server (sandboxed filesystem access), OS/Concurrency concepts (semaphore-based rate control, process pooling) — include a simple architecture diagram/flow limited to these four pieces
  - All other technologies (Tesseract, PyMuPDF, SQLite, FAISS, Bloom filter, Tauri, React, etc.) get only a single-line mention each in a short "Also uses" list at the bottom — no elaboration, no dedicated sections
- Commit and push — `README.md` is meant to be public

### Stage 17 — Interview Prep Package (FINAL STAGE — local reference only, NEVER pushed to GitHub)
Create a folder `interview-prep/` (already gitignored from Stage 0) containing one file: `interview-prep/tidyflow-interview-guide.md`, with three sections:

**A. Scoped Architecture Overview**
- A clear architecture diagram (plain text/ASCII or Mermaid) showing ONLY how LangGraph, FastAPI, MCP Server, and the OS/concurrency layer connect and flow together in this project
- Do not include or explain any other technology here — this section is scoped strictly to the user's four tech-stack items
- Plain-English explanation underneath the diagram, connecting each box to what it actually does in this project

**B. Recitation Script**
- A first-person script the user can memorize and recite when asked "walk me through this project"
- Must cover, in order: one-line project summary → why it's agentic (LangGraph's role in routing/decision-making) → how it's exposed as a service (FastAPI) → how file safety is guaranteed (MCP server sandboxing) → how it stays fast and doesn't crash under load (semaphores, process pooling, fault tolerance)
- Written in natural spoken language, like the user is actually talking out loud, not reading a textbook

**C. Interview Questions (100–150+)**
- Grouped into sections: LangGraph, FastAPI, MCP Server, OS/Concurrency Concepts, **System Design**, and a final "Design Decisions & Trade-offs" section (why these choices were made vs. alternatives)
- The **System Design** section is separate from the tech-specific sections above and must cover proper system design ground since it's directly tied to the OS/concurrency work — include questions on: crash recovery, fault tolerance, pause/resume behavior, how the system handles scale (small folder vs huge folder), backpressure, safe file-move guarantees, what happens when a component fails mid-operation, and similar system-design staples
- These should be realistic cross-questions an interviewer would ask right after hearing the recitation script above
- Every answer explained as if teaching a sixteen-year-old — a simple real-world analogy first, then the technical answer
- **After every answer, add one short line pointing to where that logic actually lives in the codebase** — e.g. `Code reference: stage8, semaphore_manager.py — see the acquire/release around the LLM call` — just enough to locate it fast, not a full re-explanation
- More than 150 is fine if there are genuinely more good questions worth including

**This entire file is for the user's personal interview preparation only. It must never be committed or pushed to GitHub — confirm `interview-prep/` never appears in `git log` or the remote repo.**

---

## 3. DEFINITION OF DONE

The project is complete when:
- All 18 stages are built, committed, and individually verified
- `docs/stage3_mcp_server.md`, `docs/stage7_langgraph.md`, `docs/stage8_concurrency.md`, and `docs/stage10_fastapi.md` all exist and follow the required template
- `interview-prep/tidyflow-interview-guide.md` exists with all three sections (scoped architecture overview, recitation script, 100–150+ interview questions)
- `docs/` and `interview-prep/` are confirmed gitignored — neither folder appears anywhere in `git log` or the pushed GitHub repo
- The GitHub-facing `README.md` scopes its architecture section to only LangGraph, FastAPI, MCP Server, and OS/concurrency concepts, explicitly states this is an agentic AI project, and mentions all other tech only briefly
- A full run on the user's test folder completes successfully via CLI (and Tauri app, if built) with no crashes
- Undo works correctly on a completed run
- Pausing (simulated quota exhaustion) and resuming works without data loss or duplication

Do not mark the project done unless every item above is true.
