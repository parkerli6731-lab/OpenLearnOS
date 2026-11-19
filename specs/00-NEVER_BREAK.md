# 00 — Core Invariants (`NEVER BREAK`) & Abandonment Criteria

> Derived from AI-Native Software Engineering Taste Discipline (`ai-native-engineering`).

## 1. NEVER BREAK (4 Non-Negotiable System Invariants)

1. **Zero-Friction Universal Access (零门槛底线)**
   - Any learner (K-12 student, parent, researcher, or lifelong learner) MUST reach a usable interactive learning session in **< 60 seconds** via browser PWA or single-click Tauri desktop bundle (< 15 MB).
   - **Never** require terminal setup, Python/Node installation, or manual port configuration for standard learners.
2. **Local-First Privacy & Zero Plaintext Secret Leak (隐私与零明文密钥红线)**
   - User API keys remain strictly in client-side local storage / OS keychain and are **never** logged, printed, committed to Git, or relayed through a third-party server.
   - K-12 learning records default to 100% local device persistence (zero mandatory cloud PII collection).
3. **Physical Core/UI Architectural Isolation (Box with Invariants)**
   - `packages/contracts` has **zero runtime dependencies**.
   - `packages/core` imports **only** `@openlearnos/contracts` — zero DOM, React, Electron/Tauri UI, or vendor-locked LLM SDK imports.
   - `packages/ui` communicates with Core exclusively through typed RPC/Worker contracts defined in `@openlearnos/contracts`.
4. **100% Auditable Memory & Non-Blocking Turns (可审计记忆与非阻塞主循环)**
   - Every L2 (Concept/FSRS) and L3 (Learner Profile) memory record MUST link to >= 1 immutable `L1` `sourceTraceId`; orphan hallucinated profile writes are rejected at runtime.
   - Building model context for a **150-turn session** MUST complete in **< 50 ms** without blocking the UI thread.

## 2. CAN TRADE OFF (Deliberate Engineering Concessions)

- Skip 15-channel IM bots in core (expose thin MCP/Webhook extensions instead).
- Skip heavy native video compilation pipelines (Manim/FFmpeg/Remotion) in favor of instant sandboxed HTML/SVG/Canvas interactive diagrams.
- Skip multi-tenant enterprise SaaS RBAC in V1; optimize relentlessly for single-learner + Guardian read-only view.
- Maintain 1 battle-tested hybrid retrieval engine (BM25 + Dense Vector + Section Tree) rather than 4 overlapping RAG stacks.

## 3. Quantified Abandonment & Redesign Red Lines

- **Thin Harness Cap**: Any workaround patch compensating for an LLM weakness that exceeds **1,000 LOC** triggers an immediate stop-and-redesign review (`[HARNESS-WORKAROUND]` tracking required for patches < 1,000 LOC).
- **OCR Pragmatism**: If client-side WASM OCR drops below 90% accuracy on scanned homework/textbooks, route scanned pages directly to multimodal vision models rather than bundling multi-GB native OCR runtimes.
- **Latency Ceiling**: If any release regresses 150-turn context assembly above `50 ms` or browser typing latency above `16 ms`, CI blocks release automatically.
