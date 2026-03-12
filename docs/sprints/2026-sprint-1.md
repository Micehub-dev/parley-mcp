# Sprint 1 Brief

## Dates

- 2026-03-23 to 2026-04-03

## Goal

- Core session lifecycle and contract stabilization

## Committed Scope

- [x] session state schema stabilization
- [x] lease/stateVersion conflict handling
- [x] `parley_start`
- [x] `parley_state`
- [x] `parley_claim_lease`
- [x] `parley_finish`
- [x] error model definition

## Stretch Scope

- [ ] `parley_step` participant adapter connection draft only

## Exit Criteria

- [x] lifecycle tests pass
- [x] contract spec 1.0 draft completed
- [x] risk register refreshed

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
- [x] Make `parley_finish` idempotent for repeated orchestrator calls

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
- `npx tsx --test test/parley-service.lifecycle.test.ts`

### Task 2. Lease and Error Semantics

- [x] Introduce explicit domain error codes for lifecycle failures
- [x] Harden lease conflict and version mismatch behavior
- [x] Add focused tests for invalid models, missing topics, finished sessions, and lease conflicts

Review:

- Error codes are now part of the domain layer instead of being hidden inside ad hoc exception text.
- The highest-value failure modes for Sprint 1 are covered: bad model selection, bad topic linkage, lease ownership, finished sessions, and state version drift.
- `parley_step` stays placeholder-only, but its contract boundary is now much harder to misuse.

Debt Watch:

- MCP transport-level error shaping is still thin; richer structured tool errors may be worth adding once more clients consume the server.
- Lease expiry behavior is tested through current ownership rules, but explicit stale-lease recovery coverage is still missing.

Verification:

- `npm run typecheck`
- `npm run build`
- `npx tsx --test test/parley-service.lifecycle.test.ts`

### Task 3. Sprint Exit Quality Bar

- [x] Add a stable test script and integrate tests into CI expectations
- [x] Add high-value lifecycle integration coverage for `parley_claim_lease` and `parley_step`
- [x] Sync contract and risk docs with the implemented behavior

Review:

- The sprint now has a single command-level verification path: `npm test`.
- CI will catch lifecycle regressions instead of relying on local discipline alone.
- `parley_step` remains intentionally placeholder logic, but its current termination and transcript behavior are now covered.

Debt Watch:

- There is still no dedicated MCP transport integration test exercising the stdio server end-to-end.
- Topic and workspace tools are not yet covered by automated tests because Sprint 1 stayed focused on core session semantics.

Verification:

- `npm run typecheck`
- `npm test`
- `npm run build`
