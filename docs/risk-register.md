# Risk Register

| ID | Risk | Probability | Impact | Mitigation | Owner | Review Date |
| --- | --- | --- | --- | --- | --- | --- |
| R1 | CLI adapter behavior drift | Medium | High | adapter normalization, golden tests, service-level contract tests | TBD | 2026-04-03 |
| R2 | Lease/state corruption | Medium | High | version checks, audit log, replay tools, lifecycle tests in CI | TBD | 2026-04-03 |
| R3 | Summary quality degrades memory | Medium | Medium | acceptance bar, promote-after-review | TBD | 2026-04-03 |
| R4 | UI work distracts core protocol | Medium | Medium | defer UI until core contract stabilizes | TBD | 2026-04-17 |
| R5 | MCP handler behavior drifts away from domain contract | Medium | Medium | keep lifecycle logic in `DebateService` and update contract spec with each change | TBD | 2026-04-03 |
