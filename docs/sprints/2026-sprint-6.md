# Sprint 6 Brief

## Dates

- Planned window: 2026-06-01 to 2026-06-12
- Planning note: as of 2026-03-13, Sprint 5 retrieval and operator tooling are functionally complete, so the highest-value follow-up is to harden orchestrator confidence and improve promoted-memory quality before packaging any external surface.

## Goal

- Reduce remaining orchestrator ambiguity, improve synthesis quality, and add only the smallest repair helpers still needed after the Sprint 5 diagnostic surface.

## Status

- Functionally complete as of 2026-03-13

## Why This Sprint Now

- Sprint 5 proved that promoted topic memory can be searched, inspected, and rendered as board digests through MCP.
- The largest remaining product risk is no longer missing retrieval surface area, but uneven confidence across orchestrators and noisy first-pass synthesis quality.
- Diagnostic inspection is now available, which means Sprint 6 can focus on the narrow set of repair helpers that actually remove operator friction instead of broad speculative recovery automation.
- Packaging, plugin, extension, or UI direction is still downstream of contract trust; shipping those surfaces early would amplify any remaining ambiguity.

## Committed Scope

- [x] Expand orchestrator-oriented verification beyond the currently implemented Windows-first matrix
- [x] Improve heuristic synthesis quality for `rollingSummary`, `conclusion`, and promoted topic memory
- [x] Add minimal repair-oriented helper tooling only where `parley_list_diagnostics` still leaves operators blocked
- [x] Refresh planning, matrix, and risk docs to reflect the new hardening bar and any remaining gaps

## Stretch Scope

- [x] Add one more cross-client resume scenario beyond the minimum planned matrix additions
- [x] Add lightweight operator helpers for replay-boundary follow-up after `storage_failure`
- [ ] Capture a packaging-direction note or ADR only if Sprint 6 hardening exits cleanly

## Explicit Non-Goals

- [ ] Gemini extension implementation
- [ ] Claude plugin implementation
- [ ] web UI or TUI work
- [ ] external vector memory, ranking, or recommendation infrastructure
- [ ] broad session-state schema expansion beyond what the hardening work proves necessary

## Exit Criteria

- [x] The test matrix no longer leaves the highest-risk orchestrator scenarios only as planned placeholders
- [x] At least one synthesis refinement measurably improves promoted memory quality without regressing contract stability
- [x] Operators gain a smaller, clearer path through the remaining replay or repair edge cases
- [x] Packaging stays explicitly downstream of Sprint 6 unless the hardening scope is complete
- [x] `npm test`, `npm run lint`, `npm run typecheck`, and `npm run build` are green

## Dependencies

- Keep the Sprint 4 synthesis contract additive and stable unless a change is clearly justified
- Preserve the Sprint 5 search, board, and diagnostics MCP surfaces while refining the data behind them
- Prefer verification and repair changes that remain orchestrator-agnostic rather than optimizing one client flow only

## Owners

- PM: TBD
- Engineering: TBD

## Task Tracker

### Task 1. Orchestrator Verification Expansion

- [x] Convert the remaining planned matrix gaps into implemented automated scenarios where practical
- [x] Add explicit coverage for session resume reuse and lease-conflict handling across orchestrator-labeled runs
- [x] Keep verification centered on MCP contract behavior rather than client-specific UX conventions

Review focus:

- The core product promise is orchestrator-agnostic behavior, so remaining matrix gaps should be closed before adding more outward-facing surfaces.
- Coverage should target the scenarios most likely to reveal drift in lease ownership, resume semantics, and tool wiring.

Expected outcome:

- The team has stronger evidence that Claude-, Gemini-, and Codex-led orchestration assumptions all reach the same server-owned outcomes.
- `docs/test-matrix.md` becomes a truer record of product confidence rather than a mostly-forward-looking checklist.

Debt Watch:

- Full OS and transport coverage can still remain later if the highest-risk orchestrator cases are now automated.
- Some matrix gaps may still require fixture-based simulation rather than a fully distinct client harness.

Verification:

- `npm test`
- targeted stdio integration additions
- updated `docs/test-matrix.md`

