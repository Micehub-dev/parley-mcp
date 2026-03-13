import { access, mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import {
  assessParticipantResponseUsefulness,
  createParticipantAdapters
} from "../dist/participants/adapters.js";
import { SpawnCommandExecutor } from "../dist/participants/runtime.js";
import {
  buildReleaseEvidenceRecord,
  formatReleaseEvidenceMarkdown,
  writeReleaseEvidenceArtifacts
} from "../dist/smoke/release-evidence.js";
import { ParleyService } from "../dist/services/parley-service.js";
import { FileSystemStore } from "../dist/storage/fs-store.js";

class RecordingCommandExecutor {
  calls = [];

  constructor(delegate) {
    this.delegate = delegate;
  }

  async run(input) {
    this.calls.push({
      command: input.command,
      args: [...input.args]
    });
    return this.delegate.run(input);
  }
}

const smokeRoot = await mkdtemp(path.join(os.tmpdir(), "parley-real-cli-"));
const keepArtifacts = process.env.PARLEY_SMOKE_KEEP_TEMP === "1";

await maybeConfigureWindowsGeminiWrapper();

const config = {
  parley: {
    defaults: {
      claudeModel: process.env.PARLEY_SMOKE_CLAUDE_MODEL ?? "sonnet",
      geminiModel: process.env.PARLEY_SMOKE_GEMINI_MODEL ?? "auto"
    },
    allowedModels: {
      claude: ["sonnet", "opus"],
      gemini: ["auto", "gemini-2.5-pro"]
    },
    defaultMaxTurns: 1
  }
};

const store = new FileSystemStore(smokeRoot);
await store.ensureBaseLayout();
await mkdir(path.join(smokeRoot, ".multi-llm"), { recursive: true });
await writeFile(
  path.join(smokeRoot, ".multi-llm", "config.json"),
  `${JSON.stringify(config, null, 2)}\n`,
  "utf8"
);

const recordingExecutor = new RecordingCommandExecutor(new SpawnCommandExecutor());
const service = new ParleyService(store, config, createParticipantAdapters(recordingExecutor));
const smokeTopic =
  process.env.PARLEY_SMOKE_TOPIC ??
  "Name one concrete production-readiness risk in Parley's current Windows-first release posture, explain why it matters, and propose one next step.";
const speakerOrder = ["claude", "gemini"];

try {
  const started = await service.startSession({
    workspaceId: "default",
    workspaceRoot: smokeRoot,
    topic: smokeTopic,
    orchestrator: "codex",
    orchestratorRunId: "real-cli-smoke"
  });
  const lease = await service.claimLease({
    parleySessionId: started.parleySessionId,
    orchestratorRunId: "real-cli-smoke",
    ttlSeconds: 120
  });
  const stepped = await service.advanceStep({
    parleySessionId: started.parleySessionId,
    expectedStateVersion: lease.stateVersion,
    orchestratorRunId: "real-cli-smoke",
    speakerOrder,
    userNudge:
      "Keep the response brief, concrete, and topic-specific. Do not ask for more context."
  });
  const finished = await service.finishSession(started.parleySessionId, "real-cli-smoke");
  const geminiUsefulness = assessParticipantResponseUsefulness(stepped.responses.gemini, smokeTopic);
  const participantLaunches = recordingExecutor.calls.map((call, index) => ({
    participant: speakerOrder[index] ?? `call-${index + 1}`,
    command: call.command,
    args: call.args
  }));
  const claudeLaunch = participantLaunches.find((entry) => entry.participant === "claude");
  const geminiLaunch = participantLaunches.find((entry) => entry.participant === "gemini");
  const releaseEvidence = buildReleaseEvidenceRecord({
    reviewDate: new Date().toISOString().slice(0, 10),
    commit: process.env.PARLEY_SMOKE_COMMIT ?? process.env.GITHUB_SHA,
    reviewer: process.env.PARLEY_SMOKE_REVIEWER,
    releaseCandidateLabel: process.env.PARLEY_SMOKE_RELEASE_LABEL,
    windowsRealEnvironmentEvidence:
      process.platform === "win32"
        ? `Windows local real-CLI smoke passed on ${new Date().toISOString().slice(0, 10)} using ${formatLauncher(
            claudeLaunch
          )} and ${formatLauncher(geminiLaunch)}.`
        : "No Windows real-environment fact was recorded by this smoke run.",
    linuxEvidence:
      process.platform === "linux"
        ? `This smoke artifact was generated from a Linux real-CLI run on ${new Date().toISOString().slice(0, 10)}.`
        : "GitHub Actions ubuntu-latest automation evidence remains the current Linux coverage baseline; no Linux real-CLI smoke was recorded in this artifact.",
    currentCaveats: buildSmokeCaveats(geminiUsefulness, geminiLaunch),
    automatedChecks: {
      test: process.env.PARLEY_SMOKE_TEST_STATUS,
      lint: process.env.PARLEY_SMOKE_LINT_STATUS,
      typecheck: process.env.PARLEY_SMOKE_TYPECHECK_STATUS,
      build: process.env.PARLEY_SMOKE_BUILD_STATUS
    },
    realCliSmoke: {
      os: process.platform,
      nodeVersion: process.version,
      smokeDate: new Date().toISOString().slice(0, 10),
      claudeLauncher: formatLauncher(claudeLaunch),
      geminiLauncher: formatLauncher(geminiLaunch),
      result: "passed",
      geminiUsefulnessClassification: geminiUsefulness.classification,
      geminiUsefulnessReasons: geminiUsefulness.reasons,
      notes: [
        "Participant launch metadata and Gemini usefulness were captured automatically from the smoke run.",
        "Use this note payload with docs/release-evidence-template.md during release review."
      ]
    },
    codexDesktopAcceptance: {
      checklistRunDate: process.env.PARLEY_SMOKE_ACCEPTANCE_DATE,
      result: process.env.PARLEY_SMOKE_ACCEPTANCE_RESULT,
      launcherCaveats: process.env.PARLEY_SMOKE_ACCEPTANCE_LAUNCHER_CAVEATS,
      notes: process.env.PARLEY_SMOKE_ACCEPTANCE_NOTES
    },
    followUps: {
      openIssues:
        geminiUsefulness.classification === "material"
          ? "none recorded"
          : "Review Gemini prompt/normalization because the smoke response remained low-value.",
      releaseDecision:
        geminiUsefulness.classification === "material"
          ? "ready for broader release review"
          : "hold until Gemini usefulness is reviewed"
    }
  });
  const releaseEvidenceMarkdown = formatReleaseEvidenceMarkdown(releaseEvidence);
  const releaseEvidenceArtifacts = await maybeWriteReleaseEvidenceArtifacts(releaseEvidence);

  globalThis.console.log(
    JSON.stringify(
      {
        ok: true,
        recordedAt: new Date().toISOString(),
        smokeRoot,
        environment: {
          os: process.platform,
          node: process.version
        },
        sessionId: started.parleySessionId,
        turn: stepped.turn,
        speakerOrder,
        participantLaunches,
        geminiUsefulness: {
          classification: geminiUsefulness.classification,
          meetsBar: geminiUsefulness.classification === "material",
          reasons: geminiUsefulness.reasons
        },
        releaseEvidence,
        releaseEvidenceMarkdown,
        ...(releaseEvidenceArtifacts ? { releaseEvidenceArtifacts } : {}),
        responses: stepped.responses,
        conclusion: finished.conclusion
      },
      null,
      2
    )
  );
} catch (error) {
  const diagnosticsDir =
    error && typeof error === "object" && "details" in error && error.details
      ? await resolveDiagnosticsDir(smokeRoot)
      : null;

  globalThis.console.error(
    JSON.stringify(
      {
        ok: false,
        smokeRoot,
        diagnosticsDir,
        name: error instanceof Error ? error.name : "UnknownError",
        message: error instanceof Error ? error.message : String(error),
        details:
          error &&
          typeof error === "object" &&
          "details" in error &&
          typeof error.details === "object"
            ? error.details
            : undefined
      },
      null,
      2
    )
  );
  process.exitCode = 1;
} finally {
  if (!keepArtifacts) {
    await rm(smokeRoot, { recursive: true, force: true });
  }
}

async function resolveDiagnosticsDir(smokeRootDir) {
  const sessionsDir = path.join(smokeRootDir, ".multi-llm", "sessions");

  try {
    const sessionDirs = await readdir(sessionsDir);
    if (sessionDirs.length === 0) {
      return null;
    }

    return path.join(sessionsDir, sessionDirs[0], "diagnostics");
  } catch {
    return null;
  }
}

async function maybeConfigureWindowsGeminiWrapper() {
  if (
    process.platform !== "win32" ||
    process.env.PARLEY_GEMINI_COMMAND ||
    process.env.PARLEY_GEMINI_ARGS_JSON
  ) {
    return;
  }

  const appData = process.env.APPDATA;
  if (!appData) {
    return;
  }

  const geminiCmdPath = path.join(appData, "npm", "gemini.cmd");
  const geminiWrapperPath = path.join(appData, "npm", "gemini.ps1");

  try {
    await access(geminiCmdPath);
    process.env.PARLEY_GEMINI_COMMAND = geminiCmdPath;
    return;
  } catch {
    // Fall back to the PowerShell wrapper when the cmd shim is not present.
  }

  try {
    await access(geminiWrapperPath);
    process.env.PARLEY_GEMINI_COMMAND = "powershell.exe";
    process.env.PARLEY_GEMINI_ARGS_JSON = JSON.stringify([
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      geminiWrapperPath
    ]);
  } catch {
    // Leave the environment unchanged when the wrapper is not present.
  }
}

async function maybeWriteReleaseEvidenceArtifacts(releaseEvidence) {
  const outputDir = process.env.PARLEY_SMOKE_EVIDENCE_DIR;
  if (!outputDir) {
    return null;
  }

  const baseName = `release-evidence-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  return writeReleaseEvidenceArtifacts(outputDir, baseName, releaseEvidence);
}

function formatLauncher(launch) {
  if (!launch) {
    return "not recorded";
  }

  return [launch.command, ...launch.args].join(" ").trim();
}

function buildSmokeCaveats(geminiUsefulness, geminiLaunch) {
  const caveats = [];

  if (process.platform === "win32") {
    if (geminiLaunch?.command?.toLowerCase().includes("cmd.exe")) {
      caveats.push("Windows smoke launched Gemini through the npm-installed gemini.cmd shim.");
    } else if (geminiLaunch?.command?.toLowerCase().includes("powershell")) {
      caveats.push("Windows smoke required the PowerShell Gemini wrapper override.");
    }
  }

  if (geminiUsefulness.classification !== "material") {
    caveats.push(
      `Gemini usefulness was classified as ${geminiUsefulness.classification}: ${geminiUsefulness.reasons.join(", ")}.`
    );
  }

  return caveats;
}
