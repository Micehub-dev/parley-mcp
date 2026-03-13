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

export interface ParticipantResponseUsefulnessAssessment {
  classification: "material" | "generic_fallback";
  reasons: string[];
}

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
    "Output rules:",
    "- Return exactly one JSON object and no surrounding commentary.",
    "- Do not wrap the JSON in markdown fences.",
    "- Use one of: agree, disagree, refine, undecided.",
    "- If you are unsure about stance, use undecided.",
    "- Make the summary topic-specific instead of describing your own process or readiness.",
    "- Keep arguments and questions as JSON arrays. Use [] when empty.",
    "- If context is limited, ask one concrete topic question instead of giving a generic fallback.",
    "- Avoid generic filler such as 'I am ready to participate' or 'Here is a structured response'.",
    "- Do not ask for the objective, task, or workspace context. The topic above is already the task.",
    "- Do not say you are ready to participate; contribute one concrete point about the topic instead.",
    "- Always provide a short proposed_next_step string that is specific to the topic or current disagreement.",
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

export function assessParticipantResponseUsefulness(
  response: ParticipantResponse,
  topic: string
): ParticipantResponseUsefulnessAssessment {
  const reasons: string[] = [];
  const topicTokens = extractMeaningfulTopicTokens(topic);
  const responseText = [
    response.summary,
    ...response.arguments,
    ...response.questions,
    response.proposed_next_step
  ]
    .join(" ")
    .toLowerCase();
  const matchedTopicTokens = topicTokens.filter((token) => responseText.includes(token));
  const hasSupportingDetail = response.arguments.length > 0 || response.questions.length > 0;

  if (isGenericFallbackSummary(response.summary)) {
    reasons.push("generic_summary");
  }

  if (
    response.proposed_next_step === "Continue the parley with the next participant response."
  ) {
    reasons.push("default_next_step");
  }

  if (matchedTopicTokens.length === 0) {
    reasons.push("missing_topic_terms");
  }

  if (!hasSupportingDetail) {
    reasons.push("no_supporting_detail");
  }

  const classification =
    reasons.includes("generic_summary") &&
    reasons.includes("missing_topic_terms") &&
    reasons.includes("no_supporting_detail")
      ? "generic_fallback"
      : reasons.length === 4
        ? "generic_fallback"
        : "material";

  return {
    classification,
    reasons
  };
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
  const parsedValue = normalizeGeminiResponseValue(value);

  if (typeof parsedValue === "string") {
    const structuredTextResponse = parseGeminiLabeledTextResponse(parsedValue);
    if (structuredTextResponse) {
      return structuredTextResponse;
    }

    const summary = normalizeGeminiSummaryText(parsedValue);
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
  const structuredTextCandidate = getFirstText(record, ["response", "content", "text", "message"]);
  const structuredTextResponse = structuredTextCandidate
    ? parseGeminiLabeledTextResponse(structuredTextCandidate)
    : null;
  if (structuredTextResponse) {
    return structuredTextResponse;
  }

  const summary = normalizeGeminiSummaryText(
    getFirstText(record, [
      "summary",
      "message",
      "response",
      "text",
      "content",
      "analysis"
    ]) ?? ""
  );
  if (!summary) {
    throw new Error("Gemini response did not include a usable summary.");
  }

  return {
    stance: normalizeParticipantStance(getFirstText(record, ["stance", "position", "opinion"])),
    summary,
    arguments: normalizeStringArray(
      record.arguments ?? record.argumentList ?? record.points ?? record.reasons
    ),
    questions: normalizeStringArray(
      record.questions ?? record.followUpQuestions ?? record.follow_up_questions
    ),
    proposed_next_step:
      getFirstText(record, [
        "proposed_next_step",
        "proposedNextStep",
        "next_step",
        "nextStep",
        "recommended_next_step"
      ]) ??
      "Continue the parley with the next participant response."
  };
}

function normalizeGeminiResponseValue(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return trimmed;
  }

  const unfenced = unwrapMarkdownCodeFence(trimmed);
  return tryParseJson(unfenced) ?? unfenced;
}

function tryParseJson(value: string): unknown | null {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function unwrapMarkdownCodeFence(value: string): string {
  const match = /^```(?:json)?\s*([\s\S]*?)\s*```$/iu.exec(value);
  const fencedBody = match?.[1];
  return fencedBody ? fencedBody.trim() : value;
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
  if (typeof value === "string") {
    return splitGeminiListText(value);
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => normalizeStringArray(item));
  }

  const extracted = extractTextValue(value);
  if (!extracted) {
    return [];
  }

  return splitGeminiListText(extracted);
}

