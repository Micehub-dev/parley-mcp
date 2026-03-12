import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { DebateService } from "../src/services/debate-service.js";
import type { DebateConfig } from "../src/types.js";
import { FileSystemStore } from "../src/storage/fs-store.js";

const config: DebateConfig = {
  debate: {
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

    const state = await fixture.service.getSessionState(result.debateSessionId);
    const topic = await fixture.store.getTopic("default", topicId);

    assert.equal(state.workspaceRoot, fixture.rootDir);
    assert.equal(state.stateVersion, 1);
    assert.equal(state.participants.claude.model, "sonnet");
    assert.equal(state.participants.gemini.model, "auto");
    assert.equal(state.topicId, topicId);
    assert.deepEqual(topic?.linkedSessionIds, [result.debateSessionId]);
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

    const firstFinish = await fixture.service.finishSession(result.debateSessionId, "run-002");
    const secondFinish = await fixture.service.finishSession(result.debateSessionId, "run-003");
    const state = await fixture.service.getSessionState(result.debateSessionId);

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
      result.debateSessionId,
      "transcript.jsonl"
    );
    const transcript = await readFile(transcriptPath, "utf8");

    assert.match(transcript, /Debate session created for topic: Transcript bootstrap/);
  } finally {
    await fixture.cleanup();
  }
});

async function createFixture() {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "parley-sprint1-"));
  const store = new FileSystemStore(rootDir);
  await store.ensureBaseLayout();

  return {
    rootDir,
    store,
    service: new DebateService(store, config),
    cleanup: async () => {
      await rm(rootDir, { recursive: true, force: true });
    }
  };
}
