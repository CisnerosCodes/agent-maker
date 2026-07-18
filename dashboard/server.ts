// Dashboard server — SSE stream of the registry + approval endpoints.
// Deliberately boring: node http, no framework, one HTML page.

import { createServer } from "node:http";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { registry } from "../src/registry/registry.js";

const EVALS_DIR = process.env.EVALS_DIR ?? "./data/evals";

function evalRuns(): unknown[] {
  if (!existsSync(EVALS_DIR)) return [];
  return readdirSync(EVALS_DIR)
    .filter((f) => f.endsWith(".json") && f.startsWith("run-"))
    .sort()
    .reverse()
    .slice(0, 20)
    .map((f) => JSON.parse(readFileSync(join(EVALS_DIR, f), "utf8")));
}

const PORT = Number(process.env.DASHBOARD_PORT ?? 4000);
const clients = new Set<import("node:http").ServerResponse>();

registry.on("update", (record) => {
  const payload = `data: ${JSON.stringify(record)}\n\n`;
  for (const res of clients) res.write(payload);
});

createServer((req, res) => {
  if (req.url === "/") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(readFileSync(new URL("./index.html", import.meta.url)));
  } else if (req.url === "/events") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write(`data: ${JSON.stringify({ snapshot: registry.all() })}\n\n`);
    clients.add(res);
    req.on("close", () => clients.delete(res));
  } else if (req.url === "/evals") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(readFileSync(new URL("./evals.html", import.meta.url)));
  } else if (req.url === "/api/eval-runs") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(evalRuns()));
  } else if (req.url?.startsWith("/approve/") && req.method === "POST") {
    // TODO: resolve escalation by id -> notify CEO -> unblock worker
    res.writeHead(200).end("approved");
  } else if (req.url?.startsWith("/deny/") && req.method === "POST") {
    res.writeHead(200).end("denied");
  } else {
    res.writeHead(404).end();
  }
}).listen(PORT, () => console.log(`Dashboard: http://localhost:${PORT}`));
