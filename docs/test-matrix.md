# Integration Test Matrix

## Support Statement

- Supported transport today: stdio MCP
- Minimum runtime: Node.js 22+
- Automated confidence today: GitHub Actions `ubuntu-latest` plus `windows-latest` lint, typecheck, test, and build with fixture-backed service, adapter, and stdio flows
- Real-environment confidence today: Windows local smoke via `npm run smoke:real` plus a Windows Codex Desktop acceptance pass
- Linux is currently backed by automated CI evidence rather than a Linux real-CLI smoke
- macOS remains unverified in this repository
- Sprint 12 focus: keep the latest smoke and release evidence aligned, fail low-value Gemini smoke responses honestly, and keep generated release artifacts concise without widening the contract

## Automated Coverage

| Verification Type | Orchestrator | Participants | OS | Transport | Scenario | Status |
| --- | --- | --- | --- | --- | --- | --- |
| stdio integration | Codex | Claude + Gemini | Ubuntu CI + Windows CI | stdio | start -> claim_lease -> step -> finish -> promote | Implemented |
| stdio integration | Claude | Claude + Gemini | Ubuntu CI + Windows CI | stdio | start -> claim_lease -> step -> finish -> promote -> search -> board | Implemented |
| stdio integration | Codex | Claude + Gemini | Ubuntu CI + Windows CI | stdio | structured tool error on version mismatch | Implemented |
| stdio integration | Codex | Claude + Gemini | Ubuntu CI + Windows CI | stdio | participant failure returns structured MCP error and writes diagnostics | Implemented |
| stdio integration | Gemini | Claude + Gemini | Ubuntu CI + Windows CI | stdio | diagnostics MCP inspection supports redacted default and explicit full-detail opt-in | Implemented |
| stdio integration | Claude | Claude + Gemini | Ubuntu CI + Windows CI | stdio | resume with stored session | Implemented |
| stdio integration | Gemini | Claude + Gemini | Ubuntu CI + Windows CI | stdio | lease conflict handling | Implemented |
| service | Codex | Claude + Gemini | Ubuntu CI + Windows CI | in-process | rolling summary accumulates across committed turns | Implemented |
| service | Codex | Claude + Gemini | Ubuntu CI + Windows CI | in-process | finish returns stable structured conclusion on repeated calls | Implemented |
| service | Codex | Claude + Gemini | Ubuntu CI + Windows CI | in-process | timeout guardrail surfaces through diagnostics and `participant_failure` details | Implemented |
| service | Codex | Claude + Gemini | Ubuntu CI + Windows CI | in-process | labeled plain-text Gemini output normalizes before commit | Implemented |
| service | Codex | N/A | Ubuntu CI + Windows CI | in-process | corrupted session artifacts return `storage_failure` instead of collapsing into not found | Implemented |
| service | Codex | N/A | Ubuntu CI + Windows CI | in-process | persisted diagnostics return repair guidance and replay hints | Implemented |
| service | Codex | N/A | Ubuntu CI + Windows CI | in-process | diagnostics are redacted by default and expose full detail only when explicitly requested | Implemented |
| adapter | N/A | Gemini | Ubuntu CI + Windows CI | in-process | fenced JSON, partial JSON, labeled plain-text, and plain-text next-step response normalization | Implemented |
| runtime | N/A | individual subprocesses | Ubuntu CI + Windows CI | direct spawn | timeout guardrail terminates stalled participant execution | Implemented |
| runtime | N/A | individual subprocesses | Ubuntu CI + Windows CI | direct spawn | output guardrail terminates runaway participant output | Implemented |

## Real-Environment Coverage

| Verification Type | Participants | OS | Transport | Workflow | Latest Result |
| --- | --- | --- | --- | --- | --- |
| manual smoke | Claude + Gemini CLIs | Windows | stdio / in-process service | `npm run smoke:real` | Latest documented run: 2026-03-16 using `claude.exe` plus the npm-installed `gemini.cmd` shim. The smoke path completed successfully, but the generated evidence classified Gemini usefulness as `generic_fallback` and held the release decision for review. The older Codex-run timeout from 2026-03-13 remains historical evidence only; see `docs/real-cli-smoke.md` |
| manual acceptance | Codex Desktop + Claude + Gemini CLIs | Windows | stdio MCP | register server -> discover tools -> start -> claim_lease -> step -> diagnostics -> finish | Passed on 2026-03-13; see `docs/codex-desktop-acceptance.md` |

## Notes

- Fixture-backed automation remains the primary CI confidence surface, now configured across both Ubuntu and Windows runners.
- Real-CLI smoke is intentionally lightweight and release-oriented rather than a large manual QA program.
- Windows operators should prefer the npm-installed `gemini.cmd` shim when it is available; use launcher overrides only when `gemini.ps1` is the only working entrypoint.
- Linux evidence in Sprint 9 comes from exercised `ubuntu-latest` CI; local WSL on the current workstation was not promoted into release evidence because Node.js was not available there.
- macOS should remain a design target until an actual macOS environment is exercised; checklist preparation alone does not change the support statement.
- Sprint 12 now keeps Gemini usefulness, concise launcher provenance, and generated release evidence explicit in smoke output so contract validity, operator usefulness, and review artifacts remain separable.
