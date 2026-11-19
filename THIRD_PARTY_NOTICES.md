# Third-Party Notices & Clean-Room Attribution

## Clean-Room Statement
OpenLearnOS is an independent, clean-room implementation authored from scratch
against original functional specifications (`specs/`) and typed contracts
(`packages/contracts/`). It contains **no copied source code, prompt templates,
CSS stylesheets, icons, trademarks, or copyrighted educational materials** from
any third-party learning platform.

## Conceptual Inspiration (Non-Code Attribution)
The architectural concepts explored in OpenLearnOS are inspired by publicly
available academic research and open-source engineering discussions, including:
- Auditable multi-layer learning memory and personalized tutoring concepts from
  academic literature (*arXiv:2604.26962*, HKUDS).
- Box-with-Invariants physical isolation and thin-harness engineering discipline
  from modern AI-Native software engineering practices (OpenAI Codex architecture).
- Spaced-repetition memory scheduling inspired by open FSRS algorithms.
- Dual-pane source-grounded reading workflows popularized by modern research notebooks.

All trademarks belong to their respective owners and are referenced strictly for
factual provenance. OpenLearnOS is not affiliated with or endorsed by any third party.

## Third-Party Software Dependencies
Direct runtime dependencies are intentionally kept minimal and audited via CI to
avoid copyleft license contamination. Any future third-party package added to
`package.json` or `Cargo.toml` must be MIT, Apache-2.0, BSD, or ISC licensed and
documented here prior to release.
