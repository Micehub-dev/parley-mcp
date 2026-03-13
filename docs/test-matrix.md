# Integration Test Matrix

## Support Statement

- Supported transport today: stdio MCP
- Minimum runtime: Node.js 22+
- Automated confidence today: Windows fixture-backed service, adapter, and stdio flows
- Real-environment confidence today: Windows local smoke via `npm run smoke:real`
- macOS and Linux remain design targets but are not yet explicitly verified in this repository

## Automated Coverage

| Verification Type | Orchestrator | Participants | OS | Transport | Scenario | Status |
| --- | --- | --- | --- | --- | --- | --- |
| stdio integration | Codex | Claude + Gemini | Windows | stdio | start -> claim_lease -> step -> finish -> promote | Implemented |
| stdio integration | Claude | Claude + Gemini | Windows | stdio | start -> claim_lease -> step -> finish -> promote -> search -> board | Implemented |
| stdio integration | Codex | Claude + Gemini | Windows | stdio | structured tool error on version mismatch | Implemented |
| stdio integration | Codex | Claude + Gemini | Windows | stdio | participant failure returns structured MCP error and writes diagnostics | Implemented |
| stdio integration | Gemini | Claude + Gemini | Windows | stdio | diagnostics MCP inspection supports redacted default and explicit full-detail opt-in | Implemented |
| stdio integration | Claude | Claude + Gemini | Windows | stdio | resume with stored session | Implemented |
| stdio integration | Gemini | Claude + Gemini | Windows | stdio | lease conflict handling | Implemented |
| service | Codex | Claude + Gemini | Windows | in-process | rolling summary accumulates across committed turns | Implemented |
| service | Codex | Claude + Gemini | Windows | in-process | finish returns stable structured conclusion on repeated calls | Implemented |
| service | Codex | Claude + Gemini | Windows | in-process | timeout guardrail surfaces through diagnostics and `participant_failure` details | Implemented |
| service | Codex | N/A | Windows | in-process | corrupted session artifacts return `storage_failure` instead of collapsing into not found | Implemented |
| service | Codex | N/A | Windows | in-process | persisted diagnostics return repair guidance and replay hints | Implemented |
| service | Codex | N/A | Windows | in-process | diagnostics are redacted by default and expose full detail only when explicitly requested | Implemented |
| runtime | N/A | individual subprocesses | Windows | direct spawn | timeout guardrail terminates stalled participant execution | Implemented |
| runtime | N/A | individual subprocesses | Windows | direct spawn | output guardrail terminates runaway participant output | Implemented |

## Real-Environment Coverage

| Verification Type | Participants | OS | Transport | Workflow | Latest Result |
| --- | --- | --- | --- | --- | --- |
| manual smoke | Claude + Gemini CLIs | Windows | stdio / in-process service | `npm run smoke:real` | Observed local Gemini wrapper caveat on 2026-03-13; see `docs/real-cli-smoke.md` |

## Notes

- Fixture-backed automation remains the primary CI confidence surface.
- Real-CLI smoke is intentionally lightweight and release-oriented rather than a large manual QA program.
- Windows operators may need launcher overrides when the Gemini CLI is installed only as `gemini.ps1`.
