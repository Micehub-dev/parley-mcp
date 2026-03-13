import { existsSync } from "node:fs";
import path from "node:path";

import { participantResponseJsonSchema, participantResponseSchema } from "./schema.js";
import type {
  ParticipantAdapter,
  ParticipantAdapterInput,
  ParticipantAdapterRegistry,
  ParticipantExecutionResult,
  ParticipantRawExecution
} from "./types.js";
import { SpawnCommandExecutor, type CommandExecutionInput, type CommandExecutor } from "./runtime.js";
import type { ParticipantKind, ParticipantResponse } from "../types.js";

export function createParticipantAdapters(
  executor: CommandExecutor = new SpawnCommandExecutor()
): ParticipantAdapterRegistry {
  return {
    claude: new ClaudeParticipantAdapter(executor),
    gemini: new GeminiParticipantAdapter(executor)
  };
}

abstract class BaseParticipantAdapter implements ParticipantAdapter {
  abstract readonly kind: ParticipantKind;

  constructor(private readonly executor: CommandExecutor) {}

  async run(input: ParticipantAdapterInput): Promise<ParticipantExecutionResult> {
    let commandInput: CommandExecutionInput | undefined;

    let raw: ParticipantRawExecution;
    try {
      commandInput = this.buildCommand(input);
      raw = await this.executor.run(commandInput);
    } catch (error) {
      return {
        ok: false,
        participant: this.kind,
        reason: "process_error",
        message: error instanceof Error ? error.message : "Participant process failed to start.",
        raw: {
          command: commandInput?.command ?? this.kind,
          args: commandInput?.args ?? [],
          stdout: "",
          stderr: "",
          exitCode: null
        }
      };
    }

    if (raw.guardrail || raw.exitCode !== 0) {
      const guardrail = raw.guardrail;
      return {
        ok: false,
        participant: this.kind,
        reason: "process_error",
        message: buildProcessFailureMessage(raw),
        raw,
        ...(guardrail ? { guardrail } : {})
      };
    }

    try {
      const parsed = this.parseOutput(raw.stdout);
      return {
        ok: true,
        participant: this.kind,
        output: parsed.output,
        raw,
        ...(parsed.resumeId ? { resumeId: parsed.resumeId } : {})
      };
    } catch (error) {
      return {
        ok: false,
        participant: this.kind,
        reason: "invalid_output",
        message:
          error instanceof Error
            ? error.message
            : "Participant output could not be parsed or validated.",
        raw
      };
    }
  }

  protected abstract buildCommand(input: ParticipantAdapterInput): CommandExecutionInput;

  protected abstract parseOutput(stdout: string): {
    output: ParticipantResponse;
    resumeId?: string;
  };
}

function buildProcessFailureMessage(raw: ParticipantRawExecution): string {
  if (raw.guardrail === "timeout") {
    return "Participant process timed out before producing a complete response.";
  }

  if (raw.guardrail === "output_limit") {
    return "Participant process exceeded the configured output limit before completion.";
  }

  return `Participant process exited with code ${raw.exitCode ?? "unknown"}.`;
}

class ClaudeParticipantAdapter extends BaseParticipantAdapter {
  readonly kind = "claude" as const;

  protected buildCommand(input: ParticipantAdapterInput): CommandExecutionInput {
    const participantState = input.session.participants[this.kind];
    const launch = resolveParticipantLaunch(this.kind);
    const args = [
      "-p",
      "--output-format",
      "json",
      "--json-schema",
      JSON.stringify(participantResponseJsonSchema),
      "--model",
      participantState.model,
      "--tools",
      "",
      "--disable-slash-commands"
    ];

    if (participantState.resumeId) {
      args.push("--resume", participantState.resumeId);
    }

    args.push(buildParticipantPrompt(this.kind, input));

    return {
      command: launch.command,
      args: [...launch.leadingArgs, ...args],
      cwd: input.session.workspaceRoot
    };
  }

  protected parseOutput(stdout: string) {
    const payload = JSON.parse(stdout) as Record<string, unknown>;
    const response = parseParticipantResponse(
      payload.structured_output ?? payload.result ?? payload.response
    );
    const resumeId = getFirstString(payload, ["session_id", "sessionId"]);

    return resumeId ? { output: response, resumeId } : { output: response };
  }
}

class GeminiParticipantAdapter extends BaseParticipantAdapter {
  readonly kind = "gemini" as const;

  protected buildCommand(input: ParticipantAdapterInput): CommandExecutionInput {
    const participantState = input.session.participants[this.kind];
    const launch = resolveParticipantLaunch(this.kind);
    const args = [
      "-p",
      buildParticipantPrompt(this.kind, input),
      "--output-format",
      "json",
      "--model",
      participantState.model
    ];

    if (participantState.resumeId) {
      args.push("--resume", participantState.resumeId);
    }

    return {
      command: launch.command,
      args: [...launch.leadingArgs, ...args],
      cwd: input.session.workspaceRoot
    };
  }

  protected parseOutput(stdout: string) {
    const payload = tryParseJson(stdout);
    if (!payload || typeof payload !== "object") {
      return {
        output: normalizeGeminiParticipantResponse(stdout)
      };
    }

    const payloadRecord = payload as Record<string, unknown>;
    if (payloadRecord.error && typeof payloadRecord.error === "object") {
      const message = getFirstString(payloadRecord.error as Record<string, unknown>, ["message"]);
      throw new Error(message ?? "Gemini returned an error payload.");
    }

    const response = parseGeminiParticipantResponse(payloadRecord.response ?? payloadRecord.result);
    const resumeId = getFirstString(payloadRecord, ["session_id", "sessionId"]);

    return resumeId ? { output: response, resumeId } : { output: response };
  }
}

