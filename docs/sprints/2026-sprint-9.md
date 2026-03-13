# Sprint 9 Brief

## Dates

- Planned window: 2026-04-10 to 2026-04-23
- Planning note: this sprint is defined after the 2026-03-13 Codex Desktop installation and real-CLI verification pass that stabilized the Windows Gemini launcher path and restored a green `npm run smoke:real`

## Goal

- Raise Parley from a Windows-verified production-readiness baseline into a more defensible release posture by expanding real-environment verification where it is actually available this sprint, tightening participant quality normalization, and documenting orchestrator acceptance criteria before packaging direction resumes.

## Status

- Planned

## Why This Sprint Now

- Sprint 8 established subprocess guardrails, storage durability, diagnostics hardening, and a release runbook, but the support statement was still materially Windows-first.
- A real Codex Desktop installation and usage test on 2026-03-13 exposed two practical gaps that were then fixed: Windows Gemini launcher handling and weaker-than-expected Gemini structured output behavior.
- With the Windows real-CLI path now green again, the next highest-value work is no longer the same launcher fix repeated in another sprint; it is proving the MCP core under additional environments and making participant behavior more predictably useful for operators.

## Committed Scope

- [ ] Expand real-environment verification beyond the current Windows-only support bar where additional environments are actually available this sprint
- [ ] Define a repeatable orchestrator acceptance checklist for Codex Desktop and the existing stdio-first release posture
- [ ] Tighten Gemini participant response quality without widening the shared contract
- [ ] Refresh support-boundary, matrix, and release docs to reflect the stronger verification bar

## Stretch Scope

- [ ] Capture one packaging-direction ADR only if the broader verification bar exits cleanly
- [ ] Add one more thin transport-validation scenario only if it does not expand the core contract
- [ ] Add one lightweight operator metric or release evidence artifact if it clearly improves intentional release review

## Explicit Non-Goals

- [x] no new end-user MCP tools or topic-memory features
- [x] no UI implementation or extension packaging delivery
- [x] no remote auth, multi-tenant policy, or hosted control-plane scope
- [x] no database or vector-store adoption
- [x] no broad session-state or MCP contract reshaping beyond additive verification and normalization hardening

## Exit Criteria

- [ ] At least one additional non-Windows environment is exercised with documented evidence when practical this sprint, or the support statement is explicitly kept narrow instead of implying broader portability
- [ ] Linux verification, if claimed this sprint, is backed by actual exercised evidence such as WSL and or CI rather than design-only assumptions
- [ ] macOS verification is claimed only if an actual macOS environment is exercised; otherwise the sprint exits with a documented macOS acceptance path, prerequisites, and unchanged support statement
- [ ] Codex Desktop installation and baseline tool-flow verification are documented as a repeatable operator acceptance path
- [ ] Gemini participant execution remains green on Windows real smoke while output normalization reduces avoidable `invalid_output` failures and low-value plain-text drift
- [ ] `npm test`, `npm run lint`, `npm run typecheck`, `npm run build`, and `npm run smoke:real` are green at sprint close
- [ ] Release, matrix, and risk docs accurately describe the post-sprint support boundary and residual caveats

## Dependencies

- Preserve the Sprint 7 diagnostics redaction contract and the Sprint 8 subprocess/storage hardening bar
- Keep the shared `ParticipantResponse` contract stable while improving Gemini-side normalization and prompting behavior
- Prefer orchestrator-agnostic runtime handling over Codex-only or Windows-only product logic

## Owners

- PM: Micehub-dev maintainers
- Engineering: Micehub-dev core runtime maintainers
- Release captain: Micehub-dev release maintainer

## Task Tracker

### Task 1. Broader Real-Environment Verification

- [ ] Exercise at least one additional OS or operator environment beyond the current Windows workstation baseline when practical this sprint
- [ ] Treat Linux and macOS as separate verification tracks rather than one combined non-Windows claim
- [ ] Use WSL and or CI as acceptable Linux evidence if they are the only realistic non-Windows paths available during the sprint
- [ ] Claim macOS verification only from an actual macOS environment; otherwise document the exact acceptance path and prerequisites needed to run it later
- [ ] Record exact launcher, prerequisite, and result details for each exercised environment
- [ ] Keep the support statement honest when coverage remains partial

Delivered:

- real-environment evidence extends beyond the current single Windows workstation path where an additional environment is actually exercised, or the docs explicitly state why it still does not
- Linux evidence, if added, is called out separately from any future macOS evidence
- macOS support is not overstated when a macOS machine or runner is unavailable during the sprint
- launcher differences are captured as operator-facing facts rather than tribal knowledge
- release review can cite environment-specific evidence instead of only fixture-backed confidence

Verification:

- `npm run smoke:real`
- updated `docs/test-matrix.md`
- updated `docs/real-cli-smoke.md`

Operator note:

- A Windows-only workstation can prepare Linux-oriented checks through WSL and CI, but it cannot by itself prove macOS runtime stability.
- If no macOS environment is available during Sprint 9, the required output is a concrete macOS validation checklist and support-boundary wording that remains explicitly Windows-first.

### Task 2. Orchestrator Acceptance Checklist

- [ ] Define the minimum repeatable Codex Desktop installation and verification flow for Parley MCP
- [ ] Confirm the baseline operator flow at least covers server registration, tool discovery, `parley_start`, `parley_claim_lease`, `parley_step`, and diagnostics inspection
- [ ] Reflect any orchestrator-specific caveats back into release docs without introducing client-specific state semantics

Delivered:

- a documented acceptance checklist exists for Codex Desktop and the stdio MCP posture
- MCP installation and first-use verification are easier to reproduce during release review
- orchestrator caveats are separated cleanly from core contract behavior

Verification:

- manual Codex Desktop acceptance pass
- updated `docs/release-checklist.md`
- updated planning or status notes if the acceptance path changes release readiness

### Task 3. Gemini Quality Hardening

- [ ] Refine Gemini participant prompting and normalization so common real-CLI outputs produce usable shared-structure responses more consistently
- [ ] Keep Windows launcher handling stable while tightening plain-text and non-enum response normalization
- [ ] Add regression coverage for newly observed real-environment response patterns

Delivered:

- Gemini execution no longer depends on the brittle `gemini.ps1` path when the npm `gemini.cmd` shim is available on Windows
- common Gemini plain-text and partial-shape responses normalize into the shared participant contract instead of failing noisily when safe to recover
- regression tests cover the observed Windows launcher and output-shape behaviors from the 2026-03-13 real verification pass

Verification:

- `npm test`
- `npm run smoke:real`
- targeted adapter tests for launcher and normalization paths

### Task 4. Release Evidence Refresh

- [ ] Update release, test, and risk docs to reflect the actual verified support boundary after Task 1 through Task 3
- [ ] Record whether the product is still Windows-first or has earned a broader support statement
- [ ] Make residual risks explicit if Gemini quality or cross-OS verification still has caveats

Delivered:

- release docs cite current verified reality instead of stale caveat text
- the risk register reflects the new launcher and participant-quality lessons from the Codex Desktop verification pass
- release review can rely on fresh evidence rather than inference

Verification:

- updated `docs/release-checklist.md`
- updated `docs/test-matrix.md`
- updated `docs/risk-register.md`

## Outcome Notes

- Sprint 9 remains a production-readiness sprint, not a feature sprint.
- The Windows Gemini launcher and smoke-path repair from 2026-03-13 is treated as the new baseline, not the next headline deliverable.
- Packaging direction should resume only after the stronger verification and acceptance bar is met or the narrower support statement is intentionally accepted.
