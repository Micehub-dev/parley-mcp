# Parley Project Operating Plan

## 1. Product Definition

### Product Goal

Parley's primary goal is to provide an orchestrator-agnostic MCP server that lets Codex, Claude, Gemini, and future clients start, resume, coordinate, and finish multi-LLM parley sessions through one shared contract.

### Success Conditions

- Session lifecycle behavior is stable across orchestrators.
- `leaseOwner`, `leaseExpiresAt`, and `stateVersion` remain the core concurrency controls.
- `claude` and `gemini` participant runtimes stay normalized behind one adapter contract.
- Session outputs become reusable workspace knowledge rather than disposable transcript text.
- The core MCP contract remains stable enough to support later plugins, extensions, UI, search, and analytics work.

### Current Product Stage

As of 2026-03-13, the repository is beyond the bootstrap, placeholder, and runtime-only phases.

- Core session lifecycle is implemented.
- `parley_step` executes real participant subprocesses.
- Structured participant outputs are validated and persisted.
- Successful steps accumulate a structured `rollingSummary`.
- `parley_finish` returns a structured `conclusion`.
- Finished sessions can be promoted into linked topics through `parley_promote_summary`.
- Failed step attempts write diagnostics under `.multi-llm/sessions/<sessionId>/diagnostics/`.
- Promoted topic memory is now searchable through dedicated MCP tooling.
- Workspace boards and operator-facing diagnostic inspection are now exposed through MCP tools.
- Diagnostic inspection now returns redacted records by default with explicit full-detail opt-in.
- Participant subprocesses now enforce timeout, kill-grace, and output-size guardrails.
- JSON-backed artifacts now write through atomic temp-file replacement and surface explicit corruption/readability failures on read paths.
- A release-oriented real CLI smoke workflow and runbook baseline now exist for production-readiness review.
- Automated coverage exists at the service, adapter, and stdio MCP integration layers and the repo is now configured to exercise them in GitHub Actions on both `ubuntu-latest` and `windows-latest`.
- A live Codex Desktop installation and MCP usage pass has now exercised the actual operator flow on Windows.
- The Windows Gemini launcher path has been hardened to prefer the npm-installed `gemini.cmd` shim, and the Windows real smoke path is green again.
- Gemini normalization now recovers common fenced JSON, labeled plain-text, and partial JSON response shapes without widening the shared participant contract.
- Sprint 10 usefulness hardening now adds stronger anti-fallback participant prompting, targeted regression coverage, and smoke-time usefulness classification without widening the shared participant contract.
- Sprint 11 usefulness hardening now infers topic-specific next steps from some plain-text Gemini prose and classifies thin default-next-step replies more strictly during release review.
- Gemini CLI schema-enforcement follow-up is now explicitly tracked against `google-gemini/gemini-cli` PR `#18032`; once that capability is stable in a released CLI and revalidated in Windows real smoke, Parley should replace prompt-only schema steering and part of the current Gemini fallback normalization path with the CLI flag-based contract.
- The release smoke path now emits launcher metadata, a reusable release-evidence note payload, and optional `.json` plus `.md` artifacts when requested.
- A repeatable Codex Desktop acceptance checklist now exists for release review and operator verification.
- The latest local Codex-run smoke attempt on 2026-03-13 hit a Gemini timeout on the current workstation, so Sprint 11 remains in progress until real smoke is rerun cleanly.

Sprint 6 hardening is now functionally complete ahead of the original calendar window. Sprint 7 closed the immediate diagnostics access gap, Sprint 8 landed the intended production-readiness hardening pass, Sprint 9 verification and acceptance work landed early enough to tighten the support statement before packaging direction is revisited, and Sprint 10 production-use evidence and release operationalization work is now functionally complete as of 2026-03-13.

Sprint 11 is now in progress as the current production-readiness sprint, focused on Windows CI parity, release-evidence automation, and a tighter Gemini usefulness bar rather than new end-user surface area.

## 2. Working Source Of Truth

When planning or making scope decisions, prefer the following order:

1. Implemented runtime behavior
2. `docs/mcp-contract-spec.md`
3. `README.md`
4. Sprint briefs under `docs/sprints/`
5. Architecture rationale in `multi-cli-parley-architecture.md`

