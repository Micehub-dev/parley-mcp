import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  assessParticipantResponseUsefulness,
  buildParticipantPrompt,
  createParticipantAdapters
} from "../src/participants/adapters.js";
import type { CommandExecutionInput, CommandExecutor } from "../src/participants/runtime.js";
import type { ParticipantAdapterInput } from "../src/participants/types.js";
import type { ParleySessionState } from "../src/types.js";

test("claude adapter parses structured JSON output and captures session resume ID", async () => {
  const executor = new FakeCommandExecutor({
    stdout: JSON.stringify({
      result: JSON.stringify({
        stance: "agree",
        summary: "Claude result",
        arguments: ["Claude argument"],
        questions: ["Claude question?"],
        proposed_next_step: "Claude next step"
      }),
      session_id: "claude-session-42"
    })
  });
  const adapters = createParticipantAdapters(executor);

  const result = await adapters.claude.run(buildAdapterInput());

  assert.equal(executor.calls[0]?.command, "claude");
  assert.ok(executor.calls[0]?.args.includes("--json-schema"));
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.output.summary, "Claude result");
    assert.equal(result.resumeId, "claude-session-42");
  }
});

test("gemini adapter parses response payloads and reuses persisted resume IDs", async () => {
  const executor = new FakeCommandExecutor({
    stdout: JSON.stringify({
      response: JSON.stringify({
        stance: "refine",
        summary: "Gemini result",
        arguments: ["Gemini argument"],
        questions: ["Gemini question?"],
        proposed_next_step: "Gemini next step"
      }),
      sessionId: "gemini-session-42"
    })
  });
  const adapters = createParticipantAdapters(executor);
  const input = buildAdapterInput({
    participants: {
      claude: {
        model: "sonnet"
      },
      gemini: {
        model: "auto",
        resumeId: "gemini-session-existing"
      }
    }
  });

  const result = await adapters.gemini.run(input);

  const expectedGeminiCommand =
    process.platform === "win32"
      ? existsSync(path.join(process.env.APPDATA ?? "", "npm", "gemini.cmd"))
        ? path.join(process.env.APPDATA ?? "", "npm", "gemini.cmd")
        : "gemini"
      : "gemini";
  assert.equal(
    executor.calls[0]?.command,
    process.platform === "win32" && expectedGeminiCommand.endsWith(".cmd")
      ? (process.env.ComSpec ?? "cmd.exe")
      : expectedGeminiCommand
  );
  if (process.platform === "win32" && expectedGeminiCommand.endsWith(".cmd")) {
    assert.deepEqual(executor.calls[0]?.args.slice(0, 4), [
      "/d",
      "/s",
      "/c",
      expectedGeminiCommand
    ]);
  }
  assert.ok(executor.calls[0]?.args.includes("--resume"));
  assert.ok(executor.calls[0]?.args.includes("gemini-session-existing"));
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.output.summary, "Gemini result");
    assert.equal(result.resumeId, "gemini-session-42");
  }
});

test("adapter returns participant_failure-ready invalid_output results for malformed payloads", async () => {
  const executor = new FakeCommandExecutor({
    stdout: JSON.stringify({
      response: "{\"arguments\":[\"missing summary\"]}"
    })
  });
  const adapters = createParticipantAdapters(executor);

  const result = await adapters.gemini.run(buildAdapterInput());

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "invalid_output");
    assert.match(result.message, /usable summary|required/i);
  }
});

test("gemini adapter normalizes plain-text responses into the shared participant shape", async () => {
  const executor = new FakeCommandExecutor({
    stdout: JSON.stringify({
      response: "I am ready to participate in the Parley multi-LLM session."
    })
  });
  const adapters = createParticipantAdapters(executor);

  const result = await adapters.gemini.run(buildAdapterInput());

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.output.stance, "undecided");
    assert.match(result.output.summary, /ready to participate/i);
    assert.equal(result.output.arguments.length, 0);
    assert.equal(result.output.questions.length, 0);
  }
});

