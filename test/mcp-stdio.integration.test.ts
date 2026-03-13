import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

test("stdio MCP flow supports start -> claim_lease -> step -> finish -> promote -> search -> board", async () => {
  const binDir = await mkdtemp(path.join(os.tmpdir(), "parley-e2e-bin-"));
  const stderrLines: string[] = [];
  let sessionId: string | undefined;
  let topicId: string | undefined;
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

    const createdTopic = await callJsonTool<{
      topicId: string;
    }>(client, "parley_create_topic", {
      title: "MCP integration topic",
      body: "Track promoted session memory"
    });
    topicId = createdTopic.topicId;

    const started = await callJsonTool<{
      parleySessionId: string;
      stateVersion: number;
      maxTurns: number;
    }>(client, "parley_start", {
      topic: "MCP integration",
      topicId,
      maxTurns: 1,
      orchestrator: "claude",
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
        rollingSummary?: {
          synopsis: string;
        };
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
      conclusion: {
        summary: string;
        consensus: string[];
      };
    }>(client, "parley_finish", {
      parleySessionId: sessionId,
      orchestratorRunId: "e2e-run-001"
    });
    const promoted = await callJsonTool<{
      topicId: string;
      sourceSessionId: string;
      updatedFields: string[];
      topic: {
        status: string;
        decisionSummary?: string;
        canonicalSummary?: string;
      };
    }>(client, "parley_promote_summary", {
      parleySessionId: sessionId
    });
    const searched = await callJsonTool<{
      workspaceId: string;
      results: Array<{
        matchedFields: string[];
        score: number;
        topic: {
          topicId: string;
          decisionSummary?: string;
        };
      }>;
    }>(client, "parley_search_topics", {
      workspaceId: "default",
      query: "integration response"
    });
    const board = await callJsonTool<{
      workspaceId: string;
      topicCount: number;
      statusCounts: {
        open: number;
        in_progress: number;
        resolved: number;
      };
      board: {
        resolved: Array<{
          topicId: string;
          hasDecisionSummary: boolean;
        }>;
      };
    }>(client, "parley_get_workspace_board", {
      workspaceId: "default",
      limit: 5
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
    assert.match(state.state.rollingSummary?.synopsis ?? "", /Consensus:/);
    assert.equal(finished.parleySessionId, sessionId);
    assert.equal(finished.status, "finished");
    assert.equal(finished.summary, finished.conclusion.summary);
    assert.equal(finished.conclusion.consensus.length, 2);
    assert.equal(promoted.topicId, topicId);
    assert.equal(promoted.sourceSessionId, sessionId);
    assert.ok(promoted.updatedFields.includes("decisionSummary"));
    assert.equal(promoted.topic.status, "resolved");
    assert.match(promoted.topic.decisionSummary ?? "", /Claude integration response/);
    assert.equal(searched.workspaceId, "default");
    assert.equal(searched.results[0]?.topic.topicId, topicId);
    assert.ok(searched.results[0]?.matchedFields.includes("decisionSummary"));
    assert.equal(board.workspaceId, "default");
    assert.equal(board.topicCount, 1);
    assert.equal(board.statusCounts.resolved, 1);
    assert.equal(board.board.resolved[0]?.topicId, topicId);
    assert.equal(board.board.resolved[0]?.hasDecisionSummary, true);

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
    if (topicId) {
      await rm(path.join(repoRoot, ".multi-llm", "workspaces", "default", "topics", topicId), {
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
      orchestrator: "gemini",
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

    const diagnostics = await callJsonTool<{
      parleySessionId: string;
      diagnostics: Array<{
        diagnosticId: string;
        repairGuidance: {
          canRetrySameVersion: boolean;
          shouldReadStateFirst: boolean;
          nextAction: {
            tool: string;
          };
        };
        record: {
          outcome: string;
          redaction?: {
            hiddenFields: string[];
          };
          participants: Array<{
            participant: string;
            raw: {
              command: string;
              stderr: string;
            };
            redaction?: {
              hiddenFields: string[];
            };
            failureKind?: string;
          }>;
        };
      }>;
    }>(client, "parley_list_diagnostics", {
      parleySessionId: sessionId,
      failureKind: "process_error"
    });
    const fullDiagnostics = await callJsonTool<{
      diagnostics: Array<{
        record: {
          participants: Array<{
            raw: {
              command: string;
              stderr: string;
            };
          }>;
        };
      }>;
    }>(client, "parley_list_diagnostics", {
      parleySessionId: sessionId,
      failureKind: "process_error",
      detailLevel: "full"
    });

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
    assert.equal(diagnostics.parleySessionId, sessionId);
    assert.equal(diagnostics.diagnostics.length, 1);
    assert.equal(diagnostics.diagnostics[0]?.record.outcome, "participant_failure");
    const redactedGeminiParticipant = diagnostics.diagnostics[0]?.record.participants.find(
      (participant) => participant.participant === "gemini"
    );
    assert.equal(redactedGeminiParticipant?.raw.command, "[redacted]");
    assert.match(
      redactedGeminiParticipant?.raw.stderr ?? "",
      /\[redacted \d+ chars\]/i
    );
    assert.deepEqual(diagnostics.diagnostics[0]?.record.redaction?.hiddenFields, []);
    assert.deepEqual(redactedGeminiParticipant?.redaction?.hiddenFields, [
      "raw.command",
      "raw.args",
      "raw.stdout",
      "raw.stderr"
    ]);
    assert.equal(diagnostics.diagnostics[0]?.repairGuidance.canRetrySameVersion, true);
    assert.equal(diagnostics.diagnostics[0]?.repairGuidance.shouldReadStateFirst, false);
    assert.equal(diagnostics.diagnostics[0]?.repairGuidance.nextAction.tool, "parley_step");
    const fullGeminiParticipant = fullDiagnostics.diagnostics[0]?.record.participants.find(
      (participant) => participant.raw.stderr.includes("Gemini simulated failure")
    );
    assert.equal(fullGeminiParticipant?.raw.command, process.execPath);
    assert.match(
      fullGeminiParticipant?.raw.stderr ?? "",
      /Gemini simulated failure/
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

test("stdio MCP reuses stored participant resume ids on later turns", async () => {
  const binDir = await mkdtemp(path.join(os.tmpdir(), "parley-e2e-bin-"));
  let sessionId: string | undefined;
  const participantScriptPath = await installResumeAwareParticipants(binDir);
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
    name: "parley-e2e-test-resume",
    version: "1.0.0"
  });

  try {
    await client.connect(transport);

    const started = await callJsonTool<{
      parleySessionId: string;
    }>(client, "parley_start", {
      topic: "Resume integration",
      maxTurns: 3,
      orchestrator: "claude",
      orchestratorRunId: "e2e-run-004"
    });
    sessionId = started.parleySessionId;

    const claimed = await callJsonTool<{
      stateVersion: number;
    }>(client, "parley_claim_lease", {
      parleySessionId: sessionId,
      orchestratorRunId: "e2e-run-004",
      ttlSeconds: 300
    });

    const firstStep = await callJsonTool<{
      stateVersion: number;
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
      orchestratorRunId: "e2e-run-004"
    });
    const secondStep = await callJsonTool<{
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
      expectedStateVersion: firstStep.stateVersion,
      orchestratorRunId: "e2e-run-004"
    });
    const state = await callJsonTool<{
      state: {
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

    assert.match(firstStep.responses.claude.summary, /started a new participant session/i);
    assert.match(firstStep.responses.gemini.summary, /started a new participant session/i);
    assert.equal(state.state.participants.claude.resumeId, "claude-resume-1");
    assert.equal(state.state.participants.gemini.resumeId, "gemini-resume-1");
    assert.match(secondStep.responses.claude.summary, /resumed from claude-resume-1/i);
    assert.match(secondStep.responses.gemini.summary, /resumed from gemini-resume-1/i);
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

test("stdio MCP returns a structured lease_conflict for conflicting orchestrator runs", async () => {
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
    name: "parley-e2e-test-lease-conflict",
    version: "1.0.0"
  });

  try {
    await client.connect(transport);

    const started = await callJsonTool<{
      parleySessionId: string;
    }>(client, "parley_start", {
      topic: "Lease conflict integration",
      orchestrator: "gemini",
      orchestratorRunId: "e2e-run-005"
    });
    sessionId = started.parleySessionId;

    const claimed = await callJsonTool<{
      stateVersion: number;
    }>(client, "parley_claim_lease", {
      parleySessionId: sessionId,
      orchestratorRunId: "e2e-run-005",
      ttlSeconds: 300
    });

    const result = await client.callTool({
      name: "parley_step",
      arguments: {
        parleySessionId: sessionId,
        expectedStateVersion: claimed.stateVersion,
        orchestratorRunId: "e2e-run-006"
      }
    });

    assert.equal(result.isError, true);
    const payload = parseTextContent<{
      error: {
        code: string;
        details?: {
          leaseOwner?: string;
          staleLease?: boolean;
          retryable?: boolean;
        };
      };
    }>(result);

    assert.equal(payload.error.code, "lease_conflict");
    assert.equal(payload.error.details?.leaseOwner, "e2e-run-005");
    assert.equal(payload.error.details?.staleLease, false);
    assert.equal(payload.error.details?.retryable, true);
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
      '  questions: [],',
      '  proposed_next_step: "Document the integration outcome"',
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

async function installResumeAwareParticipants(binDir: string): Promise<string> {
  const participantScriptPath = path.join(binDir, "resume-aware-participant.mjs");
  await writeFile(
    participantScriptPath,
    [
      "#!/usr/bin/env node",
      'const [kind, ...args] = process.argv.slice(2);',
      'const resumeFlagIndex = args.indexOf("--resume");',
      "const resumeId =",
      '  resumeFlagIndex >= 0 && args[resumeFlagIndex + 1]',
      '    ? args[resumeFlagIndex + 1]',
      '    : `${kind}-resume-1`;',
      'const summary = resumeFlagIndex >= 0',
      '  ? `${kind} resumed from ${resumeId}`',
      '  : `${kind} started a new participant session`;',
      "const response = {",
      '  stance: kind === "claude" ? "agree" : "refine",',
      "  summary,",
      '  arguments: [`${kind} resume argument`],',
      '  questions: [],',
      '  proposed_next_step: "Document the resume behavior"',
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
