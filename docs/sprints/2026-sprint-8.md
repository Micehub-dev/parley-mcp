# Sprint 8 Brief

## Dates

- Planned window: 2026-03-27 to 2026-04-09
- Delivery note: the core Sprint 8 hardening scope landed early on 2026-03-13 while keeping packaging and UI work deferred

## Goal

- Raise Parley from locally trustworthy hardening into a clearer production-readiness posture by tightening subprocess guardrails, storage durability, real-environment verification, and release ownership.

## Status

- Functionally complete as of 2026-03-13

## Why This Sprint Now

- The MCP contract, diagnostics boundary, and retrieval surfaces were already stable enough that the main remaining risk was operational rather than missing end-user capability.
- `parley_step` still depended on long-running subprocess behavior and filesystem persistence paths that needed a sharper failure boundary for real usage.
- Fixture-backed automation proved contract behavior well, but the release story still needed a more honest support statement and a repeatable real-CLI smoke workflow.

## Committed Scope

- [x] Add subprocess execution guardrails for participant runtimes
- [x] Improve filesystem persistence durability and corruption visibility
- [x] Expand verification toward real CLI and broader OS expectations
- [x] Establish a release-readiness ownership and runbook baseline
- [x] Refresh planning, risk, matrix, and release docs to reflect the new production-readiness bar

## Stretch Scope

- [ ] Add lightweight session cleanup or stale-artifact maintenance guidance if it clearly supports production operations
- [ ] Capture one packaging-direction ADR only if the production-readiness bar exits cleanly
- [ ] Add one more transport-oriented verification scenario beyond stdio if it stays thin-wrapper and low-risk

## Explicit Non-Goals

- [x] no new end-user MCP tools or topic-memory features
- [x] no plugin, extension, or UI implementation
- [x] no remote authentication or multi-tenant policy design beyond documenting current limits
- [x] no external databases, vector stores, or hosted control-plane work
- [x] no broad contract or session-state expansion beyond additive hardening details

## Exit Criteria

- [x] Participant subprocess execution no longer depends on unbounded runtime behavior without explicit timeout, cancellation, or output-size expectations
- [x] Filesystem persistence failures and corrupted artifacts are more distinguishable to operators than the earlier read-as-null behavior
- [x] The verification story includes a documented real-CLI path and a written OS support position instead of only fixture-backed confidence
- [x] Release ownership, rollback expectations, and operator runbook steps are documented well enough to support an intentional release review
- [x] `npm test`, `npm run lint`, `npm run typecheck`, and `npm run build` are green

## Dependencies

- Preserve the Sprint 7 diagnostics redaction contract while extending runtime and operator hardening
- Keep the current MCP tool surface additive unless a production-readiness gap clearly justifies a contract change
- Prefer orchestrator-agnostic runtime controls over participant- or client-specific behavior

## Owners

- PM: Micehub-dev maintainers
- Engineering: Micehub-dev core runtime maintainers
- Release captain: Micehub-dev release maintainer

## Task Tracker

### Task 1. Subprocess Guardrails

- [x] Define the minimum runtime guardrails for participant subprocess execution
- [x] Add bounded execution behavior through timeout, termination, and output-size limits
- [x] Keep failures visible through the existing diagnostic and MCP error model

Delivered:

- participant execution now enforces a default timeout, kill grace period, and per-stream output cap
- guardrail hits persist `guardrail`, `timedOut`, `outputLimitExceeded`, `durationMs`, and `signal` metadata for operators
- repair guidance now distinguishes timeout and output-limit failures from generic process exits

Verification:

- `npm test`
- targeted runtime guardrail tests
- targeted service diagnostics assertions

### Task 2. Storage Durability

- [x] Review current write paths for session state, transcript, lease, topic, and diagnostics artifacts
- [x] Tighten persistence so partial writes, corruption, and missing files are more distinguishable
- [x] Document operator-facing recovery expectations for damaged or incomplete filesystem artifacts

Delivered:

- JSON-backed artifacts now write through atomic temp-file replacement instead of blind in-place overwrite
- store reads now distinguish missing artifacts from invalid JSON and unreadable directories/files
- corrupted session artifacts now surface `storage_failure` with `artifactType`, `artifactPath`, and `failureKind`

Verification:

- `npm test`
- targeted corruption and replay-boundary tests
- release runbook updates

### Task 3. Real CLI and OS Verification

- [x] Define the minimum supported-environment statement for Node, OS, and participant CLI expectations
- [x] Add a repeatable real-CLI smoke path outside the fake-participant-only automation pattern
- [x] Refresh the verification matrix to distinguish automated fixture coverage from real-environment coverage

Delivered:

- added `npm run smoke:real` for release-oriented local CLI verification
- documented current support as Node 22+ plus stdio MCP with Windows as the only explicitly verified OS today
- recorded the Windows Gemini wrapper caveat discovered during local real-CLI smoke

Verification:

- `npm test`
- updated `docs/test-matrix.md`
- updated `docs/real-cli-smoke.md`

### Task 4. Release Ownership and Runbook

- [x] Assign concrete owners for PM, engineering, and release readiness across the active risk and release docs
- [x] Expand the release checklist into an actionable runbook for preflight, rollout, rollback, and post-release review
- [x] Document production caveats around diagnostics detail level, participant CLI prerequisites, and current support boundaries

Delivered:

- release owners are now named in sprint, risk, and release docs
- `docs/release-checklist.md` is now a release runbook instead of a short checklist
- operator caveats now cover diagnostics detail level, subprocess guardrail overrides, and Windows launcher overrides

Verification:

- doc review against runtime behavior
- updated `docs/release-checklist.md`
- updated `docs/risk-register.md`

## Outcome Notes

- Sprint 8 remained a production-readiness sprint rather than a feature sprint.
- Packaging remains downstream of runtime guardrails, storage durability, and release ownership.
- The real-CLI smoke path produced useful release evidence even where local environment caveats remained; the team now has a sharper and more defensible support statement instead of an implicit one.
