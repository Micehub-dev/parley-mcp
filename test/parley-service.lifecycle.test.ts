import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { ParleyError } from "../src/errors.js";
import { createParticipantAdapters } from "../src/participants/adapters.js";
import type { CommandExecutionInput, CommandExecutor } from "../src/participants/runtime.js";
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

test("getSessionState distinguishes corrupted session artifacts from missing sessions", async () => {
  const fixture = await createFixture();

  try {
    const result = await fixture.service.startSession({
      workspaceId: "default",
      workspaceRoot: fixture.rootDir,
      topic: "Corrupted session state",
      orchestrator: "codex"
    });

    const statePath = path.join(
      fixture.rootDir,
      ".multi-llm",
      "sessions",
      result.parleySessionId,
      "state.json"
    );
    await writeFile(statePath, "{not-valid-json", "utf8");

    await assert.rejects(
      () => fixture.service.getSessionState(result.parleySessionId),
      (error: unknown) => {
        assert.ok(error instanceof ParleyError);
        assert.equal(error.code, "storage_failure");
        assert.equal(error.details?.failureKind, "artifact_invalid");
        assert.equal(error.details?.artifactType, "session_state");
        return true;
      }
    );
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
    assert.equal(step.rollingSummary?.updatedAt, state.rollingSummary?.updatedAt);
    assert.equal(step.latestSummary, state.rollingSummary?.synopsis);
    assert.match(state.rollingSummary?.synopsis ?? "", /Consensus:/);
    assert.match(transcript, /Step 1 requested\. Nudge: Close the loop/);
    assert.match(transcript, /Claude responds with agreement\./);
    assert.match(transcript, /Gemini opens with a refinement\./);
  } finally {
    await fixture.cleanup();
  }
});

test("advanceStep commits Gemini responses that were normalized from labeled plain text", async () => {
  const fixture = await createFixture(
    createParticipantAdapters(
      new SequencedCommandExecutor([
        {
          stdout: JSON.stringify({
            response: [
              "Stance: disagree",
              "Summary: The release plan still needs a narrower support statement.",
              "Arguments:",
              "- Linux CI is helpful but is not a real-CLI smoke.",
              "- macOS remains unverified.",
              "Questions:",
              "- Should the docs stay Windows-first for now?",
              "Next step: Update the release docs and rerun the smoke path."
            ].join("\n"),
            sessionId: "gemini-session-2"
          })
        },
        {
          stdout: JSON.stringify({
            result: JSON.stringify({
              stance: "agree",
              summary: "Claude agrees with narrowing the release statement.",
              arguments: ["Claude wants the docs to match the evidence exactly."],
              questions: [],
              proposed_next_step: "Update the support-boundary docs."
            }),
            session_id: "claude-session-2"
          })
        }
      ])
    )
  );

  try {
    const started = await fixture.service.startSession({
      workspaceId: "default",
      workspaceRoot: fixture.rootDir,
      topic: "Normalized Gemini service path",
      orchestrator: "codex",
      orchestratorRunId: "run-021"
    });
    const lease = await fixture.service.claimLease({
      parleySessionId: started.parleySessionId,
      orchestratorRunId: "run-021",
      ttlSeconds: 300
    });

    const step = await fixture.service.advanceStep({
      parleySessionId: started.parleySessionId,
      expectedStateVersion: lease.stateVersion,
      orchestratorRunId: "run-021",
      speakerOrder: ["gemini", "claude"]
    });
    const state = await fixture.service.getSessionState(started.parleySessionId);

    assert.equal(step.responses.gemini.stance, "disagree");
    assert.equal(
      step.responses.gemini.summary,
      "The release plan still needs a narrower support statement."
    );
    assert.deepEqual(step.responses.gemini.arguments, [
      "Linux CI is helpful but is not a real-CLI smoke.",
      "macOS remains unverified."
    ]);
    assert.deepEqual(step.responses.gemini.questions, [
      "Should the docs stay Windows-first for now?"
    ]);
    assert.equal(
      step.responses.gemini.proposed_next_step,
      "Update the release docs and rerun the smoke path."
    );
    assert.equal(state.participants.gemini.resumeId, "gemini-session-2");
    assert.equal(state.participants.claude.resumeId, "claude-session-2");
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

    const diagnosticsDir = path.join(
      fixture.rootDir,
      ".multi-llm",
      "sessions",
      result.parleySessionId,
      "diagnostics"
    );
    const diagnosticFiles = await readDirSafe(diagnosticsDir);
    assert.equal(diagnosticFiles.length, 1);

    const diagnostic = JSON.parse(
      await readFile(path.join(diagnosticsDir, diagnosticFiles[0]!), "utf8")
    ) as {
      outcome: string;
      stateCommitStatus: string;
      participants: Array<{
        participant: string;
        raw: {
          exitCode: number | null;
        };
        failureKind?: string;
      }>;
    };

    assert.equal(diagnostic.outcome, "participant_failure");
    assert.equal(diagnostic.stateCommitStatus, "not_committed");
    assert.equal(diagnostic.participants[0]?.participant, "claude");
    assert.equal(diagnostic.participants[0]?.raw.exitCode, 17);
    assert.equal(diagnostic.participants[0]?.failureKind, "process_error");
    assert.equal(diagnosticFiles.length, 1);
  } finally {
    await fixture.cleanup();
  }
});

