import type { ParleyConfig, ParleySessionState, TranscriptEntry } from "../types.js";
import { ParleyError } from "../errors.js";
import { FileSystemStore } from "../storage/fs-store.js";
import { createId } from "../utils/id.js";

export interface StartSessionInput {
  workspaceId: string;
  workspaceRoot: string;
  topic: string;
  topicId?: string;
  claudeModel?: string;
  geminiModel?: string;
  maxTurns?: number;
  systemPrompt?: string;
  orchestrator: "codex" | "claude" | "gemini" | "other";
  orchestratorRunId?: string;
}

export interface ClaimLeaseInput {
  parleySessionId: string;
  orchestratorRunId: string;
  ttlSeconds: number;
}

export interface AdvanceStepInput {
  parleySessionId: string;
  expectedStateVersion: number;
  orchestratorRunId: string;
  speakerOrder?: Array<"claude" | "gemini">;
  userNudge?: string;
}

export class ParleyService {
  constructor(
    private readonly store: FileSystemStore,
    private readonly config: ParleyConfig
  ) {}

  async startSession(input: StartSessionInput) {
    const resolvedClaudeModel = this.assertAllowedModel(
      "claude",
      input.claudeModel ?? this.config.parley.defaults.claudeModel
    );
    const resolvedGeminiModel = this.assertAllowedModel(
      "gemini",
      input.geminiModel ?? this.config.parley.defaults.geminiModel
    );
    const now = new Date().toISOString();
    const sessionId = createId("parley");

    if (input.topicId) {
      const topicRecord = await this.store.getTopic(input.workspaceId, input.topicId);
      if (!topicRecord) {
        throw new ParleyError("not_found", `Topic not found: ${input.topicId}`, {
          topicId: input.topicId
        });
      }
    }

    const state: ParleySessionState = {
      sessionId,
      workspaceId: input.workspaceId,
      workspaceRoot: input.workspaceRoot,
      topic: input.topic,
      ...(input.topicId ? { topicId: input.topicId } : {}),
      ...(input.systemPrompt ? { systemPrompt: input.systemPrompt } : {}),
      turn: 0,
      maxTurns: input.maxTurns ?? this.config.parley.defaultMaxTurns,
      status: "active",
      stateVersion: 1,
      createdAt: now,
      updatedAt: now,
      participants: {
        claude: { model: resolvedClaudeModel },
        gemini: { model: resolvedGeminiModel }
      },
      orchestratorAuditLog: [
        {
          clientKind: input.orchestrator,
          ...(input.orchestratorRunId ? { runId: input.orchestratorRunId } : {}),
          startedAt: now
        }
      ]
    };

    const transcript: TranscriptEntry[] = [
      {
        timestamp: now,
        kind: "system",
        speaker: "parley",
        message: `Parley session created for topic: ${input.topic}`
      }
    ];

    await this.store.createSession(state, transcript);

    if (input.topicId) {
      const topicRecord = await this.store.getTopic(input.workspaceId, input.topicId);
      if (topicRecord) {
        topicRecord.linkedSessionIds = [...new Set([...topicRecord.linkedSessionIds, sessionId])];
        topicRecord.updatedAt = now;
        await this.store.updateTopic(topicRecord);
      }
    }

    return {
      parleySessionId: sessionId,
      stateVersion: state.stateVersion,
      leaseOwner: state.leaseOwner ?? null,
      appliedModels: {
        claude: resolvedClaudeModel,
        gemini: resolvedGeminiModel
      },
      maxTurns: state.maxTurns
    };
  }

  async getSessionState(sessionId: string): Promise<ParleySessionState> {
    const state = await this.store.getSession(sessionId);
    if (!state) {
      throw new ParleyError("not_found", `Session not found: ${sessionId}`, {
        parleySessionId: sessionId
      });
    }

    return state;
  }

