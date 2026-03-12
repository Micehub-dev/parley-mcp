# Sprint 2 Brief

## Dates

- Planned window: 2026-04-06 to 2026-04-17
- Planning note: as of 2026-03-12, the repository is already functionally past the Sprint 1 exit bar, so this brief is ready to use immediately even if the calendar plan remains unchanged.

## Goal

- Turn `parley_step` from a placeholder state transition into a real participant execution path for `claude` and `gemini`.

## Why This Sprint Now

- The session lifecycle contract is implemented and covered by tests.
- The highest-value missing product capability is real participant execution.
- Without subprocess-backed participant turns, Parley does not yet deliver its core product value despite having a stable session engine.

## Committed Scope

- [ ] Add a participant adapter boundary for `claude` and `gemini`
- [ ] Execute participant subprocesses from `parley_step`
- [ ] Capture normalized structured participant output
- [ ] Validate participant output against a shared schema
- [ ] Persist participant responses into transcript and session state
- [ ] Introduce `participant_failure` handling in the domain and MCP layers
- [ ] Define resume ID persistence semantics for each participant
- [ ] Add service-level tests for successful step execution and participant failure cases

## Stretch Scope

- [ ] Capture stdout/stderr snapshots in a debug-friendly shape
- [ ] Add MCP stdio integration coverage for one end-to-end session flow
- [ ] Add configurable step timeout and retry policy defaults

## Explicit Non-Goals

- [ ] Rolling summary quality improvements
- [ ] Conclusion generation
- [ ] Topic board expansion or search
- [ ] Plugin, extension, packaging, or UI work

## Exit Criteria

- [ ] `parley_step` invokes real adapter code instead of placeholder-only orchestration logging
- [ ] Both participants return a normalized response object or a structured `participant_failure`
- [ ] Resume identifiers are persisted when returned by the participant runtime
- [ ] Contract docs reflect the exact `parley_step` response and error behavior
- [ ] `npm test`, `npm run typecheck`, and `npm run build` are green

## Dependencies

- Confirm the minimal adapter contract for subprocess execution
- Freeze the first-pass participant output schema
- Decide how much subprocess debug detail belongs in persisted state versus transcript-only audit data

## Owners

- PM: TBD
- Engineering: TBD

## Task Tracker

### Task 1. Participant Adapter Contract

- [ ] Define a small adapter interface with input, raw execution result, normalized output, and failure shape
- [ ] Keep adapter-specific flags and command construction outside `ParleyService`
- [ ] Ensure the contract is orchestrator-agnostic and does not leak CLI-specific semantics into session state

Review focus:

- The main architectural risk is coupling session orchestration to CLI invocation details too early.
- A narrow adapter boundary keeps later participants and policy layers possible.

### Task 2. `parley_step` Runtime Execution

- [ ] Replace placeholder note-only behavior with adapter invocation
- [ ] Respect `speakerOrder` while preserving the current lease and `stateVersion` invariants
- [ ] Append participant messages to `transcript.jsonl`
- [ ] Persist participant resume IDs when available
- [ ] Update finish behavior when `maxTurns` is reached after a real step

Review focus:

- This is the first sprint where `parley_step` becomes product-defining behavior instead of scaffolding.
- Partial failure handling must be explicit: we need a clear rule for what is persisted if one participant succeeds and the other fails.

### Task 3. Structured Output and Error Semantics

- [ ] Add a shared participant response schema
- [ ] Validate adapter output before mutating final session state
- [ ] Add `participant_failure` to the domain error taxonomy
- [ ] Return machine-visible error codes consistently from the MCP layer

Review focus:

- Contract drift is likely unless the schema and error rules are documented together with the code.
- Sprint 2 should end with a contract that future moderation and summary work can safely build on.

### Task 4. Test and Verification Coverage

- [ ] Add unit or service tests for successful two-participant execution
- [ ] Add tests for malformed participant output
- [ ] Add tests for subprocess failure propagation
- [ ] Add tests for resume ID persistence

Debt watch:

- Workspace/topic tools still have lighter test coverage than session lifecycle paths.
- Full MCP transport integration can remain stretch scope if the adapter contract lands cleanly.

## Open Questions To Resolve During Sprint

- Should `parley_step` fail the whole step when one participant output is invalid, or persist partial success with repair metadata?
- Should stdout/stderr live in transcript metadata, a separate diagnostic file, or only in transient logs?
- Is the first adapter implementation allowed to shell out directly, or do we want a tiny execution wrapper from day one?

## Recommended Execution Order

1. Freeze the adapter interface and shared participant schema.
2. Implement one happy-path adapter behind tests.
3. Wire `parley_step` to the adapter boundary and persist normalized outputs.
4. Add failure taxonomy and malformed-output handling.
5. Update `docs/mcp-contract-spec.md` to match the final behavior before calling the sprint done.
