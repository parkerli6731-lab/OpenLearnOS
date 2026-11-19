# 01 — Architecture & Physical Isolation Boundaries

## Box-with-Invariants Dependency Graph

```text
                ┌─────────────────────────────────────────────┐
                │   packages/ui  (Adaptive Product Shell)     │
                │   K-12 Spark | Scholar | Lifelong Presets   │
                │   Virtualizer + Lazy KaTeX + Local BYOK UI  │
                └─────────────────────┬───────────────────────┘
                                      │ (Typed Worker / Tauri IPC ONLY)
                                      ▼
                ┌─────────────────────────────────────────────┐
                │   packages/contracts  (Pure Invariants Box) │
                │   ZERO runtime deps · Pure TS Interfaces    │
                └─────────────────────▲───────────────────────┘
                                      │ (Implements Contracts ONLY)
                                      │
                ┌─────────────────────┴───────────────────────┐
                │   packages/core  (Pure Engine Box)          │
                │   TurnEngine · AuditableMemory · HybridRAG  │
                │   SocraticSafetyGate · ModelAgnosticGateway │
                └─────────────────────▲───────────────────────┘
                                      │ (Differential Verification)
                                      │
                ┌─────────────────────┴───────────────────────┐
                │   packages/harness  (CI Verifier Loop)      │
                │   150-Turn Stress · RAG Eval · K-12 Gate    │
                └─────────────────────────────────────────────┘
```

## Hard Boundary Rules (Enforced by `scripts/check-boundaries.mjs`)

| Package | Allowed Workspace Imports | Forbidden Imports |
| :--- | :--- | :--- |
| `packages/contracts` | None (pure leaf box) | `core`, `ui`, `harness`, DOM, Node `fs`/`http`, vendor LLM SDKs |
| `packages/core` | `@openlearnos/contracts` only | `ui`, `harness`, `react`, `window`/`document`, raw vendor SDKs |
| `packages/ui` | `@openlearnos/contracts` only | `core` internal files, `harness`, raw credential env readers |
| `packages/harness` | `@openlearnos/contracts`, `@openlearnos/core`, `@openlearnos/ui` | Direct secrets or network side effects in deterministic tests |

## Why This Eliminates Legacy Failure Modes

1. **No GIL / Event-Loop Freeze**: `TurnEngine` uses append-only immutable turn records + windowed context slices instead of deep-cloning multi-MB JSON payloads on every turn.
2. **No Cross-Browser Typing Lag**: `ui` isolates composer state from virtualized message history and lazy-renders KaTeX formulas.
3. **One Core, Three Audience Shells**: K-12, Scholar, and Lifelong modes are declarative shell profiles (`ShellProfile`) parameterized over the same Core contracts — zero duplicated business logic.
