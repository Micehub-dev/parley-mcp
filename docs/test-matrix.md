# Integration Test Matrix

## Support Statement

- Supported transport today: stdio MCP
- Minimum runtime: Node.js 22+
- Automated confidence today: GitHub Actions `ubuntu-latest` lint, typecheck, test, and build with fixture-backed service, adapter, and stdio flows
- Real-environment confidence today: Windows local smoke via `npm run smoke:real` plus a Windows Codex Desktop acceptance pass
- Linux is currently backed by automated CI evidence rather than a Linux real-CLI smoke
- macOS remains unverified in this repository

## Automated Coverage

| Verification Type | Orchestrator | Participants | OS | Transport | Scenario | Status |
| --- | --- | --- | --- | --- | --- | --- |
| stdio integration | Codex | Claude + Gemini | Ubuntu CI | stdio | start -> claim_lease -> step -> finish -> promote | Implemented |
| stdio integration | Claude | Claude + Gemini | Ubuntu CI | stdio | start -> claim_lease -> step -> finish -> promote -> search -> board | Implemented |
| stdio integration | Codex | Claude + Gemini | Ubuntu CI | stdio | structured tool error on version mismatch | Implemented |
| stdio integration | Codex | Claude + Gemini | Ubuntu CI | stdio | participant failure returns structured MCP error and writes diagnostics | Implemented |
| stdio integration | Gemini | Claude + Gemini | Ubuntu CI | stdio | diagnostics MCP inspection supports redacted default and explicit full-detail opt-in | Implemented |
| stdio integration | Claude | Claude + Gemini | Ubuntu CI | stdio | resume with stored session | Implemented |
| stdio integration | Gemini | Claude + Gemini | Ubuntu CI | stdio | lease conflict handling | Implemented |
| service | Codex | Claude + Gemini | Ubuntu CI | in-process | rolling summary accumulates across committed turns | Implemented |
| service | Codex | Claude + Gemini | Ubuntu CI | in-process | finish returns stable structured conclusion on repeated calls | Implemented |
| service | Codex | Claude + Gemini | Ubuntu CI | in-process | timeout guardrail surfaces through diagnostics and `participant_failure` details | Implemented |
| service | Codex | Claude + Gemini | Ubuntu CI | in-process | labeled plain-text Gemini output normalizes before commit | Implemented |
| service | Codex | N/A | Ubuntu CI | in-process | corrupted session artifacts return `storage_failure` instead of collapsing into not found | Implemented |
| service | Codex | N/A | Ubuntu CI | in-process | persisted diagnostics return repair guidance and replay hints | Implemented |
| service | Codex | N/A | Ubuntu CI | in-process | diagnostics are redacted by default and expose full detail only when explicitly requested | Implemented |
| adapter | N/A | Gemini | Ubuntu CI | in-process | fenced JSON, partial JSON, and labeled plain-text response normalization | Implemented |
| runtime | N/A | individual subprocesses | Ubuntu CI | direct spawn | timeout guardrail terminates stalled participant execution | Implemented |
| runtime | N/A | individual subprocesses | Ubuntu CI | direct spawn | output guardrail terminates runaway participant output | Implemented |

## Real-Environment Coverage

| Verification Type | Participants | OS | Transport | Workflow | Latest Result |
| --- | --- | --- | --- | --- | --- |
| manual smoke | Claude + Gemini CLIs | Windows | stdio / in-process service | `npm run smoke:real` | Passed on 2026-03-13 using `claude.exe` plus the npm-installed `gemini.cmd` shim; see `docs/real-cli-smoke.md` |
| manual acceptance | Codex Desktop + Claude + Gemini CLIs | Windows | stdio MCP | register server -> discover tools -> start -> claim_lease -> step -> diagnostics -> finish | Passed on 2026-03-13; see `docs/codex-desktop-acceptance.md` |

## Notes

- Fixture-backed automation remains the primary CI confidence surface.
- Real-CLI smoke is intentionally lightweight and release-oriented rather than a large manual QA program.
- Windows operators should prefer the npm-installed `gemini.cmd` shim when it is available; use launcher overrides only when `gemini.ps1` is the only working entrypoint.
- Linux evidence in Sprint 9 comes from exercised `ubuntu-latest` CI; local WSL on the current workstation was not promoted into release evidence because Node.js was not available there.
- macOS should remain a design target until an actual macOS environment is exercised; checklist preparation alone does not change the support statement.