test("advanceStep surfaces timeout guardrails through participant_failure details and diagnostics", async () => {
  const fixture = await createFixture(
    createMockAdapters({
      claude: async () =>
        failureResult("claude", "process_error", "Claude timed out before finishing.", {
          exitCode: null,
          signal: "SIGTERM",
          durationMs: 250,
          timedOut: true,
          guardrail: "timeout"
        }),
      gemini: async () => successResult("gemini", buildResponse("refine", "Gemini would succeed."))
    }).adapters
  );

  try {
    const result = await fixture.service.startSession({
      workspaceId: "default",
      workspaceRoot: fixture.rootDir,
      topic: "Timeout guardrail",
      orchestrator: "codex",
      orchestratorRunId: "run-041"
    });

    const lease = await fixture.service.claimLease({
      parleySessionId: result.parleySessionId,
      orchestratorRunId: "run-041",
      ttlSeconds: 300
    });

    await assert.rejects(
      () =>
        fixture.service.advanceStep({
          parleySessionId: result.parleySessionId,
          expectedStateVersion: lease.stateVersion,
          orchestratorRunId: "run-041"
        }),
      (error: unknown) => {
        assert.ok(error instanceof ParleyError);
        assert.equal(error.code, "participant_failure");
        assert.equal(error.details?.guardrail, "timeout");
        assert.equal(error.details?.timedOut, true);
        assert.equal(error.details?.signal, "SIGTERM");
        return true;
      }
    );

    const diagnostics = await fixture.service.listDiagnostics({
      parleySessionId: result.parleySessionId,
      failureKind: "process_error",
      detailLevel: "full"
    });

    assert.equal(diagnostics.diagnostics[0]?.record.participants[0]?.raw.guardrail, "timeout");
    assert.equal(diagnostics.diagnostics[0]?.record.participants[0]?.raw.timedOut, true);
    assert.match(diagnostics.diagnostics[0]?.repairGuidance.summary ?? "", /timed out/i);
  } finally {
    await fixture.cleanup();
  }
});

test("advanceStep requires stale leases to be reclaimed before execution continues", async () => {
  const fixture = await createFixture();

  try {
    const started = await fixture.service.startSession({
      workspaceId: "default",
      workspaceRoot: fixture.rootDir,
      topic: "Stale lease recovery",
      orchestrator: "codex",
      orchestratorRunId: "run-050"
    });

    const claimed = await fixture.service.claimLease({
      parleySessionId: started.parleySessionId,
      orchestratorRunId: "run-050",
      ttlSeconds: 300
    });
    const state = await fixture.service.getSessionState(started.parleySessionId);
    state.leaseExpiresAt = new Date(Date.now() - 1_000).toISOString();
    await fixture.store.saveSession(state);

    await assert.rejects(
      () =>
        fixture.service.advanceStep({
          parleySessionId: started.parleySessionId,
          expectedStateVersion: claimed.stateVersion,
          orchestratorRunId: "run-050"
        }),
      (error: unknown) => {
        assert.ok(error instanceof ParleyError);
        assert.equal(error.code, "lease_conflict");
        assert.equal(error.details?.staleLease, true);
        return true;
      }
    );

    const reclaimed = await fixture.service.claimLease({
      parleySessionId: started.parleySessionId,
      orchestratorRunId: "run-051",
      ttlSeconds: 300
    });
    const step = await fixture.service.advanceStep({
      parleySessionId: started.parleySessionId,
      expectedStateVersion: reclaimed.stateVersion,
      orchestratorRunId: "run-051"
    });

    assert.equal(step.turn, 1);
    assert.equal(step.finished, false);
  } finally {
    await fixture.cleanup();
  }
});

