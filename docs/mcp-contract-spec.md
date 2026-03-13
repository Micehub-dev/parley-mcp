# MCP Contract Spec

## Status

This document tracks the implemented MCP contract for the current runtime.

- Sprint 4 rolling summary, structured conclusion, and explicit topic promotion are now implemented.
- Sprint 5 search, workspace-board retrieval, and diagnostic inspection surfaces are now implemented.
- Sprint 6 resume/lease verification hardening and additive repair-action hints are now implemented.
- Sprint 7 diagnostics access hardening now redacts diagnostic records by default and keeps full detail behind explicit opt-in.
- Sprint 8 subprocess guardrails and corrupted-artifact visibility are now implemented.
- Compatibility string fields remain in place so existing orchestrators can migrate additively.
- The design rationale and frozen migration rules still live in `docs/decisions/ADR-0001-sprint-4-synthesis-contract.md`.

## Scope

### Implemented Tools

- `parley_start`
- `parley_state`
- `parley_claim_lease`
- `parley_step`
- `parley_finish`
- `parley_promote_summary`
- `parley_list_workspaces`
- `parley_create_topic`
- `parley_list_topics`
- `parley_get_topic`
- `parley_search_topics`
- `parley_get_workspace_board`
- `parley_list_diagnostics`

## Contract Rules

### State Ownership

- The server owns session state.
- Orchestrators must treat session state as authoritative rather than reconstructing state from local transcript assumptions.

### Concurrency

- `leaseOwner`
- `leaseExpiresAt`
- `stateVersion`

These three fields remain the product-critical concurrency surface.

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

Error messages include the code in a machine-visible form such as `[lease_conflict] ...` so orchestrators can classify failures without fragile string parsing.

### Compatibility Rules

- `state.latestSummary` remains contract-valid as a compatibility string.
- `parley_step.latestSummary` remains contract-valid as a compatibility string.
- `parley_finish.summary` remains contract-valid as a compatibility string.
- `rollingSummary` is now the preferred machine-readable session synthesis field.
- `conclusion` is now the preferred machine-readable finish artifact.

## Shared Shapes

### `ParticipantResponse`

```json
{
  "stance": "agree | disagree | refine | undecided",
  "summary": "short structured response",
  "arguments": ["point 1"],
  "questions": ["question 1"],
  "proposed_next_step": "next action"
}
```

### `RollingSummary`

```json
{
  "synopsis": "short current state of the parley",
  "agreements": ["agreed point"],
  "disagreements": ["active disagreement"],
  "openQuestions": ["open question"],
  "actionItems": ["next action"],
  "updatedAt": "ISO-8601 timestamp"
}
```

Behavior notes:

- `rollingSummary` is updated only after a successful committed `parley_step`.
- `rollingSummary` summarizes the session so far, not only the latest turn.
- The current synthesis is heuristic and intentionally transcript-light.
- Repeated questions and action items are deduplicated with normalization so promoted memory stays less noisy.
- `undecided` turns no longer accumulate into consensus automatically.
- `latestSummary`, when present, is derived from `rollingSummary.synopsis`.

### `SessionConclusion`

```json
{
  "summary": "human-usable conclusion summary",
  "consensus": ["agreed final point"],
  "disagreements": ["remaining disagreement"],
  "openQuestions": ["question still unresolved"],
  "actionItems": ["recommended next step"],
  "recommendedDisposition": "resolved | in_progress | open"
}
```

Behavior notes:

- `summary` is the finish-time closeout text.
- `summary` is compacted from the accumulated synthesis rather than mirroring the full rolling synopsis verbatim.
- `recommendedDisposition` is a topic-promotion hint that maps into the current topic status set.
- Repeated `parley_finish` calls for the same unchanged session return the same logical conclusion.

## Tool Specs

### `parley_start`

Status:

- Implemented

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
- `storage_failure`: linked topic artifacts or new session artifacts could not be read or written safely

### `parley_state`

Status:

- Implemented

Input:

- `parleySessionId`

Output:

- `state`
- `state.participants.{claude,gemini}.resumeId` is persisted when a participant runtime returns one
- `state.latestTurn?` contains the most recently committed structured participant responses
- `state.latestSummary?` is a compatibility string derived from the current rolling synthesis
- `state.rollingSummary?` is the preferred machine-readable session synthesis field

