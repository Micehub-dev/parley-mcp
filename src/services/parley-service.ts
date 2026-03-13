import { ZodError } from "zod";

import { ParleyError } from "../errors.js";
import { participantResponseSchema } from "../participants/schema.js";
import type { ParticipantRawExecution } from "../participants/types.js";
import type { ParticipantAdapterRegistry } from "../participants/types.js";
import type { ParticipantExecutionFailure } from "../participants/types.js";
import { FileSystemStore, isFileSystemStoreError } from "../storage/fs-store.js";
import type {
  DiagnosticDetailLevel,
  DiagnosticRepairAction,
  DiagnosticRepairGuidance,
  OrchestratorAuditLogEntry,
  ParleyConfig,
  ParleySessionState,
  ParticipantKind,
  ParticipantResponse,
  RollingSummary,
  SessionDiagnosticParticipant,
  SessionDiagnosticRecord,
  SessionDiagnosticRecordView,
  SessionDiagnosticParticipantView,
  SessionConclusion,
  TopicBoardCard,
  TopicRecord,
  TopicSearchResult,
  TranscriptEntry,
  WorkspaceBoard
} from "../types.js";
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

export interface PromoteSummaryInput {
  parleySessionId: string;
  topicId?: string;
}

export interface SearchTopicsInput {
  workspaceId: string;
  status?: TopicRecord["status"];
  query?: string;
  tags?: string[];
  limit?: number;
}

export interface GetWorkspaceBoardInput {
  workspaceId: string;
  limit?: number;
}

export interface ListDiagnosticsInput {
  parleySessionId: string;
  outcome?: SessionDiagnosticRecord["outcome"];
  participant?: ParticipantKind;
  failureKind?: SessionDiagnosticParticipant["failureKind"];
  limit?: number;
  detailLevel?: DiagnosticDetailLevel;
}

type StepParticipantDiagnostic = SessionDiagnosticParticipant & {
  raw: ParticipantRawExecution;
};

