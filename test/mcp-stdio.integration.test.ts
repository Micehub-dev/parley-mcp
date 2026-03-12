import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

test("stdio MCP flow supports start -> claim_lease -> step -> finish", async () => {
  const binDir = await mkdtemp(path.join(os.tmpdir(), "parley-e2e-bin-"));
  const stderrLines: string[] = [];
  let sessionId: string | undefined;
  const participantScriptPath = await installFakeParticipants(binDir);
  const transport = new StdioClientTransport({
    command: getTsxCommandPath(),
    args: getTsxArgs(),
    cwd: repoRoot,
    env: {
      ...process.env,
      PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}`,
      PARLEY_CLAUDE_COMMAND: process.execPath,
      PARLEY_GEMINI_COMMAND: process.execPath,
      PARLEY_CLAUDE_ARGS_JSON: JSON.stringify([participantScriptPath, "claude"]),
      PARLEY_GEMINI_ARGS_JSON: JSON.stringify([participantScriptPath, "gemini"])
    },
    stderr: "pipe"
  });
  const client = new Client({
    name: "parley-e2e-test",
    version: "1.0.0"
  });

  transport.stderr?.on("data", (chunk) => {
    stderrLines.push(chunk.toString());
  });

  try {
    await client.connect(transport);

    const started = await callJsonTool<{
      parleySessionId: string;
      stateVersion: number;
      maxTurns: number;
    }>(client, "parley_start", {
      topic: "MCP integration",
      maxTurns: 1,
      orchestrator: "codex",
      orchestratorRunId: "e2e-run-001"
    });
    sessionId = started.parleySessionId;

    const claimed = await callJsonTool<{
      leaseOwner: string;
      stateVersion: number;
    }>(client, "parley_claim_lease", {
      parleySessionId: sessionId,
      orchestratorRunId: "e2e-run-001",
      ttlSeconds: 300
    });
    const stepped = await callJsonTool<{
      turn: number;
      finished: boolean;
      responses: {
        claude: {
          summary: string;
        };
        gemini: {
          summary: string;
        };
      };
    }>(client, "parley_step", {
      parleySessionId: sessionId,
      expectedStateVersion: claimed.stateVersion,
      orchestratorRunId: "e2e-run-001"
    });
    const state = await callJsonTool<{
      state: {
        turn: number;
        status: string;
        latestSummary?: string;
        participants: {
          claude: {
            resumeId?: string;
          };
          gemini: {
            resumeId?: string;
          };
        };
      };
    }>(client, "parley_state", {
      parleySessionId: sessionId
    });
    const finished = await callJsonTool<{
      parleySessionId: string;
      status: string;
      summary: string;
    }>(client, "parley_finish", {
      parleySessionId: sessionId,
      orchestratorRunId: "e2e-run-001"
    });

    assert.equal(started.maxTurns, 1);
    assert.equal(claimed.leaseOwner, "e2e-run-001");
    assert.equal(stepped.turn, 1);
    assert.equal(stepped.finished, true);
    assert.match(stepped.responses.claude.summary, /claude/i);
    assert.match(stepped.responses.gemini.summary, /gemini/i);
    assert.equal(state.state.turn, 1);
    assert.equal(state.state.status, "finished");
    assert.ok(state.state.participants.claude.resumeId);
    assert.ok(state.state.participants.gemini.resumeId);
    assert.equal(finished.parleySessionId, sessionId);
    assert.equal(finished.status, "finished");
    assert.match(finished.summary, /Claude/i);

    const transcript = await readFile(
      path.join(repoRoot, ".multi-llm", "sessions", sessionId, "transcript.jsonl"),
      "utf8"
    );
    assert.match(transcript, /Parley session created for topic: MCP integration/);
    assert.match(transcript, /Claude integration response/);
    assert.match(transcript, /Gemini integration response/);
  } catch (error) {
    assert.fail(
      `MCP stdio integration failed: ${error instanceof Error ? error.message : String(error)}\n${stderrLines.join("")}`
    );
  } finally {
    await transport.close().catch(() => undefined);
    if (sessionId) {
      await rm(path.join(repoRoot, ".multi-llm", "sessions", sessionId), {
        recursive: true,
        force: true
      });
    }
    await rm(binDir, { recursive: true, force: true });
  }
});

test("stdio MCP errors are returned as structured tool results", async () => {
  const binDir = await mkdtemp(path.join(os.tmpdir(), "parley-e2e-bin-"));
  let sessionId: string | undefined;
  const participantScriptPath = await installFakeParticipants(binDir);
  const transport = new StdioClientTransport({
    command: getTsxCommandPath(),
    args: getTsxArgs(),
    cwd: repoRoot,
    env: {
      ...process.env,
      PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}`,
      PARLEY_CLAUDE_COMMAND: process.execPath,
      PARLEY_GEMINI_COMMAND: process.execPath,
      PARLEY_CLAUDE_ARGS_JSON: JSON.stringify([participantScriptPath, "claude"]),
      PARLEY_GEMINI_ARGS_JSON: JSON.stringify([participantScriptPath, "gemini"])
    },
    stderr: "pipe"
  });
  const client = new Client({
    name: "parley-e2e-test-errors",
    version: "1.0.0"
  });
  try {
    await client.connect(transport);

    const started = await callJsonTool<{
      parleySessionId: string;
    }>(client, "parley_start", {
      topic: "MCP integration error",
      orchestrator: "codex",
      orchestratorRunId: "e2e-run-002"
    });
    sessionId = started.parleySessionId;

    const result = await client.callTool({
      name: "parley_step",
      arguments: {
        parleySessionId: sessionId,
        expectedStateVersion: 999,
        orchestratorRunId: "e2e-run-002"
      }
    });

    assert.equal(result.isError, true);
    const payload = parseTextContent<{
      error: {
        code: string;
        details?: {
          expectedStateVersion?: number;
          actualStateVersion?: number;
        };
      };
    }>(result);

    assert.equal(payload.error.code, "version_mismatch");
    assert.equal(payload.error.details?.expectedStateVersion, 999);
  } finally {
    await transport.close().catch(() => undefined);
    if (sessionId) {
      await rm(path.join(repoRoot, ".multi-llm", "sessions", sessionId), {
        recursive: true,
        force: true
      });
    }
    await rm(binDir, { recursive: true, force: true });
  }
});

