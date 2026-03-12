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

    if (raw.exitCode !== 0) {
      return {
        ok: false,
        participant: this.kind,
        reason: "process_error",
        message: `Participant process exited with code ${raw.exitCode ?? "unknown"}.`,
        raw
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
    const payload = JSON.parse(stdout) as Record<string, unknown>;
    if (payload.error && typeof payload.error === "object") {
      const message = getFirstString(payload.error as Record<string, unknown>, ["message"]);
      throw new Error(message ?? "Gemini returned an error payload.");
    }

    const response = parseParticipantResponse(payload.response ?? payload.result);
    const resumeId = getFirstString(payload, ["session_id", "sessionId"]);

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

  return {
    command: configuredCommand && configuredCommand.length > 0 ? configuredCommand : participant,
    leadingArgs: parseLaunchArgs(configuredArgs)
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
