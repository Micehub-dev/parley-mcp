# MCP Contract Spec

## Scope

- `parley_start`
- `parley_state`
- `parley_claim_lease`
- `parley_step`
- `parley_finish`
- topic/workspace query tools

## Contract Rules

### State Ownership

- 서버가 세션 상태를 소유한다.

### Concurrency

- `leaseOwner`
- `leaseExpiresAt`
- `stateVersion`

### Error Model

- not_found
- invalid_argument
- version_mismatch
- lease_conflict
- session_finished
- participant_failure
- storage_failure

Error messages should include the code in a machine-visible form such as `[lease_conflict] ...` so orchestrators can classify failures without fragile string parsing.

## Tool Specs

### `parley_start`

입력:

- workspaceId
- topic
- topicId?
- claudeModel?
- geminiModel?
- maxTurns?
- systemPrompt?
- orchestrator
- orchestratorRunId?

출력:

- parleySessionId
- appliedModels
- maxTurns
- stateVersion
- leaseOwner

가능한 오류:

- `invalid_argument`: disallowed participant model
- `not_found`: linked `topicId` does not exist

### `parley_state`

입력:

- parleySessionId

출력:

- state

가능한 오류:

- `not_found`: session does not exist

### `parley_claim_lease`

입력:

- parleySessionId
- orchestratorRunId
- ttlSeconds

출력:

- leaseOwner
- leaseExpiresAt
- stateVersion

가능한 오류:

- `not_found`: session does not exist
- `lease_conflict`: another valid lease owner already holds the session
- `session_finished`: session is already finished

### `parley_step`

입력:

- parleySessionId
- expectedStateVersion
- orchestratorRunId
- speakerOrder?
- userNudge?

출력:

- turn
- stateVersion
- finished
- note

가능한 오류:

- `not_found`: session does not exist
- `lease_conflict`: lease owner does not match
- `version_mismatch`: `expectedStateVersion` differs from the persisted state
- `session_finished`: session is already finished
- `participant_failure`: participant execution or output validation failed

### `parley_finish`

입력:

- parleySessionId
- orchestratorRunId?

출력:

- parleySessionId
- status
- turn
- summary

가능한 오류:

- `not_found`: session does not exist

특이사항:

- `parley_finish` is idempotent for already finished sessions.

## Open Questions

- participant stdout/stderr를 어느 수준까지 contract에 노출할지
- retry semantics를 tool 내부로 둘지 orchestrator 책임으로 둘지
