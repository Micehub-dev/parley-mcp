# Sprint 8 Brief

## Dates

- Planned window: 2026-03-27 to 2026-04-09
- Planning note: as of 2026-03-13, Sprint 7 closed the immediate diagnostics redaction gap, so the next highest-value work is production-readiness hardening on the existing core rather than new feature expansion or packaging.

## Goal

- Raise Parley from locally trustworthy hardening into a clearer production-readiness posture by tightening subprocess guardrails, storage durability, real-environment verification, and release ownership.

## Status

- Planned

## Why This Sprint Now

- The current MCP contract, diagnostics boundary, and retrieval surfaces are stable enough that the main remaining risk is operational rather than missing user-facing capability.
- `parley_step` still depends on long-running subprocess behavior and filesystem persistence paths that are correct in tests but not yet fully hardened for production-style failure modes.
- The automated matrix is strong on contract behavior but still relies heavily on fixture-backed participants and a Windows-first planning assumption.
- Packaging or broader distribution before runtime guardrails, durability, and release ownership are clearer would amplify operational risk instead of reducing it.

## Committed Scope

- [ ] Add subprocess execution guardrails for participant runtimes
- [ ] Improve filesystem persistence durability and corruption visibility
- [ ] Expand verification toward real CLI and broader OS expectations
- [ ] Establish a release-readiness ownership and runbook baseline
- [ ] Refresh planning, risk, matrix, and release docs to reflect the new production-readiness bar

## Stretch Scope

- [ ] Add lightweight session cleanup or stale-artifact maintenance guidance if it clearly supports production operations
- [ ] Capture one packaging-direction ADR only if the production-readiness bar exits cleanly
- [ ] Add one more transport-oriented verification scenario beyond stdio if it stays thin-wrapper and low-risk

## Explicit Non-Goals

- [ ] new end-user MCP tools or topic-memory features
- [ ] plugin, extension, or UI implementation
- [ ] remote authentication or multi-tenant policy design beyond documenting current limits
- [ ] external databases, vector stores, or hosted control-plane work
- [ ] broad contract or session-state expansion unless hardening proves it necessary

## Exit Criteria

- [ ] Participant subprocess execution no longer depends on unbounded runtime behavior without explicit timeout, cancellation, or output-size expectations
- [ ] Filesystem persistence failures and corrupted artifacts are more distinguishable to operators than the current generic read-as-null behavior
- [ ] The verification story includes at least one real-CLI path and a documented OS support position instead of only fixture-backed confidence
- [ ] Release ownership, rollback expectations, and operator runbook steps are documented well enough to support an intentional release review
- [ ] `npm test`, `npm run lint`, `npm run typecheck`, and `npm run build` are green

## Dependencies

- Preserve the Sprint 7 diagnostics redaction contract while extending runtime and operator hardening
- Keep the current MCP tool surface additive unless a production-readiness gap justifies a contract change
- Prefer orchestrator-agnostic runtime controls over participant- or client-specific behavior

## Owners

- PM: TBD
- Engineering: TBD
- Release captain: TBD

## Task Tracker

### Task 1. Subprocess Guardrails

- [ ] Define the minimum runtime guardrails for participant subprocess execution
- [ ] Add bounded execution behavior such as timeout, cancellation, and output-size limits where appropriate
- [ ] Ensure failures remain visible through the existing diagnostic and MCP error model

Review focus:

- A production orchestrator cannot depend on participant CLIs always exiting quickly or emitting small well-formed payloads.
- Guardrails should reduce hang and runaway-output risk without coupling the core to one vendor's CLI quirks.

Expected outcome:

- `parley_step` has a clearer failure boundary when participant execution stalls, overproduces output, or exits ambiguously.
- Operators receive diagnostics that distinguish runtime guardrail failures from normal participant validation failures.

Debt Watch:

- Some cancellation semantics may still vary across Windows, macOS, and Linux even after the first hardening pass.
- A later transport or queue layer may still be needed if production workloads outgrow in-process subprocess control.

Verification:

- `npm test`
- targeted participant runtime and service failure-mode tests
- one documented manual smoke check with real participant CLIs