test("gemini adapter drops leading meta-planning lines from plain-text summaries", async () => {
  const executor = new FakeCommandExecutor({
    stdout: JSON.stringify({
      response: [
        "I will inspect the workspace to understand the project.",
        "I will read the config before responding.",
        "Parley needs resilient retry and recovery behavior around participant failures."
      ].join("\n")
    })
  });
  const adapters = createParticipantAdapters(executor);

  const result = await adapters.gemini.run(buildAdapterInput());

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(
      result.output.summary,
      "Parley needs resilient retry and recovery behavior around participant failures."
    );
  }
});

test("gemini adapter drops generic lead-in lines when a useful summary follows", async () => {
  const executor = new FakeCommandExecutor({
    stdout: JSON.stringify({
      response: [
        "Here is a structured response.",
        "Sprint 10 should keep the Windows-first support boundary narrow until Linux real smoke exists."
      ].join("\n")
    })
  });
  const adapters = createParticipantAdapters(executor);

  const result = await adapters.gemini.run(buildAdapterInput());

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(
      result.output.summary,
      "Sprint 10 should keep the Windows-first support boundary narrow until Linux real smoke exists."
    );
  }
});

test("gemini adapter infers a concrete next step and supporting detail from plain-text prose", async () => {
  const executor = new FakeCommandExecutor({
    stdout: JSON.stringify({
      response:
        "Windows CI parity will catch launcher regressions on the OS that anchors operator evidence. Add a windows-latest validation lane before the next release review."
    })
  });
  const adapters = createParticipantAdapters(executor);

  const result = await adapters.gemini.run(buildAdapterInput());

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(
      result.output.summary,
      "Windows CI parity will catch launcher regressions on the OS that anchors operator evidence."
    );
    assert.deepEqual(result.output.arguments, []);
    assert.equal(
      result.output.proposed_next_step,
      "Add a windows-latest validation lane before the next release review."
    );
  }
});

test("gemini adapter extracts bolded proposed next steps from markdown-like prose", async () => {
  const executor = new FakeCommandExecutor({
    stdout: JSON.stringify({
      response:
        "A concrete production-readiness risk is platform-specific path handling drift. **Why it matters:** Windows is case-insensitive while Linux CI and production paths are not. **Proposed Next Step:** Implement a cross-platform CI pipeline (e.g., via GitHub Actions) that runs on both `ubuntu-latest` and `windows-latest`."
    })
  });
  const adapters = createParticipantAdapters(executor);

  const result = await adapters.gemini.run(buildAdapterInput());

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(
      result.output.summary,
      "A concrete production-readiness risk is platform-specific path handling drift."
    );
    assert.deepEqual(result.output.arguments, [
      "**Why it matters:** Windows is case-insensitive while Linux CI and production paths are not."
    ]);
    assert.equal(
      result.output.proposed_next_step,
      "Implement a cross-platform CI pipeline (e.g., via GitHub Actions) that runs on both ubuntu-latest and windows-latest."
    );
  }
});

test("gemini adapter extracts markdown-heading next steps from prose", async () => {
  const executor = new FakeCommandExecutor({
    stdout: JSON.stringify({
      response: [
        "A concrete production-readiness risk is shell and path divergence across operating systems.",
        "### Why it Matters",
        "Most CI and cloud runtimes are Linux-based, so Windows-only verification misses real failures.",
        "### Proposed Next Step",
        "Implement a cross-platform CI pipeline (e.g., using GitHub Actions) that runs on ubuntu-latest and windows-latest."
      ].join("\n")
    })
  });
  const adapters = createParticipantAdapters(executor);

  const result = await adapters.gemini.run(buildAdapterInput());

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(
      result.output.summary,
      "A concrete production-readiness risk is shell and path divergence across operating systems."
    );
    assert.equal(
      result.output.proposed_next_step,
      "Implement a cross-platform CI pipeline (e.g., using GitHub Actions) that runs on ubuntu-latest and windows-latest."
    );
  }
});

