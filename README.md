# Parley

> Orchestrator-agnostic MCP server for multi-LLM parley sessions across Codex, Claude, and Gemini.

[![CI](https://github.com/Micehub-dev/parley-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/Micehub-dev/parley-mcp/actions/workflows/ci.yml)
[![MIT License](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)
[![Node.js](https://img.shields.io/badge/node-22%2B-0f172a?logo=node.js&logoColor=white)](https://nodejs.org/)
[![MCP](https://img.shields.io/badge/MCP-Model%20Context%20Protocol-111827)](https://modelcontextprotocol.io/)
![Visitors](https://hits.seeyoufarm.com/api/count/incr/badge.svg?url=https%3A%2F%2Fgithub.com%2FMicehub-dev%2Fparley-mcp&count_bg=%230F766E&title_bg=%23111827&icon=github.svg&icon_color=%23E7E7E7&title=visitors&edge_flat=false)

Parley is a **Model Context Protocol (MCP) server** designed for **multi-agent and multi-LLM parley workflows**. It gives `Codex`, `Claude`, and `Gemini` a shared orchestration contract so parley sessions can be started, resumed, coordinated, and archived without locking the project into a single client or vendor-specific extension model.

If you are looking for a **TypeScript MCP server template** for **AI parley orchestration**, **Claude/Gemini interoperability**, or **workspace-level session memory**, this repository is built for that exact problem space.

## Why Parley

Most AI tooling gets trapped inside one client surface. Parley takes the opposite approach:

- The server owns session state, not the client.
- Parley steps are driven by MCP tools, not UI-specific commands.
- Claude, Gemini, and future participants can be normalized behind one contract.
- Workspace memory survives any single orchestrator session.
- The architecture is ready for later expansion into plugins, extensions, web UIs, or hosted coordination services.

## Highlights

- Orchestrator-agnostic MCP server
- Filesystem-backed workspace, topic, and parley session storage
- Lease and `stateVersion` primitives for safe concurrent orchestration
- Structured tool surface for topic creation, search, board retrieval, session start, state lookup, lease claiming, diagnostics inspection, and session progression
- TypeScript + Zod-based validation for predictable inputs and outputs
- Real `claude` and `gemini` subprocess adapter boundary with shared structured output validation
- Resume ID persistence and last-turn response snapshots for multi-step session continuation
- Rolling summary accumulation across successful turns
- Structured finish-time conclusions and explicit topic promotion into workspace memory
- Topic-memory search across promoted summaries, open questions, action items, and tags
- Workspace board digests for status-oriented topic retrieval
- Operator-facing diagnostic inspection with replay and repair guidance
- Redacted-by-default diagnostic MCP views with explicit full-detail opt-in for local debugging
- Next-safe repair actions derived from persisted diagnostics for replay-boundary follow-up
- Participant subprocess timeout, termination, and output-size guardrails
- Atomic JSON persistence for session, topic, lease, and diagnostic artifacts
- Explicit corrupted-artifact visibility on session and topic reads

## Architecture

```mermaid
flowchart LR
    A["Codex"] --> D["Parley MCP Server"]
    B["Claude Code"] --> D
    C["Gemini CLI"] --> D
    D --> E["Session State"]
    D --> F["Topic Board"]
    D --> G["Filesystem Storage (.multi-llm)"]
    D --> H["Participant Adapters"]
    H --> I["Claude CLI"]
    H --> J["Gemini CLI"]
```

## Current Status

The repository is currently at the **production-readiness hardening** stage.

- MCP server skeleton and core session lifecycle are implemented
- Filesystem-backed storage is implemented
- `parley_step` executes participant adapters and validates shared structured responses
- Session state persists participant `resumeId` values and `latestTurn` snapshots
- Session state also persists a structured `rollingSummary` for downstream orchestration and promotion
- `parley_finish` returns a structured `conclusion` while keeping `summary` as a compatibility field
- `parley_promote_summary` promotes finished-session conclusions into linked topic memory
- `parley_search_topics` retrieves promoted topic memory across summaries, questions, actions, and tags
- `parley_get_workspace_board` exposes board-style workspace digests for downstream clients
- `parley_list_diagnostics` exposes failed step diagnostics with operator repair guidance and next-safe tool actions
- `parley_list_diagnostics` now redacts raw subprocess details by default and requires explicit `detailLevel: "full"` opt-in for full MCP detail
- participant subprocesses now enforce timeout, kill-grace, and output-size guardrails with environment-variable overrides for operators
- filesystem reads now distinguish missing artifacts from invalid or unreadable ones instead of collapsing them into a generic null path
- rolling summary, conclusion, and promoted topic memory now deduplicate repeated questions/action items and emit more compact synthesis text
- stdio integration coverage now exercises participant resume reuse and lease-conflict handling across orchestrator-labeled runs
- Structured MCP tool errors now return machine-readable JSON envelopes with `isError: true`
- Failed participant attempts persist debug-friendly diagnostics under `.multi-llm/sessions/<sessionId>/diagnostics/`
- Service and adapter tests cover happy-path execution, retrieval, diagnostics, and key failure modes
- Stdio MCP integration coverage now exercises `start -> claim_lease -> step -> finish -> promote -> search -> board`, resume reuse, and lease-conflict scenarios
- `npm run smoke:real` provides a release-oriented real CLI smoke path, with the current Windows Gemini wrapper caveat documented under `docs/real-cli-smoke.md`
- CI is configured for install, lint, test, typecheck, and build

## Repository Layout

```text
.
|-- .github/workflows/ci.yml
|-- .multi-llm/
|-- docs/
|-- src/
|   |-- index.ts
|   |-- server.ts
|   |-- config.ts
|   |-- participants/
|   |-- services/
|   |-- storage/fs-store.ts
|   `-- types.ts
|-- test/
|-- AGENTS.md
|-- LICENSE
|-- README.md
`-- multi-cli-parley-architecture.md
```

## Quick Start

### Requirements

- Node.js 22+
- npm 10+

### Install

```bash
npm install
```

### Validate

```bash
npm test
npm run lint
npm run typecheck
npm run build
npm run smoke:real
```

### Run

```bash
npm run dev
```

Parley stores local project data under `.multi-llm/`, including workspace metadata, parley sessions, transcripts, and topic records.

## Operational Notes

- Default participant guardrails:
  - `PARLEY_PARTICIPANT_TIMEOUT_MS=120000`
  - `PARLEY_PARTICIPANT_MAX_OUTPUT_BYTES=1000000`
  - `PARLEY_PARTICIPANT_KILL_GRACE_MS=1000`
- Windows operators may need to launch Gemini through a PowerShell wrapper via `PARLEY_GEMINI_COMMAND` and `PARLEY_GEMINI_ARGS_JSON`.
- Corrupted or unreadable persisted artifacts now surface explicit `storage_failure` details instead of silently disappearing from read APIs.

## Documentation

- `AGENTS.md`: onboarding guide for coding agents and contributors
- `docs/project-operating-plan.md`: PM-oriented roadmap, sprint structure, and prioritization
- `docs/mcp-contract-spec.md`: MCP contract source of truth
- `docs/real-cli-smoke.md`: release-oriented real CLI smoke workflow and latest observed result
- `docs/release-checklist.md`: release runbook for preflight, rollout, rollback, and post-release review
- `multi-cli-parley-architecture.md`: architecture rationale and long-form design

## Roadmap

- Keep packaging direction downstream of the now-stable Sprint 8 production-readiness hardening bar
- Keep subprocess guardrails, corruption visibility, and diagnostics access rules stable before broader distribution work
- Package thin surfaces for plugins, extensions, and future UI layers only after those safeguards stay stable

## Use Cases

- AI research debates across multiple model providers
- structured architecture discussions between coding agents
- persistent topic boards for technical decisions
- orchestrator-neutral MCP experimentation
- multi-agent workflow prototypes for Claude, Gemini, and Codex

## License

Released under the [MIT License](./LICENSE).
