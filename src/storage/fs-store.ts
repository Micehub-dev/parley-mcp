import { appendFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import type {
  ParleySessionState,
  SessionDiagnosticRecord,
  TopicRecord,
  TranscriptEntry,
  WorkspaceRecord
} from "../types.js";

export class FileSystemStore {
  constructor(private readonly rootDir: string) {}

  get dataRoot(): string {
    return path.join(this.rootDir, ".multi-llm");
  }

  async ensureBaseLayout(): Promise<void> {
    await mkdir(path.join(this.dataRoot, "sessions"), { recursive: true });
    await mkdir(path.join(this.dataRoot, "workspaces", "default", "topics"), { recursive: true });
    await mkdir(path.join(this.dataRoot, "workspaces", "default", "indexes"), { recursive: true });
  }

  async listWorkspaces(): Promise<WorkspaceRecord[]> {
    const workspacesDir = path.join(this.dataRoot, "workspaces");
    const entries = await safeReadDir(workspacesDir, "workspace");
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => ({
        workspaceId: entry.name,
        workspaceRoot: this.rootDir
      }));
  }

  async createTopic(record: TopicRecord): Promise<void> {
    const topicDir = path.join(
      this.dataRoot,
      "workspaces",
      record.workspaceId,
      "topics",
      record.topicId
    );

    await mkdir(topicDir, { recursive: true });
    await writeJson(path.join(topicDir, "topic.json"), record);
    await writeTextAtomically(path.join(topicDir, "threads.jsonl"), "");
    await writeTextAtomically(path.join(topicDir, "decision.md"), "");
  }

  async listTopics(workspaceId: string): Promise<TopicRecord[]> {
    const topicsDir = path.join(this.dataRoot, "workspaces", workspaceId, "topics");
    const entries = await safeReadDir(topicsDir, "topic");
    const topics: TopicRecord[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const topicPath = path.join(topicsDir, entry.name, "topic.json");
      const record = await readJson<TopicRecord>(topicPath, "topic");
      if (record) {
        topics.push(record);
      }
    }

    return topics.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async getTopic(workspaceId: string, topicId: string): Promise<TopicRecord | null> {
    return readJson<TopicRecord>(
      path.join(this.dataRoot, "workspaces", workspaceId, "topics", topicId, "topic.json"),
      "topic"
    );
  }

  async createSession(state: ParleySessionState, initialTranscript: TranscriptEntry[]): Promise<void> {
    const sessionDir = path.join(this.dataRoot, "sessions", state.sessionId);
    await mkdir(sessionDir, { recursive: true });
    await writeJson(path.join(sessionDir, "state.json"), state);
    await writeTextAtomically(path.join(sessionDir, "transcript.jsonl"), "");
    await appendTranscript(state.sessionId, initialTranscript, this.dataRoot);
    await writeTextAtomically(path.join(sessionDir, "summary.md"), "");
    await writeJson(path.join(sessionDir, "lease.json"), {
      leaseOwner: state.leaseOwner ?? null,
      leaseExpiresAt: state.leaseExpiresAt ?? null
    });
  }

  async getSession(sessionId: string): Promise<ParleySessionState | null> {
    return readJson<ParleySessionState>(
      path.join(this.dataRoot, "sessions", sessionId, "state.json"),
      "session_state"
    );
  }

  async saveSession(state: ParleySessionState): Promise<void> {
    const sessionDir = path.join(this.dataRoot, "sessions", state.sessionId);
    await mkdir(sessionDir, { recursive: true });
    await writeJson(path.join(sessionDir, "state.json"), state);
    await writeJson(path.join(sessionDir, "lease.json"), {
      leaseOwner: state.leaseOwner ?? null,
      leaseExpiresAt: state.leaseExpiresAt ?? null
    });
  }

  async appendTranscript(sessionId: string, entries: TranscriptEntry[]): Promise<void> {
    await appendTranscript(sessionId, entries, this.dataRoot);
  }

  async writeSessionDiagnostic(
    sessionId: string,
    diagnosticId: string,
    payload: unknown
  ): Promise<string> {
    const diagnosticsDir = path.join(this.dataRoot, "sessions", sessionId, "diagnostics");
    const diagnosticPath = path.join(diagnosticsDir, `${diagnosticId}.json`);
    await writeJson(diagnosticPath, payload);
    return diagnosticPath;
  }

  async listSessionDiagnostics(
    sessionId: string
  ): Promise<Array<{ diagnosticId: string; record: SessionDiagnosticRecord }>> {
    const diagnosticsDir = path.join(this.dataRoot, "sessions", sessionId, "diagnostics");
    const entries = await safeReadDir(diagnosticsDir, "diagnostic");
    const diagnostics: Array<{ diagnosticId: string; record: SessionDiagnosticRecord }> = [];

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) {
        continue;
      }

      const record = await readJson<SessionDiagnosticRecord>(
        path.join(diagnosticsDir, entry.name),
        "diagnostic"
      );
      if (!record) {
        continue;
      }

      diagnostics.push({
        diagnosticId: entry.name.replace(/\.json$/u, ""),
        record
      });
    }

    return diagnostics.sort((left, right) =>
      right.record.completedAt.localeCompare(left.record.completedAt)
    );
  }

  async getSessionDiagnostic(
    sessionId: string,
    diagnosticId: string
  ): Promise<SessionDiagnosticRecord | null> {
    return readJson<SessionDiagnosticRecord>(
      path.join(this.dataRoot, "sessions", sessionId, "diagnostics", `${diagnosticId}.json`),
      "diagnostic"
    );
  }

  async updateTopic(record: TopicRecord): Promise<void> {
    const topicPath = path.join(
      this.dataRoot,
      "workspaces",
      record.workspaceId,
      "topics",
      record.topicId,
      "topic.json"
    );
    await writeJson(topicPath, record);
  }

  async sessionExists(sessionId: string): Promise<boolean> {
    try {
      await stat(path.join(this.dataRoot, "sessions", sessionId, "state.json"));
      return true;
    } catch {
      return false;
    }
  }
}