If planning docs drift from implementation, update the docs quickly rather than carrying stale assumptions forward.

## 3. Operating Cadence

### Daily

- Async status update before 10:00 KST
- Format: yesterday / today / blockers
- Reflect meaningful decisions back into the relevant document the same day

### Weekly

- Sprint planning: 45 minutes
- Architecture and risk review: 30 minutes
- Demo and retro: 45 minutes

### Governance Rules

- Decisions that affect contract or state behavior should be reflected in docs within 24 hours.
- Unowned work should not sit in active sprint scope.
- New requests should be triaged as `Now`, `Next`, or `Later` before detailed sizing.

## 4. PM Artifact Set

The minimum document set for the project is:

- `docs/product-brief.md`
- `docs/mcp-contract-spec.md`
- `docs/sprints/YYYY-sprint-N.md`
- `docs/risk-register.md`
- `docs/test-matrix.md`
- `docs/release-checklist.md`

Optional but expected as the project matures:

- `docs/status/weekly-YYYY-MM-DD.md`
- `docs/decisions/ADR-xxxx-title.md`

## 5. Prioritization Framework

Parley's roadmap should be driven by protocol and product leverage, not by whichever surface looks easiest to build next.

### P0. Contract Correctness

These items block trustworthy release behavior:

- session state correctness
- lease and version correctness
- participant output validation
- retry and replay boundary clarity
- storage failure handling

### P1. Core Product Value

These items determine whether Parley is meaningfully useful:

- reliable `parley_start` -> `parley_step` -> `parley_finish`
- participant subprocess execution
- rolling summary accumulation
- structured conclusions
- promotion of session outcomes into topic memory

### P2. Operator and Knowledge Ergonomics

These items improve day-to-day usage after the core workflow is stable:

- topic board expansion
- workspace and topic search
- operator diagnostics and repair tooling
- cross-client validation scenarios

### P3. Ecosystem Expansion

These items are valuable but should not preempt core contract and memory work:

- Gemini extension packaging
- Claude plugin packaging
- web UI or TUI
- ranking, recommendation, or analytics layers

### Backlog Rules

- Do not pull P2 or P3 work ahead of unresolved P0 items.
- Do not start UI or packaging work before the current sprint explicitly allows it.
- Prefer changes that reduce cross-orchestrator ambiguity over changes that only improve one client surface.

## 6. Roadmap by Sprint

Dates below remain planning windows. The repository may move ahead of the calendar if execution outpaces the original sequence.

### Sprint 0: Bootstrap

Window: 2026-03-12 to 2026-03-20

Goal:

- initialize the repository
- stand up a TypeScript MCP server skeleton
- define basic storage and planning documents

Status:

- Completed

Exit bar:

- `npm run build` and `npm run typecheck` green
- basic MCP tool skeleton available
- planning docs established

### Sprint 1: Core Session Engine

Window: 2026-03-23 to 2026-04-03

Goal:

- stabilize the session lifecycle contract
- implement `parley_start`, `parley_state`, `parley_claim_lease`, and `parley_finish`
- lock core state schema and error model

Status:

- Functionally complete

Exit bar:

- lifecycle behavior tested
- lease and version semantics defined
- contract spec draft completed

### Sprint 2: Participant Adapter MVP

Window: 2026-04-06 to 2026-04-17

Goal:

- execute real `claude` and `gemini` subprocesses through `parley_step`
- validate shared structured participant output
- persist participant resume IDs and normalized responses

Status:

- Functionally complete

Exit bar:

- `parley_step` is backed by real adapters
- malformed or failed participant runs return structured errors
- tests cover happy path and key failure modes

### Sprint 3: Reliability and Recovery

Window: 2026-04-20 to 2026-05-01

Goal:

- define stale-lease reclaim semantics
- tighten recovery and replay behavior
- persist diagnostics for failed step attempts
- add real stdio MCP end-to-end verification

Status:

- Functionally complete

Detailed scope:

- See `docs/sprints/2026-sprint-3.md`

Exit bar:

- stale lease behavior documented and implemented
- structured MCP error envelopes returned for domain failures
- diagnostics persisted outside normalized session state
- stdio MCP integration path passes in automation