test("gemini adapter coerces non-enum stance values from JSON payloads", async () => {
  const executor = new FakeCommandExecutor({
    stdout: JSON.stringify({
      response: JSON.stringify({
        stance: "Analytical",
        summary: "Gemini returned a non-enum stance label.",
        arguments: ["Gemini kept the rest of the shape usable."],
        questions: [],
        proposed_next_step: "Proceed with the next step."
      })
    })
  });
  const adapters = createParticipantAdapters(executor);

  const result = await adapters.gemini.run(buildAdapterInput());

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.output.stance, "undecided");
    assert.equal(result.output.summary, "Gemini returned a non-enum stance label.");
  }
});

test("gemini adapter parses markdown-fenced JSON responses", async () => {
  const executor = new FakeCommandExecutor({
    stdout: JSON.stringify({
      response: "```json\n{\"stance\":\"refine\",\"summary\":\"Use the smaller rollout first.\",\"arguments\":[\"It lowers deployment risk.\"],\"questions\":[],\"proposed_next_step\":\"Run the smoke path on the canary.\"}\n```"
    })
  });
  const adapters = createParticipantAdapters(executor);

  const result = await adapters.gemini.run(buildAdapterInput());

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.output.stance, "refine");
    assert.equal(result.output.summary, "Use the smaller rollout first.");
    assert.deepEqual(result.output.arguments, ["It lowers deployment risk."]);
    assert.equal(result.output.proposed_next_step, "Run the smoke path on the canary.");
  }
});

test("gemini adapter parses markdown-fenced JSON even when Gemini adds planning text first", async () => {
  const executor = new FakeCommandExecutor({
    stdout: JSON.stringify({
      response: [
        "I will review the request and prepare a structured response.",
        "```json",
        "{\"stance\":\"refine\",\"summary\":\"Windows release verification still depends on one clean smoke run.\",\"arguments\":[\"CI is green on both Windows and Ubuntu.\"],\"questions\":[],\"proposed_next_step\":\"Rerun the Windows real smoke and attach the generated release evidence.\"}",
        "```"
      ].join("\n")
    })
  });
  const adapters = createParticipantAdapters(executor);

  const result = await adapters.gemini.run(buildAdapterInput());

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.output.stance, "refine");
    assert.equal(
      result.output.summary,
      "Windows release verification still depends on one clean smoke run."
    );
    assert.deepEqual(result.output.arguments, ["CI is green on both Windows and Ubuntu."]);
    assert.equal(
      result.output.proposed_next_step,
      "Rerun the Windows real smoke and attach the generated release evidence."
    );
  }
});

test("gemini adapter normalizes partial JSON shapes with alternate keys and string lists", async () => {
  const executor = new FakeCommandExecutor({
    stdout: JSON.stringify({
      response: {
        position: "Support with refinement",
        text: "The launch plan is usable but needs a smaller blast radius first.",
        points: "- Start with one environment\n- Keep the rollback ready",
        followUpQuestions: "Do we have an operator on call?",
        nextStep: "Run smoke in the lowest-risk environment."
      }
    })
  });
  const adapters = createParticipantAdapters(executor);

  const result = await adapters.gemini.run(buildAdapterInput());

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.output.stance, "refine");
    assert.equal(
      result.output.summary,
      "The launch plan is usable but needs a smaller blast radius first."
    );
    assert.deepEqual(result.output.arguments, [
      "Start with one environment",
      "Keep the rollback ready"
    ]);
    assert.deepEqual(result.output.questions, ["Do we have an operator on call?"]);
    assert.equal(
      result.output.proposed_next_step,
      "Run smoke in the lowest-risk environment."
    );
  }
});