export class ParleyService {
  constructor(
    private readonly store: FileSystemStore,
    private readonly config: ParleyConfig,
    private readonly participantAdapters: ParticipantAdapterRegistry
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
      const topicRecord = await this.getTopicRecord(input.workspaceId, input.topicId);
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

    try {
      await this.store.createSession(state, transcript);
    } catch (error) {
      this.rethrowStorageFailure(error, "Failed to create session artifacts.");
    }

    if (input.topicId) {
      const topicRecord = await this.getTopicRecord(input.workspaceId, input.topicId);
      if (topicRecord) {
        topicRecord.linkedSessionIds = [...new Set([...topicRecord.linkedSessionIds, sessionId])];
        topicRecord.updatedAt = now;
        try {
          await this.store.updateTopic(topicRecord);
        } catch (error) {
          this.rethrowStorageFailure(error, "Failed to link the created session back to its topic.");
        }
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
    let state: ParleySessionState | null;
    try {
      state = await this.store.getSession(sessionId);
    } catch (error) {
      this.rethrowStorageFailure(error, "Failed to read session state.");
    }

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

    try {
      await this.store.saveSession(state);
    } catch (error) {
      this.rethrowStorageFailure(error, "Failed to persist the claimed lease.");
    }

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

    const leaseStatus = this.getLeaseStatus(state);

    if (state.leaseOwner) {
      if (!leaseStatus.isActive) {
        throw new ParleyError(
          "lease_conflict",
          "Session lease has expired and must be reclaimed before parley_step.",
          {
            leaseOwner: state.leaseOwner,
            retryable: true,
            staleLease: true
          }
        );
      }

      if (state.leaseOwner !== input.orchestratorRunId) {
        throw new ParleyError("lease_conflict", `Session lease is owned by ${state.leaseOwner}.`, {
          leaseOwner: state.leaseOwner,
          retryable: true,
          staleLease: false
        });
      }
    }

    const nextTurn = state.turn + 1;
    const order = this.resolveSpeakerOrder(input.speakerOrder);
    const startedAt = new Date().toISOString();
    const orderedResponses: Array<{
      participant: ParticipantKind;
      response: ParticipantResponse;
      resumeId?: string;
    }> = [];
    const participantDiagnostics: StepParticipantDiagnostic[] = [];

    for (const participant of order) {
      const adapter = this.participantAdapters[participant];
      const result = await adapter.run({
        session: state,
        turn: nextTurn,
        speakerOrder: order,
        priorResponses: orderedResponses.map(({ participant: previousParticipant, response }) => ({
          participant: previousParticipant,
          response
        })),
        ...(input.userNudge ? { userNudge: input.userNudge } : {})
      });

      if (!result.ok) {
        participantDiagnostics.push({
          participant,
          model: state.participants[participant].model,
          status: "failed",
          raw: result.raw,
          failureKind: result.reason,
          message: result.message,
          retryable: result.reason === "process_error"
        });
        const diagnosticsPersisted = await this.persistStepDiagnostic({
          state,
          input,
          turn: nextTurn,
          speakerOrder: order,
          startedAt,
          completedAt: new Date().toISOString(),
          outcome: "participant_failure",
          stateCommitStatus: "not_committed",
          participantDiagnostics
        });
        throw new ParleyError(
          "participant_failure",
          `${participant} failed during parley_step: ${result.message}`,
          this.buildParticipantFailureDetails(participant, result, diagnosticsPersisted)
        );
      }

      try {
        const response = participantResponseSchema.parse(result.output);
        participantDiagnostics.push({
          participant,
          model: state.participants[participant].model,
          status: "ok",
          raw: result.raw,
          response,
          ...(result.resumeId ? { resumeId: result.resumeId } : {})
        });
        orderedResponses.push({
          participant,
          response,
          ...(result.resumeId ? { resumeId: result.resumeId } : {})
        });
      } catch (error) {
        const message =
          error instanceof ZodError
            ? error.issues.map((issue) => issue.message).join("; ")
            : "Participant output failed validation.";
        participantDiagnostics.push({
          participant,
          model: state.participants[participant].model,
          status: "invalid_output",
          raw: result.raw,
          message,
          failureKind: "invalid_output",
          retryable: false
        });
        const diagnosticsPersisted = await this.persistStepDiagnostic({
          state,
          input,
          turn: nextTurn,
          speakerOrder: order,
          startedAt,
          completedAt: new Date().toISOString(),
          outcome: "participant_failure",
          stateCommitStatus: "not_committed",
          participantDiagnostics
        });
        throw new ParleyError(
          "participant_failure",
          `${participant} returned invalid structured output: ${message}`,
          {
            participant,
            reason: "invalid_output",
            retryable: false,
            diagnosticsPersisted
          }
        );
      }
    }

    const responses = this.toResponseRecord(orderedResponses);
    const now = new Date().toISOString();

    for (const entry of orderedResponses) {
      if (entry.resumeId) {
        state.participants[entry.participant].resumeId = entry.resumeId;
      }
    }

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
      },
      ...order.map((participant) => {
        const participantState = state.participants[participant];
        const response = responses[participant];
        const metadata: Record<string, string | number | boolean> = {
          model: participantState.model,
          stance: response.stance
        };

        if (participantState.resumeId) {
          metadata.resumeId = participantState.resumeId;
        }

        return {
          timestamp: now,
          kind: "participant" as const,
          speaker: participant,
          message: JSON.stringify(response),
          metadata
        };
      })
    ];

    state.turn = nextTurn;
    state.stateVersion += 1;
    state.lastWriter = input.orchestratorRunId;
    state.updatedAt = now;
    state.latestTurn = {
      turn: nextTurn,
      speakerOrder: order,
      completedAt: now,
      ...(input.userNudge ? { userNudge: input.userNudge } : {}),
      responses
    };
    state.rollingSummary = this.buildRollingSummary(state.topic, state.rollingSummary, responses, now);
    state.latestSummary = state.rollingSummary.synopsis;

    if (state.turn >= state.maxTurns) {
      state.status = "finished";
      state.orchestratorAuditLog = this.markAuditCompleted(state.orchestratorAuditLog, now);
    }

    try {
      await this.store.saveSession(state);
    } catch (_error) {
      const diagnosticsPersisted = await this.persistStepDiagnostic({
        state,
        input,
        turn: nextTurn,
        speakerOrder: order,
        startedAt,
        completedAt: new Date().toISOString(),
        outcome: "storage_failure",
        stateCommitStatus: "not_committed",
        participantDiagnostics
      });
      throw new ParleyError(
        "storage_failure",
        `Failed to persist session state for turn ${nextTurn}.`,
        {
          retryable: true,
          stateCommitted: false,
          diagnosticsPersisted
        }
      );
    }

    try {
      await this.store.appendTranscript(state.sessionId, transcriptEntries);
    } catch (_error) {
      const diagnosticsPersisted = await this.persistStepDiagnostic({
        state,
        input,
        turn: nextTurn,
        speakerOrder: order,
        startedAt,
        completedAt: new Date().toISOString(),
        outcome: "storage_failure",
        stateCommitStatus: "session_state_committed",
        participantDiagnostics
      });
      throw new ParleyError(
        "storage_failure",
        "Step state was committed, but transcript append failed. Read parley_state before retrying.",
        {
          retryable: false,
          stateCommitted: true,
          diagnosticsPersisted
        }
      );
    }

    return {
      turn: state.turn,
      stateVersion: state.stateVersion,
      finished: state.status === "finished",
      speakerOrder: order,
      responses,
      latestSummary: state.latestSummary,
      rollingSummary: state.rollingSummary
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
    state.orchestratorAuditLog = this.markAuditCompleted(state.orchestratorAuditLog, now);

    try {
      await this.store.saveSession(state);
    } catch (error) {
      this.rethrowStorageFailure(error, "Failed to persist the finished session.");
    }

    return this.buildFinishResponse(state);
  }

  async promoteSummary(input: PromoteSummaryInput) {
    const state = await this.getSessionState(input.parleySessionId);

    if (state.status !== "finished") {
      throw new ParleyError(
        "invalid_argument",
        "Session must be finished before promoting its summary into topic memory.",
        {
          parleySessionId: input.parleySessionId
        }
      );
    }

    const resolvedTopicId = input.topicId ?? state.topicId;
    if (!resolvedTopicId) {
      throw new ParleyError(
        "invalid_argument",
        "No topicId was provided and the session is not linked to a topic.",
        {
          parleySessionId: input.parleySessionId
        }
      );
    }

    const topic = await this.getTopicRecord(state.workspaceId, resolvedTopicId);
    if (!topic) {
      throw new ParleyError("not_found", `Topic not found: ${resolvedTopicId}`, {
        topicId: resolvedTopicId
      });
    }

    const conclusion = this.buildConclusion(state);
    const nextTopic: TopicRecord = {
      ...topic,
      linkedSessionIds: [...topic.linkedSessionIds],
      openQuestions: [...topic.openQuestions],
      actionItems: [...topic.actionItems],
      statusHistory: [...topic.statusHistory]
    };
    const updatedFields: string[] = [];
    let changed = false;

    if (!nextTopic.linkedSessionIds.includes(state.sessionId)) {
      nextTopic.linkedSessionIds.push(state.sessionId);
      updatedFields.push("linkedSessionIds");
      changed = true;
    }

    if (nextTopic.decisionSummary !== conclusion.summary) {
      nextTopic.decisionSummary = conclusion.summary;
      updatedFields.push("decisionSummary");
      changed = true;
    }

    const canonicalSummary = this.buildCanonicalTopicSummary(state, conclusion);
    if (nextTopic.canonicalSummary !== canonicalSummary) {
      nextTopic.canonicalSummary = canonicalSummary;
      updatedFields.push("canonicalSummary");
      changed = true;
    }

    if (!this.areStringArraysEqual(nextTopic.openQuestions, conclusion.openQuestions)) {
      nextTopic.openQuestions = [...conclusion.openQuestions];
      updatedFields.push("openQuestions");
      changed = true;
    }

    if (!this.areStringArraysEqual(nextTopic.actionItems, conclusion.actionItems)) {
      nextTopic.actionItems = [...conclusion.actionItems];
      updatedFields.push("actionItems");
      changed = true;
    }

    if (nextTopic.status !== conclusion.recommendedDisposition) {
      nextTopic.status = conclusion.recommendedDisposition;
      nextTopic.statusHistory.push({
        status: conclusion.recommendedDisposition,
        changedAt: new Date().toISOString()
      });
      updatedFields.push("status");
      changed = true;
    }

    if (changed) {
      nextTopic.updatedAt = new Date().toISOString();
      try {
        await this.store.updateTopic(nextTopic);
      } catch (error) {
        this.rethrowStorageFailure(error, "Failed to persist promoted topic memory.");
      }
    }

    return {
      topicId: nextTopic.topicId,
      sourceSessionId: state.sessionId,
      updatedFields,
      topic: nextTopic
    };
  }

  async searchTopics(input: SearchTopicsInput): Promise<{
    workspaceId: string;
    results: TopicSearchResult[];
  }> {
    let topics: TopicRecord[];
    try {
      topics = await this.store.listTopics(input.workspaceId);
    } catch (error) {
      this.rethrowStorageFailure(error, "Failed to read workspace topics.");
    }
    const normalizedTags = this.normalizeTags(input.tags);
    const queryTokens = this.tokenizeSearchQuery(input.query);
    const limit = input.limit ?? 20;

    const results = topics
      .filter((topic) => (input.status ? topic.status === input.status : true))
      .filter((topic) => this.topicMatchesTags(topic, normalizedTags))
      .map((topic) => {
        const matchedFields = this.getMatchedTopicFields(topic, queryTokens);
        return {
          topic,
          matchedFields,
          score: this.scoreTopicMatch(matchedFields)
        };
      })
      .filter((result) => queryTokens.length === 0 || result.matchedFields.length > 0)
      .sort((left, right) => {
        if (right.score !== left.score) {
          return right.score - left.score;
        }

        return right.topic.updatedAt.localeCompare(left.topic.updatedAt);
      })
      .slice(0, limit);

    return {
      workspaceId: input.workspaceId,
      results
    };
  }

  async getWorkspaceBoard(input: GetWorkspaceBoardInput): Promise<WorkspaceBoard> {
    let topics: TopicRecord[];
    try {
      topics = await this.store.listTopics(input.workspaceId);
    } catch (error) {
      this.rethrowStorageFailure(error, "Failed to build the workspace board from persisted topics.");
    }
    const limit = input.limit ?? 10;
    const board = {
      open: [] as TopicBoardCard[],
      in_progress: [] as TopicBoardCard[],
      resolved: [] as TopicBoardCard[]
    };
    const openQuestions: WorkspaceBoard["openQuestions"] = [];
    const actionItems: WorkspaceBoard["actionItems"] = [];

    for (const topic of topics) {
      const card = this.toTopicBoardCard(topic);
      if (board[topic.status].length < limit) {
        board[topic.status].push(card);
      }

      for (const question of topic.openQuestions) {
        if (openQuestions.length >= limit) {
          break;
        }

        openQuestions.push({
          topicId: topic.topicId,
          title: topic.title,
          question
        });
      }

      for (const actionItem of topic.actionItems) {
        if (actionItems.length >= limit) {
          break;
        }

        actionItems.push({
          topicId: topic.topicId,
          title: topic.title,
          actionItem
        });
      }
    }

    return {
      workspaceId: input.workspaceId,
      topicCount: topics.length,
      ...(topics[0] ? { lastUpdatedAt: topics[0].updatedAt } : {}),
      statusCounts: {
        open: topics.filter((topic) => topic.status === "open").length,
        in_progress: topics.filter((topic) => topic.status === "in_progress").length,
        resolved: topics.filter((topic) => topic.status === "resolved").length
      },
      board,
      openQuestions,
      actionItems
    };
  }

  async listDiagnostics(input: ListDiagnosticsInput): Promise<{
    parleySessionId: string;
    diagnostics: Array<{
      diagnosticId: string;
      record: SessionDiagnosticRecordView;
      repairGuidance: DiagnosticRepairGuidance;
    }>;
  }> {
    await this.getSessionState(input.parleySessionId);

    const detailLevel = input.detailLevel ?? "redacted";
    let diagnostics: Array<{ diagnosticId: string; record: SessionDiagnosticRecord }>;
    try {
      diagnostics = await this.store.listSessionDiagnostics(input.parleySessionId);
    } catch (error) {
      this.rethrowStorageFailure(error, "Failed to read persisted diagnostics.");
    }
    const filtered = diagnostics
      .filter(({ record }) => (input.outcome ? record.outcome === input.outcome : true))
      .filter(({ record }) =>
        input.participant
          ? record.participants.some((participant) => participant.participant === input.participant)
          : true
      )
      .filter(({ record }) =>
        input.failureKind
          ? record.participants.some((participant) => participant.failureKind === input.failureKind)
          : true
      )
      .slice(0, input.limit ?? 20)
      .map(({ diagnosticId, record }) => ({
        diagnosticId,
        record: this.renderDiagnosticRecord(record, detailLevel),
        repairGuidance: this.buildRepairGuidance(record)
      }));

    return {
      parleySessionId: input.parleySessionId,
      diagnostics: filtered
    };
  }

  private buildFinishResponse(state: ParleySessionState) {
    const conclusion = this.buildConclusion(state);

    return {
      parleySessionId: state.sessionId,
      status: state.status,
      turn: state.turn,
      summary: conclusion.summary,
      conclusion
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

  private resolveSpeakerOrder(
    speakerOrder?: Array<"claude" | "gemini">
  ): Array<"claude" | "gemini"> {
    const order = speakerOrder ?? ["claude", "gemini"];
    if (
      order.length !== 2 ||
      order[0] === order[1] ||
      !order.includes("claude") ||
      !order.includes("gemini")
    ) {
      throw new ParleyError(
        "invalid_argument",
        "speakerOrder must include claude and gemini exactly once."
      );
    }

    return order;
  }

  private getLeaseStatus(state: ParleySessionState) {
    if (!state.leaseOwner || !state.leaseExpiresAt) {
      return {
        isActive: false
      };
    }

    return {
      isActive: new Date(state.leaseExpiresAt).getTime() > Date.now()
    };
  }

  private toResponseRecord(
    orderedResponses: Array<{
      participant: ParticipantKind;
      response: ParticipantResponse;
    }>
  ): Record<ParticipantKind, ParticipantResponse> {
    const responseMap = new Map(
      orderedResponses.map((entry) => [entry.participant, entry.response] as const)
    );
    const claude = responseMap.get("claude");
    const gemini = responseMap.get("gemini");

    if (!claude || !gemini) {
      throw new ParleyError(
        "participant_failure",
        "Both participant responses must be present before state is persisted."
      );
    }

    return {
      claude,
      gemini
    };
  }

  private buildRollingSummary(
    topic: string,
    previousSummary: RollingSummary | undefined,
    responses: Record<ParticipantKind, ParticipantResponse>,
    updatedAt: string
  ): RollingSummary {
    const canAccumulateAgreements = [responses.claude.stance, responses.gemini.stance].every(
      (stance) => stance === "agree" || stance === "refine"
    );
    const nextAgreements =
      canAccumulateAgreements
        ? this.mergeUniqueStrings(previousSummary?.agreements, [
            responses.claude.summary,
            responses.gemini.summary
          ])
        : previousSummary?.agreements ?? [];
    const nextDisagreements =
      responses.claude.stance === "disagree" || responses.gemini.stance === "disagree"
        ? this.mergeUniqueStrings(previousSummary?.disagreements, [
            ...(responses.claude.stance === "disagree" ? [responses.claude.summary] : []),
            ...(responses.gemini.stance === "disagree" ? [responses.gemini.summary] : [])
          ])
        : previousSummary?.disagreements ?? [];
    const nextOpenQuestions = this.mergeUniqueStrings(previousSummary?.openQuestions, [
      ...responses.claude.questions,
      ...responses.gemini.questions
    ]);
    const nextActionItems = this.mergeUniqueStrings(previousSummary?.actionItems, [
      responses.claude.proposed_next_step,
      responses.gemini.proposed_next_step
    ]);

    return {
      synopsis: this.buildRollingSynopsis(
        topic,
        responses,
        nextAgreements,
        nextDisagreements,
        nextOpenQuestions,
        nextActionItems
      ),
      agreements: nextAgreements,
      disagreements: nextDisagreements,
      openQuestions: nextOpenQuestions,
      actionItems: nextActionItems,
      updatedAt
    };
  }

  private buildRollingSynopsis(
    topic: string,
    responses: Record<ParticipantKind, ParticipantResponse>,
    agreements: string[],
    disagreements: string[],
    openQuestions: string[],
    actionItems: string[]
  ): string {
    const parts = [`Topic: ${topic}.`];

    if (agreements.length > 0) {
      parts.push(`Consensus: ${this.formatInsightList(agreements, 2)}`);
    }

    if (disagreements.length > 0) {
      parts.push(`Disagreements: ${this.formatInsightList(disagreements, 2)}`);
    }

    if (openQuestions.length > 0) {
      parts.push(`Open questions: ${this.formatInsightList(openQuestions, 2)}`);
    }

    if (actionItems.length > 0) {
      parts.push(`Next actions: ${this.formatInsightList(actionItems, 2)}`);
    }

    parts.push(
      `Latest turn: Claude (${responses.claude.stance}) ${responses.claude.summary} | Gemini (${responses.gemini.stance}) ${responses.gemini.summary}`
    );

    return parts.join(" ");
  }

  private buildConclusion(state: ParleySessionState): SessionConclusion {
    const rollingSummary = state.rollingSummary;
    const consensus = rollingSummary?.agreements ?? [];
    const disagreements = rollingSummary?.disagreements ?? [];
    const openQuestions = rollingSummary?.openQuestions ?? [];
    const actionItems = rollingSummary?.actionItems ?? [];
    const summary =
      state.turn === 0 && !state.latestTurn
        ? "Parley session finished before any participant turns were committed."
        : this.buildConclusionSummary(state, consensus, disagreements, openQuestions, actionItems);

    return {
      summary,
      consensus,
      disagreements,
      openQuestions,
      actionItems,
      recommendedDisposition: this.resolveRecommendedDisposition(
        consensus,
        disagreements,
        openQuestions,
        actionItems,
        state.turn
      )
    };
  }

  private resolveRecommendedDisposition(
    consensus: string[],
    disagreements: string[],
    openQuestions: string[],
    actionItems: string[],
    turnCount: number
  ): TopicRecord["status"] {
    if (consensus.length > 0 && disagreements.length === 0 && openQuestions.length === 0) {
      return "resolved";
    }

    if (turnCount > 0 || actionItems.length > 0 || consensus.length > 0 || disagreements.length > 0) {
      return "in_progress";
    }

    return "open";
  }

  private buildCanonicalTopicSummary(
    state: ParleySessionState,
    conclusion: SessionConclusion
  ): string {
    const parts = [`Topic: ${state.topic}.`, conclusion.summary];

    if (conclusion.consensus.length > 0) {
      parts.push(`Consensus: ${this.formatInsightList(conclusion.consensus, 3)}`);
    }

    if (conclusion.disagreements.length > 0) {
      parts.push(`Disagreements: ${this.formatInsightList(conclusion.disagreements, 3)}`);
    }

    if (conclusion.openQuestions.length > 0) {
      parts.push(`Open questions: ${this.formatInsightList(conclusion.openQuestions, 3)}`);
    }

    if (conclusion.actionItems.length > 0) {
      parts.push(`Action items: ${this.formatInsightList(conclusion.actionItems, 3)}`);
    }

    return parts.join(" ");
  }

  private mergeUniqueStrings(existing: string[] | undefined, additions: string[]): string[] {
    const merged = new Map<string, string>();

    for (const value of existing ?? []) {
      const cleaned = this.cleanInsight(value);
      if (cleaned) {
        merged.set(this.normalizeInsightKey(cleaned), cleaned);
      }
    }

    for (const value of additions) {
      const cleaned = this.cleanInsight(value);
      if (cleaned) {
        const normalizedKey = this.normalizeInsightKey(cleaned);
        if (!merged.has(normalizedKey)) {
          merged.set(normalizedKey, cleaned);
        }
      }
    }

    return [...merged.values()];
  }

  private buildConclusionSummary(
    state: ParleySessionState,
    consensus: string[],
    disagreements: string[],
    openQuestions: string[],
    actionItems: string[]
  ): string {
    const parts = [this.buildConclusionLead(state.topic, consensus, disagreements, openQuestions)];

    if (consensus.length > 0) {
      parts.push(`Consensus: ${this.formatInsightList(consensus, 2)}`);
    }

    if (disagreements.length > 0) {
      parts.push(`Remaining disagreements: ${this.formatInsightList(disagreements, 2)}`);
    }

    if (openQuestions.length > 0) {
      parts.push(`Open questions: ${this.formatInsightList(openQuestions, 2)}`);
    }

    if (actionItems.length > 0) {
      parts.push(`Next actions: ${this.formatInsightList(actionItems, 2)}`);
    }

    return parts.join(" ");
  }

  private buildConclusionLead(
    topic: string,
    consensus: string[],
    disagreements: string[],
    openQuestions: string[]
  ): string {
    if (consensus.length > 0 && disagreements.length === 0 && openQuestions.length === 0) {
      return `The parley reached a working resolution on ${topic}.`;
    }

    if (consensus.length > 0) {
      return `The parley clarified ${topic} and established partial alignment.`;
    }

    if (disagreements.length > 0) {
      return `The parley surfaced unresolved disagreement on ${topic}.`;
    }

    return `The parley advanced discussion on ${topic}.`;
  }

  private formatInsightList(values: string[], limit: number): string {
    const visible = values.slice(0, limit);
    const remaining = values.length - visible.length;
    const text = visible.join("; ");

    return remaining > 0 ? `${text}; +${remaining} more` : text;
  }

  private cleanInsight(value: string): string {
    return value.replace(/\s+/gu, " ").trim();
  }

  private normalizeInsightKey(value: string): string {
    return this.cleanInsight(value).toLowerCase().replace(/[.?!]+$/u, "");
  }

  private areStringArraysEqual(left: string[], right: string[]) {
    return (
      left.length === right.length && left.every((value, index) => value === right[index])
    );
  }

  private normalizeTags(tags?: string[]) {
    if (!tags || tags.length === 0) {
      return [];
    }

    return [...new Set(tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean))];
  }

  private tokenizeSearchQuery(query?: string) {
    if (!query) {
      return [];
    }

    return [...new Set(query.toLowerCase().split(/\s+/u).map((token) => token.trim()).filter(Boolean))];
  }

  private topicMatchesTags(topic: TopicRecord, tags: string[]) {
    if (tags.length === 0) {
      return true;
    }

    const topicTags = new Set(topic.tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean));
    return tags.every((tag) => topicTags.has(tag));
  }

  private getMatchedTopicFields(topic: TopicRecord, queryTokens: string[]) {
    if (queryTokens.length === 0) {
      return [];
    }

    const fields = [
      { name: "title", values: [topic.title] },
      { name: "body", values: [topic.body] },
      { name: "decisionSummary", values: [topic.decisionSummary ?? ""] },
      { name: "canonicalSummary", values: [topic.canonicalSummary ?? ""] },
      { name: "openQuestions", values: topic.openQuestions },
      { name: "actionItems", values: topic.actionItems },
      { name: "tags", values: topic.tags }
    ];

    const matchedFields = fields
      .filter((field) =>
        field.values.some((value) => {
          const normalizedValue = value.toLowerCase();
          return queryTokens.some((token) => normalizedValue.includes(token));
        })
      )
      .map((field) => field.name);

    const combinedValues = fields.flatMap((field) => field.values).join("\n").toLowerCase();
    return queryTokens.every((token) => combinedValues.includes(token)) ? matchedFields : [];
  }

  private scoreTopicMatch(matchedFields: string[]) {
    const weights: Record<string, number> = {
      title: 5,
      decisionSummary: 4,
      canonicalSummary: 4,
      body: 3,
      openQuestions: 2,
      actionItems: 2,
      tags: 1
    };

    return matchedFields.reduce((total, field) => total + (weights[field] ?? 0), 0);
  }

  private toTopicBoardCard(topic: TopicRecord): TopicBoardCard {
    return {
      topicId: topic.topicId,
      title: topic.title,
      status: topic.status,
      tags: [...topic.tags],
      updatedAt: topic.updatedAt,
      linkedSessionCount: topic.linkedSessionIds.length,
      openQuestionCount: topic.openQuestions.length,
      actionItemCount: topic.actionItems.length,
      hasDecisionSummary: Boolean(topic.decisionSummary),
      ...(topic.decisionSummary ? { decisionSummary: topic.decisionSummary } : {}),
      ...(topic.canonicalSummary ? { canonicalSummary: topic.canonicalSummary } : {})
    };
  }

  private buildRepairGuidance(record: SessionDiagnosticRecord): DiagnosticRepairGuidance {
    if (record.outcome === "participant_failure") {
      const failedParticipants = record.participants.filter((participant) => participant.status !== "ok");
      const hasProcessFailure = failedParticipants.some(
        (participant) => participant.failureKind === "process_error"
      );
      const timeoutFailure = failedParticipants.find(
        (participant) => participant.raw.guardrail === "timeout"
      );
      const outputLimitFailure = failedParticipants.find(
        (participant) => participant.raw.guardrail === "output_limit"
      );

      if (timeoutFailure) {
        return {
          summary: "Participant execution timed out before the turn was committed.",
          recommendedSteps: [
            "Inspect the participant command, prompt size, and CLI health to understand why execution stalled.",
            "Increase PARLEY_PARTICIPANT_TIMEOUT_MS only if the longer runtime is expected and safe for this workload.",
            "Retry parley_step with the same expectedStateVersion after confirming the stalled turn was not committed."
          ],
          canRetrySameVersion: record.stateCommitStatus === "not_committed",
          shouldReadStateFirst: false,
          nextAction: this.buildRepairAction(record)
        };
      }

      if (outputLimitFailure) {
        return {
          summary: "Participant execution exceeded the configured output limit before the turn was committed.",
          recommendedSteps: [
            "Inspect the participant prompt and CLI behavior to understand why the response over-produced output.",
            "Raise PARLEY_PARTICIPANT_MAX_OUTPUT_BYTES only if the larger payload is intentional and safe to retain.",
            "Retry parley_step with the same expectedStateVersion after the noisy participant behavior is corrected."
          ],
          canRetrySameVersion: record.stateCommitStatus === "not_committed",
          shouldReadStateFirst: false,
          nextAction: this.buildRepairAction(record)
        };
      }

      return {
        summary: hasProcessFailure
          ? "Participant execution failed before the turn was committed."
          : "Participant output was rejected before the turn was committed.",
        recommendedSteps: hasProcessFailure
          ? [
              "Inspect the failed participant stderr, exit code, and launcher command.",
              "Fix the participant runtime or configuration issue before retrying parley_step.",
              "Retry with the same expectedStateVersion after confirming the session state was not committed."
            ]
          : [
              "Inspect the invalid participant payload and validation failure details.",
              "Adjust the participant prompt or adapter parsing so the shared response schema is satisfied.",
              "Retry with the same expectedStateVersion only after the output issue is fixed."
            ],
        canRetrySameVersion: record.stateCommitStatus === "not_committed",
        shouldReadStateFirst: false,
        nextAction: this.buildRepairAction(record)
      };
    }

    if (record.stateCommitStatus === "session_state_committed") {
      return {
        summary: "Session state was committed before transcript persistence failed.",
        recommendedSteps: [
          "Call parley_state before retrying so the orchestrator sees the committed turn.",
          "Avoid replaying the same step blindly because participant outputs may already be persisted in state.",
          "Repair transcript storage only after confirming the current session version."
        ],
        canRetrySameVersion: false,
        shouldReadStateFirst: true,
        nextAction: this.buildRepairAction(record)
      };
    }

    return {
      summary: "Storage failed before the turn was committed.",
      recommendedSteps: [
        "Check filesystem availability or permissions for the session directory.",
        "Confirm that diagnostics captured the failed attempt details.",
        "Retry parley_step with the same expectedStateVersion after the storage issue is resolved."
      ],
      canRetrySameVersion: true,
      shouldReadStateFirst: false,
      nextAction: this.buildRepairAction(record)
    };
  }

  private buildRepairAction(record: SessionDiagnosticRecord): DiagnosticRepairAction {
    if (record.stateCommitStatus === "session_state_committed") {
      return {
        tool: "parley_state",
        arguments: {
          parleySessionId: record.sessionId
        },
        reason: "The session may already include the committed turn, so inspect current state before retrying."
      };
    }

    return {
      tool: "parley_step",
      arguments: {
        parleySessionId: record.sessionId,
        expectedStateVersion: record.expectedStateVersion,
        orchestratorRunId: record.orchestratorRunId,
        speakerOrder: [...record.speakerOrder],
        ...(record.userNudge ? { userNudge: record.userNudge } : {})
      },
      reason: "The failed turn was not committed, so the same step can be retried after the underlying issue is fixed."
    };
  }

  private markAuditCompleted(auditLog: OrchestratorAuditLogEntry[], completedAt: string) {
    return auditLog.map((entry, index, entries) =>
      index === entries.length - 1 && !entry.completedAt ? { ...entry, completedAt } : entry
    );
  }

  private async persistStepDiagnostic(input: {
    state: ParleySessionState;
    turn: number;
    speakerOrder: ParticipantKind[];
    startedAt: string;
    completedAt: string;
    outcome: "participant_failure" | "storage_failure";
    stateCommitStatus: "not_committed" | "session_state_committed";
    participantDiagnostics: StepParticipantDiagnostic[];
    input: AdvanceStepInput;
  }): Promise<boolean> {
    const diagnosticId = `${this.formatTurnDiagnosticPrefix(input.turn)}-${input.outcome}-${Date.now()}`;

    try {
      await this.store.writeSessionDiagnostic(input.state.sessionId, diagnosticId, {
        sessionId: input.state.sessionId,
        turn: input.turn,
        expectedStateVersion: input.input.expectedStateVersion,
        orchestratorRunId: input.input.orchestratorRunId,
        speakerOrder: input.speakerOrder,
        ...(input.input.userNudge ? { userNudge: input.input.userNudge } : {}),
        startedAt: input.startedAt,
        completedAt: input.completedAt,
        outcome: input.outcome,
        stateCommitStatus: input.stateCommitStatus,
        lease: {
          leaseOwner: input.state.leaseOwner ?? null,
          leaseExpiresAt: input.state.leaseExpiresAt ?? null,
          active: this.getLeaseStatus(input.state).isActive
        },
        participants: input.participantDiagnostics
      });
      return true;
    } catch {
      return false;
    }
  }

  private formatTurnDiagnosticPrefix(turn: number): string {
    return `step-${turn.toString().padStart(4, "0")}`;
  }

  private renderDiagnosticRecord(
    record: SessionDiagnosticRecord,
    detailLevel: DiagnosticDetailLevel
  ): SessionDiagnosticRecordView {
    const userNudge = record.userNudge
      ? detailLevel === "full"
        ? record.userNudge
        : "[redacted]"
      : undefined;
    const redaction =
      detailLevel === "redacted"
        ? {
            detailLevel,
            hiddenFields: record.userNudge ? ["userNudge"] : []
          }
        : undefined;

    return {
      sessionId: record.sessionId,
      turn: record.turn,
      expectedStateVersion: record.expectedStateVersion,
      orchestratorRunId: record.orchestratorRunId,
      speakerOrder: [...record.speakerOrder],
      ...(userNudge ? { userNudge } : {}),
      startedAt: record.startedAt,
      completedAt: record.completedAt,
      outcome: record.outcome,
      stateCommitStatus: record.stateCommitStatus,
      lease: {
        leaseOwner: record.lease.leaseOwner,
        leaseExpiresAt: record.lease.leaseExpiresAt,
        active: record.lease.active
      },
      participants: record.participants.map((participant) =>
        this.renderDiagnosticParticipant(participant, detailLevel)
      ),
      ...(redaction ? { redaction } : {})
    };
  }

  private renderDiagnosticParticipant(
    participant: SessionDiagnosticParticipant,
    detailLevel: DiagnosticDetailLevel
  ): SessionDiagnosticParticipantView {
    if (detailLevel === "full") {
      return {
        participant: participant.participant,
        model: participant.model,
        status: participant.status,
        raw: this.renderDiagnosticRaw(participant.raw, detailLevel),
        ...(participant.resumeId ? { resumeId: participant.resumeId } : {}),
        ...(participant.response ? { response: participant.response } : {}),
        ...(participant.failureKind ? { failureKind: participant.failureKind } : {}),
        ...(participant.message ? { message: participant.message } : {}),
        ...(typeof participant.retryable === "boolean"
          ? { retryable: participant.retryable }
          : {})
      };
    }

    const hiddenFields = [
      "raw.command",
      "raw.args",
      "raw.stdout",
      "raw.stderr",
      ...(participant.resumeId ? ["resumeId"] : []),
      ...(participant.response ? ["response"] : [])
    ];

    return {
      participant: participant.participant,
      model: participant.model,
      status: participant.status,
      raw: this.renderDiagnosticRaw(participant.raw, detailLevel),
      ...(participant.failureKind ? { failureKind: participant.failureKind } : {}),
      ...(participant.message ? { message: participant.message } : {}),
      ...(typeof participant.retryable === "boolean"
        ? { retryable: participant.retryable }
        : {}),
      redaction: {
        detailLevel,
        hiddenFields
      }
    };
  }

  private describeRedactedText(value: string): string {
    if (value.length === 0) {
      return "";
    }

    return `[redacted ${value.length} chars]`;
  }

  private async getTopicRecord(workspaceId: string, topicId: string): Promise<TopicRecord | null> {
    try {
      return await this.store.getTopic(workspaceId, topicId);
    } catch (error) {
      this.rethrowStorageFailure(error, "Failed to read topic state.");
    }
  }

  private buildParticipantFailureDetails(
    participant: ParticipantKind,
    result: ParticipantExecutionFailure,
    diagnosticsPersisted: boolean
  ) {
    return {
      participant,
      reason: result.reason,
      retryable: result.reason === "process_error",
      diagnosticsPersisted,
      ...(typeof result.raw.exitCode === "number" ? { exitCode: result.raw.exitCode } : {}),
      ...(result.raw.signal ? { signal: result.raw.signal } : {}),
      ...(typeof result.raw.durationMs === "number" ? { durationMs: result.raw.durationMs } : {}),
      ...(result.raw.timedOut ? { timedOut: true } : {}),
      ...(result.raw.outputLimitExceeded ? { outputLimitExceeded: true } : {}),
      ...(result.guardrail ? { guardrail: result.guardrail } : {})
    };
  }

  private rethrowStorageFailure(error: unknown, message: string): never {
    if (isFileSystemStoreError(error)) {
      throw new ParleyError("storage_failure", message, {
        artifactType: error.artifactType,
        artifactPath: error.artifactPath,
        failureKind: error.code
      });
    }

    throw error;
  }

  private renderDiagnosticRaw(
    raw: ParticipantRawExecution,
    detailLevel: DiagnosticDetailLevel
  ): SessionDiagnosticParticipantView["raw"] {
    if (detailLevel === "full") {
      return {
        command: raw.command,
        args: [...raw.args],
        stdout: raw.stdout,
        stderr: raw.stderr,
        exitCode: raw.exitCode,
        ...(raw.signal ? { signal: raw.signal } : {}),
        ...(typeof raw.durationMs === "number" ? { durationMs: raw.durationMs } : {}),
        ...(raw.timedOut ? { timedOut: true } : {}),
        ...(raw.outputLimitExceeded ? { outputLimitExceeded: true } : {}),
        ...(raw.guardrail ? { guardrail: raw.guardrail } : {})
      };
    }

    return {
      command: "[redacted]",
      args: raw.args.length > 0 ? [`[redacted ${raw.args.length} args]`] : [],
      stdout: this.describeRedactedText(raw.stdout),
      stderr: this.describeRedactedText(raw.stderr),
      exitCode: raw.exitCode,
      ...(raw.signal ? { signal: raw.signal } : {}),
      ...(typeof raw.durationMs === "number" ? { durationMs: raw.durationMs } : {}),
      ...(raw.timedOut ? { timedOut: true } : {}),
      ...(raw.outputLimitExceeded ? { outputLimitExceeded: true } : {}),
      ...(raw.guardrail ? { guardrail: raw.guardrail } : {})
    };
  }

  private assertActiveSession(state: ParleySessionState) {
    if (state.status === "finished") {
      throw new ParleyError("session_finished", `Session ${state.sessionId} has already finished.`, {
        parleySessionId: state.sessionId
      });
    }
  }
}