### Sprint 4: Rolling Summary and Topic Promotion

Window: 2026-05-04 to 2026-05-15

Goal:

- accumulate rolling summaries across successful turns
- generate structured conclusions at `parley_finish`
- promote completed session outcomes into linked topic memory

Status:

- Functionally complete

Detailed scope:

- See `docs/sprints/2026-sprint-4.md`

Exit bar:

- session state stores a reusable rolling summary shape
- `parley_finish` returns a structured conclusion contract
- linked topics can be enriched from completed sessions without manual editing

### Sprint 5: Operator Tooling and Knowledge Layer Expansion

Window: 2026-05-18 to 2026-05-29

Goal:

- improve operator-facing diagnostics and repair ergonomics
- expand topic and workspace retrieval capabilities
- strengthen cross-client verification coverage

Status:

- Functionally complete

Planned scope:

- diagnostic reader or operator-facing inspection surface
- replay and recovery tooling
- workspace and topic search
- broader orchestrator matrix coverage

Memory-layer review note:

- External long-term memory layers such as mem0 and Milvus were discussed, but are intentionally deferred until file-backed retrieval and operator workflows prove insufficient for Sprint 5 needs.

### Sprint 6: Verification and Synthesis Hardening

Window: 2026-06-01 to 2026-06-12

Goal:

- reduce remaining orchestrator ambiguity, improve promoted-memory quality, and add the smallest repair helpers that materially unblock operators

Status:

- Functionally complete as of 2026-03-13

Delivered scope:

- broader orchestrator matrix coverage for resume reuse and lease-conflict handling
- synthesis-quality refinement on top of `rollingSummary`, `conclusion`, and promoted topic memory
- additive repair-oriented helper output on `parley_list_diagnostics`
- planning, matrix, and risk refresh that keeps packaging explicitly downstream of the hardening bar

### Sprint 7: Diagnostics Redaction and Access Hardening

Window: 2026-03-13 to 2026-03-26

Goal:

- make diagnostics inspection safe-by-default for orchestrators while preserving explicit full-detail access for local operators

Status:

- Functionally complete as of 2026-03-13

Delivered scope:

- `parley_list_diagnostics` defaults to redacted diagnostic records
- explicit `detailLevel: "full"` opt-in keeps local operator debugging viable
- contract, sprint, README, risk, and matrix docs now reflect the tighter diagnostics boundary

### Sprint 8: Production Readiness Hardening

Window: 2026-03-27 to 2026-04-09

Goal:

- harden subprocess execution, storage durability, real-environment verification, and release ownership before any broader distribution work

Status:

- Functionally complete as of 2026-03-13

Delivered scope:

- subprocess guardrails for participant runtime execution
- stronger durability and corruption visibility for filesystem-backed artifacts
- real CLI smoke workflow plus a clearer Windows-first OS support statement
- release ownership, preflight, rollback, and runbook hardening

### Sprint 9: Cross-Environment Verification and Acceptance Hardening

Window: 2026-04-10 to 2026-04-23

Goal:

- expand real-environment verification beyond the current Windows baseline where additional environments are actually available
- define a repeatable Codex Desktop acceptance path
- tighten Gemini participant quality normalization before packaging work resumes

Status:

- Functionally complete as of 2026-03-13

Delivered scope:

- Linux automation evidence is now called out explicitly through exercised GitHub Actions `ubuntu-latest` coverage while the support statement stays narrow about real CLI portability
- a repeatable Codex Desktop acceptance checklist now documents registration, tool discovery, baseline lease flow, diagnostics inspection, and finish behavior
- Gemini participant hardening now recovers common fenced JSON, labeled plain-text, and partial JSON response shapes and is covered by new adapter and service regression tests
- release, matrix, README, AGENTS, and risk docs now align around the same Windows-first real-environment support boundary and macOS caveat

Detailed scope:

- See `docs/sprints/2026-sprint-9.md`

Exit bar:

- broader real-environment evidence exists where an additional environment is actually exercised, or the narrower support statement is explicitly retained
- Linux verification claims are backed by exercised WSL and or CI evidence when used
- macOS verification is claimed only if an actual macOS environment is exercised; otherwise the sprint must leave the support statement unchanged and document the macOS acceptance path
- Codex Desktop acceptance steps are documented and repeatable
- Gemini participant execution remains green on Windows smoke with lower avoidable output-shape failures

