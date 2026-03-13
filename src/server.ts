import process from "node:process";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { loadConfig } from "./config.js";
import { ParleyError, isParleyError } from "./errors.js";
import { createParticipantAdapters } from "./participants/adapters.js";
import { FileSystemStore } from "./storage/fs-store.js";
import { ParleyService } from "./services/parley-service.js";
import type { TopicRecord } from "./types.js";
import { createId } from "./utils/id.js";

export async function startServer(): Promise<void> {
  const rootDir = process.cwd();
  const store = new FileSystemStore(rootDir);
  await store.ensureBaseLayout();

  const config = await loadConfig(rootDir);
  const participantAdapters = createParticipantAdapters();
  const parleyService = new ParleyService(store, config, participantAdapters);

  const server = new McpServer({
    name: "parley",
    version: "0.1.0"
  });

  server.tool(
    "parley_list_workspaces",
    "List known workspaces managed by the parley server.",
    {},
    async () =>
      executeTool(async () => {
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
      })
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
    async ({ workspaceId, title, body, tags, status }) =>
      executeTool(async () => {
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
      })
  );

  server.tool(
    "parley_list_topics",
    "List topics for a workspace.",
    {
      workspaceId: z.string().default("default"),
      status: z.enum(["open", "in_progress", "resolved"]).optional(),
      query: z.string().optional(),
      tags: z.array(z.string().min(1)).optional()
    },
    async ({ workspaceId, status, query, tags }) =>
      executeTool(async () => {
      const search = await parleyService.searchTopics({
        workspaceId,
        ...(status ? { status } : {}),
        ...(query ? { query } : {}),
        ...(tags ? { tags } : {}),
        limit: Number.MAX_SAFE_INTEGER
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ topics: search.results.map((result) => result.topic) }, null, 2)
          }
        ]
      };
      })
  );

  server.tool(
    "parley_search_topics",
    "Search topic memory across promoted summaries, open questions, and action items.",
    {
      workspaceId: z.string().default("default"),
      status: z.enum(["open", "in_progress", "resolved"]).optional(),
      query: z.string().optional(),
      tags: z.array(z.string().min(1)).optional(),
      limit: z.number().int().positive().max(100).default(20)
    },
    async ({ workspaceId, status, query, tags, limit }) =>
      executeTool(async () => {
      const result = await parleyService.searchTopics({
        workspaceId,
        ...(status ? { status } : {}),
        ...(query ? { query } : {}),
        ...(tags ? { tags } : {}),
        limit
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2)
          }
        ]
      };
      })
  );

  server.tool(
    "parley_get_topic",
    "Fetch a single topic and its metadata.",
    {
      workspaceId: z.string().default("default"),
      topicId: z.string().min(1)
    },
    async ({ workspaceId, topicId }) =>
      executeTool(async () => {
      const topic = await store.getTopic(workspaceId, topicId);
      if (!topic) {
        throw new ParleyError("not_found", `Topic not found: ${topicId}`, {
          topicId
        });
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                topic,
                boardCard: {
                  topicId: topic.topicId,
                  title: topic.title,
                  status: topic.status,
                  tags: topic.tags,
                  updatedAt: topic.updatedAt,
                  linkedSessionCount: topic.linkedSessionIds.length,
                  openQuestionCount: topic.openQuestions.length,
                  actionItemCount: topic.actionItems.length,
                  hasDecisionSummary: Boolean(topic.decisionSummary),
                  ...(topic.decisionSummary ? { decisionSummary: topic.decisionSummary } : {}),
                  ...(topic.canonicalSummary ? { canonicalSummary: topic.canonicalSummary } : {})
                }
              },
              null,
              2
            )
          }
        ]
      };
      })
  );

  server.tool(
    "parley_get_workspace_board",
    "Return a board-style workspace digest over promoted topic memory.",
    {
      workspaceId: z.string().default("default"),
      limit: z.number().int().positive().max(100).default(10)
    },
    async ({ workspaceId, limit }) =>
      executeTool(async () => {
      const board = await parleyService.getWorkspaceBoard({
        workspaceId,
        limit
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(board, null, 2)
          }
        ]
      };
      })
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
    }) =>
      executeTool(async () => {
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
      })
  );

  server.tool(
    "parley_state",
    "Get the current parley session state.",
    {
      parleySessionId: z.string().min(1)
    },
    async ({ parleySessionId }) =>
      executeTool(async () => {
      const state = await parleyService.getSessionState(parleySessionId);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ state }, null, 2)
          }
        ]
      };
      })
  );

  server.tool(
    "parley_claim_lease",
    "Claim or refresh a short lease for orchestrating a session.",
    {
      parleySessionId: z.string().min(1),
      orchestratorRunId: z.string().min(1),
      ttlSeconds: z.number().int().positive().max(3600).default(300)
    },
    async ({ parleySessionId, orchestratorRunId, ttlSeconds }) =>
      executeTool(async () => {
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
      })
  );

  server.tool(
    "parley_step",
    "Advance session state by executing both participant adapters.",
    {
      parleySessionId: z.string().min(1),
      expectedStateVersion: z.number().int().positive(),
      orchestratorRunId: z.string().min(1),
      speakerOrder: z.array(z.enum(["claude", "gemini"])).length(2).optional(),
      userNudge: z.string().optional()
    },
    async ({ parleySessionId, expectedStateVersion, orchestratorRunId, speakerOrder, userNudge }) =>
      executeTool(async () => {
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
      })
  );

  server.tool(
    "parley_finish",
    "Mark a parley session as finished and return a structured conclusion.",
    {
      parleySessionId: z.string().min(1),
      orchestratorRunId: z.string().optional()
    },
    async ({ parleySessionId, orchestratorRunId }) =>
      executeTool(async () => {
      const result = await parleyService.finishSession(parleySessionId, orchestratorRunId);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2)
          }
        ]
      };
      })
  );

  server.tool(
    "parley_promote_summary",
    "Promote a finished session conclusion into linked topic memory.",
    {
      parleySessionId: z.string().min(1),
      topicId: z.string().optional()
    },
    async ({ parleySessionId, topicId }) =>
      executeTool(async () => {
      const result = await parleyService.promoteSummary({
        parleySessionId,
        ...(topicId ? { topicId } : {})
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2)
          }
        ]
      };
      })
  );

  server.tool(
    "parley_list_diagnostics",
    "Inspect persisted step diagnostics and operator repair guidance for a session.",
    {
      parleySessionId: z.string().min(1),
      outcome: z.enum(["participant_failure", "storage_failure"]).optional(),
      participant: z.enum(["claude", "gemini"]).optional(),
      failureKind: z.enum(["process_error", "invalid_output"]).optional(),
      limit: z.number().int().positive().max(100).default(20)
    },
    async ({ parleySessionId, outcome, participant, failureKind, limit }) =>
      executeTool(async () => {
      const diagnostics = await parleyService.listDiagnostics({
        parleySessionId,
        ...(outcome ? { outcome } : {}),
        ...(participant ? { participant } : {}),
        ...(failureKind ? { failureKind } : {}),
        limit
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(diagnostics, null, 2)
          }
        ]
      };
      })
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

async function executeTool(
  operation: () => Promise<{
    content: Array<{
      type: "text";
      text: string;
    }>;
  }>
) {
  try {
    return await operation();
  } catch (error) {
    if (!isParleyError(error)) {
      throw error;
    }

    return {
      isError: true,
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              error: {
                code: error.code,
                message: error.message,
                ...(error.details ? { details: error.details } : {})
              }
            },
            null,
            2
          )
        }
      ]
    };
  }
}
