# AGENTS.md

## Project Summary

Parley is an orchestrator-agnostic MCP server for running and managing multi-LLM debate sessions across Codex, Claude, and Gemini.

The current codebase is an MVP scaffold:

- Node.js + TypeScript
- MCP server over stdio
- filesystem-backed storage under `.multi-llm/`
- session/topic/workspace tool surface
- participant subprocess execution is planned next, not fully implemented yet

## Source Of Truth

Read these files first before making changes:

1. `README.md`
2. `multi-cli-debate-architecture.md`
3. `docs/project-operating-plan.md`
4. `docs/mcp-contract-spec.md`
5. `docs/sprints/2026-sprint-1.md`

If code and docs disagree, prefer:

1. implemented runtime behavior
2. `docs/mcp-contract-spec.md`
3. `multi-cli-debate-architecture.md`

Then update the docs to remove drift.

## Repo Map

- `src/index.ts`: process entrypoint
- `src/server.ts`: MCP server and tool registration
- `src/storage/fs-store.ts`: filesystem persistence for sessions/topics
- `src/config.ts`: loads `.multi-llm/config.json`
- `src/types.ts`: core state and record types
- `.multi-llm/`: local persisted data and config
- `docs/`: PM, contract, release, test, and sprint docs

## Quick Start

```bash
npm install
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

1. `debate_step` real participant subprocess execution
2. structured participant output validation
3. error taxonomy and recovery behavior
4. rolling summary and debate conclusion generation
5. workspace topic memory and search

Do not jump ahead to UI or packaging unless the current sprint says so.

## Definition Of Done

A change is not done until all applicable items below are true:

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

- There is currently no committed test suite beyond build/typecheck.
- `debate_step` is scaffolded and intentionally returns placeholder orchestration behavior for now.
- Packaging for Claude plugins, Gemini extensions, and UI surfaces is explicitly later-phase work.
