import assert from "node:assert/strict";
import test from "node:test";

import { createParticipantAdapters } from "../src/participants/adapters.js";
import type { CommandExecutionInput, CommandExecutor } from "../src/participants/runtime.js";
import type { ParticipantAdapterInput } from "../src/participants/types.js";
import type { ParleySessionState } from "../src/types.js";

test("claude adapter parses structured JSON output and captures session resume ID", async () => {
  const executor = new FakeCommandExecutor({
    stdout: JSON.stringify({
      result: JSON.stringify({
        stance: "agree",
        summary: "Claude result",
        arguments: ["Claude argument"],
        questions: ["Claude question?"],
        proposed_next_step: "Claude next step"
      }),
      session_id: "claude-session-42"
    })
  });
  const adapters = createParticipantAdapters(executor);

  const result = await adapters.claude.run(buildAdapterInput());

  assert.equal(executor.calls[0]?.command, "claude");
  assert.ok(executor.calls[0]?.args.includes("--json-schema"));
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.output.summary, "Claude result");
    assert.equal(result.resumeId, "claude-session-42");
  }
});

test("gemini adapter parses response payloads and reuses persisted resume IDs", async () => {
  const executor = new FakeCommandExecutor({
    stdout: JSON.stringify({
      response: JSON.stringify({
        stance: "refine",
        summary: "Gemini result",
        arguments: ["Gemini argument"],
        questions: ["Gemini question?"],
        proposed_next_step: "Gemini next step"
      }),
      sessionId: "gemini-session-42"
    })
  });
  const adapters = createParticipantAdapters(executor);
  const input = buildAdapterInput({
    participants: {
      claude: {
        model: "sonnet"
      },
      gemini: {
        model: "auto",
        resumeId: "gemini-session-existing"
      }
    }
  });

  const result = await adapters.gemini.run(input);

  assert.equal(executor.calls[0]?.command, "gemini");
  assert.ok(executor.calls[0]?.args.includes("--resume"));
  assert.ok(executor.calls[0]?.args.includes("gemini-session-existing"));
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.output.summary, "Gemini result");
    assert.equal(result.resumeId, "gemini-session-42");
  }
});

test("adapter returns participant_failure-ready invalid_output results for malformed payloads", async () => {
  const executor = new FakeCommandExecutor({
    stdout: JSON.stringify({
      response: "{\"summary\":\"missing fields\"}"
    })
  });
  const adapters = createParticipantAdapters(executor);

  const result = await adapters.gemini.run(buildAdapterInput());

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "invalid_output");
    assert.match(result.message, /required/i);
  }
});

test("adapter normalizes launcher override parse errors into process_error results", async () => {
  const originalArgs = process.env.PARLEY_CLAUDE_ARGS_JSON;
  process.env.PARLEY_CLAUDE_ARGS_JSON = "{not-json";

  try {
    const executor = new FakeCommandExecutor({
      stdout: ""
    });
    const adapters = createParticipantAdapters(executor);

    const result = await adapters.claude.run(buildAdapterInput());

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, "process_error");
      assert.match(result.message, /json string array/i);
      assert.equal(result.raw.command, "claude");
      assert.deepEqual(result.raw.args, []);
    }
    assert.equal(executor.calls.length, 0);
  } finally {
    if (originalArgs === undefined) {
      delete process.env.PARLEY_CLAUDE_ARGS_JSON;
    } else {
      process.env.PARLEY_CLAUDE_ARGS_JSON = originalArgs;
    }
  }
});

class FakeCommandExecutor implements CommandExecutor {
  readonly calls: CommandExecutionInput[] = [];

  constructor(
    private readonly response: {
      stdout: string;
      stderr?: string;
      exitCode?: number | null;
    }
  ) {}

  async run(input: CommandExecutionInput) {
    this.calls.push(input);
    return {
      command: input.command,
      args: input.args,
      stdout: this.response.stdout,
      stderr: this.response.stderr ?? "",
      exitCode: this.response.exitCode ?? 0
    };
  }
}

function buildAdapterInput(overrides?: Partial<ParleySessionState>): ParticipantAdapterInput {
  const session: ParleySessionState = {
    sessionId: "parley-001",
    workspaceId: "default",
    workspaceRoot: "E:\\research\\Parley",
    topic: "Adapter contract",
    turn: 0,
    maxTurns: 4,
    status: "active",
    stateVersion: 2,
    updatedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    participants: {
      claude: {
        model: "sonnet"
      },
      gemini: {
        model: "auto"
      }
    },
    orchestratorAuditLog: [
      {
        clientKind: "codex",
        startedAt: new Date().toISOString()
      }
    ],
    ...overrides
  };

  return {
    session,
    turn: 1,
    speakerOrder: ["claude", "gemini"],
    priorResponses: []
  };
}
