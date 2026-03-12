import process from "node:process";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { loadConfig } from "./config.js";
import { FileSystemStore } from "./storage/fs-store.js";
import { ParleyService } from "./services/parley-service.js";
import type { TopicRecord } from "./types.js";
import { createId } from "./utils/id.js";

export async function startServer(): Promise<void> {
  const rootDir = process.cwd();
  const store = new FileSystemStore(rootDir);
  await store.ensureBaseLayout();

  const config = await loadConfig(rootDir);
  const parleyService = new ParleyService(store, config);

  const server = new McpServer({
    name: "parley",
    version: "0.1.0"
  });

  server.tool(
    "parley_list_workspaces",
    "List known workspaces managed by the parley server.",
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
    "parley_create_topic",
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
    "parley_list_topics",
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
    "parley_get_topic",
    "Fetch a single topic and its metadata.",
    {
      workspaceId: z.string().default("default"),
      topicId: z.string().min(1)
    },
    async ({ workspaceId, topicId }) => {
      const topic = await store.getTopic(workspaceId, topicId);
      if (!topic) {
        throw new Error(`[not_found] Topic not found: ${topicId}`);
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
    "parley_start",
    "Create a parley session and persist initial metadata.",
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
      const result = await parleyService.startSession({
        workspaceId,
        workspaceRoot: rootDir,
        topic,
        ...(topicId ? { topicId } : {}),
        ...(claudeModel ? { claudeModel } : {}),
        ...(geminiModel ? { geminiModel } : {}),
        ...(typeof maxTurns === "number" ? { maxTurns } : {}),
        ...(systemPrompt ? { systemPrompt } : {}),
        orchestrator,
        ...(orchestratorRunId ? { orchestratorRunId } : {})
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2)
          }
        ]
      };
    }
  );

  server.tool(
    "parley_state",
    "Get the current parley session state.",
    {
      parleySessionId: z.string().min(1)
    },
    async ({ parleySessionId }) => {
      const state = await parleyService.getSessionState(parleySessionId);
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
    "parley_claim_lease",
    "Claim or refresh a short lease for orchestrating a session.",
    {
      parleySessionId: z.string().min(1),
      orchestratorRunId: z.string().min(1),
      ttlSeconds: z.number().int().positive().max(3600).default(300)
    },
    async ({ parleySessionId, orchestratorRunId, ttlSeconds }) => {
      const result = await parleyService.claimLease({
        parleySessionId,
        orchestratorRunId,
        ttlSeconds
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2)
          }
        ]
      };
    }
  );

  server.tool(
    "parley_step",
    "Advance session state and record an orchestrator step placeholder.",
    {
      parleySessionId: z.string().min(1),
      expectedStateVersion: z.number().int().positive(),
      orchestratorRunId: z.string().min(1),
      speakerOrder: z.array(z.enum(["claude", "gemini"])).optional(),
      userNudge: z.string().optional()
    },
    async ({ parleySessionId, expectedStateVersion, orchestratorRunId, speakerOrder, userNudge }) => {
      const result = await parleyService.advanceStep({
        parleySessionId,
        expectedStateVersion,
        orchestratorRunId,
        ...(speakerOrder ? { speakerOrder } : {}),
        ...(userNudge ? { userNudge } : {})
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2)
          }
        ]
      };
    }
  );

  server.tool(
    "parley_finish",
    "Mark a parley session as finished and return a lightweight summary.",
    {
      parleySessionId: z.string().min(1),
      orchestratorRunId: z.string().optional()
    },
    async ({ parleySessionId, orchestratorRunId }) => {
      const result = await parleyService.finishSession(parleySessionId, orchestratorRunId);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2)
          }
        ]
      };
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
