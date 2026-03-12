import path from "node:path";
import process from "node:process";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { loadConfig } from "./config.js";
import { FileSystemStore } from "./storage/fs-store.js";
import type { DebateSessionState, TopicRecord, TranscriptEntry } from "./types.js";
import { createId } from "./utils/id.js";

export async function startServer(): Promise<void> {
  const rootDir = process.cwd();
  const store = new FileSystemStore(rootDir);
  await store.ensureBaseLayout();

  const config = await loadConfig(rootDir);

  const server = new McpServer({
    name: "parley",
    version: "0.1.0"
  });

  server.tool(
    "debate_list_workspaces",
    "List known workspaces managed by the debate server.",
    {},
    async () => {
      const workspaces = await store.listWorkspaces();
      const topicsByWorkspace = await Promise.all(
        workspaces.map(async (workspace) => ({
          ...workspace,
          topicCount: (await store.listTopics(workspace.workspaceId)).length
        }))
      );

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ workspaces: topicsByWorkspace }, null, 2)
          }
        ]
      };
    }
  );

  server.tool(
    "debate_create_topic",
    "Create a topic record under a workspace.",
    {
      workspaceId: z.string().default("default"),
      title: z.string().min(1),
      body: z.string().default(""),
      tags: z.array(z.string().min(1)).optional(),
      status: z.enum(["open", "in_progress", "resolved"]).optional()
    },
    async ({ workspaceId, title, body, tags, status }) => {
      const now = new Date().toISOString();
      const topicId = createId("topic");

      const topic: TopicRecord = {
        topicId,
        workspaceId,
        title,
        body,
        status: status ?? "open",
        tags: tags ?? [],
        createdAt: now,
        updatedAt: now,
        linkedSessionIds: [],
        keyThreadIds: [],
        openQuestions: [],
        actionItems: [],
        statusHistory: [
          {
            status: status ?? "open",
            changedAt: now
          }
        ]
      };

      await store.createTopic(topic);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ topicId, topic }, null, 2)
          }
        ]
      };
    }
  );

  server.tool(
    "debate_list_topics",
    "List topics for a workspace.",
    {
      workspaceId: z.string().default("default"),
      status: z.enum(["open", "in_progress", "resolved"]).optional(),
      query: z.string().optional()
    },
    async ({ workspaceId, status, query }) => {
      const topics = await store.listTopics(workspaceId);
      const normalizedQuery = query?.toLowerCase();
      const filtered = topics.filter((topic) => {
        const statusMatches = status ? topic.status === status : true;
        const queryMatches = normalizedQuery
          ? `${topic.title}\n${topic.body}`.toLowerCase().includes(normalizedQuery)
          : true;
        return statusMatches && queryMatches;
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ topics: filtered }, null, 2)
          }
        ]
      };
    }
  );

  server.tool(
    "debate_get_topic",
    "Fetch a single topic and its metadata.",
    {
      workspaceId: z.string().default("default"),
      topicId: z.string().min(1)
    },
    async ({ workspaceId, topicId }) => {
      const topic = await store.getTopic(workspaceId, topicId);

      if (!topic) {
        throw new Error(`Topic not found: ${topicId}`);
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ topic }, null, 2)
          }
        ]
      };
    }
  );

  server.tool(
    "debate_start",
    "Create a debate session and persist initial metadata.",
    {
      workspaceId: z.string().default("default"),
      topic: z.string().min(1),
      topicId: z.string().optional(),
      claudeModel: z.string().optional(),
      geminiModel: z.string().optional(),
      maxTurns: z.number().int().positive().optional(),
      systemPrompt: z.string().optional(),
      orchestrator: z.enum(["codex", "claude", "gemini", "other"]).default("codex"),
      orchestratorRunId: z.string().optional()
    },
    async ({
      workspaceId,
      topic,
      topicId,
      claudeModel,
      geminiModel,
      maxTurns,
      systemPrompt,
      orchestrator,
      orchestratorRunId
    }) => {
      const resolvedClaudeModel = assertAllowedModel(
        "claude",
        claudeModel ?? config.debate.defaults.claudeModel,
        config
      );
      const resolvedGeminiModel = assertAllowedModel(
        "gemini",
        geminiModel ?? config.debate.defaults.geminiModel,
        config
      );
      const now = new Date().toISOString();
      const sessionId = createId("debate");

      const state: DebateSessionState = {
        sessionId,
        workspaceId,
        workspaceRoot: path.join(rootDir, workspaceId),
        topic,
        ...(topicId ? { topicId } : {}),
        ...(systemPrompt ? { systemPrompt } : {}),
        turn: 0,
        maxTurns: maxTurns ?? config.debate.defaultMaxTurns,
        status: "active",
        stateVersion: 1,
        createdAt: now,
        updatedAt: now,
        participants: {
          claude: { model: resolvedClaudeModel },
          gemini: { model: resolvedGeminiModel }
        },
        orchestratorAuditLog: [
          {
            clientKind: orchestrator,
            ...(orchestratorRunId ? { runId: orchestratorRunId } : {}),
            startedAt: now
          }
        ]
      };

      const transcript: TranscriptEntry[] = [
        {
          timestamp: now,
          kind: "system",
          speaker: "parley",
          message: `Debate session created for topic: ${topic}`
        }
      ];

      await store.createSession(state, transcript);

      if (topicId) {
        const topicRecord = await store.getTopic(workspaceId, topicId);
        if (topicRecord) {
          topicRecord.linkedSessionIds = [...new Set([...topicRecord.linkedSessionIds, sessionId])];
          topicRecord.updatedAt = now;
          await store.updateTopic(topicRecord);
        }
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                debateSessionId: sessionId,
                stateVersion: state.stateVersion,
                leaseOwner: state.leaseOwner ?? null,
                appliedModels: {
                  claude: resolvedClaudeModel,
                  gemini: resolvedGeminiModel
                },
                maxTurns: state.maxTurns
              },
              null,
              2
            )
          }
        ]
      };
    }
  );

  server.tool(
    "debate_state",
    "Get the current debate session state.",
    {
      debateSessionId: z.string().min(1)
    },
    async ({ debateSessionId }) => {
      const state = await requireSession(store, debateSessionId);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ state }, null, 2)
          }
        ]
      };
    }
  );

  server.tool(
    "debate_claim_lease",
    "Claim or refresh a short lease for orchestrating a session.",
    {
      debateSessionId: z.string().min(1),
      orchestratorRunId: z.string().min(1),
      ttlSeconds: z.number().int().positive().max(3600).default(300)
    },
    async ({ debateSessionId, orchestratorRunId, ttlSeconds }) => {
      const state = await requireSession(store, debateSessionId);
      const now = new Date();
      const currentLeaseValid =
        state.leaseOwner && state.leaseExpiresAt
          ? new Date(state.leaseExpiresAt).getTime() > now.getTime()
          : false;

      if (currentLeaseValid && state.leaseOwner !== orchestratorRunId) {
        throw new Error(`Lease is currently owned by ${state.leaseOwner}.`);
      }

      state.leaseOwner = orchestratorRunId;
      state.leaseExpiresAt = new Date(now.getTime() + ttlSeconds * 1000).toISOString();
      state.stateVersion += 1;
      state.lastWriter = orchestratorRunId;
      state.updatedAt = now.toISOString();

      await store.saveSession(state);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                leaseOwner: state.leaseOwner,
                leaseExpiresAt: state.leaseExpiresAt,
                stateVersion: state.stateVersion
              },
              null,
              2
            )
          }
        ]
      };
    }
  );

  server.tool(
    "debate_step",
    "Advance session state and record an orchestrator step placeholder.",
    {
      debateSessionId: z.string().min(1),
      expectedStateVersion: z.number().int().positive(),
      orchestratorRunId: z.string().min(1),
      speakerOrder: z.array(z.enum(["claude", "gemini"])).optional(),
      userNudge: z.string().optional()
    },
    async ({ debateSessionId, expectedStateVersion, orchestratorRunId, speakerOrder, userNudge }) => {
      const state = await requireSession(store, debateSessionId);

      if (state.stateVersion !== expectedStateVersion) {
        throw new Error(
          `State version mismatch. Expected ${expectedStateVersion}, found ${state.stateVersion}.`
        );
      }

      if (state.leaseOwner && state.leaseOwner !== orchestratorRunId) {
        throw new Error(`Session lease is owned by ${state.leaseOwner}.`);
      }

      const now = new Date().toISOString();
      const nextTurn = state.turn + 1;
      const order = speakerOrder ?? ["claude", "gemini"];

      const transcriptEntries: TranscriptEntry[] = [
        {
          timestamp: now,
          kind: "orchestrator",
          speaker: orchestratorRunId,
          message: userNudge
            ? `Step ${nextTurn} requested. Nudge: ${userNudge}`
            : `Step ${nextTurn} requested.`,
          metadata: {
            speakerOrder: order.join(",")
          }
        }
      ];

      state.turn = nextTurn;
      state.stateVersion += 1;
      state.lastWriter = orchestratorRunId;
      state.updatedAt = now;
      state.latestSummary =
        "Participant subprocess integration is not wired yet. This step currently records orchestration metadata only.";

      if (state.turn >= state.maxTurns) {
        state.status = "finished";
      }

      await store.appendTranscript(state.sessionId, transcriptEntries);
      await store.saveSession(state);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                turn: state.turn,
                stateVersion: state.stateVersion,
                finished: state.status === "finished",
                note:
                  "CLI participant execution is scaffolded for the next phase. This step recorded the orchestrator event and advanced state."
              },
              null,
              2
            )
          }
        ]
      };
    }
  );

  server.tool(
    "debate_finish",
    "Mark a debate session as finished and return a lightweight summary.",
    {
      debateSessionId: z.string().min(1),
      orchestratorRunId: z.string().optional()
    },
    async ({ debateSessionId, orchestratorRunId }) => {
      const state = await requireSession(store, debateSessionId);
      const now = new Date().toISOString();

      state.status = "finished";
      state.stateVersion += 1;
      state.updatedAt = now;
      if (orchestratorRunId) {
        state.lastWriter = orchestratorRunId;
      }
      state.orchestratorAuditLog = state.orchestratorAuditLog.map((entry, index, entries) =>
        index === entries.length - 1 && !entry.completedAt
          ? { ...entry, completedAt: now }
          : entry
      );

      await store.saveSession(state);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                sessionId: state.sessionId,
                status: state.status,
                turn: state.turn,
                summary:
                  state.latestSummary ??
                  "Debate session finished. Automatic participant synthesis will be added in the next implementation phase."
              },
              null,
              2
            )
          }
        ]
      };
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

async function requireSession(store: FileSystemStore, sessionId: string) {
  const state = await store.getSession(sessionId);
  if (!state) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  return state;
}

function assertAllowedModel(
  participant: "claude" | "gemini",
  model: string,
  config: Awaited<ReturnType<typeof loadConfig>>
): string {
  const allowed = config.debate.allowedModels[participant];
  if (!allowed.includes(model)) {
    throw new Error(`Model "${model}" is not allowed for ${participant}.`);
  }

  return model;
}
