# Risk Register

| ID | Risk | Probability | Impact | Mitigation | Owner | Review Date |
| --- | --- | --- | --- | --- | --- | --- |
| R1 | CLI adapter behavior drift | Medium | High | adapter normalization, service-level contract tests, stdio MCP integration coverage, launcher overrides for controlled execution | TBD | 2026-05-01 |
| R2 | Lease/state corruption | Medium | High | version checks, stale-lease reclaim rules, replay-boundary tests, lifecycle tests in CI | TBD | 2026-05-01 |
| R3 | Summary quality degrades memory | Medium | Medium | defer summary-quality work until reliability bar holds, keep promote-after-review guardrails | TBD | 2026-05-15 |
| R4 | UI work distracts core protocol | Medium | Medium | keep packaging and UI out of Sprint 3, preserve MCP-first contract focus | TBD | 2026-05-15 |
| R5 | MCP handler behavior drifts away from domain contract | Medium | Medium | keep lifecycle logic in `ParleyService`, return structured `isError` tool payloads, and update contract spec with each change | TBD | 2026-05-01 |
| R6 | Diagnostic artifacts may expose raw subprocess details without redaction rules | Medium | Medium | keep diagnostics filesystem-local for now and add redaction policy before wider operator distribution | TBD | 2026-05-15 |
