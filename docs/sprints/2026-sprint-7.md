# Sprint 7 Brief

## Dates

- Planned window: 2026-03-13 to 2026-03-26
- Planning note: after Sprint 6 closed the highest-risk orchestrator verification gaps, the next immediate product risk is exposing diagnostics through MCP without a clear default redaction and explicit access rule.

## Goal

- make diagnostics inspection safe-by-default for downstream orchestrators while preserving an explicit local operator path to full detail when needed

## Status

- Functionally complete as of 2026-03-13

## Why This Sprint Now

- Sprint 6 expanded diagnostics-oriented helper output, which raised the importance of a clear boundary between repair guidance and raw subprocess detail.
- The product can now keep diagnostics filesystem-local and human-debuggable without forcing every MCP caller to receive raw command lines, args, or process output by default.
- This work is a better next step than packaging because it reduces risk on an already-exposed operator surface instead of widening distribution first.

## Committed Scope

- [x] Make `parley_list_diagnostics` return redacted diagnostic views by default
- [x] Add an explicit full-detail opt-in for local operator debugging
- [x] Keep persisted diagnostic artifacts unchanged on disk while moving redaction into the MCP read path
- [x] Refresh contract, sprint, README, and PM docs to reflect the new diagnostics boundary

## Explicit Non-Goals

- [ ] add authentication or remote policy enforcement beyond the explicit MCP opt-in
- [ ] change diagnostic storage layout under `.multi-llm/sessions/<sessionId>/diagnostics/`
- [ ] introduce automated repair workflows or new session-state fields
- [ ] start packaging, plugin, extension, or UI work

## Exit Criteria

- [x] `parley_list_diagnostics` hides raw subprocess details unless callers explicitly request full detail
- [x] operators can still retrieve full diagnostics intentionally for local debugging
- [x] service and stdio tests cover both redacted and full-detail paths
- [x] `npm test`, `npm run lint`, `npm run typecheck`, and `npm run build` are green

## Dependencies

- preserve the Sprint 6 repair-guidance contract and additive next-safe action hints
- keep diagnostics persisted as human-debuggable filesystem artifacts
- avoid widening the core session-state contract for what is fundamentally a read-time access concern

## Task Tracker

### Task 1. Redacted-By-Default Diagnostics

- [x] add a diagnostics detail-level input with `redacted` as the default
- [x] redact raw command, args, stdout, stderr, and other sensitive diagnostic fields in the default MCP view
- [x] keep repair guidance and replay-boundary hints visible in the redacted view

Verification:

- `npm test`
- targeted service diagnostics assertions

### Task 2. Explicit Full-Detail Opt-In

- [x] allow callers to request `detailLevel: "full"` when local operator debugging needs raw subprocess detail
- [x] keep the full-detail path additive rather than replacing the filesystem-backed source of truth

Verification:

- `npm test`
- targeted stdio diagnostics assertions

### Task 3. Contract and Planning Refresh

- [x] update `docs/mcp-contract-spec.md` for the new diagnostics input and redacted view behavior
- [x] update README, AGENTS, and PM docs so Sprint 7 priorities no longer point only at Sprint 6 hardening
- [x] update test and risk docs to reflect what this sprint now covers and what remains open

Verification:

- doc review against runtime behavior
- `npm run lint`

## Open Questions To Carry Forward

- whether explicit full-detail access eventually needs a stronger policy gate than a tool argument once diagnostics move beyond local operator use
- whether future transports need different default redaction behavior than the current stdio-focused surface

## Outcome Notes

- `parley_list_diagnostics` now defaults to a redacted record view suitable for broader orchestrator consumption.
- Raw subprocess command lines, args, stdout, stderr, resume IDs, participant responses, and user nudges remain available only through an explicit `detailLevel: "full"` request.
- Diagnostic artifacts on disk remain unchanged so local operators still have the original forensic record when needed.
