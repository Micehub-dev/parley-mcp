# ADR-0001: Sprint 4 Synthesis Contract

## Status

Accepted

## Date

2026-03-12

## Context

Parley is already beyond the placeholder session phase.

- `parley_step` executes real participant subprocesses.
- participant outputs are validated and normalized
- recovery and replay boundaries are documented
- failed steps persist diagnostics

The next product gap is knowledge synthesis.

Today:

- `state.latestSummary` is a stitched string derived from the latest successful turn
- `parley_finish` returns a lightweight `summary` string
- topic records exist, but there is no explicit contract for promoting completed session outcomes into topic memory

Sprint 4 needs a design that gives future implementation agents a stable target without breaking the currently implemented contract.

## Decision

### 1. Add structured rolling summary as an additive session field

Sprint 4 will add an optional `rollingSummary` field to session state and to successful `parley_step` output.

The target shape is:

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

Semantics:

- `synopsis` is the preferred concise machine- and human-readable state summary
- `agreements` captures points both sides appear to accept for now
- `disagreements` captures active unresolved differences
- `openQuestions` captures unresolved questions worth carrying forward
- `actionItems` captures recommended next actions emerging from the parley
- `updatedAt` reflects the successful committed turn that last updated the summary

Persistence rules:

- `rollingSummary` is updated only after a successful committed `parley_step`
- `rollingSummary` summarizes the session so far, not only the latest turn
- raw transcript text must not be embedded into `rollingSummary`

### 2. Keep compatibility string fields during the migration

Sprint 4 must remain additive first.

- `state.latestSummary` remains valid during migration
- `parley_step.latestSummary` remains valid during migration
- once `rollingSummary` exists, compatibility string fields should be derived from `rollingSummary.synopsis` or equivalent summary logic

This avoids breaking existing orchestrators while the structured summary contract is adopted.

### 3. Add structured conclusion as an additive finish artifact

Sprint 4 will add an optional `conclusion` field to `parley_finish`.

The target shape is:

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

Semantics:

- `summary` is the finish-time closeout text
- `consensus` captures points the session should treat as settled enough to carry into topic memory
- `disagreements` captures unresolved but still important differences
- `openQuestions` captures unknowns that need future work
- `actionItems` captures recommended follow-up actions
- `recommendedDisposition` is a topic-promotion hint, not an automatic mandate

Compatibility rules:

- `parley_finish.summary` remains valid during migration
- once `conclusion` exists, `parley_finish.summary` should be derived from `conclusion.summary`
- repeated `parley_finish` calls for the same finished session should return the same logical conclusion

### 4. Topic promotion will be an explicit tool, not automatic finish behavior

Sprint 4 will use an explicit promotion tool instead of silently mutating topics inside `parley_finish`.

Chosen surface:

- tool name: `parley_promote_summary`

Rationale:

- preserves operator control
- keeps `parley_finish` focused on session closeout
- makes promotion idempotency easier to reason about
- avoids surprising topic mutation for orchestrators that only wanted a session conclusion

### 5. `parley_promote_summary` should use the session as the source of truth

The preferred first-pass tool contract is:

Input:

- `parleySessionId`
- `topicId?`

Output:

- `topicId`
- `sourceSessionId`
- `updatedFields`
- `topic`

Behavior:

- if `topicId` is omitted, use the session's linked `topicId`
- if neither an input `topicId` nor a linked session `topicId` exists, fail with `invalid_argument`
- require the source session to be finished before promotion
- use `conclusion` as the primary source artifact
- if `conclusion` is temporarily unavailable during migration, use the best available finish-time synthesis path
- promotion must be idempotent for the same session and topic pair

### 6. First-pass topic promotion maps into existing topic fields

Sprint 4 should prefer mapping promoted data into the existing `TopicRecord` shape rather than expanding the topic schema aggressively.

The intended mapping is:

- `conclusion.summary` -> `decisionSummary`
- `conclusion.summary` or a fuller synthesis form -> `canonicalSummary`
- `conclusion.openQuestions` -> `openQuestions`
- `conclusion.actionItems` -> `actionItems`
- `conclusion.recommendedDisposition` -> `status`

Supporting rules:

- `linkedSessionIds` must include the promoted session id
- `updatedAt` must be refreshed
- `statusHistory` should be updated only if the topic status actually changes

### 7. Avoid new provenance-heavy topic metadata in Sprint 4

Sprint 4 should not introduce a large promotion-history object or transcript-derived blob into topic records.

Rationale:

- current topic storage is intentionally simple and human-debuggable
- provenance already exists through session linkage
- richer audit history can be added later if operators need it

## Consequences

### Positive

- future coding agents get a clear additive migration path
- orchestrator compatibility is preserved during Sprint 4
- `parley_finish` and topic promotion have distinct responsibilities
- topic promotion can be tested and retried independently

### Negative

- the contract temporarily carries both string summary fields and structured fields
- first-pass synthesis may still be heuristic
- topic promotion remains one explicit step instead of being fully automatic

## Implementation Notes For Future Agents

- update `src/types.ts` first so the new shapes become explicit
- keep `exactOptionalPropertyTypes` discipline when adding optional structured fields
- update `docs/mcp-contract-spec.md` and Sprint 4 docs together with the code
- add tests before removing or de-emphasizing compatibility string fields
- prefer additive handler changes in `src/server.ts` and service-layer logic in `src/services/parley-service.ts`

## Follow-Up

- Implement `rollingSummary` persistence in `parley_step`
- Implement `conclusion` generation in `parley_finish`
- Add `parley_promote_summary`
- Revisit whether compatibility string fields can be deprecated after downstream orchestrators adopt the structured fields
