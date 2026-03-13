export type ParticipantKind = "claude" | "gemini";

export type ParticipantStance = "agree" | "disagree" | "refine" | "undecided";

export interface ParleyConfig {
  parley: {
    defaults: {
      claudeModel: string;
      geminiModel: string;
    };
    allowedModels: {
      claude: string[];
      gemini: string[];
    };
    defaultMaxTurns: number;
  };
}

export interface OrchestratorAuditLogEntry {
  clientKind: "codex" | "claude" | "gemini" | "other";
  clientVersion?: string;
  runId?: string;
  startedAt: string;
  completedAt?: string;
}

export interface ParticipantState {
  model: string;
  resumeId?: string;
}

export interface ParticipantResponse {
  stance: ParticipantStance;
  summary: string;
  arguments: string[];
  questions: string[];
  proposed_next_step: string;
}

export interface RollingSummary {
  synopsis: string;
  agreements: string[];
  disagreements: string[];
  openQuestions: string[];
  actionItems: string[];
  updatedAt: string;
}

export interface SessionConclusion {
  summary: string;
  consensus: string[];
  disagreements: string[];
  openQuestions: string[];
  actionItems: string[];
  recommendedDisposition: TopicRecord["status"];
}

export interface SessionTurnRecord {
  turn: number;
  speakerOrder: ParticipantKind[];
  completedAt: string;
  userNudge?: string;
  responses: Record<ParticipantKind, ParticipantResponse>;
}

export interface ParleySessionState {
  sessionId: string;
  workspaceId: string;
  workspaceRoot: string;
  topicId?: string;
  topic: string;
  systemPrompt?: string;
  turn: number;
  maxTurns: number;
  status: "active" | "finished";
  stateVersion: number;
  leaseOwner?: string;
  leaseExpiresAt?: string;
  lastWriter?: string;
  updatedAt: string;
  createdAt: string;
  latestSummary?: string;
  rollingSummary?: RollingSummary;
  latestTurn?: SessionTurnRecord;
  participants: Record<ParticipantKind, ParticipantState>;
  orchestratorAuditLog: OrchestratorAuditLogEntry[];
}

export interface TopicRecord {
  topicId: string;
  workspaceId: string;
  title: string;
  body: string;
  status: "open" | "in_progress" | "resolved";
  tags: string[];
  createdAt: string;
  updatedAt: string;
  linkedSessionIds: string[];
  keyThreadIds: string[];
  decisionSummary?: string;
  openQuestions: string[];
  actionItems: string[];
  canonicalSummary?: string;
  statusHistory: Array<{
    status: string;
    changedAt: string;
  }>;
}

export interface TopicSearchResult {
  topic: TopicRecord;
  matchedFields: string[];
  score: number;
}

export interface TopicBoardCard {
  topicId: string;
  title: string;
  status: TopicRecord["status"];
  tags: string[];
  updatedAt: string;
  linkedSessionCount: number;
  openQuestionCount: number;
  actionItemCount: number;
  hasDecisionSummary: boolean;
  decisionSummary?: string;
  canonicalSummary?: string;
}

export interface WorkspaceBoard {
  workspaceId: string;
  topicCount: number;
  lastUpdatedAt?: string;
  statusCounts: Record<TopicRecord["status"], number>;
  board: Record<TopicRecord["status"], TopicBoardCard[]>;
  openQuestions: Array<{
    topicId: string;
    title: string;
    question: string;
  }>;
  actionItems: Array<{
    topicId: string;
    title: string;
    actionItem: string;
  }>;
}

export interface SessionDiagnosticParticipant {
  participant: ParticipantKind;
  model: string;
  status: "ok" | "failed" | "invalid_output";
  raw: {
    command: string;
    args: string[];
    stdout: string;
    stderr: string;
    exitCode: number | null;
  };
  resumeId?: string;
  response?: ParticipantResponse;
  failureKind?: "process_error" | "invalid_output";
  message?: string;
  retryable?: boolean;
}

export interface SessionDiagnosticRecord {
  sessionId: string;
  turn: number;
  expectedStateVersion: number;
  orchestratorRunId: string;
  speakerOrder: ParticipantKind[];
  userNudge?: string;
  startedAt: string;
  completedAt: string;
  outcome: "participant_failure" | "storage_failure";
  stateCommitStatus: "not_committed" | "session_state_committed";
  lease: {
    leaseOwner: string | null;
    leaseExpiresAt: string | null;
    active: boolean;
  };
  participants: SessionDiagnosticParticipant[];
}

export interface DiagnosticRepairAction {
  tool: "parley_state" | "parley_step";
  arguments: Record<string, unknown>;
  reason: string;
}

export interface DiagnosticRepairGuidance {
  summary: string;
  recommendedSteps: string[];
  canRetrySameVersion: boolean;
  shouldReadStateFirst: boolean;
  nextAction: DiagnosticRepairAction;
}

export interface TranscriptEntry {
  timestamp: string;
  kind: "system" | "orchestrator" | "participant";
  speaker: string;
  message: string;
  metadata?: Record<string, string | number | boolean>;
}

export interface WorkspaceRecord {
  workspaceId: string;
  workspaceRoot: string;
}