test("gemini adapter infers a next step from argument text when Gemini leaves the default fallback", async () => {
  const executor = new FakeCommandExecutor({
    stdout: JSON.stringify({
      response: {
        summary:
          "A primary production-readiness risk in a Windows-first release posture is path and filesystem incompatibility.",
        arguments: [
          "Windows is case-insensitive while most production environments run Linux and stay case-sensitive.",
          "### Proposed Next Step **Implement a cross-platform path abstraction layer and mandate Linux-based CI validation.**"
        ]
      }
    })
  });
  const adapters = createParticipantAdapters(executor);

  const result = await adapters.gemini.run(buildAdapterInput());

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(
      result.output.proposed_next_step,
      "Implement a cross-platform path abstraction layer and mandate Linux-based CI validation."
    );
  }
});

test("gemini adapter repairs a valid JSON response when the next step is embedded in the arguments", async () => {
  const executor = new FakeCommandExecutor({
    stdout: JSON.stringify({
      response: JSON.stringify({
        stance: "undecided",
        summary:
          "A concrete production-readiness risk is inconsistent file path normalization across Windows and Linux.",
        arguments: [
          "Windows paths and POSIX paths can diverge during session persistence.",
          "### Proposed Next Step Implement a platform-agnostic path normalization layer and validate it in Linux CI."
        ],
        questions: [],
        proposed_next_step: "Continue the parley with the next participant response."
      })
    })
  });
  const adapters = createParticipantAdapters(executor);

  const result = await adapters.gemini.run(buildAdapterInput());

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(
      result.output.proposed_next_step,
      "Implement a platform-agnostic path normalization layer and validate it in Linux CI."
    );
  }
});

test("gemini adapter extracts labeled plain-text sections into the shared participant shape", async () => {
  const executor = new FakeCommandExecutor({
    stdout: JSON.stringify({
      response: [
        "Stance: disagree",
        "Summary: The current release plan still overstates Linux readiness.",
        "Arguments:",
        "- CI proves automated behavior, not real CLI parity.",
        "- WSL is not ready on this workstation yet.",
        "Questions:",
        "- Should we keep the support statement Windows-first?",
        "Next step: Document the macOS checklist and retain the narrow support boundary."
      ].join("\n")
    })
  });
  const adapters = createParticipantAdapters(executor);

  const result = await adapters.gemini.run(buildAdapterInput());

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.output.stance, "disagree");
    assert.equal(
      result.output.summary,
      "The current release plan still overstates Linux readiness."
    );
    assert.deepEqual(result.output.arguments, [
      "CI proves automated behavior, not real CLI parity.",
      "WSL is not ready on this workstation yet."
    ]);
    assert.deepEqual(result.output.questions, [
      "Should we keep the support statement Windows-first?"
    ]);
    assert.equal(
      result.output.proposed_next_step,
      "Document the macOS checklist and retain the narrow support boundary."
    );
  }
});

test("participant prompt includes the Sprint 10 usefulness bar", () => {
  const prompt = buildParticipantPrompt("gemini", buildAdapterInput());

  assert.match(prompt, /Make the summary topic-specific/i);
  assert.match(prompt, /ask one concrete topic question/i);
  assert.match(prompt, /Provide at least one useful argument or one concrete question/i);
  assert.match(prompt, /Avoid generic filler/i);
  assert.match(prompt, /Do not identify yourself as Gemini CLI, Claude, or another assistant persona/i);
  assert.match(prompt, /Never say you acknowledge the session/i);
  assert.match(prompt, /Do not ask for the objective/i);
  assert.match(prompt, /Do not ask the orchestrator to provide a first directive/i);
  assert.match(prompt, /Do not ask how you can help or contribute/i);
  assert.match(prompt, /Do not say that you need to inspect files/i);
  assert.match(prompt, /Treat the topic and earlier participant responses as sufficient context/i);
  assert.match(prompt, /Do not say you are ready to participate/i);
  assert.match(prompt, /Do not use a generic next step/i);
  assert.match(prompt, /If earlier responses are present, directly challenge, refine, or extend/i);
  assert.match(prompt, /ask one concrete question about a named risk, document, environment, or decision/i);
});