export type FileSystemStoreErrorCode =
  | "artifact_invalid"
  | "artifact_unreadable"
  | "directory_unreadable";

export class FileSystemStoreError extends Error {
  constructor(
    public readonly code: FileSystemStoreErrorCode,
    public readonly artifactPath: string,
    public readonly artifactType: string,
    message: string
  ) {
    super(message);
    this.name = "FileSystemStoreError";
  }
}

export function isFileSystemStoreError(error: unknown): error is FileSystemStoreError {
  return error instanceof FileSystemStoreError;
}

async function readJson<T>(filePath: string, artifactType = "artifact"): Promise<T | null> {
  try {
    const raw = await readFile(filePath, "utf8");
    try {
      return JSON.parse(raw) as T;
    } catch {
      throw new FileSystemStoreError(
        "artifact_invalid",
        filePath,
        artifactType,
        `Invalid JSON payload in ${artifactType} artifact at ${filePath}.`
      );
    }
  } catch (error) {
    if (isMissingFileError(error)) {
      return null;
    }

    if (isFileSystemStoreError(error)) {
      throw error;
    }

    throw new FileSystemStoreError(
      "artifact_unreadable",
      filePath,
      artifactType,
      `Unable to read ${artifactType} artifact at ${filePath}.`
    );
  }
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeTextAtomically(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function appendTranscript(
  sessionId: string,
  entries: TranscriptEntry[],
  dataRoot: string
): Promise<void> {
  const filePath = path.join(dataRoot, "sessions", sessionId, "transcript.jsonl");
  const lines = entries.map((entry) => JSON.stringify(entry)).join("\n");
  const nextContent = lines.length > 0 ? `${lines}\n` : "";
  await mkdir(path.dirname(filePath), { recursive: true });
  await appendFile(filePath, nextContent, "utf8");
}

async function safeReadDir(dirPath: string, artifactType = "directory") {
  try {
    return await readdir(dirPath, { withFileTypes: true });
  } catch (error) {
    if (isMissingFileError(error)) {
      return [];
    }

    throw new FileSystemStoreError(
      "directory_unreadable",
      dirPath,
      artifactType,
      `Unable to read ${artifactType} directory at ${dirPath}.`
    );
  }
}

async function writeTextAtomically(filePath: string, content: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;

  try {
    await writeFile(tempPath, content, "utf8");
    await rename(tempPath, filePath);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}
