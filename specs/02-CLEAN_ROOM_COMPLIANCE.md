# 02 — Clean-Room IP & K-12 Safety Compliance Specification

## 1. Clean-Room Intellectual Property Firewall
1. **Expression vs. Idea Separation**:
   - Only abstract functional specifications (`specs/`) and original interface contracts (`packages/contracts/`) cross into implementation.
   - Zero source files, prompt YAML templates, CSS stylesheets, icon assets, or marketing copy may be copied from any third-party tutoring project.
2. **Trademark Hygiene**:
   - `scripts/check-security-and-ip.mjs` automatically fails CI if prohibited third-party product trademarks appear in runtime source (`packages/*/src/**`).
   - Factual academic/conceptual attribution is confined solely to `THIRD_PARTY_NOTICES.md` and `README.md`.
3. **License Purity**:
   - Original codebase is licensed under `MIT`.
   - Third-party dependencies must use permissive licenses (MIT / Apache-2.0 / BSD / ISC); no copyleft (GPL/AGPL) dependencies permitted in core distribution.
4. **Copyrighted Content Exclusion**:
   - No copyrighted textbooks, exam banks, or proprietary audio/video assets are ever bundled into the repository. Users mount local files or open OER (CC-BY / OpenStax) sources at runtime.

## 2. K-12 Minor Protection & Pedagogical Safety
1. **Local-First Privacy (COPPA / GDPR-K / Minor Protection Alignment)**:
   - Default runtime stores all learning history, notes, and mastery states locally on device (`IndexedDB` / local SQLite).
   - No mandatory account registration, behavioral telemetry, or third-party ad tracking.
2. **Socratic Anti-Cheat Gate (`SocraticSafetyGate`)**:
   - In `k12` mode, prompts requesting direct homework/exam answers (`revealAnswer: false`) are intercepted by the policy engine and transformed into guided scaffolding hints unless explicitly unlocked by an authorized guardian/teacher review toggle.
3. **Zero Plaintext Secret Redaction**:
   - All turn traces and exported Guardian reports pass through `redactSecrets()` to scrub accidental API key patterns (`sk-...`, `AIzaSy...`, `ghp_...`) before persistence or display.
