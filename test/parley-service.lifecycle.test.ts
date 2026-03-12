import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { ParleyError } from "../src/errors.js";
import { ParleyService } from "../src/services/parley-service.js";
import { FileSystemStore } from "../src/storage/fs-store.js";
import type { ParleyConfig, ParticipantKind, ParticipantResponse } from "../src/types.js";
import type {
  ParticipantAdapterInput,
  ParticipantAdapterRegistry,
  ParticipantExecutionResult
} from "../src/participants/types.js";

const config: ParleyConfig = {
  parley: {
    defaults: {
      claudeModel: "sonnet",
      geminiModel: "auto"
    },
    allowedModels: {
      claude: ["sonnet", "opus"],
      gemini: ["auto", "gemini-2.5-pro"]
    },
    defaultMaxTurns: 8
  }
};

test("startSession persists a stable session contract and links an existing topic", async () => {
  const fixture = await createFixture();

  try {
    const topicId = "topic-001";
    await fixture.store.createTopic({
      topicId,
      workspaceId: "default",
      title: "Contract stability",
      body: "Track session linkage",
      status: "open",
      tags: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      linkedSessionIds: [],
      keyThreadIds: [],
      openQuestions: [],
      actionItems: [],
      statusHistory: [{ status: "open", changedAt: new Date().toISOString() }]
    });

    const result = await fixture.service.startSession({
      workspaceId: "default",
      workspaceRoot: fixture.rootDir,
      topic: "Stabilize session schema",
      topicId,
      orchestrator: "codex",
      orchestratorRunId: "run-001"
    });

    const state = await fixture.service.getSessionState(result.parleySessionId);
    const topic = await fixture.store.getTopic("default", topicId);

    assert.equal(state.workspaceRoot, fixture.rootDir);
    assert.equal(state.stateVersion, 1);
    assert.equal(state.participants.claude.model, "sonnet");
    assert.equal(state.participants.gemini.model, "auto");
    assert.equal(state.topicId, topicId);
    assert.deepEqual(topic?.linkedSessionIds, [result.parleySessionId]);
  } finally {
    await fixture.cleanup();
  }
});

test("finishSession stamps the final audit entry exactly once", async () => {
  const fixture = await createFixture();

  try {
    const result = await fixture.service.startSession({
      workspaceId: "default",
      workspaceRoot: fixture.rootDir,
      topic: "Finish semantics",
      orchestrator: "codex",
      orchestratorRunId: "run-002"
    });

    const firstFinish = await fixture.service.finishSession(result.parleySessionId, "run-002");
    const secondFinish = await fixture.service.finishSession(result.parleySessionId, "run-003");
    const state = await fixture.service.getSessionState(result.parleySessionId);

    assert.equal(firstFinish.status, "finished");
    assert.equal(secondFinish.status, "finished");
    assert.equal(state.orchestratorAuditLog.length, 1);
    assert.ok(state.orchestratorAuditLog[0]?.completedAt);
    assert.equal(state.lastWriter, "run-002");
  } finally {
    await fixture.cleanup();
  }
});

test("session transcript is created with the initial system message", async () => {
  const fixture = await createFixture();

  try {
    const result = await fixture.service.startSession({
      workspaceId: "default",
      workspaceRoot: fixture.rootDir,
      topic: "Transcript bootstrap",
      orchestrator: "codex"
    });

    const transcriptPath = path.join(
      fixture.rootDir,
      ".multi-llm",
      "sessions",
      result.parleySessionId,
      "transcript.jsonl"
    );
    const transcript = await readFile(transcriptPath, "utf8");

    assert.match(transcript, /Parley session created for topic: Transcript bootstrap/);
  } finally {
    await fixture.cleanup();
  }
});

test("startSession rejects missing topics and invalid models with explicit error codes", async () => {
  const fixture = await createFixture();

  try {
    await assert.rejects(
      () =>
        fixture.service.startSession({
          workspaceId: "default",
          workspaceRoot: fixture.rootDir,
          topic: "Broken topic link",
          topicId: "topic-missing",
          orchestrator: "codex"
        }),
      (error: unknown) => {
        assert.ok(error instanceof ParleyError);
        assert.equal(error.code, "not_found");
        return true;
      }
    );

    await assert.rejects(
      () =>
        fixture.service.startSession({
          workspaceId: "default",
          workspaceRoot: fixture.rootDir,
          topic: "Broken model config",
          claudeModel: "haiku",
          orchestrator: "codex"
        }),
      (error: unknown) => {
        assert.ok(error instanceof ParleyError);
        assert.equal(error.code, "invalid_argument");
        return true;
      }
    );
  } finally {
    await fixture.cleanup();
  }
});

