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

- The server owns session state.

### Concurrency

- `leaseOwner`
- `leaseExpiresAt`
- `stateVersion`

### Tool Error Envelope

- Domain failures are returned as MCP tool results with `isError: true`.
- Error payloads are JSON text blocks with this shape:

```json
{
  "error": {
    "code": "lease_conflict",
    "message": "[lease_conflict] Session lease has expired and must be reclaimed before parley_step.",
    "details": {
      "retryable": true,
      "staleLease": true
    }
  }
}
```

### Error Model

- `not_found`
- `invalid_argument`
- `version_mismatch`
- `lease_conflict`
- `session_finished`
- `participant_failure`
- `storage_failure`

Error messages should include the code in a machine-visible form such as `[lease_conflict] ...` so orchestrators can classify failures without fragile string parsing.

## Tool Specs

### `parley_start`

Input:

- `workspaceId`
- `topic`
- `topicId?`
- `claudeModel?`
- `geminiModel?`
- `maxTurns?`
- `systemPrompt?`
- `orchestrator`
- `orchestratorRunId?`

Output:

- `parleySessionId`
- `appliedModels`
- `maxTurns`
- `stateVersion`
- `leaseOwner`

Possible errors:

- `invalid_argument`: disallowed participant model
- `not_found`: linked `topicId` does not exist

### `parley_state`

Input:

- `parleySessionId`

Output:

- `state`
- `state.participants.{claude,gemini}.resumeId` is persisted when a participant runtime returns one
- `state.latestTurn?` contains the most recently committed structured participant responses

Possible errors:

- `not_found`: session does not exist

### `parley_claim_lease`

Input:

- `parleySessionId`
- `orchestratorRunId`
- `ttlSeconds`

Output:

- `leaseOwner`
- `leaseExpiresAt`
- `stateVersion`

Possible errors:

- `not_found`: session does not exist
- `lease_conflict`: another valid lease owner already holds the session
- `session_finished`: session is already finished

Behavior notes:

- Expired leases may be reclaimed by any orchestrator via `parley_claim_lease`.
- Reclaiming a lease increments `stateVersion`.

### `parley_step`

Input:

- `parleySessionId`
- `expectedStateVersion`
- `orchestratorRunId`
- `speakerOrder?`
- `userNudge?`

Output:

- `turn`
- `stateVersion`
- `finished`
- `speakerOrder`
- `responses`
- `latestSummary`

`responses` shape:

```json
{
  "claude": {
    "stance": "agree | disagree | refine | undecided",
    "summary": "short structured response",
    "arguments": ["point 1"],
    "questions": ["question 1"],
    "proposed_next_step": "next action"
  },
  "gemini": {
    "stance": "agree | disagree | refine | undecided",
    "summary": "short structured response",
    "arguments": ["point 1"],
    "questions": ["question 1"],
    "proposed_next_step": "next action"
  }
}
```

Possible errors:

- `not_found`: session does not exist
- `lease_conflict`: lease owner does not match, or a recorded lease has expired and must be reclaimed first
- `version_mismatch`: `expectedStateVersion` differs from the persisted state
- `session_finished`: session is already finished
- `participant_failure`: participant execution or output validation failed
- `storage_failure`: post-execution persistence failed; `details.stateCommitted` distinguishes replay boundaries

Behavior notes:

- `speakerOrder`, when provided, must contain `claude` and `gemini` exactly once.
- `parley_step` validates both participant outputs before committing the turn.
- If either participant fails process execution or output validation, the step fails with `[participant_failure]`, the turn is not persisted, and diagnostics are written under `.multi-llm/sessions/{sessionId}/diagnostics/`.
- `participant_failure` includes `details.reason` (`process_error` or `invalid_output`), `details.retryable`, and `details.diagnosticsPersisted`.
- If a lease exists but has expired, `parley_step` returns `[lease_conflict]` until an orchestrator reclaims the lease through `parley_claim_lease`.
- Participant responses are appended to `transcript.jsonl` and mirrored in `state.latestTurn` on success.
- Resume IDs are persisted under `state.participants` when the participant runtime returns them.
- If session state save fails after participant execution, `parley_step` returns `[storage_failure]` with `details.stateCommitted = false`; the same version may be retried.
- If transcript append fails after session state save, `parley_step` returns `[storage_failure]` with `details.stateCommitted = true`; orchestrators should call `parley_state` before retrying.
- `storage_failure` also includes `details.diagnosticsPersisted` so operators know whether the diagnostic artifact exists.

### `parley_finish`

Input:

- `parleySessionId`
- `orchestratorRunId?`

Output:

- `parleySessionId`
- `status`
- `turn`
- `summary`

Possible errors:

- `not_found`: session does not exist

Notes:

- `parley_finish` is idempotent for already finished sessions.

## Open Questions

- Should future retry semantics live in the tool contract or remain the orchestrator's responsibility?
