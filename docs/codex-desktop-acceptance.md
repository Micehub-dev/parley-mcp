# Codex Desktop Acceptance Checklist

## Purpose

Use this checklist to confirm that Parley is installable and operable from Codex Desktop without changing the core stdio MCP contract.

## Latest Exercised Baseline

- Exercised on Windows on 2026-03-13
- Participant CLIs available: `claude.exe` plus Gemini installed under `%APPDATA%\npm`
- Observed launcher detail: PowerShell may surface `gemini.ps1`, but Parley should prefer `%APPDATA%\npm\gemini.cmd` automatically when that shim exists

## Prerequisites

- Node.js 22+
- `npm install`
- `npm run build`
- Real `claude` CLI available on `PATH`
- Real Gemini CLI installation available under `%APPDATA%\npm`
- A writable project workspace so Parley can create `.multi-llm/`

## Registration

1. Start Codex Desktop and open the Parley workspace.
2. Register the built server entrypoint that launches `dist/index.js` over stdio.
3. Restart or reload Codex Desktop if the MCP server list does not refresh automatically.
4. Confirm the Parley server appears without transport errors before trying any tools.

## Baseline Flow

1. Discover tools and confirm `parley_start`, `parley_claim_lease`, `parley_step`, `parley_finish`, and `parley_list_diagnostics` are exposed.
2. Run `parley_start` with a simple topic and record the returned `parleySessionId` and `stateVersion`.
3. Run `parley_claim_lease` with an explicit `orchestratorRunId`.
4. Run `parley_step` once and confirm:
   - both participant responses are returned
   - `stateVersion` increments
   - `rollingSummary` is present
5. If a participant fails, run `parley_list_diagnostics` and confirm the default MCP view is redacted.
6. Run `parley_finish` and confirm `conclusion` is returned.

## Acceptance Checks

- The server remains stdio MCP only; no Codex-specific state is introduced.
- Lease handling stays server-owned through `leaseOwner`, `leaseExpiresAt`, and `stateVersion`.
- Gemini responses may vary in shape, but common fenced JSON, labeled plain text, and partial JSON shapes normalize into the shared participant contract when safe.
- Diagnostics remain redacted by default in the Codex Desktop MCP surface.
- Windows Gemini launcher behavior remains stable without requiring a PowerShell override when `%APPDATA%\npm\gemini.cmd` exists.

## Failure Notes

- If Gemini launches only through `gemini.ps1`, set `PARLEY_GEMINI_COMMAND=powershell.exe` and provide `PARLEY_GEMINI_ARGS_JSON` as documented in [docs/real-cli-smoke.md](./real-cli-smoke.md).
- If `parley_step` returns `participant_failure`, inspect `parley_list_diagnostics` before retrying.
- If Codex Desktop can register the server but not discover tools, rebuild the project and reload the MCP server registration.

## Out Of Scope

- This checklist does not claim macOS verification.
- This checklist does not replace the release-oriented real CLI smoke or CI checks.
- Release review should record this checklist alongside the current smoke output in the active note based on `docs/release-evidence-template.md`.
