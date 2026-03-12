import { ZodError } from "zod";

import { ParleyError } from "../errors.js";
import { participantResponseSchema } from "../participants/schema.js";
import type { ParticipantRawExecution } from "../participants/types.js";
import type { ParticipantAdapterRegistry } from "../participants/types.js";
import { FileSystemStore } from "../storage/fs-store.js";
import type {
  OrchestratorAuditLogEntry,
  ParleyConfig,
  ParleySessionState,
  ParticipantKind,
  ParticipantResponse,
  RollingSummary,
  SessionConclusion,
  TopicRecord,
  TranscriptEntry
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

interface StepParticipantDiagnostic {
  participant: ParticipantKind;
  model: string;
  status: "ok" | "failed" | "invalid_output";
  raw: ParticipantRawExecution;
  resumeId?: string;
  response?: ParticipantResponse;
  failureKind?: "process_error" | "invalid_output";
  message?: string;
  retryable?: boolean;
}

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
          {
            participant,
            reason: result.reason,
            retryable: result.reason === "process_error",
            diagnosticsPersisted,
            ...(typeof result.raw.exitCode === "number" ? { exitCode: result.raw.exitCode } : {})
          }
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
    state.rollingSummary = this.buildRollingSummary(state.rollingSummary, responses, now);
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

    await this.store.saveSession(state);

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

    const topic = await this.store.getTopic(state.workspaceId, resolvedTopicId);
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
      await this.store.updateTopic(nextTopic);
    }

    return {
      topicId: nextTopic.topicId,
      sourceSessionId: state.sessionId,
      updatedFields,
      topic: nextTopic
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
    previousSummary: RollingSummary | undefined,
    responses: Record<ParticipantKind, ParticipantResponse>,
    updatedAt: string
  ): RollingSummary {
    const nextAgreements =
      responses.claude.stance !== "disagree" && responses.gemini.stance !== "disagree"
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
        responses,
        nextAgreements,
        nextDisagreements,
        nextOpenQuestions
      ),
      agreements: nextAgreements,
      disagreements: nextDisagreements,
      openQuestions: nextOpenQuestions,
      actionItems: nextActionItems,
      updatedAt
    };
  }

  private buildRollingSynopsis(
    responses: Record<ParticipantKind, ParticipantResponse>,
    agreements: string[],
    disagreements: string[],
    openQuestions: string[]
  ): string {
    const parts: string[] = [];

    if (agreements.length > 0) {
      parts.push(`Agreements: ${agreements.join("; ")}`);
    }

    if (disagreements.length > 0) {
      parts.push(`Disagreements: ${disagreements.join("; ")}`);
    }

    if (openQuestions.length > 0) {
      parts.push(`Open questions: ${openQuestions.join("; ")}`);
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
      rollingSummary?.synopsis ??
      state.latestSummary ??
      (state.latestTurn
        ? `Latest turn: Claude (${state.latestTurn.responses.claude.stance}) ${state.latestTurn.responses.claude.summary} | Gemini (${state.latestTurn.responses.gemini.stance}) ${state.latestTurn.responses.gemini.summary}`
        : "Parley session finished before any participant turns were committed.");

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
    const parts = [conclusion.summary];

    if (conclusion.consensus.length > 0) {
      parts.push(`Consensus: ${conclusion.consensus.join("; ")}`);
    }

    if (conclusion.disagreements.length > 0) {
      parts.push(`Disagreements: ${conclusion.disagreements.join("; ")}`);
    }

    if (conclusion.openQuestions.length > 0) {
      parts.push(`Open questions: ${conclusion.openQuestions.join("; ")}`);
    }

    if (conclusion.actionItems.length > 0) {
      parts.push(`Action items: ${conclusion.actionItems.join("; ")}`);
    }

    if (state.topic && !parts[0]?.includes(state.topic)) {
      parts.push(`Topic: ${state.topic}`);
    }

    return parts.join(" ");
  }

  private mergeUniqueStrings(existing: string[] | undefined, additions: string[]): string[] {
    const merged = new Set<string>();

    for (const value of existing ?? []) {
      const normalized = value.trim();
      if (normalized) {
        merged.add(normalized);
      }
    }

    for (const value of additions) {
      const normalized = value.trim();
      if (normalized) {
        merged.add(normalized);
      }
    }

    return [...merged];
  }

  private areStringArraysEqual(left: string[], right: string[]) {
    return (
      left.length === right.length && left.every((value, index) => value === right[index])
    );
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

  private assertActiveSession(state: ParleySessionState) {
    if (state.status === "finished") {
      throw new ParleyError("session_finished", `Session ${state.sessionId} has already finished.`, {
        parleySessionId: state.sessionId
      });
    }
  }
}
