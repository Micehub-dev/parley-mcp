# Sprint 3 Brief

## Dates

- Planned window: 2026-04-20 to 2026-05-01
- Planning note: as of 2026-03-12, the repository is already functionally at the Sprint 2 exit bar, so Sprint 3 should prioritize reliability and recovery behavior before moderation-quality synthesis work.

## Goal

- Make participant-backed parley runs operationally reliable by defining recovery semantics, diagnostic capture, and one real MCP end-to-end verification path.

## Why This Sprint Now

- Core session lifecycle and participant subprocess execution are already implemented.
- The highest-risk gap is no longer feature absence, but unclear recovery behavior after lease expiry, participant failure, or transport-level issues.
- Summary and conclusion quality matter, but they are lower leverage until operators and orchestrators can reliably understand and recover from failure states.

## Committed Scope

- [ ] Freeze recovery rules for `parley_step` failure, stale lease handling, and retry ownership
- [ ] Persist debug-friendly subprocess diagnostics outside normalized session state
- [ ] Tighten the error taxonomy so orchestrators can distinguish recoverable vs terminal failures
- [ ] Add at least one MCP stdio end-to-end test that exercises `start -> claim_lease -> step -> finish`
- [ ] Refresh contract and risk docs to match the final recovery behavior

## Stretch Scope

- [ ] Add configurable participant step timeout defaults
- [ ] Add retry policy defaults at the service layer
- [ ] Add a diagnostic bundle reader resource or operator-facing tool

## Explicit Non-Goals

- [ ] Rolling summary quality improvements
- [ ] Conclusion generation or moderator verdict synthesis
- [ ] Topic board expansion, search, or workspace knowledge graph work
- [ ] Plugin, extension, packaging, or UI work

## Exit Criteria

- [ ] Recovery behavior for stale lease, participant failure, and replay boundaries is documented and implemented
- [ ] A failed participant step leaves enough diagnostic data for operator triage without polluting normalized session state
- [ ] At least one stdio MCP integration scenario passes in automated verification
- [ ] `docs/mcp-contract-spec.md` and `docs/risk-register.md` reflect the final behavior
- [ ] `npm test`, `npm run typecheck`, `npm run lint`, and `npm run build` are green

## Dependencies

- Confirm where diagnostic artifacts should live under `.multi-llm/`
- Decide whether retry policy remains orchestrator-owned or gets a first-pass server default
- Freeze the minimum structured error envelope expected by downstream orchestrators

## Owners

- PM: TBD
- Engineering: TBD

## Task Tracker

### Task 1. Recovery Semantics and Error Contract

- [ ] Define stale-lease recovery behavior and document who may reclaim execution
- [ ] Distinguish recoverable participant/runtime failures from terminal contract failures
- [ ] Clarify replay and retry expectations after subprocess completion but before state commit

Review focus:

- The biggest product risk is ambiguous ownership during retries and partial failures.
- Recovery rules need to stay orchestrator-agnostic and machine-readable.

Expected outcome:

- `parley_step` failure states are classified clearly enough that Codex, Claude, and Gemini orchestrators can make the same next decision.
- Lease/version semantics remain the primary concurrency control surface.

Debt Watch:

- Rich structured MCP transport errors may still lag behind domain-level error precision.
- Full repair tooling can remain out of scope if retry and re-entry rules are crisp.

Verification:

- `npm test`
- `npm run typecheck`
- targeted failure-mode tests for stale lease and retry scenarios

### Task 2. Diagnostics and Observability

- [ ] Capture subprocess stdout/stderr, exit code, and execution metadata in a debug-friendly artifact
- [ ] Keep normalized session state limited to product-facing data such as structured responses and resume IDs
- [ ] Decide whether diagnostics attach per step, per session, or both

Review focus:

- Operators need enough evidence to debug a failed participant run without turning session state into a dump of transport internals.
- Diagnostic storage should remain filesystem-simple and human-debuggable.

Expected outcome:

- A failed run can be investigated from `.multi-llm/` artifacts without guessing what the participant process returned.
- The persisted contract seen by orchestrators remains stable and minimal.

Debt Watch:

- Redaction policy may still be incomplete if participant outputs can include sensitive path or environment details.
- A future resource or tool may still be needed to surface diagnostics cleanly over MCP.

Verification:

- `npm test`
- fixture-backed checks for diagnostic artifact creation and failure-path persistence

### Task 3. MCP End-to-End Verification

- [ ] Add one stdio transport integration test for a successful end-to-end session flow
- [ ] Add one end-to-end failure-path test if the harness cost stays reasonable
- [ ] Reflect actual status in `docs/test-matrix.md`

Review focus:

- The current suite is strong at the service and adapter layers, but there is still no automated proof that the stdio MCP surface behaves correctly end to end.
- Even one real integration path will reduce contract drift between handler wiring and domain behavior.

Expected outcome:

- A regression in MCP tool registration, argument wiring, or transport shaping is caught before release.
- The test matrix begins tracking implemented coverage instead of planned coverage only.

Debt Watch:

- Cross-orchestrator matrix coverage will still be incomplete after this sprint.
- Windows-only validation is acceptable for now if the stdio contract is the main target.

Verification:

- `npm test`
- `npm run build`
- integration test command added to the normal verification path if stable

### Task 4. Documentation and Risk Refresh

- [ ] Update `docs/mcp-contract-spec.md` with final recovery and diagnostic behavior
- [ ] Refresh `docs/risk-register.md` review dates and mitigations based on implemented recovery rules
- [ ] Update roadmap/status language that still implies `parley_step` is placeholder-level

Review focus:

- The repository has already moved ahead of some planning assumptions, so PM documentation must catch up before the next sprint layers on more behavior.

Expected outcome:

- Product planning docs point at the real current state rather than a past scaffold phase.
- The next sprint can focus on moderation and synthesis without reopening reliability decisions.

Verification:

- doc review against implemented code paths
- `npm run lint`

## Open Questions To Resolve In This Sprint

- Should a stale lease be reclaimable automatically on time expiry alone, or should there be an explicit release/reconcile flow?
- Should retry defaults live only in orchestrators, or should the server expose a first-pass timeout/retry policy?
- What is the smallest persisted diagnostic artifact that still makes operator triage practical?

## Recommended Execution Order

1. Freeze failure and retry semantics in the contract.
2. Add diagnostic artifact persistence behind tests.
3. Add one stdio MCP end-to-end verification path.
4. Refresh contract, risk, and test-matrix docs.
5. Re-plan the following sprint around rolling summary and conclusion generation.
