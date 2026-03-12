# MCP Contract Spec

## Scope

- `debate_start`
- `debate_state`
- `debate_claim_lease`
- `debate_step`
- `debate_finish`
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
- participant_failure
- storage_failure

## Tool Specs

### `debate_start`

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

- debateSessionId
- appliedModels
- maxTurns
- stateVersion
- leaseOwner

### `debate_step`

입력:

- debateSessionId
- expectedStateVersion
- orchestratorRunId
- speakerOrder?
- userNudge?

출력:

- turn
- stateVersion
- finished
- note

## Open Questions

- participant stdout/stderr를 어느 수준까지 contract에 노출할지
- retry semantics를 tool 내부로 둘지 orchestrator 책임으로 둘지