  async claimLease(input: ClaimLeaseInput) {
    const state = await this.getSessionState(input.parleySessionId);
    this.assertActiveSession(state);

    const now = new Date();
    const currentLeaseValid =
      state.leaseOwner && state.leaseExpiresAt
        ? new Date(state.leaseExpiresAt).getTime() > now.getTime()
        : false;

    if (currentLeaseValid && state.leaseOwner !== input.orchestratorRunId) {
      throw new ParleyError(
        "lease_conflict",
        `Lease is currently owned by ${state.leaseOwner}.`,
        state.leaseOwner ? { leaseOwner: state.leaseOwner } : undefined
      );
    }

    state.leaseOwner = input.orchestratorRunId;
    state.leaseExpiresAt = new Date(now.getTime() + input.ttlSeconds * 1000).toISOString();
    state.stateVersion += 1;
    state.lastWriter = input.orchestratorRunId;
    state.updatedAt = now.toISOString();

    await this.store.saveSession(state);

    return {
      leaseOwner: state.leaseOwner,
      leaseExpiresAt: state.leaseExpiresAt,
      stateVersion: state.stateVersion
    };
  }

  async advanceStep(input: AdvanceStepInput) {
    const state = await this.getSessionState(input.parleySessionId);
    this.assertActiveSession(state);

    if (state.stateVersion !== input.expectedStateVersion) {
      throw new ParleyError(
        "version_mismatch",
        `State version mismatch. Expected ${input.expectedStateVersion}, found ${state.stateVersion}.`,
        {
          expectedStateVersion: input.expectedStateVersion,
          actualStateVersion: state.stateVersion
        }
      );
    }

    if (state.leaseOwner && state.leaseOwner !== input.orchestratorRunId) {
      throw new ParleyError("lease_conflict", `Session lease is owned by ${state.leaseOwner}.`, {
        leaseOwner: state.leaseOwner
      });
    }

    const now = new Date().toISOString();
    const nextTurn = state.turn + 1;
    const order = input.speakerOrder ?? ["claude", "gemini"];

    const transcriptEntries: TranscriptEntry[] = [
      {
        timestamp: now,
        kind: "orchestrator",
        speaker: input.orchestratorRunId,
        message: input.userNudge
          ? `Step ${nextTurn} requested. Nudge: ${input.userNudge}`
          : `Step ${nextTurn} requested.`,
        metadata: {
          speakerOrder: order.join(",")
        }
      }
    ];

    state.turn = nextTurn;
    state.stateVersion += 1;
    state.lastWriter = input.orchestratorRunId;
    state.updatedAt = now;
    state.latestSummary =
      "Participant subprocess integration is not wired yet. This step currently records orchestration metadata only.";

    if (state.turn >= state.maxTurns) {
      state.status = "finished";
    }

    await this.store.appendTranscript(state.sessionId, transcriptEntries);
    await this.store.saveSession(state);

    return {
      turn: state.turn,
      stateVersion: state.stateVersion,
      finished: state.status === "finished",
      note:
        "CLI participant execution is scaffolded for the next phase. This step recorded the orchestrator event and advanced state."
    };
  }

  async finishSession(parleySessionId: string, orchestratorRunId?: string) {
    const state = await this.getSessionState(parleySessionId);
    const now = new Date().toISOString();

    if (state.status === "finished") {
      return this.buildFinishResponse(state);
    }

    state.status = "finished";
    state.stateVersion += 1;
    state.updatedAt = now;
    if (orchestratorRunId) {
      state.lastWriter = orchestratorRunId;
    }
    state.orchestratorAuditLog = state.orchestratorAuditLog.map((entry, index, entries) =>
      index === entries.length - 1 && !entry.completedAt ? { ...entry, completedAt: now } : entry
    );

    await this.store.saveSession(state);

    return this.buildFinishResponse(state);
  }

  private buildFinishResponse(state: ParleySessionState) {
    return {
      parleySessionId: state.sessionId,
      status: state.status,
      turn: state.turn,
      summary:
        state.latestSummary ??
        "Parley session finished. Automatic participant synthesis will be added in the next implementation phase."
    };
  }

  private assertAllowedModel(participant: "claude" | "gemini", model: string): string {
    const allowed = this.config.parley.allowedModels[participant];
    if (!allowed.includes(model)) {
      throw new ParleyError("invalid_argument", `Model "${model}" is not allowed for ${participant}.`, {
        participant,
        model
      });
    }

    return model;
  }

  private assertActiveSession(state: ParleySessionState) {
    if (state.status === "finished") {
      throw new ParleyError("session_finished", `Session ${state.sessionId} has already finished.`, {
        parleySessionId: state.sessionId
      });
    }
  }
}
