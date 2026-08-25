import express from "express";
import { randomUUID } from "crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import * as store from "./store.js";
import { escalate } from "./slack.js";

const ROLES = ["backend", "frontend", "stress"];
const PRIORITIES = ["critical", "high", "medium"];

function buildServer() {
  const server = new McpServer({ name: "start-it-orchestrator", version: "1.0.0" });

  server.registerTool(
    "create_task",
    {
      title: "Create task",
      description: "Director creates a task for a specific role's worker queue.",
      inputSchema: {
        role: z.enum(ROLES),
        instructions: z.string(),
        context: z.string().optional(),
      },
    },
    async ({ role, instructions, context }) => {
      const task = store.createTask({ role, instructions, context });
      return { content: [{ type: "text", text: JSON.stringify(task, null, 2) }] };
    }
  );

  server.registerTool(
    "claim_task",
    {
      title: "Claim next task",
      description: "Worker claims the next pending task for its role. Returns null if queue is empty.",
      inputSchema: { worker_id: z.string(), role: z.enum(ROLES) },
    },
    async ({ worker_id, role }) => {
      const task = store.claimTask({ worker_id, role });
      return { content: [{ type: "text", text: JSON.stringify(task, null, 2) }] };
    }
  );

  server.registerTool(
    "submit_result",
    {
      title: "Submit task result",
      description: "Worker submits output for a claimed task. Moves it to awaiting_review.",
      inputSchema: { task_id: z.number(), output: z.string() },
    },
    async ({ task_id, output }) => {
      const task = store.submitResult({ task_id, output });
      return { content: [{ type: "text", text: JSON.stringify(task, null, 2) }] };
    }
  );

  server.registerTool(
    "review_result",
    {
      title: "Review task result",
      description: "Director approves (closes task) or requests revision (re-queues with notes).",
      inputSchema: {
        task_id: z.number(),
        verdict: z.enum(["approve", "revise"]),
        notes: z.string().optional(),
      },
    },
    async ({ task_id, verdict, notes }) => {
      const task = store.reviewResult({ task_id, verdict, notes });
      return { content: [{ type: "text", text: JSON.stringify(task, null, 2) }] };
    }
  );

  server.registerTool(
    "list_tasks",
    {
      title: "List tasks",
      description: "List tasks, optionally filtered by status and/or role.",
      inputSchema: {
        status: z.enum(["pending", "in_progress", "awaiting_review", "approved"]).optional(),
        role: z.enum(ROLES).optional(),
      },
    },
    async ({ status, role }) => {
      const tasks = store.listTasks({ status, role });
      return { content: [{ type: "text", text: JSON.stringify(tasks, null, 2) }] };
    }
  );

  server.registerTool(
    "fire",
    {
      title: "Fire signal",
      description:
        "Any worker posts a signal. CRITICAL/HIGH auto-escalate to #start-it in Slack, threaded under today's digest. MEDIUM stays logged only.",
      inputSchema: {
        worker_id: z.string(),
        priority: z.enum(PRIORITIES),
        content: z.string(),
        data: z.record(z.any()).optional(),
      },
    },
    async ({ worker_id, priority, content, data }) => {
      const signal = store.fireSignal({ worker_id, priority, content, data });
      await escalate(signal); // no-op for medium; posts to Slack for critical/high
      return { content: [{ type: "text", text: JSON.stringify(signal, null, 2) }] };
    }
  );

  server.registerTool(
    "drain",
    {
      title: "Drain signals",
      description: "Pull and mark-read all undrained signals, optionally filtered by priority.",
      inputSchema: { priority: z.enum(PRIORITIES).optional() },
    },
    async ({ priority }) => {
      const signals = store.drainSignals({ priority });
      return { content: [{ type: "text", text: JSON.stringify(signals, null, 2) }] };
    }
  );

  return server;
}

const app = express();
app.use(express.json());

app.get("/api/health", (_req, res) => res.json({ status: "ok", service: "start-it-orchestrator" }));

// Stateless MCP over Streamable HTTP — one server+transport per request.
app.post("/mcp", async (req, res) => {
  try {
    const server = buildServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      transport.close();
      server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("[mcp] error:", err);
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal error" }, id: null });
    }
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`start-it-orchestrator listening on :${PORT}`));
