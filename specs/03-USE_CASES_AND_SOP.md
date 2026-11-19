# 03 — Three Classic Cross-Audience Use Cases & Operational SOPs

## Case 1: K-12 Student & Parent (Spark Mode) — Socratic Homework Companion & Zero-Privacy-Leak Weekly Report

- **Target Users**: Primary, middle, and high school students + non-technical parents.
- **Core Capabilities**: `ShellProfile(k12)` + Local Multimodal Vision/OCR + `SocraticSafetyGate` + `AuditableMemoryStore(L1->L2)` + Guardian Read-Only Report.
- **Operational SOP**:
  1. **Zero-Install Launch (< 60s)**: Parent opens the Web PWA (or double-clicks `<15MB` Tauri desktop app) and selects **K-12 Spark Mode**. Enters BYOK key once in local browser storage (or selects local Ollama/WebGPU offline model).
  2. **Mount Study Material**: Student drags/drops a homework photo or worksheet PDF; pages without text layer automatically route to vision/OCR without installing external tools.
  3. **Socratic Guided Solving**: Student asks "直接告诉我这道一元二次方程的答案". `SocraticSafetyGate` blocks direct solution dumping and responds with Step 1 hint ("先观察方程各项系数，你能写出判别式 Δ 的表达式吗？").
  4. **Weakness Tracking (L1 → L2)**: After solving, Core records an L1 trace and promotes an auditable L2 weakness node (`Quadratic Formula Sign Error`) linked to `sourceTraceIds`, scheduling an FSRS review card for 24h later.
  5. **Guardian Weekly Check**: Parent clicks **Guardian View** to inspect mastered vs. struggling concepts and study time — 100% locally generated with zero cloud PII upload.

---

## Case 2: Graduate Student & Researcher (Scholar Mode) — Dual-Pane Grounded Paper Reading & Quantified RAG Eval

- **Target Users**: University students, PhD researchers, senior architects.
- **Core Capabilities**: `ShellProfile(scholar)` + `HybridRetriever` + `evaluateRetrieval()` + `TurnEngine` (150-turn non-blocking) + CLI/MCP Export.
- **Operational SOP**:
  1. **Workspace & Corpus Mounting**: Switch to **Scholar Mode** and mount a local paper folder (`./papers/`). Core indexes sections via BM25 + dense vector + heading tree with exact `docId` & `page` metadata.
  2. **Quantified Retrieval Audit (`kb-eval`)**: Run a 5-to-20-item golden QA dataset through `evaluateRetrieval()` to verify `Recall@5 >= 0.85` and `MRR >= 0.75` before relying on citations.
  3. **Dual-Pane Grounded Deep Reading**: Read PDF on left pane, highlight equations/tables, and ask comparative synthesis questions on right pane; every claim cites `[docId:page]`.
  4. **150-Turn Long Research Session**: Conduct deep multi-paper debate without event-loop stalls (`< 50ms` context window assembly) or Safari/Firefox typing lag (virtualized DOM + lazy KaTeX).
  5. **Memory Audit & Export**: Inspect Memory Graph (`L2/L3`), prune stale assumptions, and export structured Markdown literature notes or Anki flashcards.

---

## Case 3: Adult Lifelong Learner (Lifelong Mode) — Fragmented Voice Capture, FSRS Daily 3-Card Loop & Living Knowledge Book

- **Target Users**: Working professionals, cross-domain learners, career switchers.
- **Core Capabilities**: `ShellProfile(lifelong)` + Mobile Voice/Quick-Capture + `AuditableMemoryStore` (FSRS Scheduler) + Living Notes Synthesis.
- **Operational SOP**:
  1. **Fragmented Capture**: During commute or reading breaks, drop a web article, book excerpt, or voice transcript into **Lifelong Mode**.
  2. **5-Minute Concept Distillation**: Core extracts core mental models, IF-THEN decision rules, and renders an instant sandboxed HTML/SVG interactive diagram (zero heavy Manim/FFmpeg setup).
  3. **Daily 3-Question FSRS Recall**: Next morning, open PWA for a 3-minute spaced-repetition check generated from due L2 concept nodes; FSRS updates stability & next review interval automatically.
  4. **Living Knowledge Evolution**: Whenever new articles contradict or extend earlier notes, Core links new L1 traces to existing L2 concepts and surfaces a transparent diff in the Living Note.
  5. **Cross-Device Local Backup**: Export an encrypted/redacted single-file workspace snapshot (guaranteed scrubbed by `redactSecrets()`) to own cloud drive whenever desired.
