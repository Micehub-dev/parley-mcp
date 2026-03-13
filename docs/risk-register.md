# Risk Register

| ID | Risk | Probability | Impact | Mitigation | Owner | Review Date |
| --- | --- | --- | --- | --- | --- | --- |
| R1 | CLI adapter behavior drift | Medium | High | adapter normalization, service-level contract tests, stdio MCP integration coverage, launcher overrides for controlled execution | TBD | 2026-06-12 |
| R2 | Lease/state corruption | Medium | High | version checks, stale-lease reclaim rules, replay-boundary tests, lifecycle tests in CI, and operator-facing diagnostic guidance for failure triage | TBD | 2026-06-12 |
| R3 | Heuristic rolling summaries may still promote noisy topic memory | Medium | Medium | keep `rollingSummary` and `conclusion` contract-stable, use Sprint 5 lexical search and board surfaces to review promoted memory quality, and defer heavier indexing until retrieval pain is proven | TBD | 2026-06-12 |
| R4 | UI or packaging work distracts retrieval and operator priorities | Medium | Medium | keep packaging and UI out of the core path until the Sprint 5 MCP surfaces stabilize, and treat future surfaces as thin wrappers over the existing tools | TBD | 2026-06-12 |
| R5 | MCP handler behavior drifts away from the service-layer synthesis contract | Medium | Medium | keep synthesis, retrieval, board, and diagnostic logic in `ParleyService`, return structured `isError` tool payloads, and keep contract docs aligned with tests | TBD | 2026-06-12 |
| R6 | Diagnostic artifacts may expose raw subprocess details without redaction rules | Medium | Medium | keep diagnostics filesystem-local for now, expose them through filtered inspection tools rather than broader distribution, and add redaction policy before any external surface | TBD | 2026-06-12 |
