# Risk Register

| ID | Risk | Probability | Impact | Mitigation | Owner | Review Date |
| --- | --- | --- | --- | --- | --- | --- |
| R1 | CLI adapter behavior drift | Medium | High | adapter normalization, service-level contract tests, stdio MCP integration coverage, launcher overrides for controlled execution | TBD | 2026-06-12 |
| R2 | Lease/state corruption | Medium | High | version checks, stale-lease reclaim rules, replay-boundary tests, lifecycle tests in CI, stdio lease-conflict coverage, and operator-facing diagnostic guidance with next-safe tool hints | TBD | 2026-07-03 |
| R3 | Heuristic rolling summaries may still promote noisy topic memory | Medium | Medium | keep `rollingSummary` and `conclusion` contract-stable, deduplicate repeated questions/action items, avoid consensus carryover from `undecided` turns, use search and board surfaces to review quality, and defer heavier indexing until retrieval pain is proven | TBD | 2026-07-03 |
| R4 | UI or packaging work distracts hardening priorities | Medium | Medium | keep packaging and UI out of the core path until the Sprint 7 diagnostics hardening work proves stable, and treat future surfaces as thin wrappers over the existing tools | TBD | 2026-07-17 |
| R5 | MCP handler behavior drifts away from the service-layer synthesis contract | Medium | Medium | keep synthesis, retrieval, board, and diagnostic logic in `ParleyService`, return structured `isError` tool payloads, and keep contract docs aligned with the expanded resume/lease/repair-helper tests | TBD | 2026-07-03 |
| R6 | Diagnostic artifacts may expose raw subprocess details without redaction rules | Low | Medium | default `parley_list_diagnostics` to redacted views, require explicit `detailLevel: "full"` opt-in for raw MCP detail, keep raw artifacts filesystem-local, and revisit stronger policy gates before broader transports | TBD | 2026-07-17 |
