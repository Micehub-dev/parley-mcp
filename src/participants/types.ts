import type {
  ParleySessionState,
  ParticipantKind,
  ParticipantProcessGuardrail,
  ParticipantRawExecution as SharedParticipantRawExecution,
  ParticipantResponse
} from "../types.js";

export interface ParticipantAdapterInput {
  session: ParleySessionState;
  turn: number;
  speakerOrder: ParticipantKind[];
  priorResponses: Array<{
    participant: ParticipantKind;
    response: ParticipantResponse;
  }>;
  userNudge?: string;
}

export type ParticipantRawExecution = SharedParticipantRawExecution;

export interface ParticipantExecutionSuccess {
  ok: true;
  participant: ParticipantKind;
  output: ParticipantResponse;
  raw: ParticipantRawExecution;
  resumeId?: string;
}

export interface ParticipantExecutionFailure {
  ok: false;
  participant: ParticipantKind;
  reason: "invalid_output" | "process_error";
  message: string;
  raw: ParticipantRawExecution;
  guardrail?: ParticipantProcessGuardrail;
}

export type ParticipantExecutionResult = ParticipantExecutionSuccess | ParticipantExecutionFailure;

export interface ParticipantAdapter {
  readonly kind: ParticipantKind;
  run(input: ParticipantAdapterInput): Promise<ParticipantExecutionResult>;
}

export type ParticipantAdapterRegistry = Record<ParticipantKind, ParticipantAdapter>;
