# Integration Test Matrix

| Orchestrator | Participants | OS | Transport | Scenario | Status |
| --- | --- | --- | --- | --- | --- |
| Codex | Claude + Gemini | Windows | stdio | start -> claim_lease -> step -> finish -> promote | Implemented |
| Claude | Claude + Gemini | Windows | stdio | start -> claim_lease -> step -> finish -> promote -> search -> board | Implemented |
| Codex | Claude + Gemini | Windows | stdio | structured tool error on version mismatch | Implemented |
| Codex | Claude + Gemini | Windows | stdio | participant failure returns structured MCP error and writes diagnostics | Implemented |
| Gemini | Claude + Gemini | Windows | stdio | participant failure diagnostics inspection via `parley_list_diagnostics` | Implemented |
| Codex | Claude + Gemini | Windows | service | rolling summary accumulates across committed turns | Implemented |
| Codex | Claude + Gemini | Windows | service | finish returns stable structured conclusion on repeated calls | Implemented |
| Codex | Claude + Gemini | Windows | service | topic promotion stays idempotent for unchanged session/topic pairs | Implemented |
| Codex | N/A | Windows | service | topic search matches promoted knowledge fields and tag filters | Implemented |
| Codex | N/A | Windows | service | workspace board retrieval returns status columns and promoted digests | Implemented |
| Codex | N/A | Windows | service | persisted diagnostics return repair guidance and replay hints | Implemented |
| Claude | Claude + Gemini | Windows | stdio | resume with stored session | Implemented |
| Gemini | Claude + Gemini | Windows | stdio | lease conflict handling | Implemented |
| Codex | N/A | Windows | service | synthesis deduplicates repeated questions/action items and excludes undecided turns from consensus | Implemented |
| Codex | N/A | Windows | service | diagnostics include next-safe repair action hints for replay-boundary follow-up | Implemented |
