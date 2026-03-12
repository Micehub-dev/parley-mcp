import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import type {
  DebateSessionState,
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
    const entries = await readdir(workspacesDir, { withFileTypes: true });
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
    await writeFile(path.join(topicDir, "threads.jsonl"), "", "utf8");
    await writeFile(path.join(topicDir, "decision.md"), "", "utf8");
  }

  async listTopics(workspaceId: string): Promise<TopicRecord[]> {
    const topicsDir = path.join(this.dataRoot, "workspaces", workspaceId, "topics");
    const entries = await safeReadDir(topicsDir);
    const topics: TopicRecord[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const topicPath = path.join(topicsDir, entry.name, "topic.json");
      const record = await readJson<TopicRecord>(topicPath);
      if (record) {
        topics.push(record);
      }
    }

    return topics.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async getTopic(workspaceId: string, topicId: string): Promise<TopicRecord | null> {
    return readJson<TopicRecord>(
      path.join(this.dataRoot, "workspaces", workspaceId, "topics", topicId, "topic.json")
    );
  }

  async createSession(state: DebateSessionState, initialTranscript: TranscriptEntry[]): Promise<void> {
    const sessionDir = path.join(this.dataRoot, "sessions", state.sessionId);
    await mkdir(sessionDir, { recursive: true });
    await writeJson(path.join(sessionDir, "state.json"), state);
    await writeFile(path.join(sessionDir, "transcript.jsonl"), "", "utf8");
    await appendTranscript(state.sessionId, initialTranscript, this.dataRoot);
    await writeFile(path.join(sessionDir, "summary.md"), "", "utf8");
    await writeJson(path.join(sessionDir, "lease.json"), {
      leaseOwner: state.leaseOwner ?? null,
      leaseExpiresAt: state.leaseExpiresAt ?? null
    });
  }

  async getSession(sessionId: string): Promise<DebateSessionState | null> {
    return readJson<DebateSessionState>(
      path.join(this.dataRoot, "sessions", sessionId, "state.json")
    );
  }

  async saveSession(state: DebateSessionState): Promise<void> {
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

async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
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
  await writeFile(filePath, nextContent, { encoding: "utf8", flag: "a" });
}

async function safeReadDir(dirPath: string) {
  try {
    return await readdir(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }
}
