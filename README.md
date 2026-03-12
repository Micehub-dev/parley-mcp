# Parley

`Parley` is an orchestrator-agnostic MCP server for managing multi-LLM debate sessions across Codex, Claude, and Gemini.

## Initial Scope

- Node.js + TypeScript MCP server
- Local filesystem-backed workspace/topic/session storage
- Debate/session metadata management
- Lease/state version scaffolding for orchestrator-safe coordination
- Room for future `claude` / `gemini` subprocess integration

## Quick Start

```bash
npm install
npm run build
npm run dev
```

The server uses the `.multi-llm/` directory in the project root to persist workspace, topic, and session state.