### Task 2. Synthesis Quality Refinement

- [x] Review the current heuristic summary and conclusion builders against the promoted-memory surfaces they now feed
- [x] Tighten how agreements, disagreements, open questions, and action items accumulate across turns
- [x] Reduce duplication and low-signal carryover in promoted topic memory without changing the MCP contract shape unless necessary

Review focus:

- Retrieval and board tooling now expose synthesis quality directly to operators, so noisy output is a product problem rather than an internal implementation detail.
- Improvements should increase signal quality while preserving the additive compatibility rules already established in the contract.

Expected outcome:

- `rollingSummary`, `conclusion`, and promoted topic fields become more decision-useful and less repetitive.
- Search and board surfaces gain practical value from better synthesis without requiring heavier retrieval infrastructure.

Debt Watch:

- The project may still need a later second-pass or moderator-quality synthesis strategy if heuristic refinement reaches diminishing returns.
- Any schema change should be treated as a separate decision rather than folded casually into implementation work.

Verification:

- `npm test`
- targeted service tests for multi-turn synthesis behavior
- `npm run typecheck`

### Task 3. Minimal Repair Helper Tooling

- [x] Identify the concrete failure modes where diagnostic inspection alone still leaves operators uncertain about the next safe action
- [x] Add only the smallest helper surface needed for replay-boundary clarity or repair follow-up
- [x] Keep repair guidance derived and tool-first rather than moving operational internals into core session state

Review focus:

- Sprint 5 already delivered diagnostics and operator guidance, so Sprint 6 should add helpers only where there is a clear remaining unblock.
- Repair tooling should narrow ambiguity, not create a second orchestration surface with overlapping responsibility.

Expected outcome:

- Operators spend less time translating diagnostics into the next safe step after participant failure or storage replay-boundary issues.
- The recovery story becomes more practical without overcommitting to automated repair workflows.

Debt Watch:

- Redaction policy is still a prerequisite before diagnostics or repair helpers are exposed through broader surfaces.
- Fully automated repair can remain later if the helper layer removes most operational uncertainty.

Verification:

- `npm test`
- targeted diagnostic and repair-helper checks
- `npm run lint`

### Task 4. Roadmap and Risk Refresh

- [x] Update planning docs so Sprint 6 consistently reflects hardening rather than premature packaging work
- [x] Refresh the risk register based on what verification and synthesis work does or does not close
- [x] Keep contract and sprint documentation aligned with the actual next milestone

Review focus:

- Documentation drift at this stage would send future contributors toward packaging work before the core product is ready.
- The roadmap should clearly show that external surfaces remain downstream of the hardening bar.

Expected outcome:

- Planning docs, risks, and sprint scope all point at the same immediate priorities.
- The team can revisit packaging direction later without ambiguity about why it was deferred.

Verification:

- doc review against the latest sprint brief
- `npm run lint`

## Open Questions To Resolve In This Sprint

- Which remaining orchestrator scenarios provide the highest confidence gain per test added?
- Is the current heuristic synthesis good enough after refinement, or does it justify a later second-pass synthesis design?
- What is the smallest repair helper that removes the most operator uncertainty without expanding the core state contract?
- What redaction or access rules must exist before diagnostics-oriented helper tooling can grow further?

## Recommended Execution Order

1. Close the highest-risk orchestrator verification gaps first.
2. Refine synthesis quality using the now-stable retrieval and board surfaces as evaluation targets.
3. Add only the repair helpers justified by real remaining operator ambiguity.
4. Refresh test-matrix, risk, and roadmap docs.
5. Reassess packaging direction only after the Sprint 6 hardening bar is met.

## Outcome Notes

- Automated stdio coverage now includes participant resume reuse and lease-conflict handling across orchestrator-labeled runs.
- `rollingSummary`, `conclusion`, and promoted topic memory now deduplicate repeated questions and action items while avoiding consensus carryover from `undecided` turns.
- `parley_list_diagnostics` now includes additive `nextAction` helper output so operators can move from inspection to the next safe tool call more directly.
- Packaging direction remains deferred; no plugin, extension, or UI implementation work was pulled into Sprint 6.
