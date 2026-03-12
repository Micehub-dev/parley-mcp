# Risk Register

| ID | Risk | Probability | Impact | Mitigation | Owner | Review Date |
| --- | --- | --- | --- | --- | --- | --- |
| R1 | CLI adapter behavior drift | Medium | High | adapter normalization, service-level contract tests, stdio MCP integration coverage, launcher overrides for controlled execution | TBD | 2026-05-01 |
| R2 | Lease/state corruption | Medium | High | version checks, stale-lease reclaim rules, replay-boundary tests, lifecycle tests in CI | TBD | 2026-05-01 |
| R3 | Heuristic rolling summaries may still promote noisy topic memory | Medium | Medium | keep `rollingSummary` and `conclusion` contract-stable, require explicit `parley_promote_summary`, and add follow-up search/operator review before stronger automation | TBD | 2026-05-29 |
| R4 | UI or packaging work distracts retrieval and operator priorities | Medium | Medium | keep packaging and UI out of Sprint 5, preserve MCP-first contract focus, and build on promoted topic memory before external surfaces | TBD | 2026-05-29 |
| R5 | MCP handler behavior drifts away from the service-layer synthesis contract | Medium | Medium | keep synthesis and promotion logic in `ParleyService`, return structured `isError` tool payloads, and keep contract docs aligned with tests | TBD | 2026-05-29 |
| R6 | Diagnostic artifacts may expose raw subprocess details without redaction rules | Medium | Medium | keep diagnostics filesystem-local for now, prioritize operator-facing inspection before broader distribution, and add redaction policy before external surfaces | TBD | 2026-05-29 |
