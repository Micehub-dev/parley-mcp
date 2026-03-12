# Sprint 1 Brief

## Dates

- 2026-03-23 to 2026-04-03

## Goal

- Core session lifecycle and contract stabilization

## Committed Scope

- [x] session state schema stabilization
- [ ] lease/stateVersion conflict handling
- [x] `debate_start`
- [x] `debate_state`
- [ ] `debate_claim_lease`
- [x] `debate_finish`
- [ ] error model definition

## Stretch Scope

- [ ] `debate_step` participant adapter connection draft only

## Exit Criteria

- [ ] lifecycle tests pass
- [ ] contract spec 1.0 draft completed
- [ ] risk register refreshed

## Dependencies

- architecture decisions frozen for session schema
- adapter interface draft

## Owners

- PM: TBD
- Engineering: TBD

## Task Tracker

### Task 1. Session Contract Stabilization

- [x] Move session lifecycle rules into a testable service layer
- [x] Persist a stable `workspaceRoot` value instead of deriving a non-existent workspace path
- [x] Require linked `topicId` values to resolve to a real topic before session creation
- [x] Make `debate_finish` idempotent for repeated orchestrator calls

Review:

- Session lifecycle code is now concentrated in one place instead of being spread across MCP handlers.
- The previous `workspaceRoot = path.join(rootDir, workspaceId)` behavior was a correctness bug, not just cleanup.
- Topic linking is safer because missing topic references now fail fast.

Debt Watch:

- Tool handlers still return plain JSON text payloads; typed response helpers can wait until Sprint 2.
- MCP-layer error serialization is still minimal even though domain error codes now exist.

Verification:

- `npm run typecheck`
- `npm run build`
- `npx tsx --test test/debate-service.lifecycle.test.ts`

### Task 2. Lease and Error Semantics

- [ ] Introduce explicit domain error codes for lifecycle failures
- [ ] Harden lease conflict and version mismatch behavior
- [ ] Add focused tests for invalid models, missing topics, finished sessions, and lease conflicts

### Task 3. Sprint Exit Quality Bar

- [ ] Add a stable test script and integrate tests into CI expectations
- [ ] Add high-value lifecycle integration coverage for `debate_claim_lease` and `debate_step`
- [ ] Sync contract and risk docs with the implemented behavior