### Sprint 10: Production-Use Evidence and Release Operationalization

Window: 2026-04-24 to 2026-05-07

Goal:

- strengthen exercised real-environment evidence without overstating support
- improve Gemini operator usefulness in release-oriented smoke runs
- make release evidence collection and review more repeatable before packaging resumes

Status:

- Functionally complete as of 2026-03-13

Delivered scope:

- release-oriented smoke now records launcher metadata and Gemini usefulness classification for repeatable evidence capture
- a lightweight release-evidence template now keeps smoke, acceptance, support-boundary, and post-run notes aligned
- Gemini prompt hardening plus targeted regression tests now cover low-value fallback patterns while keeping the shared participant contract unchanged
- the Windows-first support statement remains intact because no additional Linux real-CLI participant environment was exercised

Detailed scope:

- See `docs/sprints/2026-sprint-10.md`

Exit bar:

- a real Linux CLI verification path is either exercised and documented, or the Windows-first support statement remains explicitly intact
- Linux and macOS evidence remain separated in release-facing docs and support wording
- Gemini remains contract-valid and is materially more useful in real smoke or the residual quality caveat is documented honestly
- release review can rely on one repeatable evidence path across smoke, acceptance, matrix, and runbook docs

### Sprint 11: Windows Verification Parity and Release Automation

Window: 2026-05-08 to 2026-05-21

Goal:

- add Windows automation parity for the current validation bar
- reduce manual release-review work by generating reusable smoke evidence
- tighten Gemini operator usefulness without widening the shared contract

Status:

- In progress as of 2026-03-13

Delivered scope so far:

- added `windows-latest` CI coverage alongside the existing `ubuntu-latest` lane for install, lint, typecheck, test, and build
- turned smoke output into a reusable release-evidence note payload with optional `.json` and `.md` artifact emission
- tightened Gemini fallback handling around default next steps and low-detail but technically valid responses
- refreshed README, sprint, matrix, risk, and release docs around the updated production-readiness baseline

Outstanding verification:

- confirm the new GitHub Actions Windows lane on a remote run
- rerun Windows real smoke cleanly after the current workstation Gemini timeout is resolved

Exit bar:

- Windows automation evidence exists alongside the current Ubuntu CI lane, or the sprint ends with an explicit documented reason it could not be added
- release review can rely on one generated smoke evidence artifact rather than manual reconstruction
- Gemini remains contract-valid and is more often materially useful in real smoke
- packaging direction stays downstream of the stronger automation and evidence bar

### Sprint 12: Evidence Alignment and Release Signal Hardening

Window: 2026-05-22 to 2026-06-04

Goal:

- align the production-readiness evidence set to the latest exercised facts
- tighten the Gemini usefulness gate so low-value smoke passes fail honestly
- simplify generated release artifacts before any new MCP surface area resumes

Status:

- Planned as of 2026-03-16

Planned scope:

- clean up smoke, matrix, sprint, and release docs around the latest exercised evidence
- harden usefulness scoring and smoke-time release decisions for Gemini
- simplify generated release evidence so it is concise and directly reviewable
- keep the workspace-scoped file-reading tool explicitly downstream of this sprint

Detailed scope:

- See `docs/sprints/2026-sprint-12.md`

Exit bar:

- the latest smoke and release docs no longer rely on stale evidence ordering
- Gemini generic fallback responses do not clear the release-usefulness bar
- generated release artifacts are concise enough to attach directly to review
- feature expansion remains downstream of the production-readiness cleanup pass

## 7. Epic View

### Epic 1. Core Orchestration

Scope:

- session model
- lifecycle
- lease semantics
- versioning
- error handling

Done when:

- different orchestrators can drive the same session semantics without contract drift

### Epic 2. Participant Runtime

Scope:

- `claude` adapter
- `gemini` adapter
- resume semantics
- output normalization

Done when:

- participant differences stay below the tool contract

### Epic 3. Knowledge Persistence

Scope:

- rolling summary
- structured conclusion
- topic promotion
- canonical summary
- search-ready topic memory

Done when:

- a useful session outcome survives beyond the original transcript

