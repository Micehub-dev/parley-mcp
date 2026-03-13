import { access, mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import {
  assessParticipantResponseUsefulness,
  createParticipantAdapters
} from "../dist/participants/adapters.js";
import { SpawnCommandExecutor } from "../dist/participants/runtime.js";
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
        participantLaunches: recordingExecutor.calls.map((call, index) => ({
          participant: speakerOrder[index] ?? `call-${index + 1}`,
          command: call.command,
          args: call.args
        })),
        geminiUsefulness: {
          classification: geminiUsefulness.classification,
          meetsBar: geminiUsefulness.classification === "material",
          reasons: geminiUsefulness.reasons
        },
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
