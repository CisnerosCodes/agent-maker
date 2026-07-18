// Dashboard server — SSE stream of the registry + approval endpoints.
// Deliberately boring: node http, no framework, one HTML page.

import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { registry } from "../src/registry/registry.js";

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
  } else if (req.url?.startsWith("/approve/") && req.method === "POST") {
    // TODO: resolve escalation by id -> notify CEO -> unblock worker
    res.writeHead(200).end("approved");
  } else if (req.url?.startsWith("/deny/") && req.method === "POST") {
    res.writeHead(200).end("denied");
  } else {
    res.writeHead(404).end();
  }
}).listen(PORT, () => console.log(`Dashboard: http://localhost:${PORT}`));