test("usefulness assessment flags generic fallback Gemini responses", () => {
  const assessment = assessParticipantResponseUsefulness(
    {
      stance: "undecided",
      summary: "I am ready to participate in the Parley multi-LLM session.",
      arguments: [],
      questions: [],
      proposed_next_step: "Continue the parley with the next participant response."
    },
    "Return one short structured thought about Parley production-readiness hardening."
  );

  assert.equal(assessment.classification, "generic_fallback");
  assert.deepEqual(assessment.reasons, [
    "generic_summary",
    "default_next_step",
    "missing_topic_terms",
    "no_supporting_detail"
  ]);
});

test("usefulness assessment keeps topic-specific Gemini responses material", () => {
  const assessment = assessParticipantResponseUsefulness(
    {
      stance: "refine",
      summary: "Keep the Windows-first release note until a Linux real smoke run is exercised.",
      arguments: ["Ubuntu CI is useful evidence but it is not the same as a Linux real-CLI pass."],
      questions: ["Who will own the first Linux participant smoke run?"],
      proposed_next_step: "Record the current support boundary in the release evidence note."
    },
    "Strengthen Linux and Windows release evidence without overstating support."
  );

  assert.equal(assessment.classification, "material");
  assert.ok(assessment.reasons.includes("missing_topic_terms") === false);
});

test("usefulness assessment treats thin topical responses with the default next step as fallback", () => {
  const assessment = assessParticipantResponseUsefulness(
    {
      stance: "refine",
      summary: "Windows CI parity is still missing from the current release posture.",
      arguments: [],
      questions: [],
      proposed_next_step: "Continue the parley with the next participant response."
    },
    "Add Windows CI parity to the release validation bar."
  );

  assert.equal(assessment.classification, "generic_fallback");
  assert.deepEqual(assessment.reasons, ["default_next_step", "no_supporting_detail"]);
});

test("usefulness assessment rejects default next steps even when a supporting detail exists", () => {
  const assessment = assessParticipantResponseUsefulness(
    {
      stance: "refine",
      summary: "Windows smoke should keep the release evidence aligned to the latest run.",
      arguments: ["The current evidence set still mixes the 2026-03-13 timeout note into the baseline."],
      questions: [],
      proposed_next_step: "Continue the parley with the next participant response."
    },
    "Align the release evidence set to the latest Windows smoke baseline."
  );

  assert.equal(assessment.classification, "generic_fallback");
  assert.deepEqual(assessment.reasons, ["default_next_step"]);
});

test("usefulness assessment rejects the latest observed self-referential Gemini smoke fallback", () => {
  const assessment = assessParticipantResponseUsefulness(
    {
      stance: "undecided",
      summary: "I acknowledge that I am a participant in this Parley multi-LLM session.",
      arguments: [
        "I am ready to assist with software engineering tasks, codebase analysis, or any other technical challenges within this workspace.",
        "Please provide your first directive or inquiry to begin."
      ],
      questions: [],
      proposed_next_step: "Continue the parley with the next participant response."
    },
    "Name one concrete production-readiness risk in Parley's current Windows-first release posture, explain why it matters, and propose one next step."
  );

  assert.equal(assessment.classification, "generic_fallback");
  assert.deepEqual(assessment.reasons, ["generic_summary", "default_next_step"]);
});

test("adapter normalizes launcher override parse errors into process_error results", async () => {
  const originalArgs = process.env.PARLEY_CLAUDE_ARGS_JSON;
  process.env.PARLEY_CLAUDE_ARGS_JSON = "{not-json";

  try {
    const executor = new FakeCommandExecutor({
      stdout: ""
    });
    const adapters = createParticipantAdapters(executor);

    const result = await adapters.claude.run(buildAdapterInput());

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, "process_error");
      assert.match(result.message, /json string array/i);
      assert.equal(result.raw.command, "claude");
      assert.deepEqual(result.raw.args, []);
    }
    assert.equal(executor.calls.length, 0);
  } finally {
    if (originalArgs === undefined) {
      delete process.env.PARLEY_CLAUDE_ARGS_JSON;
    } else {
      process.env.PARLEY_CLAUDE_ARGS_JSON = originalArgs;
    }
  }
});