### Task 2. Storage Durability

- [ ] Review current write paths for session state, transcript, lease, topic, and diagnostics artifacts
- [ ] Tighten persistence so partial writes, corruption, and missing files are more distinguishable
- [ ] Document operator-facing recovery expectations for damaged or incomplete filesystem artifacts

Review focus:

- Production readiness depends on making persistence failures explicit, not silently collapsing missing, unreadable, and invalid JSON into the same outcome.
- The filesystem-backed design should remain simple and inspectable even as write behavior becomes more durable.

Expected outcome:

- Session and topic artifacts are harder to corrupt through interrupted writes and easier to diagnose if corruption happens.
- Operators can tell the difference between "not found", "read failed", and "payload invalid" failure classes more reliably.

Debt Watch:

- Truly transactional guarantees may remain out of scope for the filesystem model.
- Cross-process locking beyond the current lease semantics may still remain a later concern if multi-writer pressure rises.

Verification:

- `npm test`
- targeted store and replay-boundary tests
- updated operator guidance in release/runbook docs

### Task 3. Real CLI and OS Verification

- [ ] Define the minimum supported-environment statement for Node, OS, and participant CLI expectations
- [ ] Add at least one real-CLI smoke path outside the current fake-participant-only automation pattern
- [ ] Refresh the verification matrix to distinguish automated fixture coverage from real-environment coverage

Review focus:

- The current matrix proves contract behavior well, but production confidence also needs evidence against real participant binaries and documented platform assumptions.
- Verification should stay lean and repeatable rather than exploding into a large manual QA program.

Expected outcome:

- The team has a clearer answer to "what environments are actually supported today?"
- The test matrix becomes a more honest production-readiness artifact instead of mixing simulated and real-runtime confidence together.

Debt Watch:

- Full OS parity may still remain incomplete after Sprint 8.
- Remote transports can still stay later if stdio remains the only intentionally supported path for now.

Verification:

- `npm test`
- updated `docs/test-matrix.md`
- at least one documented real-CLI smoke workflow

### Task 4. Release Ownership and Runbook

- [ ] Assign concrete owners for PM, engineering, and release readiness across the active risk and release docs
- [ ] Expand the release checklist into an actionable runbook for preflight, rollout, rollback, and post-release review
- [ ] Document production caveats around diagnostics detail level, participant CLI prerequisites, and current support boundaries

Review focus:

- Production readiness is not only code hardening; the team needs named ownership and repeatable operator steps.
- Release guidance should reflect current product reality rather than implying unsupported packaging or hosted deployment guarantees.

Expected outcome:

- Release review has named owners, explicit preflight checks, rollback expectations, and known-limit communication.
- Operators can prepare a release or local deployment without reconstructing the process from scattered docs.

Debt Watch:

- A later hosted or packaged distribution model may require separate runbooks.
- Security review depth can grow later if diagnostics move beyond local or single-team operator use.

Verification:

- doc review against actual runtime behavior
- updated `docs/release-checklist.md`
- updated `docs/risk-register.md`

## Open Questions To Resolve In This Sprint

- What timeout and termination behavior is safe enough across participant CLIs without introducing vendor-specific branching in the contract core?
- How should the filesystem layer distinguish missing, unreadable, and invalid artifacts while preserving human-debuggable storage?
- What is the minimum real-CLI verification bar before the team can claim limited production readiness?
- Which release responsibilities should be assigned now even if packaging and hosted deployment are still deferred?

## Recommended Execution Order

1. Define subprocess guardrails and storage durability requirements first because they bound the runtime failure model.
2. Use those decisions to refresh the real-CLI and OS verification plan.
3. Convert the resulting support position into release checklist and runbook updates with named ownership.
4. Refresh risk, matrix, and roadmap docs to match the new production-readiness bar.
5. Reassess packaging direction only after the Sprint 8 exit criteria are met.

## Outcome Notes

- Sprint 8 is intentionally a production-readiness sprint rather than a feature sprint.
- Packaging remains downstream of runtime guardrails, storage durability, and release ownership.
- The expected result is not "general availability", but a sharper and more defensible answer to what Parley can support operationally today.
