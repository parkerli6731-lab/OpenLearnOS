# OpenLearnOS

**Zero-friction, local-first, AI-Native open learning OS for K-12 learners, researchers, and lifelong learners.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Live PWA](https://img.shields.io/badge/Live%20PWA-GitHub%20Pages-2563EB.svg)](https://parkerli6731-lab.github.io/OpenLearnOS/)

> **Zero-Install Live App:** [https://parkerli6731-lab.github.io/OpenLearnOS/](https://parkerli6731-lab.github.io/OpenLearnOS/)  
> Open in any modern browser — works immediately in **Zero-Key Local Demo Mode** or connect your own **Client-Only BYOK** gateway (SmartRouter / Ollama / OpenAI-compatible). Your API key stays strictly inside your browser's `localStorage` and never touches a third-party server.

## Three Adaptive Learning Modes (One Isolated Core)

| Adaptive Mode | Target Audience | Key Capabilities |
| :--- | :--- | :--- |
| **🎒 Spark (`k12`)** | K-12 Students & Parents | Socratic anti-cheat guidance lock (`SocraticSafetyGate`), guardian unlock toggle, read-only local weekly report, 100% local-first privacy |
| **🎓 Scholar (`scholar`)** | Researchers & Graduates | Dual-pane grounded reader with local `.md`/`.txt` upload, live `kb-eval` (`Recall@k`/`MRR`/`nDCG@k`), 150-turn non-blocking stress benchmark |
| **🌱 Lifelong (`lifelong`)** | Working Adults & Self-Learners | Fragmented quick-capture, FSRS daily review deck, auditable L1 → L2 memory graph with 1-click cascade purge |

## Architecture (Box with Invariants + Worker Isolation)

- `packages/contracts` — Pure TypeScript protocols & invariants (**0 runtime dependencies**).
- `packages/core` — Pure, DOM-free, vendor-agnostic engine (`TurnEngine`, `AuditableMemoryStore`, `LocalHybridRetriever`, `SocraticSafetyGate`).
- `packages/ui` — Adaptive 3-mode shell profiles with virtualized message viewport invariants.
- `packages/harness` — Automated differential & invariant verifier (`150-turn < 50ms`, RAG Golden Eval, K-12 & Memory audit gates).
- `apps/web` — Zero-install offline-capable **Web PWA** where Core runs inside a physically isolated **Web Worker** via typed RPC.

## Local Development & Verification

```bash
npm install
npm run verify      # Runs all 4 gates + strict TS + Differential Harness + Production PWA build
npm run dev:web     # Starts local Vite dev server
```

## Documentation & Operational SOPs

- [Core Invariants (`NEVER_BREAK`)](specs/00-NEVER_BREAK.md)
- [Architecture & Physical Boundaries](specs/01-ARCHITECTURE_AND_BOUNDARIES.md)
- [Clean-Room IP & K-12 Safety Compliance](specs/02-CLEAN_ROOM_COMPLIANCE.md)
- [Three Classic Use Cases & Operational SOPs](specs/03-USE_CASES_AND_SOP.md)
- [Third-Party Notices & Conceptual Attribution](THIRD_PARTY_NOTICES.md)