Possible errors:

- `not_found`: session does not exist
- `storage_failure`: the persisted session artifact exists but is unreadable or invalid

### `parley_claim_lease`

Status:

- Implemented

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

Status:

- Implemented

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
- `rollingSummary`

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
- Guardrail-triggered process failures may also include `details.guardrail`, `details.timedOut`, `details.outputLimitExceeded`, `details.durationMs`, and `details.signal`.
- If a lease exists but has expired, `parley_step` returns `[lease_conflict]` until an orchestrator reclaims the lease through `parley_claim_lease`.
- Participant responses are appended to `transcript.jsonl` and mirrored in `state.latestTurn` on success.
- Resume IDs are persisted under `state.participants` when the participant runtime returns them.
- `rollingSummary` is persisted only after a successful committed turn.
- If session state save fails after participant execution, `parley_step` returns `[storage_failure]` with `details.stateCommitted = false`; the same version may be retried.
- If transcript append fails after session state save, `parley_step` returns `[storage_failure]` with `details.stateCommitted = true`; orchestrators should call `parley_state` before retrying.
- `storage_failure` also includes `details.diagnosticsPersisted` so operators know whether the diagnostic artifact exists.

### `parley_finish`

Status:

- Implemented

Input:

- `parleySessionId`
- `orchestratorRunId?`

Output:

- `parleySessionId`
- `status`
- `turn`
- `summary`
- `conclusion`

Possible errors:

- `not_found`: session does not exist

Behavior notes:

- `parley_finish` is idempotent for already finished sessions.
- `summary` is a compatibility field derived from `conclusion.summary`.
- `conclusion` is derived from the current persisted session synthesis, primarily `rollingSummary`.

### `parley_promote_summary`

Status:

- Implemented

Input:

- `parleySessionId`
- `topicId?`

Output:

- `topicId`
- `sourceSessionId`
- `updatedFields`
- `topic`

Possible errors:

- `not_found`: target topic does not exist
- `invalid_argument`: session is not finished, or neither an explicit `topicId` nor a linked session `topicId` is available

Behavior notes:

- If `topicId` is omitted, the tool uses the session's linked `topicId`.
- Promotion is explicit and does not run automatically inside `parley_finish`.
- Promotion uses the finish-time `conclusion` as the source artifact.
- Promotion maps the session conclusion into existing topic fields:
  - `conclusion.summary` -> `decisionSummary`
  - synthesized topic summary -> `canonicalSummary`
  - `conclusion.openQuestions` -> `openQuestions`
  - `conclusion.actionItems` -> `actionItems`
  - `conclusion.recommendedDisposition` -> `status`
- `linkedSessionIds` continues to act as the lightweight provenance link.
- Repeated promotion for an unchanged session/topic pair does not duplicate links or status-history entries.

### Topic and Workspace Query Tools

Status:

- Implemented

Implemented tools:

- `parley_list_workspaces`
- `parley_create_topic`
- `parley_list_topics`
- `parley_get_topic`
- `parley_search_topics`
- `parley_get_workspace_board`
- `parley_list_diagnostics`

Behavior notes:

- Topic records are filesystem-backed and human-debuggable.
- Topic, session, and diagnostic read paths now distinguish missing artifacts from invalid JSON and unreadable directories/files.
- Topics may be linked to sessions through `topicId` at session creation time.
- Promoted knowledge is stored directly on the existing `TopicRecord` shape rather than in a separate opaque index.
- `parley_list_topics` now searches promoted memory additively rather than limiting `query` to `title` and `body`.
- Search remains lexical and filesystem-backed for Sprint 5; no semantic index or external memory service is required.
- Workspace board digests are derived at read time from persisted topic records.
- Operator repair guidance is derived at diagnostic-read time and is not persisted on the core session state.

### `parley_list_topics`

Status:

- Implemented

Input:

- `workspaceId`
- `status?`
- `query?`
- `tags?`

Output:

- `topics`

Behavior notes:

- `query`, when present, matches across `title`, `body`, `decisionSummary`, `canonicalSummary`, `openQuestions`, `actionItems`, and `tags`.
- `tags`, when present, requires each requested tag to be present on the topic.
- Output remains the raw topic list for compatibility; use `parley_search_topics` for match metadata.

### `parley_get_topic`

