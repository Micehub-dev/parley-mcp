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

- [x] Add a participant adapter boundary for `claude` and `gemini`
- [x] Execute participant subprocesses from `parley_step`
- [x] Capture normalized structured participant output
- [x] Validate participant output against a shared schema
- [x] Persist participant responses into transcript and session state
- [x] Introduce `participant_failure` handling in the domain and MCP layers
- [x] Define resume ID persistence semantics for each participant
- [x] Add service-level tests for successful step execution and participant failure cases

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

- [x] `parley_step` invokes real adapter code instead of placeholder-only orchestration logging
- [x] Both participants return a normalized response object or a structured `participant_failure`
- [x] Resume identifiers are persisted when returned by the participant runtime
- [x] Contract docs reflect the exact `parley_step` response and error behavior
- [x] `npm test`, `npm run typecheck`, and `npm run build` are green

## Dependencies

- Confirm the minimal adapter contract for subprocess execution
- Freeze the first-pass participant output schema
- Decide how much subprocess debug detail belongs in persisted state versus transcript-only audit data

## Owners

- PM: TBD
- Engineering: TBD

## Task Tracker

### Task 1. Participant Adapter Contract

- [x] Define a small adapter interface with input, raw execution result, normalized output, and failure shape
- [x] Keep adapter-specific flags and command construction outside `ParleyService`
- [x] Ensure the contract is orchestrator-agnostic and does not leak CLI-specific semantics into session state

Review focus:

- The main architectural risk is coupling session orchestration to CLI invocation details too early.
- A narrow adapter boundary keeps later participants and policy layers possible.

Review:

- `ParleyService` now depends on a small adapter registry instead of embedding CLI argument construction.
- Raw execution details stay inside the adapter/runtime layer, while persisted session state keeps only normalized response data and resume IDs.
- The shared participant schema is frozen in one place so later moderation work can build on a stable contract.

Debt Watch:

- Gemini tool isolation still relies on prompt discipline because this sprint intentionally did not add a policy file workflow.
- Command names remain fixed to `claude` and `gemini`; configurable binary paths can wait until there is a stronger operator requirement.

Verification:

- `npm test`
- `npm run typecheck`
- `npm run lint`

### Task 2. `parley_step` Runtime Execution

- [x] Replace placeholder note-only behavior with adapter invocation
- [x] Respect `speakerOrder` while preserving the current lease and `stateVersion` invariants
- [x] Append participant messages to `transcript.jsonl`
- [x] Persist participant resume IDs when available
- [x] Update finish behavior when `maxTurns` is reached after a real step

Review focus:

- This is the first sprint where `parley_step` becomes product-defining behavior instead of scaffolding.
- Partial failure handling must be explicit: we need a clear rule for what is persisted if one participant succeeds and the other fails.

Review:

- `parley_step` now executes both participants in order, validates both outputs, and only then commits the turn.
- Lease ownership and `stateVersion` checks still guard the write path before any state mutation is persisted.
- `latestTurn` gives the session state a structured last-turn snapshot without leaking adapter-specific transport details.

Debt Watch:

- The service currently fails the whole step when one participant fails after the other has already run; repair or replay support is still a later concern.
- Transcript entries store normalized JSON as text for simplicity; richer per-turn diagnostic files remain stretch scope.

Verification:

- `npm test`
- `npm run typecheck`
- `npm run lint`

### Task 3. Structured Output and Error Semantics

- [x] Add a shared participant response schema
- [x] Validate adapter output before mutating final session state
- [x] Add `participant_failure` to the domain error taxonomy
- [x] Return machine-visible error codes consistently from the MCP layer

Review focus:

- Contract drift is likely unless the schema and error rules are documented together with the code.
- Sprint 2 should end with a contract that future moderation and summary work can safely build on.

Review:

- Adapter parsing and service-layer validation both enforce the same shared schema, which closes off a high-value malformed-output failure mode.
- `participant_failure` is now part of the domain error taxonomy, and MCP-visible errors still carry machine-readable `[code]` prefixes.
- The contract now distinguishes successful structured responses from process or validation failures without changing lease/version semantics.

Debt Watch:

- MCP transport errors are still surfaced through message strings instead of a richer structured error envelope.
- The first-pass summary is a simple stitched string from both participants; moderation-quality synthesis stays out of Sprint 2.

Verification:

- `npm test`
- `npm run typecheck`
- `npm run lint`

### Task 4. Test and Verification Coverage

- [x] Add unit or service tests for successful two-participant execution
- [x] Add tests for malformed participant output
- [x] Add tests for subprocess failure propagation
- [x] Add tests for resume ID persistence

Debt watch:

- Workspace/topic tools still have lighter test coverage than session lifecycle paths.
- Full MCP transport integration can remain stretch scope if the adapter contract lands cleanly.

Review:

- Service tests now cover the happy path, malformed structured output, subprocess-style failures, and resume ID persistence.
- Adapter tests exercise command construction and CLI payload parsing without depending on installed external CLIs.
- Regression coverage now targets the highest-value Sprint 2 invariants instead of the old placeholder behavior.

Verification:

- `npm test`
- `npm run typecheck`
- `npm run lint`
- `npm run build`

## Open Questions Resolved In This Implementation

- `parley_step` now fails the whole step when any participant output is invalid or the process fails; no partial turn commit occurs.
- Stdout and stderr remain runtime/debug-only data for now and are not persisted into session state.
- The first adapter implementation shells out directly behind a small `CommandExecutor` boundary so later wrappers can replace it surgically.

## Recommended Execution Order

1. Freeze the adapter interface and shared participant schema.
2. Implement one happy-path adapter behind tests.
3. Wire `parley_step` to the adapter boundary and persist normalized outputs.
4. Add failure taxonomy and malformed-output handling.
5. Update `docs/mcp-contract-spec.md` to match the final behavior before calling the sprint done.
