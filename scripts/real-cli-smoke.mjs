import { access, mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import { createParticipantAdapters } from "../dist/participants/adapters.js";
import { ParleyService } from "../dist/services/parley-service.js";
import { FileSystemStore } from "../dist/storage/fs-store.js";

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

const service = new ParleyService(store, config, createParticipantAdapters());

try {
  const started = await service.startSession({
    workspaceId: "default",
    workspaceRoot: smokeRoot,
    topic:
      process.env.PARLEY_SMOKE_TOPIC ??
      "Return one short structured thought about Parley production-readiness hardening.",
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
    userNudge: "Keep the response brief and concrete."
  });
  const finished = await service.finishSession(started.parleySessionId, "real-cli-smoke");

  globalThis.console.log(
    JSON.stringify(
      {
        ok: true,
        smokeRoot,
        sessionId: started.parleySessionId,
        turn: stepped.turn,
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

  const geminiWrapperPath = path.join(appData, "npm", "gemini.ps1");

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