Status:

- Implemented

Input:

- `workspaceId`
- `topicId`

Output:

- `topic`
- `boardCard`

Behavior notes:

- `boardCard` is an additive digest shape intended for future board-style clients.
- `boardCard` includes status, tags, linked-session count, and summary-presence metadata.

### `parley_search_topics`

Status:

- Implemented

Input:

- `workspaceId`
- `status?`
- `query?`
- `tags?`
- `limit`

Output:

- `workspaceId`
- `results`

`results` shape:

```json
{
  "topic": {
    "topicId": "topic-001",
    "title": "Release rollout"
  },
  "matchedFields": ["decisionSummary", "actionItems"],
  "score": 6
}
```

Behavior notes:

- Search is lexical and token-based over persisted topic fields.
- A topic must satisfy all query tokens across the combined searchable surface to match.
- Results are sorted by `score` and then `updatedAt`.

### `parley_get_workspace_board`

Status:

- Implemented

Input:

- `workspaceId`
- `limit`

Output:

- `workspaceId`
- `topicCount`
- `lastUpdatedAt?`
- `statusCounts`
- `board`
- `openQuestions`
- `actionItems`

Behavior notes:

- `board` groups topic cards by `open`, `in_progress`, and `resolved`.
- Board cards are derived from topic records and do not require a separate board index.
- `openQuestions` and `actionItems` are workspace-level digests intended to keep future clients from rebuilding these summaries manually.

### `parley_list_diagnostics`

Status:

- Implemented

Input:

- `parleySessionId`
- `outcome?`
- `participant?`
- `failureKind?`
- `limit`
- `detailLevel?` (`redacted` | `full`, default `redacted`)

Output:

- `parleySessionId`
- `diagnostics`

`diagnostics` shape:

```json
{
  "diagnosticId": "step-0001-participant_failure-1234567890",
  "record": {
    "outcome": "participant_failure",
    "stateCommitStatus": "not_committed",
    "participants": [
      {
        "participant": "gemini",
        "raw": {
          "command": "[redacted]",
          "args": ["[redacted 3 args]"],
          "stdout": "[redacted 120 chars]",
          "stderr": "[redacted 42 chars]",
          "exitCode": 17,
          "durationMs": 10423,
          "guardrail": "timeout",
          "timedOut": true
        },
        "redaction": {
          "detailLevel": "redacted",
          "hiddenFields": ["raw.command", "raw.args", "raw.stdout", "raw.stderr"]
        }
      }
    ]
  },
  "repairGuidance": {
    "summary": "Participant execution failed before the turn was committed.",
    "recommendedSteps": ["Inspect the failed participant stderr, exit code, and launcher command."],
    "canRetrySameVersion": true,
    "shouldReadStateFirst": false,
    "nextAction": {
      "tool": "parley_step",
      "arguments": {
        "parleySessionId": "parley-001",
        "expectedStateVersion": 2,
        "orchestratorRunId": "run-001",
        "speakerOrder": ["claude", "gemini"]
      },
      "reason": "The failed turn was not committed, so the same step can be retried after the underlying issue is fixed."
    }
  }
}
```

Behavior notes:

- Diagnostics remain stored under `.multi-llm/sessions/{sessionId}/diagnostics/`.
- Filtering is additive and filesystem-backed.
- `record` is a read-time view rather than a guarantee of the raw persisted JSON payload.
- `detailLevel = redacted` hides raw subprocess command, args, stdout, stderr, resume IDs, structured participant responses, and user nudges from the MCP response.
- non-sensitive runtime metadata such as `durationMs`, `signal`, `guardrail`, `timedOut`, and `outputLimitExceeded` remain visible in both redacted and full diagnostic views.
- `detailLevel = full` returns the unredacted diagnostic record shape for intentional local operator debugging.
- `repairGuidance.canRetrySameVersion = false` together with `shouldReadStateFirst = true` signals the replay-boundary case where session state may already be committed.
- `repairGuidance.nextAction` is additive helper output derived from the diagnostic record; it does not introduce new session state.

## Open Questions

- How long should compatibility string fields such as `latestSummary` and `summary` remain after downstream orchestrators adopt the structured fields?
- Whether the current lexical Sprint 5 search surface is sufficient before a stronger second-pass synthesis or optional index layer becomes necessary