function splitGeminiListText(value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed) {
    return [];
  }

  const items = trimmed.includes("\n")
    ? trimmed.split(/\r?\n/u)
    : trimmed.includes(";")
      ? trimmed.split(/\s*;\s*/u)
      : [trimmed];

  return items
    .map((item) => item.replace(/^(?:[-*]|\u2022)\s*/u, "").trim())
    .filter((item) => item.length > 0);
}

function normalizeGeminiSummaryText(value: string): string {
  const lines = value
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const cleanedLines = [...lines];
  while (cleanedLines[0] && isGeminiMetaLeadInLine(cleanedLines[0])) {
    cleanedLines.shift();
  }

  const summary = (cleanedLines.length > 0 ? cleanedLines : lines).join(" ").trim();
  return summary;
}

function isGeminiMetaLeadInLine(value: string): boolean {
  return (
    /^(?:i will|i'll|let me)\b/iu.test(value) ||
    /^(?:here(?:'s| is)|sure\b|certainly\b|absolutely\b)/iu.test(value) ||
    /^i (?:am|can|can certainly|would) (?:ready|help|provide|respond)\b/iu.test(value)
  );
}

function parseGeminiLabeledTextResponse(value: string): ParticipantResponse | null {
  const sections = {
    stance: [] as string[],
    summary: [] as string[],
    arguments: [] as string[],
    questions: [] as string[],
    proposed_next_step: [] as string[]
  };
  let currentSection: keyof typeof sections | null = null;
  let sawHeader = false;

  for (const rawLine of value.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    const headerMatch = /^([a-zA-Z _-]+):\s*(.*)$/u.exec(line);
    const headerName = headerMatch?.[1];
    const sectionKey = headerName ? mapGeminiTextSection(headerName) : null;
    if (sectionKey) {
      sawHeader = true;
      currentSection = sectionKey;
      const sectionValue = headerMatch?.[2];
      if (sectionValue) {
        sections[sectionKey].push(sectionValue.trim());
      }
      continue;
    }

    if (currentSection) {
      sections[currentSection].push(line);
    }
  }

  const summary = sections.summary.join(" ").trim();
  if (!sawHeader || !summary) {
    return null;
  }

  return {
    stance: normalizeParticipantStance(sections.stance.join(" ")),
    summary,
    arguments: normalizeStringArray(sections.arguments),
    questions: normalizeStringArray(sections.questions),
    proposed_next_step:
      sections.proposed_next_step.join(" ").trim() ||
      "Continue the parley with the next participant response."
  };
}

function mapGeminiTextSection(value: string):
  | "stance"
  | "summary"
  | "arguments"
  | "questions"
  | "proposed_next_step"
  | null {
  const normalized = value.trim().toLowerCase().replace(/[_\s]+/gu, " ");

  if (normalized === "stance" || normalized === "position") {
    return "stance";
  }

  if (normalized === "summary" || normalized === "message" || normalized === "response") {
    return "summary";
  }

  if (
    normalized === "arguments" ||
    normalized === "argument" ||
    normalized === "points" ||
    normalized === "reasons"
  ) {
    return "arguments";
  }

  if (normalized === "questions" || normalized === "question") {
    return "questions";
  }

  if (
    normalized === "next step" ||
    normalized === "proposed next step" ||
    normalized === "recommended next step"
  ) {
    return "proposed_next_step";
  }

  return null;
}

function getFirstText(
  payload: Record<string, unknown>,
  keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = extractTextValue(payload[key]);
    if (value) {
      return value;
    }
  }

  return undefined;
}

function extractTextValue(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  if (Array.isArray(value)) {
    const values = value.map((item) => extractTextValue(item)).filter((item): item is string => Boolean(item));
    return values.length > 0 ? values.join("\n") : undefined;
  }

  if (!value || typeof value !== "object") {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  for (const key of ["text", "summary", "message", "response", "content", "analysis", "value"]) {
    const extracted = extractTextValue(record[key]);
    if (extracted) {
      return extracted;
    }
  }

  return undefined;
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

function extractMeaningfulTopicTokens(topic: string): string[] {
  const stopWords = new Set([
    "about",
    "after",
    "before",
    "brief",
    "concrete",
    "hardening",
    "into",
    "keep",
    "make",
    "more",
    "next",
    "one",
    "only",
    "parley",
    "return",
    "short",
    "that",
    "the",
    "this",
    "with"
  ]);

  return [...new Set(
    topic
      .toLowerCase()
      .split(/[^a-z0-9]+/u)
      .filter((token) => token.length >= 4 && !stopWords.has(token))
  )];
}

function isGenericFallbackSummary(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return true;
  }

  return [
    /ready to participate/u,
    /happy to help/u,
    /can help with/u,
    /parley multi-llm session/u,
    /structured (?:thought|response)/u,
    /here(?:'s| is) (?:a|my|the) /u,
    /brief response/u
  ].some((pattern) => pattern.test(normalized));
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