test("advanceStep surfaces replay boundary when transcript append fails after state commit", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "parley-sprint3-storage-"));
  const store = new FaultyTranscriptStore(rootDir);
  await store.ensureBaseLayout();
  const service = new ParleyService(store, config, createMockAdapters().adapters);

  try {
    const started = await service.startSession({
      workspaceId: "default",
      workspaceRoot: rootDir,
      topic: "Transcript append recovery",
      orchestrator: "codex",
      orchestratorRunId: "run-060"
    });
    const claimed = await service.claimLease({
      parleySessionId: started.parleySessionId,
      orchestratorRunId: "run-060",
      ttlSeconds: 300
    });

    await assert.rejects(
      () =>
        service.advanceStep({
          parleySessionId: started.parleySessionId,
          expectedStateVersion: claimed.stateVersion,
          orchestratorRunId: "run-060"
        }),
      (error: unknown) => {
        assert.ok(error instanceof ParleyError);
        assert.equal(error.code, "storage_failure");
        assert.equal(error.details?.stateCommitted, true);
        return true;
      }
    );

    const state = await service.getSessionState(started.parleySessionId);
    assert.equal(state.turn, 1);
    assert.ok(state.latestTurn);

    const diagnostics = await service.listDiagnostics({
      parleySessionId: started.parleySessionId,
      outcome: "storage_failure"
    });

    const diagnosticsDir = path.join(
      rootDir,
      ".multi-llm",
      "sessions",
      started.parleySessionId,
      "diagnostics"
    );
    const diagnosticFiles = await readDirSafe(diagnosticsDir);
    assert.equal(diagnosticFiles.length, 1);

    const diagnostic = JSON.parse(
      await readFile(path.join(diagnosticsDir, diagnosticFiles[0]!), "utf8")
    ) as {
      outcome: string;
      stateCommitStatus: string;
    };

    assert.equal(diagnostic.outcome, "storage_failure");
    assert.equal(diagnostic.stateCommitStatus, "session_state_committed");
    assert.equal(diagnostics.diagnostics.length, 1);
    assert.equal(diagnostics.diagnostics[0]?.repairGuidance.shouldReadStateFirst, true);
    assert.equal(diagnostics.diagnostics[0]?.repairGuidance.canRetrySameVersion, false);
    assert.equal(diagnostics.diagnostics[0]?.repairGuidance.nextAction.tool, "parley_state");
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("advanceStep maintains a rolling summary across multiple committed turns", async () => {
  const fixture = await createFixture(
    createMockAdapters({
      claude: async (input) =>
        successResult(
          "claude",
          input.turn === 1
            ? buildResponse("agree", "Claude agrees on the first pass.")
            : buildResponse("disagree", "Claude challenges the rollout timing.")
        ),
      gemini: async (input) =>
        successResult(
          "gemini",
          input.turn === 1
            ? buildResponse("refine", "Gemini refines the first pass.")
            : buildResponse("refine", "Gemini proposes a phased rollout.")
        )
    }).adapters
  );

  try {
    const started = await fixture.service.startSession({
      workspaceId: "default",
      workspaceRoot: fixture.rootDir,
      topic: "Rolling summary accumulation",
      orchestrator: "codex",
      orchestratorRunId: "run-080"
    });
    const lease = await fixture.service.claimLease({
      parleySessionId: started.parleySessionId,
      orchestratorRunId: "run-080",
      ttlSeconds: 300
    });

    const firstStep = await fixture.service.advanceStep({
      parleySessionId: started.parleySessionId,
      expectedStateVersion: lease.stateVersion,
      orchestratorRunId: "run-080"
    });
    const secondStep = await fixture.service.advanceStep({
      parleySessionId: started.parleySessionId,
      expectedStateVersion: firstStep.stateVersion,
      orchestratorRunId: "run-080"
    });
    const state = await fixture.service.getSessionState(started.parleySessionId);

    assert.deepEqual(state.rollingSummary?.agreements, [
      "Claude agrees on the first pass.",
      "Gemini refines the first pass."
    ]);
    assert.deepEqual(state.rollingSummary?.disagreements, [
      "Claude challenges the rollout timing."
    ]);
    assert.equal(state.rollingSummary?.openQuestions.length, 4);
    assert.equal(state.rollingSummary?.actionItems.length, 4);
    assert.equal(secondStep.rollingSummary?.synopsis, state.latestSummary);
    assert.match(state.rollingSummary?.synopsis ?? "", /Disagreements:/);
    assert.match(state.rollingSummary?.synopsis ?? "", /Latest turn:/);
  } finally {
    await fixture.cleanup();
  }
});

test("synthesis deduplicates repeated prompts and avoids promoting undecided turns into consensus", async () => {
  const fixture = await createFixture(
    createMockAdapters({
      claude: async (input) =>
        successResult(
          "claude",
          input.turn === 1
            ? {
                stance: "agree",
                summary: "Adopt the phased rollout.",
                arguments: ["Claude supports the phased rollout."],
                questions: ["Who owns the checklist?"],
                proposed_next_step: "Document the checklist."
              }
            : {
                stance: "undecided",
                summary: "Claude wants timeline validation.",
                arguments: ["Claude needs stronger validation evidence."],
                questions: ["Do we need a dry run?"],
                proposed_next_step: "Run a dry run."
              }
        ),
      gemini: async (input) =>
        successResult(
          "gemini",
          input.turn === 1
            ? {
                stance: "refine",
                summary: "Adopt the phased rollout with a canary.",
                arguments: ["Gemini narrows the rollout blast radius."],
                questions: ["Who owns the checklist"],
                proposed_next_step: "Document the checklist"
              }
            : {
                stance: "refine",
                summary: "Gemini also wants timeline validation.",
                arguments: ["Gemini agrees a dry run would help."],
                questions: ["Do we need a dry run"],
                proposed_next_step: "Run a dry run"
              }
        )
    }).adapters
  );

  try {
    const started = await fixture.service.startSession({
      workspaceId: "default",
      workspaceRoot: fixture.rootDir,
      topic: "Signal quality",
      orchestrator: "codex",
      orchestratorRunId: "run-085"
    });
    const lease = await fixture.service.claimLease({
      parleySessionId: started.parleySessionId,
      orchestratorRunId: "run-085",
      ttlSeconds: 300
    });

    const firstStep = await fixture.service.advanceStep({
      parleySessionId: started.parleySessionId,
      expectedStateVersion: lease.stateVersion,
      orchestratorRunId: "run-085"
    });
    await fixture.service.advanceStep({
      parleySessionId: started.parleySessionId,
      expectedStateVersion: firstStep.stateVersion,
      orchestratorRunId: "run-085"
    });

    const finished = await fixture.service.finishSession(started.parleySessionId, "run-085");

    assert.deepEqual(finished.conclusion.consensus, [
      "Adopt the phased rollout.",
      "Adopt the phased rollout with a canary."
    ]);
    assert.deepEqual(finished.conclusion.openQuestions, [
      "Who owns the checklist?",
      "Do we need a dry run?"
    ]);
    assert.deepEqual(finished.conclusion.actionItems, [
      "Document the checklist.",
      "Run a dry run."
    ]);
    assert.match(finished.conclusion.summary, /partial alignment/i);
    assert.doesNotMatch(finished.conclusion.summary, /Latest turn:/);
  } finally {
    await fixture.cleanup();
  }
});

test("finishSession returns a stable structured conclusion derived from the rolling summary", async () => {
  const fixture = await createFixture(
    createMockAdapters({
      claude: async () =>
        successResult("claude", {
          stance: "agree",
          summary: "Claude supports the plan.",
          arguments: ["Claude keeps the implementation path simple."],
          questions: [],
          proposed_next_step: "Write the implementation checklist."
        }),
      gemini: async () =>
        successResult("gemini", {
          stance: "refine",
          summary: "Gemini refines the plan.",
          arguments: ["Gemini scopes the rollout."],
          questions: [],
          proposed_next_step: "Write the implementation checklist."
        })
    }).adapters
  );

  try {
    const started = await fixture.service.startSession({
      workspaceId: "default",
      workspaceRoot: fixture.rootDir,
      topic: "Conclusion contract",
      orchestrator: "codex",
      orchestratorRunId: "run-090"
    });
    const lease = await fixture.service.claimLease({
      parleySessionId: started.parleySessionId,
      orchestratorRunId: "run-090",
      ttlSeconds: 300
    });

    await fixture.service.advanceStep({
      parleySessionId: started.parleySessionId,
      expectedStateVersion: lease.stateVersion,
      orchestratorRunId: "run-090"
    });

    const firstFinish = await fixture.service.finishSession(started.parleySessionId, "run-090");
    const secondFinish = await fixture.service.finishSession(started.parleySessionId, "run-091");

    assert.equal(firstFinish.summary, firstFinish.conclusion.summary);
    assert.deepEqual(firstFinish.conclusion.consensus, [
      "Claude supports the plan.",
      "Gemini refines the plan."
    ]);
    assert.equal(firstFinish.conclusion.recommendedDisposition, "resolved");
    assert.doesNotMatch(firstFinish.conclusion.summary, /Latest turn:/);
    assert.match(firstFinish.conclusion.summary, /working resolution/i);
    assert.deepEqual(secondFinish.conclusion, firstFinish.conclusion);
  } finally {
    await fixture.cleanup();
  }
});

test("promoteSummary updates linked topic memory and stays idempotent", async () => {
  const fixture = await createFixture(
    createMockAdapters({
      claude: async () =>
        successResult("claude", {
          stance: "agree",
          summary: "Claude confirms the decision.",
          arguments: ["Claude sees no remaining blocker."],
          questions: [],
          proposed_next_step: "Document the outcome."
        }),
      gemini: async () =>
        successResult("gemini", {
          stance: "refine",
          summary: "Gemini adds follow-up steps.",
          arguments: ["Gemini aligns the rollout sequence."],
          questions: [],
          proposed_next_step: "Document the outcome."
        })
    }).adapters
  );

  try {
    const now = new Date().toISOString();
    await fixture.store.createTopic({
      topicId: "topic-100",
      workspaceId: "default",
      title: "Promotion target",
      body: "Track session conclusions",
      status: "open",
      tags: [],
      createdAt: now,
      updatedAt: now,
      linkedSessionIds: [],
      keyThreadIds: [],
      openQuestions: [],
      actionItems: [],
      statusHistory: [{ status: "open", changedAt: now }]
    });

    const started = await fixture.service.startSession({
      workspaceId: "default",
      workspaceRoot: fixture.rootDir,
      topic: "Promotion contract",
      topicId: "topic-100",
      orchestrator: "codex",
      orchestratorRunId: "run-100"
    });
    const lease = await fixture.service.claimLease({
      parleySessionId: started.parleySessionId,
      orchestratorRunId: "run-100",
      ttlSeconds: 300
    });

    await fixture.service.advanceStep({
      parleySessionId: started.parleySessionId,
      expectedStateVersion: lease.stateVersion,
      orchestratorRunId: "run-100"
    });
    await fixture.service.finishSession(started.parleySessionId, "run-100");

    const promoted = await fixture.service.promoteSummary({
      parleySessionId: started.parleySessionId
    });
    const promotedAgain = await fixture.service.promoteSummary({
      parleySessionId: started.parleySessionId
    });
    const topic = await fixture.store.getTopic("default", "topic-100");

    assert.deepEqual(promoted.updatedFields, [
      "decisionSummary",
      "canonicalSummary",
      "actionItems",
      "status"
    ]);
    assert.equal(topic?.decisionSummary, promoted.topic.decisionSummary);
    assert.equal(topic?.canonicalSummary, promoted.topic.canonicalSummary);
    assert.doesNotMatch(topic?.decisionSummary ?? "", /Latest turn:/);
    assert.match(topic?.canonicalSummary ?? "", /Topic: Promotion contract\./);
    assert.deepEqual(topic?.linkedSessionIds, [started.parleySessionId]);
    assert.equal(topic?.status, "resolved");
    assert.equal(topic?.statusHistory.length, 2);
    assert.deepEqual(promotedAgain.updatedFields, []);
    assert.deepEqual(promotedAgain.topic.linkedSessionIds, [started.parleySessionId]);
  } finally {
    await fixture.cleanup();
  }
});

test("promoteSummary rejects unfinished sessions before mutating topic memory", async () => {
  const fixture = await createFixture();

  try {
    const started = await fixture.service.startSession({
      workspaceId: "default",
      workspaceRoot: fixture.rootDir,
      topic: "Promotion guardrail",
      orchestrator: "codex",
      orchestratorRunId: "run-110"
    });

    await assert.rejects(
      () =>
        fixture.service.promoteSummary({
          parleySessionId: started.parleySessionId
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

test("searchTopics matches promoted memory fields and tag filters", async () => {
  const fixture = await createFixture();

  try {
    const now = new Date().toISOString();
    await fixture.store.createTopic(
      createTopicRecord({
        topicId: "topic-search-1",
        createdAt: now,
        updatedAt: now,
        title: "Release rollout",
        body: "Track the rollout plan",
        tags: ["ops", "release"],
        decisionSummary: "Use a phased rollout with a rollback checklist.",
        canonicalSummary: "Phased rollout remains the preferred release plan.",
        openQuestions: ["Who owns the rollback checklist?"],
        actionItems: ["Publish the rollback checklist."]
      })
    );
    await fixture.store.createTopic(
      createTopicRecord({
        topicId: "topic-search-2",
        createdAt: now,
        updatedAt: new Date(Date.now() - 60_000).toISOString(),
        title: "Prompt tuning",
        body: "Tune synthesis prompts",
        tags: ["research"],
        actionItems: ["Review the synthesis prompt wording."]
      })
    );

    const result = await fixture.service.searchTopics({
      workspaceId: "default",
      query: "rollback checklist",
      tags: ["ops"]
    });

    assert.equal(result.results.length, 1);
    assert.equal(result.results[0]?.topic.topicId, "topic-search-1");
    assert.deepEqual(result.results[0]?.matchedFields, [
      "decisionSummary",
      "openQuestions",
      "actionItems"
    ]);
    assert.equal(result.results[0]?.score, 8);
  } finally {
    await fixture.cleanup();
  }
});

test("getWorkspaceBoard returns status columns and promoted memory digests", async () => {
  const fixture = await createFixture();

  try {
    const now = new Date().toISOString();
    await fixture.store.createTopic(
      createTopicRecord({
        topicId: "topic-board-open",
        createdAt: now,
        updatedAt: now,
        title: "Open topic",
        status: "open",
        openQuestions: ["What is the remaining blocker?"],
        actionItems: ["Assign an owner."]
      })
    );
    await fixture.store.createTopic(
      createTopicRecord({
        topicId: "topic-board-progress",
        createdAt: now,
        updatedAt: new Date(Date.now() - 30_000).toISOString(),
        title: "Progress topic",
        status: "in_progress",
        linkedSessionIds: ["parley-1"],
        decisionSummary: "The rollout is moving forward."
      })
    );
    await fixture.store.createTopic(
      createTopicRecord({
        topicId: "topic-board-resolved",
        createdAt: now,
        updatedAt: new Date(Date.now() - 120_000).toISOString(),
        title: "Resolved topic",
        status: "resolved",
        decisionSummary: "Decision is final.",
        canonicalSummary: "Decision is final and documented.",
        actionItems: ["Share the final note."]
      })
    );

    const board = await fixture.service.getWorkspaceBoard({
      workspaceId: "default",
      limit: 2
    });

    assert.equal(board.topicCount, 3);
    assert.deepEqual(board.statusCounts, {
      open: 1,
      in_progress: 1,
      resolved: 1
    });
    assert.equal(board.board.open[0]?.topicId, "topic-board-open");
    assert.equal(board.board.in_progress[0]?.linkedSessionCount, 1);
    assert.equal(board.board.resolved[0]?.hasDecisionSummary, true);
    assert.equal(board.openQuestions[0]?.topicId, "topic-board-open");
    assert.equal(board.actionItems[0]?.topicId, "topic-board-open");
  } finally {
    await fixture.cleanup();
  }
});

test("listDiagnostics redacts raw diagnostic details by default and exposes full details on demand", async () => {
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
    const started = await fixture.service.startSession({
      workspaceId: "default",
      workspaceRoot: fixture.rootDir,
      topic: "Diagnostic listing",
      orchestrator: "codex",
      orchestratorRunId: "run-115"
    });
    const lease = await fixture.service.claimLease({
      parleySessionId: started.parleySessionId,
      orchestratorRunId: "run-115",
      ttlSeconds: 300
    });

    await assert.rejects(
      () =>
        fixture.service.advanceStep({
          parleySessionId: started.parleySessionId,
          expectedStateVersion: lease.stateVersion,
          orchestratorRunId: "run-115"
        }),
      (error: unknown) => {
        assert.ok(error instanceof ParleyError);
        assert.equal(error.code, "participant_failure");
        return true;
      }
    );

    const diagnostics = await fixture.service.listDiagnostics({
      parleySessionId: started.parleySessionId,
      failureKind: "process_error"
    });
    const fullDiagnostics = await fixture.service.listDiagnostics({
      parleySessionId: started.parleySessionId,
      failureKind: "process_error",
      detailLevel: "full"
    });

    assert.equal(diagnostics.diagnostics.length, 1);
    assert.equal(diagnostics.diagnostics[0]?.record.participants[0]?.participant, "claude");
    assert.equal(diagnostics.diagnostics[0]?.record.participants[0]?.raw.command, "[redacted]");
    assert.equal(diagnostics.diagnostics[0]?.record.participants[0]?.raw.stderr, "");
    assert.equal(diagnostics.diagnostics[0]?.record.participants[0]?.resumeId, undefined);
    assert.equal(diagnostics.diagnostics[0]?.record.participants[0]?.response, undefined);
    assert.deepEqual(diagnostics.diagnostics[0]?.record.participants[0]?.redaction?.hiddenFields, [
      "raw.command",
      "raw.args",
      "raw.stdout",
      "raw.stderr"
    ]);
    assert.equal(diagnostics.diagnostics[0]?.repairGuidance.canRetrySameVersion, true);
    assert.equal(diagnostics.diagnostics[0]?.repairGuidance.shouldReadStateFirst, false);
    assert.equal(diagnostics.diagnostics[0]?.repairGuidance.nextAction.tool, "parley_step");
    assert.equal(
      diagnostics.diagnostics[0]?.repairGuidance.nextAction.arguments.expectedStateVersion,
      lease.stateVersion
    );
    assert.match(
      diagnostics.diagnostics[0]?.repairGuidance.recommendedSteps.join(" ") ?? "",
      /launcher command/i
    );
    assert.equal(fullDiagnostics.diagnostics[0]?.record.participants[0]?.raw.command, "claude");
    assert.equal(fullDiagnostics.diagnostics[0]?.record.participants[0]?.raw.stderr, "");
    assert.equal(fullDiagnostics.diagnostics[0]?.record.redaction, undefined);
    assert.equal(fullDiagnostics.diagnostics[0]?.record.participants[0]?.redaction, undefined);
  } finally {
    await fixture.cleanup();
  }
});

test("advanceStep exposes when diagnostic persistence fails during participant failure handling", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "parley-sprint3-diagnostic-"));
  const store = new FaultyDiagnosticStore(rootDir);
  await store.ensureBaseLayout();
  const service = new ParleyService(
    store,
    config,
    createMockAdapters({
      claude: async () =>
        failureResult("claude", "process_error", "Claude CLI exited with code 23.", {
          exitCode: 23
        }),
      gemini: async () => successResult("gemini", buildResponse("refine", "Gemini would succeed."))
    }).adapters
  );

  try {
    const started = await service.startSession({
      workspaceId: "default",
      workspaceRoot: rootDir,
      topic: "Diagnostic failure visibility",
      orchestrator: "codex",
      orchestratorRunId: "run-070"
    });
    const claimed = await service.claimLease({
      parleySessionId: started.parleySessionId,
      orchestratorRunId: "run-070",
      ttlSeconds: 300
    });

    await assert.rejects(
      () =>
        service.advanceStep({
          parleySessionId: started.parleySessionId,
          expectedStateVersion: claimed.stateVersion,
          orchestratorRunId: "run-070"
        }),
      (error: unknown) => {
        assert.ok(error instanceof ParleyError);
        assert.equal(error.code, "participant_failure");
        assert.equal(error.details?.diagnosticsPersisted, false);
        return true;
      }
    );

    const diagnosticsDir = path.join(
      rootDir,
      ".multi-llm",
      "sessions",
      started.parleySessionId,
      "diagnostics"
    );
    const diagnosticFiles = await readDirSafe(diagnosticsDir);
    assert.equal(diagnosticFiles.length, 0);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
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

function createTopicRecord(
  overrides: Partial<import("../src/types.js").TopicRecord> & {
    topicId: string;
    createdAt: string;
    updatedAt: string;
    title?: string;
  }
): import("../src/types.js").TopicRecord {
  return {
    topicId: overrides.topicId,
    workspaceId: overrides.workspaceId ?? "default",
    title: overrides.title ?? overrides.topicId,
    body: overrides.body ?? "",
    status: overrides.status ?? "open",
    tags: overrides.tags ?? [],
    createdAt: overrides.createdAt,
    updatedAt: overrides.updatedAt,
    linkedSessionIds: overrides.linkedSessionIds ?? [],
    keyThreadIds: overrides.keyThreadIds ?? [],
    ...(overrides.decisionSummary ? { decisionSummary: overrides.decisionSummary } : {}),
    openQuestions: overrides.openQuestions ?? [],
    actionItems: overrides.actionItems ?? [],
    ...(overrides.canonicalSummary ? { canonicalSummary: overrides.canonicalSummary } : {}),
    statusHistory: overrides.statusHistory ?? [
      {
        status: overrides.status ?? "open",
        changedAt: overrides.createdAt
      }
    ]
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
  options?: {
    exitCode?: number | null;
    signal?: string;
    durationMs?: number;
    timedOut?: boolean;
    outputLimitExceeded?: boolean;
    guardrail?: import("../src/types.js").ParticipantProcessGuardrail;
  }
): ParticipantExecutionResult {
  return {
    ok: false,
    participant,
    reason,
    message,
    raw: {
      ...emptyRaw(participant),
      ...(options && "exitCode" in options ? { exitCode: options.exitCode ?? null } : {}),
      ...(options?.signal ? { signal: options.signal } : {}),
      ...(typeof options?.durationMs === "number" ? { durationMs: options.durationMs } : {}),
      ...(options?.timedOut ? { timedOut: true } : {}),
      ...(options?.outputLimitExceeded ? { outputLimitExceeded: true } : {}),
      ...(options?.guardrail ? { guardrail: options.guardrail } : {})
    },
    ...(options?.guardrail ? { guardrail: options.guardrail } : {})
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

class FaultyTranscriptStore extends FileSystemStore {
  override async appendTranscript(_sessionId: string, _entries: unknown[]): Promise<void> {
    throw new Error("Simulated transcript append failure.");
  }
}

class FaultyDiagnosticStore extends FileSystemStore {
  override async writeSessionDiagnostic(
    _sessionId: string,
    _diagnosticId: string,
    _payload: unknown
  ): Promise<string> {
    throw new Error("Simulated diagnostic write failure.");
  }
}

class SequencedCommandExecutor implements CommandExecutor {
  constructor(
    private readonly responses: Array<{
      stdout: string;
      stderr?: string;
      exitCode?: number | null;
    }>
  ) {}

  async run(input: CommandExecutionInput) {
    const response = this.responses.shift();
    if (!response) {
      throw new Error("No fake subprocess response was configured.");
    }

    return {
      command: input.command,
      args: input.args,
      stdout: response.stdout,
      stderr: response.stderr ?? "",
      exitCode: response.exitCode ?? 0
    };
  }
}

async function readDirSafe(dirPath: string): Promise<string[]> {
  try {
    return await readdir(dirPath);
  } catch {
    return [];
  }
}
