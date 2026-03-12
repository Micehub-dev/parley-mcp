# Sprint 4 Brief

## Dates

- Planned window: 2026-05-04 to 2026-05-15
- Planning note: as of 2026-03-12, the repository is already at the Sprint 3 reliability bar, so the next highest-value gap is no longer execution correctness but turning completed sessions into reusable knowledge artifacts.

## Goal

- Convert reliable participant-backed sessions into reusable workspace knowledge through rolling summaries, structured conclusions, and explicit topic promotion.

## Design Freeze

- The Sprint 4 synthesis contract is frozen in `docs/decisions/ADR-0001-sprint-4-synthesis-contract.md`.
- Future implementation agents should follow that ADR for field names, additive migration rules, and the decision to use explicit topic promotion.

## Why This Sprint Now

- Session lifecycle, participant execution, recovery semantics, and stdio MCP verification are already implemented.
- The current product can run a parley reliably, but it still produces only a lightweight stitched summary rather than a reusable decision artifact.
- Without summary synthesis and topic promotion, workspace memory remains shallow even though topic records and linked sessions already exist.

## Committed Scope

- [x] Replace the stitched `latestSummary` string with a rolling summary shape that can accumulate across turns
- [x] Define a structured conclusion contract for completed sessions
- [x] Upgrade `parley_finish` so it returns a structured conclusion, not only a fallback text summary
- [x] Add a topic-promotion path that can persist session conclusions into linked topic records
- [x] Document the new synthesis and promotion behavior in `docs/mcp-contract-spec.md`
- [x] Add automated tests for rolling summary updates, finish-time conclusion generation, and topic promotion

## Stretch Scope

- [x] Add an explicit `parley_promote_summary` MCP tool instead of coupling all promotion behavior to `parley_finish`
- [x] Extract open questions and action items automatically from the structured conclusion
- [ ] Persist turn-level claim metadata that later search or ranking work can reuse

## Explicit Non-Goals

- [ ] Broad workspace search or ranking
- [ ] Full topic board UI or presentation-layer work
- [ ] Plugin, extension, packaging, or web surface work
- [ ] Cross-workspace governance features
- [ ] Rich moderator scoring or evidence quality analytics

## Exit Criteria

- [x] A multi-turn session maintains a rolling summary that is more useful than the current string concatenation
- [x] `parley_finish` produces a stable structured conclusion contract
- [x] A completed session can promote its conclusion into a linked topic without manual file editing
- [x] Topic records can store promoted knowledge without leaking participant-specific transport details
- [x] `npm test`, `npm run lint`, `npm run typecheck`, and `npm run build` are green

## Dependencies

- Apply the synthesis contract frozen in `docs/decisions/ADR-0001-sprint-4-synthesis-contract.md`
- Keep `docs/mcp-contract-spec.md` aligned with the ADR as implementation lands
- Confirm any remaining migration detail before de-emphasizing compatibility string fields

## Owners

- PM: TBD
- Engineering: TBD

## Task Tracker

### Task 1. Rolling Summary Contract

- [x] Define a rolling summary shape that is stable enough for orchestrators and later promotion flows
- [x] Update session state persistence so the rolling summary evolves on each successful `parley_step`
- [x] Keep the summary normalized and product-facing rather than a dump of raw participant output

Review focus:

- The summary contract should help downstream orchestration and topic promotion, not just read better to humans.
- This is the first layer of durable synthesis, so shape decisions here will influence later memory and search work.

Expected outcome:

- Session state exposes a concise but structured view of what the parley has established so far.
- Later conclusion generation can build from durable summary fields instead of reparsing raw transcript text.

Debt Watch:

- First-pass summaries may still be heuristic rather than model-moderated.
- If the summary shape is too narrow, later claim extraction work may need a follow-up migration.

Verification:

- `npm test`
- targeted service tests for multi-turn rolling summary updates
- `npm run typecheck`

Implementation notes:

- `rollingSummary` now persists in `state.json` after each committed step.
- `latestSummary` remains as a compatibility field derived from `rollingSummary.synopsis`.

### Task 2. Structured Conclusion Generation

- [x] Define a structured finish-time conclusion shape
- [x] Update `parley_finish` to return the structured conclusion plus a human-usable summary field when helpful
- [x] Ensure finish behavior remains idempotent for repeated orchestrator calls

Review focus:

- The product needs a conclusion artifact that can be consumed by Codex, Claude, and Gemini without brittle parsing.
- `parley_finish` should stay orchestrator-agnostic and avoid coupling the conclusion to any participant-specific format.

Expected outcome:

- A finished session returns reusable decision data such as consensus, disagreements, open questions, and next actions.
- The finish contract becomes the bridge between a transient parley and longer-lived workspace memory.

Debt Watch:

- A first structured conclusion may still depend heavily on the latest rolling summary rather than full claim reconciliation.
- Human-quality prose can remain secondary to contract stability in this sprint.

Verification:

- `npm test`
- targeted finish-path tests
- `npm run lint`

Implementation notes:

- `parley_finish` now returns `conclusion` plus compatibility `summary`.
- repeated finish calls reuse the same logical conclusion for an unchanged finished session.

### Task 3. Topic Promotion and Workspace Memory Bridge

- [x] Define how a completed session conclusion maps into topic fields such as `decisionSummary`, `openQuestions`, `actionItems`, and `canonicalSummary`
- [x] Implement a promotion path for linked topics
- [x] Preserve human-debuggable storage under `.multi-llm/` without introducing opaque indexing layers

Review focus:

- Promotion should enrich workspace memory without mutating topic history in surprising or lossy ways.
- The bridge from session to topic should be explicit enough that future search and board work can build on it safely.

Expected outcome:

- Topic records begin to act as durable knowledge objects instead of only metadata containers.
- A future topic board can read promoted data directly without reparsing transcripts.

Debt Watch:

- Topic merge and duplicate-detection logic stay out of scope.
- Promotion conflict resolution may still need a later review if multiple sessions target the same topic.

Verification:

- `npm test`
- fixture-backed storage checks for topic promotion
- `npm run build`

Implementation notes:

- the explicit `parley_promote_summary` tool now bridges finished sessions into topic memory.
- promotion stays idempotent for unchanged session/topic pairs and continues to use `linkedSessionIds` as the provenance link.

### Task 4. Contract and Documentation Refresh

- [x] Update `docs/mcp-contract-spec.md` with the rolling summary and structured conclusion contract
- [x] Refresh roadmap or operating-plan language that still treats workspace memory as topic CRUD only
- [x] Keep `AGENTS.md` and sprint docs aligned with the actual next priority

Review focus:

- This sprint changes the product-facing meaning of "session output", so docs need to describe the new contract precisely.
- Documentation drift here would immediately confuse future agents because current priorities are shifting from runtime reliability to knowledge synthesis.

Expected outcome:

- Product, PM, and engineering docs point at the same next milestone.
- Future implementation work can add summary and promotion behavior without re-litigating the scope.

Verification:

- doc review against implemented behavior
- `npm run lint`

Implementation notes:

- README, AGENTS, operating-plan, contract, risk, and test-matrix docs now reflect the implemented Sprint 4 state.

## Open Questions To Monitor During Implementation

- Whether a separate persisted session summary artifact is still useful after `rollingSummary` lives in `state.json`
- Whether the first heuristic synthesis pass is strong enough to promote directly into topic memory without a manual review step
- When compatibility string fields can safely become secondary in downstream orchestrators

## Recommended Execution Order

1. Freeze the rolling summary and structured conclusion schema.
2. Implement rolling summary updates during `parley_step`.
3. Upgrade `parley_finish` to return the structured conclusion.
4. Add topic promotion on top of the conclusion artifact.
5. Refresh contract and planning docs before moving on to search or board expansion.