test("claimLease and advanceStep enforce finished-session, lease, and version rules", async () => {
  const fixture = await createFixture();

  try {
    const result = await fixture.service.startSession({
      workspaceId: "default",
      workspaceRoot: fixture.rootDir,
      topic: "Concurrency rules",
      orchestrator: "codex",
      orchestratorRunId: "run-010"
    });

    const claimed = await fixture.service.claimLease({
      parleySessionId: result.parleySessionId,
      orchestratorRunId: "run-010",
      ttlSeconds: 300
    });

    await assert.rejects(
      () =>
        fixture.service.claimLease({
          parleySessionId: result.parleySessionId,
          orchestratorRunId: "run-011",
          ttlSeconds: 300
        }),
      (error: unknown) => {
        assert.ok(error instanceof ParleyError);
        assert.equal(error.code, "lease_conflict");
        return true;
      }
    );

    await assert.rejects(
      () =>
        fixture.service.advanceStep({
          parleySessionId: result.parleySessionId,
          expectedStateVersion: claimed.stateVersion + 1,
          orchestratorRunId: "run-010"
        }),
      (error: unknown) => {
        assert.ok(error instanceof ParleyError);
        assert.equal(error.code, "version_mismatch");
        return true;
      }
    );

    await fixture.service.finishSession(result.parleySessionId, "run-010");

    await assert.rejects(
      () =>
        fixture.service.claimLease({
          parleySessionId: result.parleySessionId,
          orchestratorRunId: "run-010",
          ttlSeconds: 300
        }),
      (error: unknown) => {
        assert.ok(error instanceof ParleyError);
        assert.equal(error.code, "session_finished");
        return true;
      }
    );
  } finally {
    await fixture.cleanup();
  }
});

test("advanceStep executes both participants, persists resume IDs, and finishes at maxTurns", async () => {
  const mock = createMockAdapters({
    gemini: async (input) => {
      assert.equal(input.priorResponses.length, 0);
      return successResult("gemini", buildResponse("refine", "Gemini opens with a refinement."), {
        resumeId: "gemini-session-1"
      });
    },
    claude: async (input) => {
      assert.equal(input.priorResponses.length, 1);
      assert.equal(input.priorResponses[0]?.participant, "gemini");
      return successResult("claude", buildResponse("agree", "Claude responds with agreement."), {
        resumeId: "claude-session-1"
      });
    }
  });
  const fixture = await createFixture(mock.adapters);

  try {
    const result = await fixture.service.startSession({
      workspaceId: "default",
      workspaceRoot: fixture.rootDir,
      topic: "Single turn parley",
      maxTurns: 1,
      orchestrator: "codex",
      orchestratorRunId: "run-020"
    });

    const lease = await fixture.service.claimLease({
      parleySessionId: result.parleySessionId,
      orchestratorRunId: "run-020",
      ttlSeconds: 300
    });
    const step = await fixture.service.advanceStep({
      parleySessionId: result.parleySessionId,
      expectedStateVersion: lease.stateVersion,
      orchestratorRunId: "run-020",
      speakerOrder: ["gemini", "claude"],
      userNudge: "Close the loop"
    });
    const state = await fixture.service.getSessionState(result.parleySessionId);
    const transcriptPath = path.join(
      fixture.rootDir,
      ".multi-llm",
      "sessions",
      result.parleySessionId,
      "transcript.jsonl"
    );
    const transcript = await readFile(transcriptPath, "utf8");

    assert.deepEqual(mock.calls, ["gemini", "claude"]);
    assert.equal(step.finished, true);
    assert.deepEqual(step.speakerOrder, ["gemini", "claude"]);
    assert.equal(step.responses.claude.summary, "Claude responds with agreement.");
    assert.equal(step.responses.gemini.summary, "Gemini opens with a refinement.");
    assert.equal(state.status, "finished");
    assert.equal(state.turn, 1);
    assert.equal(state.participants.claude.resumeId, "claude-session-1");
    assert.equal(state.participants.gemini.resumeId, "gemini-session-1");
    assert.equal(state.latestTurn?.responses.claude.stance, "agree");
    assert.equal(state.latestTurn?.speakerOrder[0], "gemini");
    assert.match(transcript, /Step 1 requested\. Nudge: Close the loop/);
    assert.match(transcript, /Claude responds with agreement\./);
    assert.match(transcript, /Gemini opens with a refinement\./);
  } finally {
    await fixture.cleanup();
  }
});

