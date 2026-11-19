# OpenLearnOS

**Zero-friction, local-first, AI-Native open learning OS for K-12 learners, researchers, and lifelong learners.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

## Why OpenLearnOS?

Existing open-source AI tutoring platforms often require heavy Python/Node stacks, hundreds of dependencies, and complex port/API setup — locking out K-12 families and non-technical lifelong learners while suffering from long-session freezes and browser typing lag.

OpenLearnOS applies **AI-Native Box-with-Invariants engineering** and **Clean-Room Differential Verification** to deliver one ultra-light, physically isolated core engine wrapped in three audience-adaptive shells:

| Adaptive Mode | Target Audience | Core Capabilities |
| :--- | :--- | :--- |
| **Spark (`k12`)** | K-12 Students & Parents | Socratic anti-cheat guidance gate, scanned homework vision/OCR, local-first COPPA-aligned privacy, read-only Guardian weekly report |
| **Scholar (`scholar`)** | Researchers & Graduates | Dual-pane PDF grounded reading, citation traceability, local Hybrid RAG + built-in `evaluateRetrieval` (`Recall@k`/`MRR`/`nDCG@k`), 150-turn non-blocking sessions |
| **Lifelong (`lifelong`)** | Working Adults & Self-Learners | Fragmented voice/note capture, FSRS spaced-repetition daily 3-card loop, instant sandboxed visual synthesis, living knowledge notes |

## Architecture (Box with Invariants)

- `packages/contracts` — Pure TypeScript protocols & invariants (**0 runtime dependencies**).
- `packages/core` — Pure, DOM-free, vendor-agnostic engine (`TurnEngine`, `AuditableMemoryStore`, `LocalHybridRetriever`, `SocraticSafetyGate`).
- `packages/ui` — Adaptive 3-mode shell profiles with virtualized message rendering & lazy KaTeX invariants.
- `packages/harness` — Automated differential & invariant verifier (`150-turn < 50ms`, RAG Golden Eval, K-12 & Memory audit gates).
- `specs/` — Clean-room functional specifications, `NEVER_BREAK` invariants, compliance firewall, and full operational SOPs.

## Quick Verification (Phase 0)

```bash
npm install
npm run verify
```

`npm run verify` executes all 4 automated CI gates:
1. `gate:boundaries` — Enforces strict unidirectional package isolation.
2. `gate:security-ip` — Enforces zero plaintext secrets and clean-room trademark hygiene.
3. `typecheck` — Strict TypeScript project-reference compilation (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`).
4. `harness` — Runs 150-turn stress benchmark, RAG golden evaluation, auditable memory provenance tests, and K-12 Socratic safety checks.

## Documentation & SOPs

- [Core Invariants (`NEVER_BREAK`)](specs/00-NEVER_BREAK.md)
- [Architecture & Physical Boundaries](specs/01-ARCHITECTURE_AND_BOUNDARIES.md)
- [Clean-Room IP & K-12 Safety Compliance](specs/02-CLEAN_ROOM_COMPLIANCE.md)
- [Three Classic Use Cases & Operational SOPs](specs/03-USE_CASES_AND_SOP.md)
- [Third-Party Notices & Conceptual Attribution](THIRD_PARTY_NOTICES.md)