test("gemini adapter prefers the Windows npm cmd shim when APPDATA provides one", async () => {
  if (process.platform !== "win32") {
    return;
  }

  const originalAppData = process.env.APPDATA;
  const originalGeminiCommand = process.env.PARLEY_GEMINI_COMMAND;
  const originalGeminiArgs = process.env.PARLEY_GEMINI_ARGS_JSON;
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "parley-gemini-shim-"));
  const shimDir = path.join(tempRoot, "npm");
  const shimPath = path.join(shimDir, "gemini.cmd");

  await mkdir(shimDir, { recursive: true });
  await writeFile(shimPath, "@echo off\r\n", "utf8");
  process.env.APPDATA = tempRoot;
  delete process.env.PARLEY_GEMINI_COMMAND;
  delete process.env.PARLEY_GEMINI_ARGS_JSON;

  try {
    const executor = new FakeCommandExecutor({
      stdout: JSON.stringify({
        response: JSON.stringify({
          stance: "refine",
          summary: "Gemini result",
          arguments: ["Gemini argument"],
          questions: ["Gemini question?"],
          proposed_next_step: "Gemini next step"
        }),
        sessionId: "gemini-session-42"
      })
    });
    const adapters = createParticipantAdapters(executor);

    const result = await adapters.gemini.run(buildAdapterInput());

    assert.equal(executor.calls[0]?.command, process.env.ComSpec ?? "cmd.exe");
    assert.deepEqual(executor.calls[0]?.args.slice(0, 4), [
      "/d",
      "/s",
      "/c",
      shimPath
    ]);
    assert.equal(result.ok, true);
  } finally {
    if (originalAppData === undefined) {
      delete process.env.APPDATA;
    } else {
      process.env.APPDATA = originalAppData;
    }

    if (originalGeminiCommand === undefined) {
      delete process.env.PARLEY_GEMINI_COMMAND;
    } else {
      process.env.PARLEY_GEMINI_COMMAND = originalGeminiCommand;
    }

    if (originalGeminiArgs === undefined) {
      delete process.env.PARLEY_GEMINI_ARGS_JSON;
    } else {
      process.env.PARLEY_GEMINI_ARGS_JSON = originalGeminiArgs;
    }

    await rm(tempRoot, { recursive: true, force: true });
  }
});

class FakeCommandExecutor implements CommandExecutor {
  readonly calls: CommandExecutionInput[] = [];

  constructor(
    private readonly response: {
      stdout: string;
      stderr?: string;
      exitCode?: number | null;
    }
  ) {}

  async run(input: CommandExecutionInput) {
    this.calls.push(input);
    return {
      command: input.command,
      args: input.args,
      stdout: this.response.stdout,
      stderr: this.response.stderr ?? "",
      exitCode: this.response.exitCode ?? 0
    };
  }
}

function buildAdapterInput(overrides?: Partial<ParleySessionState>): ParticipantAdapterInput {
  const session: ParleySessionState = {
    sessionId: "parley-001",
    workspaceId: "default",
    workspaceRoot: "E:\\research\\Parley",
    topic: "Adapter contract",
    turn: 0,
    maxTurns: 4,
    status: "active",
    stateVersion: 2,
    updatedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    participants: {
      claude: {
        model: "sonnet"
      },
      gemini: {
        model: "auto"
      }
    },
    orchestratorAuditLog: [
      {
        clientKind: "codex",
        startedAt: new Date().toISOString()
      }
    ],
    ...overrides
  };

  return {
    session,
    turn: 1,
    speakerOrder: ["claude", "gemini"],
    priorResponses: []
  };
}
