# Integration Test Matrix

| Orchestrator | Participants | OS | Transport | Scenario | Status |
| --- | --- | --- | --- | --- | --- |
| Codex | Claude + Gemini | Windows | stdio | start -> claim_lease -> step -> finish -> promote | Implemented |
| Codex | Claude + Gemini | Windows | stdio | structured tool error on version mismatch | Implemented |
| Codex | Claude + Gemini | Windows | stdio | participant failure returns structured MCP error and writes diagnostics | Implemented |
| Codex | Claude + Gemini | Windows | service | rolling summary accumulates across committed turns | Implemented |
| Codex | Claude + Gemini | Windows | service | finish returns stable structured conclusion on repeated calls | Implemented |
| Codex | Claude + Gemini | Windows | service | topic promotion stays idempotent for unchanged session/topic pairs | Implemented |
| Claude | Claude + Gemini | Windows | stdio | resume with stored session | Planned |
| Gemini | Claude + Gemini | Windows | stdio | lease conflict handling | Planned |
