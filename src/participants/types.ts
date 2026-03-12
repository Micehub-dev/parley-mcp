import type { ParleySessionState, ParticipantKind, ParticipantResponse } from "../types.js";

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

export interface ParticipantRawExecution {
  command: string;
  args: string[];
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

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
}

export type ParticipantExecutionResult = ParticipantExecutionSuccess | ParticipantExecutionFailure;

export interface ParticipantAdapter {
  readonly kind: ParticipantKind;
  run(input: ParticipantAdapterInput): Promise<ParticipantExecutionResult>;
}

export type ParticipantAdapterRegistry = Record<ParticipantKind, ParticipantAdapter>;
