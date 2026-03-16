# Release Runbook

## Owners

- PM owner: Micehub-dev maintainers
- Engineering owner: Micehub-dev core runtime maintainers
- Release captain: Micehub-dev release maintainer

## Support Boundary

- Supported transport: stdio MCP only
- Minimum runtime: Node.js 22+
- Current automated coverage: GitHub Actions `ubuntu-latest` plus `windows-latest` lint, typecheck, test, and build plus fixture-backed service, adapter, and stdio MCP flows
- Current real-environment coverage: Windows local smoke through `npm run smoke:real` with the latest documented run on 2026-03-16, plus a Windows Codex Desktop acceptance pass
- Current Codex Desktop checklist: `docs/codex-desktop-acceptance.md`
- Current macOS position: unverified; keep release notes explicitly narrow until an actual macOS environment is exercised
- Current CLI caveat: on Windows, prefer the npm-installed `gemini.cmd` shim; use `PARLEY_GEMINI_COMMAND=powershell.exe` plus `PARLEY_GEMINI_ARGS_JSON` only when `gemini.ps1` is the only workable launcher
- Current diagnostics caveat: `parley_list_diagnostics` is redacted by default; `detailLevel: "full"` remains local-operator-only debugging access

## Preflight

- Confirm `npm test`, `npm run lint`, `npm run typecheck`, and `npm run build` are green on the release commit.
- Open or refresh the current release-evidence record before smoke begins so support-boundary wording, smoke results, and acceptance results are recorded together.
- Prefer `docs/release-evidence-template.md` unless the release already has an equivalent note in progress.
- Confirm `docs/mcp-contract-spec.md`, `README.md`, sprint docs, and PM docs reflect any runtime or contract changes in the release.
- Confirm `.multi-llm/config.json` compatibility has been reviewed if model allowlists or defaults changed.
- Confirm participant CLI prerequisites are documented for the target operators.
- Confirm diagnostics access defaults remain redacted unless an explicit local debugging flow requires otherwise.
- Confirm the Codex Desktop acceptance checklist still matches the current operator flow if the release mentions Codex Desktop support.

## Smoke

- Run `npm run smoke:real` on a workstation with real `claude` and `gemini` CLIs available.
- Set `PARLEY_SMOKE_EVIDENCE_DIR=<dir>` when you want the smoke run to emit reusable release-evidence `.json` and `.md` artifacts alongside stdout output.
- On Windows, prefer `%APPDATA%\\npm\\gemini.cmd` when that npm shim exists.
- If Windows resolves Gemini only through `gemini.ps1`, set:
  - `PARLEY_GEMINI_COMMAND=powershell.exe`
  - `PARLEY_GEMINI_ARGS_JSON=["-NoProfile","-ExecutionPolicy","Bypass","-File","C:\\Users\\<user>\\AppData\\Roaming\\npm\\gemini.ps1"]`
- Keep `PARLEY_PARTICIPANT_TIMEOUT_MS` and `PARLEY_PARTICIPANT_MAX_OUTPUT_BYTES` at their intended release values during the smoke check.
- Treat any `participant_failure` with `guardrail`, `timedOut`, or `outputLimitExceeded` details as a release blocker until the operator confirms the behavior is expected.
- Treat `storage_failure` with `artifactType` or `failureKind` details as a release blocker until the damaged artifact path and replay boundary are understood.
- If a timeout or launcher failure occurs during smoke, rerun with `PARLEY_SMOKE_KEEP_TEMP=1` so the persisted diagnostics remain available for inspection.
- Record the participant launcher path actually used, the OS, the smoke date, and whether Gemini output was merely contract-valid or materially useful for operator review.
- Prefer the generated `releaseEvidence` or `releaseEvidenceMarkdown` payload from smoke instead of manually reconstructing the note.
- Expect the generated launcher fields to be concise provenance summaries rather than full prompt payload dumps.
- If `PARLEY_SMOKE_EVIDENCE_DIR` was set, attach the emitted `.json` and `.md` artifacts to the active release-evidence record.
- If release review includes Codex Desktop support claims, run the checklist in `docs/codex-desktop-acceptance.md` alongside the smoke check.

## Rollout

- Tag the release candidate only after preflight and smoke checks are recorded.
- Publish release notes that call out support boundaries, CLI prerequisites, and any known OS-specific caveats.
- Announce whether the release was verified with fixture-backed automation only or with an additional real-CLI smoke.
- Keep automated Linux evidence, Windows real smoke evidence, and any future macOS evidence explicitly separated in release communication.
- Keep rollback owners and communication channels active until the first post-release smoke or operator confirmation completes.

## Rollback

- If the release regresses participant execution, revert to the last green commit and rerun the preflight checks before re-announcing availability.
- If the release regresses filesystem durability or causes `storage_failure` on read paths, stop rollout and preserve the affected `.multi-llm/` artifacts for diagnosis before cleanup.
- If the release changes diagnostics output unexpectedly, confirm that redaction defaults are still intact before reopening access.

## Post-Release Review

- Record whether the real-CLI smoke passed cleanly or exposed an environment-specific caveat.
- Record any required launcher overrides, especially on Windows participant wrappers.
- Record whether the Codex Desktop acceptance checklist was exercised alongside the release candidate.
- Record whether Linux evidence came only from CI or from an additional real environment, and keep macOS wording narrow when it remains unverified.
- Record whether Gemini output met the current operator-usefulness bar or only cleared the shared contract.
- Link the completed release-evidence note so future release review does not reconstruct the same facts manually.
- Update `docs/risk-register.md` and `docs/test-matrix.md` if the release changed the real-environment confidence bar.
- Archive temporary smoke artifacts unless an active investigation requires them to remain on disk.
