# Sprint 5 Brief

## Dates

- Planned window: 2026-05-18 to 2026-05-29
- Planning note: as of 2026-03-12, Sprint 4 knowledge synthesis and topic promotion are functionally complete, so the next highest-value gap is retrieval and operator usability on top of those artifacts.

## Goal

- Turn promoted session knowledge into something operators and orchestrators can reliably find, inspect, and validate through search, board-style retrieval, and broader end-to-end verification.

## Status

- Functionally complete as of 2026-03-13

## Why This Sprint Now

- Sprint 4 created reusable topic memory through `rollingSummary`, `conclusion`, and `parley_promote_summary`.
- The product can now generate knowledge artifacts, but retrieval and inspection are still thin.
- Diagnostics exist on disk, but operators do not yet have a first-class MCP surface for triage.
- Cross-orchestrator confidence is still uneven because automated coverage remains Codex-heavy.

## Committed Scope

- [x] Expand topic retrieval beyond simple title/body filtering
- [x] Define and implement a first-pass topic board query surface over promoted topic memory
- [x] Add an operator-facing diagnostic inspection surface for failed session attempts
- [x] Clarify replay and repair workflow expectations for operators
- [x] Broaden automated verification coverage beyond the current Codex-driven happy path
- [x] Refresh test-matrix, risk, and planning docs to reflect the new retrieval and operator bar

## Stretch Scope

- [ ] Add lightweight board-style summaries or digest resources for workspaces
- [ ] Add diagnostic filtering by session, step, or failure type
- [ ] Add minimal repair-oriented helper tooling once diagnostic inspection is stable

## Explicit Non-Goals

- [ ] mem0, Milvus, or another external long-term memory backend in the core path
- [ ] large-scale semantic retrieval infrastructure
- [ ] plugin, extension, packaging, or web surface work
- [ ] topic graph, ranking, or recommendation work
- [ ] broad schema expansion for topic provenance history

## Exit Criteria

- [x] Operators can retrieve promoted topic memory through more than raw topic CRUD
- [x] At least one topic/workspace search path uses promoted knowledge fields such as `decisionSummary`, `canonicalSummary`, `openQuestions`, or `actionItems`
- [x] Failed participant attempts can be inspected without reading filesystem artifacts manually
- [x] Cross-client validation coverage expands beyond the current single orchestrator profile
- [x] `npm test`, `npm run lint`, `npm run typecheck`, and `npm run build` are green

## Dependencies

- Keep the Sprint 4 synthesis contract stable while expanding retrieval surfaces
- Preserve filesystem-backed source-of-truth behavior under `.multi-llm/`
- Confirm the minimum operator-facing diagnostic surface before adding repair helpers

## Owners

- PM: TBD
- Engineering: TBD

## Task Tracker

### Task 1. Search and Retrieval Expansion

- [x] Define the minimum useful search contract for topics and workspace memory
- [x] Expand retrieval beyond `title/body` substring filtering
- [x] Include promoted fields in the searchable surface without introducing a new storage backend

Review focus:

- Retrieval should prove the value of promoted knowledge before the project considers heavier memory infrastructure.
- The first search pass should stay simple, inspectable, and filesystem-compatible.

Expected outcome:

- Operators and orchestrators can find topics based on decision summaries, canonical summaries, open questions, or action items.
- Topic memory becomes practically reusable instead of only technically persisted.

Debt Watch:

- Search quality may still be lexical or heuristic rather than semantic.
- If retrieval demand outgrows the filesystem model, a later optional index layer can be considered.

Verification:

- `npm test`
- targeted search and retrieval tests
- `npm run typecheck`

### Task 2. Topic Board Expansion

- [x] Define a board-style retrieval shape for workspaces and topics
- [x] Surface promoted topic metadata in a form that downstream clients can render easily
- [x] Keep the contract tool-first and additive

Review focus:

- The goal is not UI design yet, but a stable retrieval contract that a future UI or extension could consume.
- The board surface should reflect product-state concepts such as status, decision summary, and open questions.

Expected outcome:

- Clients can ask for a workspace or topic-oriented digest without reconstructing it manually from raw topic files.
- The project gets closer to the original “topic board” vision without committing to a frontend surface.

Debt Watch:

- This sprint should avoid overfitting the board shape to one client.
- Thread-level expansion can remain later if the topic-level board is already useful.

Verification:

- `npm test`
- fixture-backed board retrieval checks
- `npm run build`

### Task 3. Operator Diagnostics and Repair Guidance

- [x] Add an MCP-readable diagnostic inspection surface for failed step attempts
- [x] Define the minimum replay and repair workflow operators should follow after failure
- [x] Keep diagnostics outside normalized session state while making them easier to inspect

Review focus:

- Operators should not need to browse `.multi-llm/` manually for common triage tasks.
- Repair guidance matters as much as raw diagnostic visibility because replay boundaries already exist in the contract.

Expected outcome:

- Common failure modes become inspectable through tools or resources instead of only local filesystem access.
- Recovery behavior becomes easier to use operationally, not just theoretically correct.

Debt Watch:

- Redaction policy may still need follow-up before diagnostics are exposed more broadly.
- Full automated repair can stay later if inspection and runbook guidance are strong.

Verification:

- `npm test`
- targeted diagnostic surface tests
- `npm run lint`

### Task 4. Broader Verification Coverage

- [x] Add at least one new orchestrator-oriented verification scenario beyond the current Codex-led path
- [x] Expand the test matrix with implemented versus planned coverage
- [x] Use the new retrieval and operator surfaces in at least one automated scenario when practical

Review focus:

- The product promise is orchestrator-agnostic behavior, so verification coverage needs to keep up with the contract.
- Search and diagnostics should not become Codex-only conveniences.

Expected outcome:

- The team has stronger evidence that retrieval and failure inspection work consistently across orchestrator assumptions.
- The test matrix becomes a planning tool rather than a stale list.

Debt Watch:

- Full matrix coverage will still remain incomplete after Sprint 5.
- Windows-first validation is still acceptable if the new coverage materially reduces orchestrator risk.

Verification:

- `npm test`
- `npm run build`
- updated `docs/test-matrix.md`

## Open Questions To Resolve In This Sprint

- What is the smallest useful search contract before semantic or vector-based retrieval becomes justified?
- Should operator diagnostics be exposed as tools, resources, or both?
- What repair actions belong in Sprint 5 versus staying as documented operator guidance only?

## Recommended Execution Order

1. Freeze the minimum search and topic-board retrieval contract.
2. Implement retrieval over promoted topic memory.
3. Add operator-facing diagnostic inspection.
4. Expand verification coverage around retrieval and failure workflows.
5. Refresh risk, matrix, and roadmap docs before discussing heavier memory infrastructure.