export function buildParticipantPrompt(
  participant: ParticipantKind,
  input: ParticipantAdapterInput
): string {
  const priorResponses =
    input.priorResponses.length > 0
      ? JSON.stringify(
          input.priorResponses.map((entry) => ({
            participant: entry.participant,
            response: entry.response
          })),
          null,
          2
        )
      : "[]";
  const latestTurn = input.session.latestTurn
    ? JSON.stringify(input.session.latestTurn, null, 2)
    : "null";

  return [
    "You are a participant in a Parley multi-LLM session.",
    `You are speaking as ${participant}.`,
    "Return only JSON that matches this exact schema:",
    JSON.stringify(participantResponseJsonSchema, null, 2),
    "",
    "Session context:",
    `- session_id: ${input.session.sessionId}`,
    `- topic: ${input.session.topic}`,
    `- turn: ${input.turn}`,
    `- max_turns: ${input.session.maxTurns}`,
    `- workspace_root: ${input.session.workspaceRoot}`,
    `- speaker_order: ${input.speakerOrder.join(",")}`,
    `- latest_summary: ${input.session.latestSummary ?? ""}`,
    `- system_prompt: ${input.session.systemPrompt ?? ""}`,
    `- user_nudge: ${input.userNudge ?? ""}`,
    "",
    "Previous completed turn (if any):",
    latestTurn,
    "",
    "Responses already produced in this same turn:",
    priorResponses,
    "",
    "Focus on the topic, react to earlier responses when present, and propose a concrete next step."
  ].join("\n");
}

function parseParticipantResponse(value: unknown): ParticipantResponse {
  const normalized = typeof value === "string" ? JSON.parse(value) : value;
  return participantResponseSchema.parse(normalized);
}

function parseGeminiParticipantResponse(value: unknown): ParticipantResponse {
  try {
    return parseParticipantResponse(value);
  } catch {
    const normalized = normalizeGeminiParticipantResponse(value);
    return participantResponseSchema.parse(normalized);
  }
}

function normalizeGeminiParticipantResponse(value: unknown): ParticipantResponse {
  const parsedValue = typeof value === "string" ? tryParseJson(value) ?? value : value;

  if (typeof parsedValue === "string") {
    const summary = parsedValue.trim();
    if (!summary) {
      throw new Error("Gemini returned an empty response.");
    }

    return {
      stance: "undecided",
      summary,
      arguments: [],
      questions: [],
      proposed_next_step: "Continue the parley with the next participant response."
    };
  }

  if (!parsedValue || typeof parsedValue !== "object") {
    throw new Error("Gemini response could not be normalized.");
  }

  const record = parsedValue as Record<string, unknown>;
  const summary = getFirstString(record, ["summary", "message", "response"])?.trim();
  if (!summary) {
    throw new Error("Gemini response did not include a usable summary.");
  }

  return {
    stance: normalizeParticipantStance(getFirstString(record, ["stance"])),
    summary,
    arguments: normalizeStringArray(record.arguments),
    questions: normalizeStringArray(record.questions),
    proposed_next_step:
      getFirstString(record, ["proposed_next_step", "proposedNextStep", "next_step"]) ??
      "Continue the parley with the next participant response."
  };
}

function tryParseJson(value: string): unknown | null {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function normalizeParticipantStance(value: string | undefined): ParticipantResponse["stance"] {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "agree" || normalized === "disagree" || normalized === "refine") {
    return normalized;
  }

  if (!normalized) {
    return "undecided";
  }

  if (normalized.includes("agree")) {
    return "agree";
  }

  if (normalized.includes("disagree")) {
    return "disagree";
  }

  if (normalized.includes("refine")) {
    return "refine";
  }

  return "undecided";
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function getFirstString(
  payload: Record<string, unknown>,
  keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }

  return undefined;
}

function resolveParticipantLaunch(participant: ParticipantKind): {
  command: string;
  leadingArgs: string[];
} {
  const prefix = `PARLEY_${participant.toUpperCase()}`;
  const configuredCommand = process.env[`${prefix}_COMMAND`];
  const configuredArgs = process.env[`${prefix}_ARGS_JSON`];
  const defaultCommand = resolveDefaultParticipantCommand(participant);

  return normalizeWindowsCommandLaunch(
    configuredCommand && configuredCommand.length > 0 ? configuredCommand : defaultCommand,
    parseLaunchArgs(configuredArgs)
  );
}

function resolveDefaultParticipantCommand(participant: ParticipantKind): string {
  if (participant !== "gemini" || process.platform !== "win32") {
    return participant;
  }

  const appData = process.env.APPDATA;
  if (!appData) {
    return participant;
  }

  const geminiCmdPath = path.join(appData, "npm", "gemini.cmd");
  return existsSync(geminiCmdPath) ? geminiCmdPath : participant;
}

function normalizeWindowsCommandLaunch(command: string, leadingArgs: string[]) {
  if (process.platform !== "win32") {
    return {
      command,
      leadingArgs
    };
  }

  const extension = path.extname(command).toLowerCase();
  if (extension !== ".cmd" && extension !== ".bat") {
    return {
      command,
      leadingArgs
    };
  }

  return {
    command: process.env.ComSpec ?? "cmd.exe",
    leadingArgs: ["/d", "/s", "/c", command, ...leadingArgs]
  };
}

function parseLaunchArgs(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new Error("Participant launcher args must be a JSON string array.");
  }

  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) {
    throw new Error("Participant launcher args must be a JSON string array.");
  }

  return parsed;
}
