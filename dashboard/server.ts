// Dashboard server — SSE stream of the whole company (agents, tasks, goals,
// messages) + goal intake, chat, approvals, and the /evals report page.
// Deliberately boring: node http, no framework.

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { registry } from "../src/registry/registry.js";
import { bus } from "../src/bus/bus.js";
import { orchestrator } from "../src/orchestrator/orchestrator.js";

const PORT = Number(process.env.DASHBOARD_PORT ?? 4000);
const EVALS_DIR = process.env.EVALS_DIR ?? "./data/evals";
const clients = new Set<ServerResponse>();

function broadcast(type: string, data: unknown) {
  const payload = `data: ${JSON.stringify({ type, data })}\n\n`;
  for (const res of clients) res.write(payload);
}

registry.on("update", (record) => broadcast("agent", record));
bus.on("message", (msg) => broadcast("message", msg));
orchestrator.on("task", (task) => broadcast("task", task));
orchestrator.on("goal", (goal) => broadcast("goal", goal));

function snapshot() {
  return {
    agents: registry.all(),
    messages: bus.recent(),
    ...orchestrator.snapshot(),
  };
}

function evalRuns(): unknown[] {
  if (!existsSync(EVALS_DIR)) return [];
  return readdirSync(EVALS_DIR)
    .filter((f) => f.endsWith(".json") && f.startsWith("run-"))
    .sort()
    .reverse()
    .slice(0, 20)
    .map((f) => JSON.parse(readFileSync(join(EVALS_DIR, f), "utf8")));
}

function body(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", () => {
      try { resolve(raw ? JSON.parse(raw) : {}); } catch (e) { reject(e); }
    });
  });
}

function json(res: ServerResponse, data: unknown, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

createServer(async (req, res) => {
  try {
    if (req.url === "/") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(readFileSync(new URL("./index.html", import.meta.url)));
    } else if (req.url === "/evals") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(readFileSync(new URL("./evals.html", import.meta.url)));
    } else if (req.url === "/api/eval-runs") {
      json(res, evalRuns());
    } else if (req.url === "/events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.write(`data: ${JSON.stringify({ type: "snapshot", data: snapshot() })}\n\n`);
      clients.add(res);
      req.on("close", () => clients.delete(res));
    } else if (req.url === "/goal" && req.method === "POST") {
      const { text } = await body(req);
      if (!text?.trim()) return json(res, { error: "text required" }, 400);
      const goal = await orchestrator.startGoal(text.trim());
      json(res, goal);
    } else if (req.url === "/message" && req.method === "POST") {
      const { threadId, from, to, body: msgBody } = await body(req);
      if (!msgBody?.trim()) return json(res, { error: "body required" }, 400);
      const msg = bus.post({ threadId: threadId || "company", from: from || "user", to, kind: "chat", body: msgBody.trim() });
      json(res, msg);
    } else if (req.url === "/reset" && req.method === "POST") {
      orchestrator.reset();
      broadcast("snapshot", snapshot());
      json(res, { ok: true });
    } else if (req.url?.startsWith("/approve/") && req.method === "POST") {
      // TODO: resolve escalation by id -> notify CEO -> unblock worker
      res.writeHead(200).end("approved");
    } else if (req.url?.startsWith("/deny/") && req.method === "POST") {
      res.writeHead(200).end("denied");
    } else {
      res.writeHead(404).end();
    }
  } catch (err: any) {
    json(res, { error: err.message }, 500);
  }
}).listen(PORT, () => console.log(`Dashboard: http://localhost:${PORT}`));
