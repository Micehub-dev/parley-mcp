# Release Runbook

## Owners

- PM owner: Micehub-dev maintainers
- Engineering owner: Micehub-dev core runtime maintainers
- Release captain: Micehub-dev release maintainer

## Support Boundary

- Supported transport: stdio MCP only
- Minimum runtime: Node.js 22+
- Current automated coverage: Windows fixture-backed service, adapter, and stdio MCP flows
- Current real-environment coverage: Windows local smoke through `npm run smoke:real`
- Current CLI caveat: on Windows, prefer the npm-installed `gemini.cmd` shim; use `PARLEY_GEMINI_COMMAND=powershell.exe` plus `PARLEY_GEMINI_ARGS_JSON` only when `gemini.ps1` is the only workable launcher
- Current diagnostics caveat: `parley_list_diagnostics` is redacted by default; `detailLevel: "full"` remains local-operator-only debugging access

## Preflight

- Confirm `npm test`, `npm run lint`, `npm run typecheck`, and `npm run build` are green on the release commit.
- Confirm `docs/mcp-contract-spec.md`, `README.md`, sprint docs, and PM docs reflect any runtime or contract changes in the release.
- Confirm `.multi-llm/config.json` compatibility has been reviewed if model allowlists or defaults changed.
- Confirm participant CLI prerequisites are documented for the target operators.
- Confirm diagnostics access defaults remain redacted unless an explicit local debugging flow requires otherwise.

## Smoke

- Run `npm run smoke:real` on a workstation with real `claude` and `gemini` CLIs available.
- On Windows, prefer `%APPDATA%\\npm\\gemini.cmd` when that npm shim exists.
- If Windows resolves Gemini only through `gemini.ps1`, set:
  - `PARLEY_GEMINI_COMMAND=powershell.exe`
  - `PARLEY_GEMINI_ARGS_JSON=["-NoProfile","-ExecutionPolicy","Bypass","-File","C:\\Users\\<user>\\AppData\\Roaming\\npm\\gemini.ps1"]`
- Keep `PARLEY_PARTICIPANT_TIMEOUT_MS` and `PARLEY_PARTICIPANT_MAX_OUTPUT_BYTES` at their intended release values during the smoke check.
- Treat any `participant_failure` with `guardrail`, `timedOut`, or `outputLimitExceeded` details as a release blocker until the operator confirms the behavior is expected.
- Treat `storage_failure` with `artifactType` or `failureKind` details as a release blocker until the damaged artifact path and replay boundary are understood.

## Rollout

- Tag the release candidate only after preflight and smoke checks are recorded.
- Publish release notes that call out support boundaries, CLI prerequisites, and any known OS-specific caveats.
- Announce whether the release was verified with fixture-backed automation only or with an additional real-CLI smoke.
- Keep rollback owners and communication channels active until the first post-release smoke or operator confirmation completes.

## Rollback

- If the release regresses participant execution, revert to the last green commit and rerun the preflight checks before re-announcing availability.
- If the release regresses filesystem durability or causes `storage_failure` on read paths, stop rollout and preserve the affected `.multi-llm/` artifacts for diagnosis before cleanup.
- If the release changes diagnostics output unexpectedly, confirm that redaction defaults are still intact before reopening access.

## Post-Release Review

- Record whether the real-CLI smoke passed cleanly or exposed an environment-specific caveat.
- Record any required launcher overrides, especially on Windows participant wrappers.
- Update `docs/risk-register.md` and `docs/test-matrix.md` if the release changed the real-environment confidence bar.
- Archive temporary smoke artifacts unless an active investigation requires them to remain on disk.