test("stdio MCP participant failures stay structured and persist diagnostics", async () => {
  const binDir = await mkdtemp(path.join(os.tmpdir(), "parley-e2e-bin-"));
  let sessionId: string | undefined;
  const participantScriptPath = await installFailingParticipants(binDir);
  const transport = new StdioClientTransport({
    command: getTsxCommandPath(),
    args: getTsxArgs(),
    cwd: repoRoot,
    env: {
      ...process.env,
      PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}`,
      PARLEY_CLAUDE_COMMAND: process.execPath,
      PARLEY_GEMINI_COMMAND: process.execPath,
      PARLEY_CLAUDE_ARGS_JSON: JSON.stringify([participantScriptPath, "claude"]),
      PARLEY_GEMINI_ARGS_JSON: JSON.stringify([participantScriptPath, "gemini"])
    },
    stderr: "pipe"
  });
  const client = new Client({
    name: "parley-e2e-test-participant-failure",
    version: "1.0.0"
  });

  try {
    await client.connect(transport);

    const started = await callJsonTool<{
      parleySessionId: string;
    }>(client, "parley_start", {
      topic: "MCP participant failure",
      orchestrator: "codex",
      orchestratorRunId: "e2e-run-003"
    });
    sessionId = started.parleySessionId;

    const claimed = await callJsonTool<{
      stateVersion: number;
    }>(client, "parley_claim_lease", {
      parleySessionId: sessionId,
      orchestratorRunId: "e2e-run-003",
      ttlSeconds: 300
    });

    const result = await client.callTool({
      name: "parley_step",
      arguments: {
        parleySessionId: sessionId,
        expectedStateVersion: claimed.stateVersion,
        orchestratorRunId: "e2e-run-003"
      }
    });

    assert.equal(result.isError, true);
    const payload = parseTextContent<{
      error: {
        code: string;
        details?: {
          participant?: string;
          reason?: string;
          retryable?: boolean;
          diagnosticsPersisted?: boolean;
        };
      };
    }>(result);

    assert.equal(payload.error.code, "participant_failure");
    assert.equal(payload.error.details?.participant, "gemini");
    assert.equal(payload.error.details?.reason, "process_error");
    assert.equal(payload.error.details?.retryable, true);
    assert.equal(payload.error.details?.diagnosticsPersisted, true);

    const diagnosticsDir = path.join(repoRoot, ".multi-llm", "sessions", sessionId, "diagnostics");
    const diagnosticFiles = await readdir(diagnosticsDir);
    assert.equal(diagnosticFiles.length, 1);

    const diagnostic = JSON.parse(
      await readFile(path.join(diagnosticsDir, diagnosticFiles[0]!), "utf8")
    ) as {
      outcome: string;
      participants: Array<{
        participant: string;
        failureKind?: string;
      }>;
    };

    assert.equal(diagnostic.outcome, "participant_failure");
    const geminiDiagnostic = diagnostic.participants.find(
      (participant) => participant.participant === "gemini"
    );
    assert.equal(geminiDiagnostic?.failureKind, "process_error");
  } finally {
    await transport.close().catch(() => undefined);
    if (sessionId) {
      await rm(path.join(repoRoot, ".multi-llm", "sessions", sessionId), {
        recursive: true,
        force: true
      });
    }
    await rm(binDir, { recursive: true, force: true });
  }
});

async function callJsonTool<T>(
  client: Client,
  name: string,
  args: Record<string, unknown>
): Promise<T> {
  const result = await client.callTool({
    name,
    arguments: args
  });

  assert.notEqual(result.isError, true, `Tool ${name} returned an error result.`);
  return parseTextContent<T>(result);
}

function parseTextContent<T>(result: {
  content: Array<{
    type: string;
    text?: string;
  }>;
}): T {
  const textBlock = result.content.find((item) => item.type === "text");
  assert.ok(textBlock?.text, "Expected text tool content.");
  return JSON.parse(textBlock.text) as T;
}

function getTsxCommandPath(): string {
  return process.platform === "win32"
    ? path.join(repoRoot, "node_modules", ".bin", "tsx.cmd")
    : path.join(repoRoot, "node_modules", ".bin", "tsx");
}

function getTsxArgs(): string[] {
  return ["src/index.ts"];
}

async function installFakeParticipants(binDir: string): Promise<string> {
  const participantScriptPath = path.join(binDir, "fake-participant.mjs");
  await writeFile(
    participantScriptPath,
    [
      "#!/usr/bin/env node",
      'const [kind, ...args] = process.argv.slice(2);',
      'const resumeFlagIndex = args.indexOf("--resume");',
      "const resumeId =",
      '  resumeFlagIndex >= 0 && args[resumeFlagIndex + 1]',
      '    ? args[resumeFlagIndex + 1]',
      '    : `${kind}-integration-session`;',
      "const response = {",
      '  stance: kind === "claude" ? "agree" : "refine",',
      '  summary: kind === "claude" ? "Claude integration response" : "Gemini integration response",',
      '  arguments: [`${kind} integration argument`],',
      '  questions: [`${kind} integration question?`],',
      '  proposed_next_step: `${kind} integration next step`',
      "};",
      'const payload = kind === "claude"',
      "  ? { result: JSON.stringify(response), session_id: resumeId }",
      "  : { response: JSON.stringify(response), sessionId: resumeId };",
      "process.stdout.write(JSON.stringify(payload));"
    ].join("\n"),
    "utf8"
  );
  await chmod(participantScriptPath, 0o755);
  return participantScriptPath;
}

async function installFailingParticipants(binDir: string): Promise<string> {
  const participantScriptPath = path.join(binDir, "failing-participant.mjs");
  await writeFile(
    participantScriptPath,
    [
      "#!/usr/bin/env node",
      'const [kind] = process.argv.slice(2);',
      'if (kind === "gemini") {',
      '  process.stderr.write("Gemini simulated failure");',
      "  process.exit(17);",
      "}",
      "const response = {",
      '  stance: "agree",',
      '  summary: "Claude integration response",',
      '  arguments: ["Claude integration argument"],',
      '  questions: ["Claude integration question?"],',
      '  proposed_next_step: "Claude integration next step"',
      "};",
      'process.stdout.write(JSON.stringify({ result: JSON.stringify(response), session_id: "claude-failure-session" }));'
    ].join("\n"),
    "utf8"
  );
  await chmod(participantScriptPath, 0o755);
  return participantScriptPath;
}