test("advanceStep rejects malformed participant output before mutating session state", async () => {
  const fixture = await createFixture(
    createMockAdapters({
      claude: async () => successResult("claude", buildResponse("agree", "Claude is valid.")),
      gemini: async () =>
        ({
          ok: true,
          participant: "gemini",
          output: {
            stance: "refine",
            summary: "Gemini forgot required fields."
          } as unknown as ParticipantResponse,
          raw: emptyRaw("gemini")
        }) satisfies ParticipantExecutionResult
    }).adapters
  );

  try {
    const result = await fixture.service.startSession({
      workspaceId: "default",
      workspaceRoot: fixture.rootDir,
      topic: "Malformed output",
      orchestrator: "codex",
      orchestratorRunId: "run-030"
    });

    const lease = await fixture.service.claimLease({
      parleySessionId: result.parleySessionId,
      orchestratorRunId: "run-030",
      ttlSeconds: 300
    });

    await assert.rejects(
      () =>
        fixture.service.advanceStep({
          parleySessionId: result.parleySessionId,
          expectedStateVersion: lease.stateVersion,
          orchestratorRunId: "run-030"
        }),
      (error: unknown) => {
        assert.ok(error instanceof ParleyError);
        assert.equal(error.code, "participant_failure");
        return true;
      }
    );

    const state = await fixture.service.getSessionState(result.parleySessionId);
    const transcriptPath = path.join(
      fixture.rootDir,
      ".multi-llm",
      "sessions",
      result.parleySessionId,
      "transcript.jsonl"
    );
    const transcript = await readFile(transcriptPath, "utf8");

    assert.equal(state.turn, 0);
    assert.equal(state.stateVersion, lease.stateVersion);
    assert.equal(state.latestTurn, undefined);
    assert.doesNotMatch(transcript, /Step 1 requested/);
  } finally {
    await fixture.cleanup();
  }
});

test("advanceStep propagates participant process failures without partial commit", async () => {
  const fixture = await createFixture(
    createMockAdapters({
      claude: async () =>
        failureResult("claude", "process_error", "Claude CLI exited with code 17.", {
          exitCode: 17
        }),
      gemini: async () => successResult("gemini", buildResponse("refine", "Gemini would succeed."))
    }).adapters
  );

  try {
    const result = await fixture.service.startSession({
      workspaceId: "default",
      workspaceRoot: fixture.rootDir,
      topic: "Subprocess failure",
      orchestrator: "codex",
      orchestratorRunId: "run-040"
    });

    const lease = await fixture.service.claimLease({
      parleySessionId: result.parleySessionId,
      orchestratorRunId: "run-040",
      ttlSeconds: 300
    });

    await assert.rejects(
      () =>
        fixture.service.advanceStep({
          parleySessionId: result.parleySessionId,
          expectedStateVersion: lease.stateVersion,
          orchestratorRunId: "run-040"
        }),
      (error: unknown) => {
        assert.ok(error instanceof ParleyError);
        assert.equal(error.code, "participant_failure");
        assert.match(error.message, /claude/i);
        return true;
      }
    );

    const state = await fixture.service.getSessionState(result.parleySessionId);
    assert.equal(state.turn, 0);
    assert.equal(state.stateVersion, lease.stateVersion);
  } finally {
    await fixture.cleanup();
  }
});

async function createFixture(participantAdapters?: ParticipantAdapterRegistry) {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "parley-sprint2-"));
  const store = new FileSystemStore(rootDir);
  await store.ensureBaseLayout();

  return {
    rootDir,
    store,
    service: new ParleyService(store, config, participantAdapters ?? createMockAdapters().adapters),
    cleanup: async () => {
      await rm(rootDir, { recursive: true, force: true });
    }
  };
}

function buildResponse(stance: ParticipantResponse["stance"], summary: string): ParticipantResponse {
  return {
    stance,
    summary,
    arguments: [`${summary} Argument.`],
    questions: [`${summary} Question?`],
    proposed_next_step: `${summary} Next step.`
  };
}

function createMockAdapters(
  overrides: Partial<
    Record<
      ParticipantKind,
      (input: ParticipantAdapterInput) => Promise<ParticipantExecutionResult> | ParticipantExecutionResult
    >
  > = {}
) {
  const calls: ParticipantKind[] = [];
  const adapters = {
    claude: {
      kind: "claude" as const,
      run: async (input: ParticipantAdapterInput) => {
        calls.push("claude");
        const handler = overrides.claude;
        return handler
          ? handler(input)
          : successResult("claude", buildResponse("agree", "Claude default response."));
      }
    },
    gemini: {
      kind: "gemini" as const,
      run: async (input: ParticipantAdapterInput) => {
        calls.push("gemini");
        const handler = overrides.gemini;
        return handler
          ? handler(input)
          : successResult("gemini", buildResponse("refine", "Gemini default response."));
      }
    }
  } satisfies ParticipantAdapterRegistry;

  return {
    calls,
    adapters
  };
}

function successResult(
  participant: ParticipantKind,
  output: ParticipantResponse,
  options?: { resumeId?: string }
): ParticipantExecutionResult {
  return {
    ok: true,
    participant,
    output,
    raw: emptyRaw(participant),
    ...(options?.resumeId ? { resumeId: options.resumeId } : {})
  };
}

function failureResult(
  participant: ParticipantKind,
  reason: "invalid_output" | "process_error",
  message: string,
  options?: { exitCode?: number }
): ParticipantExecutionResult {
  return {
    ok: false,
    participant,
    reason,
    message,
    raw: {
      ...emptyRaw(participant),
      ...(typeof options?.exitCode === "number" ? { exitCode: options.exitCode } : {})
    }
  };
}

function emptyRaw(participant: ParticipantKind) {
  return {
    command: participant,
    args: [],
    stdout: "",
    stderr: "",
    exitCode: 0
  };
}