### Epic 4. Operator Experience

Scope:

- diagnostics
- repair tooling
- audit visibility
- test matrix

Done when:

- operators can understand and recover from failure states without manual guesswork

### Epic 5. Ecosystem Expansion

Scope:

- plugins and extensions
- additional transports
- UI
- analytics

Done when:

- external surfaces remain thin wrappers over the stable MCP core

## 8. Near-Term Product Direction

### Work That Should Happen Now

- align smoke, acceptance, matrix, sprint, and support-boundary docs to the latest exercised evidence before widening scope
- tighten Gemini operator usefulness gating in smoke and release review without widening the shared participant contract
- simplify generated release evidence so it is concise and directly attachable during release review
- add a read-only workspace-scoped file-reading MCP tool so orchestrators can pass absolute or workspace-relative file context through Parley without opening arbitrary filesystem access after the production-readiness cleanup pass closes
- keep Windows automation parity green so the Windows-first real-operator path is not guarded only by manual smoke
- keep the Codex Desktop acceptance checklist, real-CLI smoke path, support-boundary wording, and release evidence docs aligned with runtime reality
- preserve the current narrow macOS wording until an actual macOS environment is exercised

### Work That Should Happen Soon After

- packaging direction once the Sprint 11 production-readiness bar proves stable
- broader transport validation if it rises above the current stdio-first release posture
- stronger access policy options if diagnostics move beyond local operator use

### Work That Should Happen Later

- plugin and extension packaging
- web UI
- topic graph and ranking
- cross-workspace governance

## 9. Risk Focus

### R1. CLI behavior drift can still break normalized contracts

Mitigation:

- keep adapters narrow
- validate participant outputs through shared schema
- maintain adapter and integration coverage

### R2. Replay boundaries remain subtle after partial persistence failures

Mitigation:

- keep `storage_failure` semantics explicit
- maintain diagnostics for failed attempts
- add repair-oriented operator tooling after Sprint 4

### R3. Weak synthesis could make workspace memory noisy

Mitigation:

- freeze a minimal structured summary and conclusion contract first
- keep the first promotion flow explicit and test-backed
- avoid overpromising search or board features before promoted knowledge is stable

### R4. Premature UI or packaging work could distract from the contract core

Mitigation:

- defer external surfaces until after synthesis and memory promotion are in place
- treat all future surfaces as thin wrappers over MCP

## 10. Immediate Next Actions

### This Week

- keep the diagnostics redaction defaults, subprocess guardrails, and Gemini normalization coverage green in the `ubuntu-latest` plus `windows-latest` matrix
- confirm the new `windows-latest` automation lane on a remote GitHub Actions run
- keep the current release-evidence template and smoke output fields aligned whenever release review steps change
- rerun the Windows smoke and Codex Desktop acceptance path whenever launcher, authentication, or release-installation behavior changes
- review whether a real Linux CLI environment is actually available before broadening the current Windows-first support wording

### Next Implementation Priority

1. Clean up the production-readiness evidence set so smoke, sprint, matrix, release, and support-boundary docs all reflect the latest exercised facts in one consistent order.
2. Tighten the Gemini usefulness gate so generic filler plus the default next step no longer passes release smoke as materially useful.
3. Simplify generated release evidence so launcher provenance remains clear without embedding oversized prompt payloads in human-facing review artifacts.
4. Add a read-only workspace-scoped file-reading MCP tool that accepts an absolute or workspace-relative path but enforces `session.workspaceRoot` containment, text-only reads, and predictable truncation metadata after the production-readiness cleanup pass closes.
5. Confirm the new Windows automation lane on a remote GitHub Actions run so the Windows-first real-operator path is covered by CI as well as manual smoke.
6. Expand real-CLI and OS verification beyond the current Windows-first statement only when additional environments are actually exercised.
7. Treat Linux and macOS verification as separate evidence tracks; CI is acceptable Linux automation evidence, but do not claim macOS stability without an actual macOS run.
8. Keep the Codex Desktop acceptance path, smoke evidence, test matrix, release-evidence template, and runbook aligned whenever release or installation behavior changes.
9. Revisit packaging direction only after the production-use evidence bar stays stable through Sprint 12 closeout.
