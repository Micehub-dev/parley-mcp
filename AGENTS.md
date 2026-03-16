# AGENTS.md

## Project Summary

Parley is an orchestrator-agnostic MCP server for running and managing multi-LLM parley sessions across Codex, Claude, and Gemini.

The current codebase is at the Windows-first production-readiness hardening stage, with Sprint 11 focused on Windows CI parity, generated release evidence, and tighter Gemini usefulness review:

- Node.js + TypeScript
- MCP server over stdio
- filesystem-backed storage under `.multi-llm/`
- session/topic/workspace tool surface
- real `claude` / `gemini` participant subprocess execution through `parley_step`
- rolling summary accumulation across committed participant turns
- structured conclusion generation at `parley_finish`
- explicit topic promotion through `parley_promote_summary`
- promoted topic-memory search across summaries, questions, actions, and tags
- workspace board retrieval for downstream clients
- structured participant output validation and resume ID persistence
- diagnostic artifact persistence for failed step attempts
- diagnostic inspection with replay/repair guidance
- redacted-by-default diagnostic MCP views with explicit full-detail opt-in
- next-safe repair action hints derived from diagnostics
- participant subprocess timeout, termination, and output-size guardrails
- atomic JSON persistence for core filesystem artifacts
- explicit corrupted-artifact visibility on session/topic/diagnostic reads
- documented real-CLI smoke workflow and release runbook baseline
- documented Codex Desktop acceptance checklist
- GitHub Actions matrix configuration for `ubuntu-latest` and `windows-latest`
- generated release-evidence note payloads and optional smoke artifact output
- Gemini normalization for common fenced JSON, labeled plain text, partial JSON, and plain-text next-step recovery
- automated service, adapter, and stdio MCP integration coverage

## Source Of Truth

Read these files first before making changes:

1. `README.md`
2. `multi-cli-parley-architecture.md`
3. `docs/project-operating-plan.md`
4. `docs/mcp-contract-spec.md`
5. `docs/sprints/2026-sprint-11.md`

If code and docs disagree, prefer:

1. implemented runtime behavior
2. `docs/mcp-contract-spec.md`
3. `multi-cli-parley-architecture.md`

Then update the docs to remove drift.

## Repo Map

- `src/index.ts`: process entrypoint
- `src/server.ts`: MCP server and tool registration
- `src/services/parley-service.ts`: session lifecycle, lease, step, and finish behavior
- `src/participants/`: participant adapters, runtime execution, and shared schemas
- `src/storage/fs-store.ts`: filesystem persistence for sessions/topics
- `src/config.ts`: loads `.multi-llm/config.json`
- `src/types.ts`: core state and record types
- `.multi-llm/`: local persisted data and config
- `docs/`: PM, contract, release, test, and sprint docs

## Quick Start

```bash
npm install
npm test
npm run lint
npm run typecheck
npm run build
npm run dev
```

## Working Rules

- Preserve the orchestrator-agnostic design. Do not add client-specific behavior directly into core session state unless it is normalized behind a shared contract.
- Treat `leaseOwner`, `leaseExpiresAt`, and `stateVersion` as product-critical invariants.
- Prefer extending MCP tools through explicit schemas and predictable JSON responses.
- Keep storage simple and inspectable. Files under `.multi-llm/` should remain human-debuggable.
- Use append-friendly audit/transcript patterns where possible.

## Coding Conventions

- TypeScript ESM only.
- Keep `strict` TypeScript compatibility.
- This repo uses `exactOptionalPropertyTypes`; do not assign `undefined` to optional fields. Omit them instead.
- Validate external inputs with `zod`.
- Prefer small pure helpers over large mixed-responsibility functions.
- Avoid introducing databases or network services unless the sprint scope explicitly requires it.

## MCP Design Conventions

- Tools are the primary correctness surface.
- Resources and prompts are additive, not substitutes for state-changing tools.
- Session state is server-owned.
- Participant adapters must be isolated from orchestrator control loops.
- Structured output is preferred over free-form text.

## Current Priorities

Priority order for upcoming work:

1. add a read-only workspace-scoped file-reading MCP tool so orchestrators can share absolute-path or workspace-relative file context without arbitrary filesystem access
2. keep the new `ubuntu-latest` and `windows-latest` automation lanes green while the Windows-first support boundary remains narrow
3. improve Gemini operator usefulness in real smoke without widening the shared participant contract
4. keep release evidence collection repeatable across smoke, acceptance, matrix, and runbook docs
5. rerun Windows real smoke whenever launcher, authentication, or release-installation behavior changes
6. packaging direction only after the Sprint 11 production-readiness bar remains stable
7. UI or extension work only as thin wrappers over the stable MCP core

Do not jump ahead to UI or packaging unless the current sprint says so.

## Definition Of Done

A change is not done until all applicable items below are true:

- tests pass with `npm test`
- lint passes with `npm run lint`
- code builds with `npm run build`
- types pass with `npm run typecheck`
- docs are updated if behavior or contract changed
- new MCP inputs/outputs are reflected in `docs/mcp-contract-spec.md`
- sprint or risk docs are updated when scope/risk meaningfully changes

## Safe Change Areas

Usually safe:

- adding new tools behind clear schemas
- tightening validation
- improving storage helpers
- adding tests and docs

Escalate before changing:

- session state shape
- lease/version semantics
- `.multi-llm/config.json` compatibility
- tool names or response formats
- participant adapter contract

## Notes For Future Agents

- There is a committed automated test suite covering service behavior, participant adapters, and stdio MCP flows.
- `parley_step` executes real participant adapters, validates structured output, persists resume IDs, and writes diagnostics on failure.
- `rollingSummary` is now the preferred machine-readable session synthesis field, while `latestSummary` remains as a compatibility string.
- `parley_finish` returns a structured `conclusion`, and `parley_promote_summary` is the explicit bridge into topic memory.
- `parley_search_topics` and `parley_get_workspace_board` are the current retrieval surfaces over promoted topic memory.
- `parley_list_diagnostics` is the current operator-facing inspection surface; replay guidance and next-safe tool actions are derived at read time rather than stored in session state.
- `parley_list_diagnostics` now returns redacted records by default; use `detailLevel: "full"` only for intentional local debugging.
- participant subprocesses now enforce default timeout, kill-grace, and output-size guardrails; operators can override them with `PARLEY_PARTICIPANT_TIMEOUT_MS`, `PARLEY_PARTICIPANT_MAX_OUTPUT_BYTES`, and `PARLEY_PARTICIPANT_KILL_GRACE_MS`.
- Gemini normalization now recovers common fenced JSON, labeled plain-text, partial JSON, and some plain-text next-step patterns when they can be mapped safely into the shared response contract.
- filesystem reads now distinguish missing artifacts from invalid or unreadable ones, and JSON-backed artifacts write through atomic temp-file replacement.
- `npm run smoke:real` is the current release-oriented real-CLI check; Windows Gemini wrapper installs may require explicit launcher overrides.
- `npm run smoke:real` now emits `releaseEvidence` and `releaseEvidenceMarkdown`, and writes reusable `.json` plus `.md` artifacts when `PARLEY_SMOKE_EVIDENCE_DIR` is set.
- usefulness assessment now treats thin default-next-step Gemini replies as fallback-grade even when they are still contract-valid.
- the most recent documented clean Windows smoke pass produced a materially useful Gemini response on 2026-03-13, but a later local Codex-run rerun on the same date timed out in Gemini on this workstation and should be revalidated before release signoff.
- The next planned MCP surface after Sprint 11 closeout is a read-only workspace-scoped file-reading tool; prefer `parleySessionId`-anchored workspace containment, text-only reads, and explicit truncation metadata instead of arbitrary absolute filesystem access.
- `docs/codex-desktop-acceptance.md` is the current repeatable operator checklist for Codex Desktop registration and baseline tool-flow verification.
- `docs/release-evidence-template.md` is the current default note shape for keeping smoke, acceptance, support-boundary, and usefulness evidence aligned.
- release readiness now depends on keeping support-boundary wording, smoke evidence, Codex Desktop acceptance evidence, and release docs aligned as one reviewable set.
- Packaging for Claude plugins, Gemini extensions, and UI surfaces is explicitly later-phase work.
