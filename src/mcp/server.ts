// MCP server — "take this MCP and your AI sets everything up."
//
// A customer plugs this into THEIR agent (Claude Code, Claude Desktop, anything
// MCP-capable) and that agent becomes a concierge for their agent company: it
// onboards them, hands them their dashboard link, launches goals, watches the
// org live, explains escalations, and guides business setup — while the
// dashboard at http://localhost:4000 stays available for humans who prefer UI.
//
// Design rules (same spirit as the rest of the repo):
//  - Pure Node stdlib. Stdio transport is newline-delimited JSON-RPC 2.0 —
//    no SDK needed. stdout is protocol-only; logs go to stderr.
//  - Thin client over the dashboard HTTP API (DASHBOARD_URL). One source of
//    truth: whatever the dashboard shows, the agent sees. No duplicated state.
//  - SECRET HYGIENE: this server never accepts credential values. Setup status
//    is booleans-only (mirrors /api/setup GET); pasting keys happens in the
//    dashboard form so no model — including the customer's own — sees a secret.

import "../config/load-env.js";
import { createInterface } from "node:readline";

const BASE = (process.env.DASHBOARD_URL ?? `http://localhost:${process.env.DASHBOARD_PORT ?? 4000}`).replace(/\/$/, "");

// ---------------------------------------------------------------------------
// Dashboard API client
// ---------------------------------------------------------------------------

async function api(path: string, init?: { method?: string; body?: unknown }): Promise<any> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method: init?.method ?? "GET",
      headers: init?.body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new Error(
      `Cannot reach the Agent-Maker dashboard at ${BASE}. ` +
      `Start it with \`npm run dev\` in the agent-maker repo (or set DASHBOARD_URL if it runs elsewhere), then retry.`
    );
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? `${path} returned HTTP ${res.status}`);
  return data;
}

// ---------------------------------------------------------------------------
// Explanations — the guided-tour content the customer's agent narrates from.
// Static on purpose: works before the dashboard is even running.
// ---------------------------------------------------------------------------

const EXPLAIN: Record<string, string> = {
  overview: `Agent-Maker is a self-expanding agent company in a box. You give the CEO agent a
business goal ("launch a Shopify store for trending shoes"). The CEO decomposes it into roles,
and the Factory provisions each worker: a scoped identity from the Vault, an OpenShell sandbox
policy it cannot escape, and a NemoClaw worker process. Every model input/output, tool call,
and ingested document passes a SecurityGate (heuristic floor always on; HiddenLayer runtime
security when connected). You watch it all on the live dashboard — org chart, per-agent
progress, the agents talking to each other — and approve anything risky.

Two ways to drive it: the dashboard chat, or right here through your own agent via MCP.
Both talk to the same live company.`,

  security: `Defense in depth, three layers:
1. SecurityGate — every worker I/O and ingested document is scanned. A keyless heuristic
   floor is always on; connect HiddenLayer for authoritative scanning. Detections route by
   policy: log, block, or escalate to a human approve/deny banner.
2. OpenShell sandbox policies — each worker gets a role-scoped YAML policy (allowed hosts,
   commands, files). Even if a poisoned document is APPROVED, the egress policy independently
   blocks exfiltration hosts.
3. Spawn authority + escalations — workers can't spawn workers without authority, and
   anything flagged goes blocked until a human resolves it (dashboard banner, or the
   resolve_approval tool here at the user's explicit request).
Try run_security_demo to watch the whole chain fire on a real poisoned document.`,

  "setup-chain": `Business setup is priority-ordered so each credential helps set up the next:
1. Resend — agents get working email identities; the root every later signup hangs off.
2. A brain (Claude OR NVIDIA Nemotron key) — real AI output from copywriter/strategist/analyst.
3. Shopify — the deliverable turns real: products created in YOUR store.
4. Apify — research scrapes live products instead of a labeled sample catalog.
5. HiddenLayer — authoritative security scanning on top of the built-in floor.
Everything degrades gracefully — with zero keys the whole demo still runs, honestly labeled
SIMULATION where simulated. Credentials are pasted in the dashboard's BUSINESS SETUP card,
never through this MCP connection, so no model ever sees a raw secret.`,

  "whats-real-vs-sim": `Honestly labeled on screen, always:
- Research agent: REAL — real HTTP fetch; the message names its source (sample catalog /
  operator feed / live Apify scrape). A mock source is never presented as live.
- Run memory: REAL — completed goals persist; repeat a niche and run 2 reuses run 1's
  findings (0 re-scrapes). The company gets faster at work it has done before.
- SecurityGate + escalations: REAL — every bus message and worker I/O scanned.
- Store-builder: REAL with a Shopify token (POSTs products to the Admin API), otherwise
  labeled SIMULATION. Nemotron inference: REAL with an NVIDIA key + WORKER_BACKEND=nvidia.`,

  architecture: `You (chat/Slack/this MCP) -> CEO (heartbeat, persistent memory) -> Factory
(spec -> identity -> OpenShell policy -> NemoClaw spawn) -> workers on a persisted message
bus. The bus is the company's spine: one choke point where the SecurityGate scans every
inter-agent message, replayable, demoable offline. The dashboard is an SSE view over it;
this MCP server is a JSON view over the same state. Evals: a 20-level Instruction-Following
Ladder benchmarks which model+backend is safe to give a worker (see latest_eval_report).`,
};

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

interface Tool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run: (args: any) => Promise<string>;
}

const OBJECTIVES = ["store", "marketing", "research", "email-automation", "everything"];

function summarizeSetup(setup: any[]): string {
  const lines = setup.map((s) =>
    `${s.connected ? "[connected]" : "[not set]"} P${s.priority} ${s.label} — ${s.unlocks}` +
    (s.connected ? "" : ` (get it: ${s.link}${s.hint ? ` — ${s.hint}` : ""})`)
  );
  return lines.join("\n");
}

const TOOLS: Tool[] = [
  {
    name: "get_started",
    description:
      "ALWAYS CALL THIS FIRST. Returns the customer's dashboard link, onboarding state, business-setup status, live company summary, and the recommended next steps. Use it to orient the user: welcome them, hand them their dashboard link, and guide whatever comes next.",
    inputSchema: { type: "object", properties: {} },
    run: async () => {
      const [company, setup, snap] = await Promise.all([
        api("/api/company"),
        api("/api/setup"),
        api("/api/snapshot"),
      ]);
      const p = company.profile;
      const openEsc = snap.escalations.filter((e: any) => !e.resolved);
      const steps: string[] = [];
      if (!p) steps.push("Onboard: ask the user about their company (name, niche, objective) and call onboard_company. Starter packs: " +
        Object.entries(company.packs).map(([k, v]: [string, any]) => `${k} (${v.roles.join("+")})`).join(", "));
      const brain = setup.some((s: any) => s.id.startsWith("brain-") && s.connected);
      if (!brain) steps.push(`Connect an AI brain (Claude or Nemotron key) in the dashboard's BUSINESS SETUP card: ${BASE}/app — credentials are pasted THERE, never through this chat, so no model sees them.`);
      if (openEsc.length) steps.push(`${openEsc.length} security escalation(s) await approve/deny — surface them (pending_approvals) and resolve only on the user's explicit decision.`);
      if (snap.pendingPlans?.length) steps.push(`The CEO's proposed org plan awaits approval (pending_approvals).`);
      if (p && !snap.goals.length) steps.push(`Launch the first goal — suggested: "${company.suggestedGoal}" (launch_goal).`);
      if (!steps.length) steps.push("Company is running — monitor with company_status, narrate what agents are doing, and surface anything blocked.");
      return JSON.stringify({
        dashboardUrl: `${BASE}/app`,
        evalsUrl: `${BASE}/evals`,
        onboarded: Boolean(p),
        profile: p,
        suggestedFirstGoal: company.suggestedGoal,
        businessSetup: setup.map((s: any) => ({ id: s.id, label: s.label, connected: s.connected, priority: s.priority })),
        company: {
          agents: snap.agents.map((a: any) => ({ id: a.id, role: a.spec.role, status: a.status })),
          goals: snap.goals.map((g: any) => ({ id: g.id, text: g.text, status: g.status, deliverable: g.deliverable })),
          autonomyMode: snap.autonomyMode,
          openEscalations: openEsc.length,
          pendingPlans: snap.pendingPlans?.length ?? 0,
          pastRuns: snap.runs?.length ?? 0,
        },
        nextSteps: steps,
      }, null, 2);
    },
  },
  {
    name: "onboard_company",
    description:
      "Set up the customer's company profile (the intake wizard, conversationally). Interview the user first — name, niche, what they want out of it — then call this once. Installs the matching starter agent pack and returns the suggested first goal. Freeform notes go in `context` (they pass the SecurityGate like any ingested document).",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Company or idea name" },
        niche: { type: "string", description: "What they sell / who they serve" },
        objective: { type: "string", enum: OBJECTIVES, description: "What they want out of the agent company" },
        objectiveNote: { type: "string", description: "Their own words about the objective" },
        hasStore: { type: "boolean" },
        storeUrl: { type: "string", description: "Existing store URL, if any" },
        wantsStoreSetup: { type: "boolean", description: "No store yet but wants one" },
        assets: { type: "array", items: { type: "string" }, description: 'What they already have: "email-domain" | "socials" | "product-list" | "brand"' },
        context: { type: "string", description: "Freeform context: product lists, brand notes, docs" },
      },
      required: ["name", "niche", "objective"],
    },
    run: async (args) => {
      const r = await api("/api/company", { method: "POST", body: args });
      return JSON.stringify({ ...r, dashboardUrl: `${BASE}/app`, note: "Profile saved — the CEO posted a welcome in the company channel. Next: connect integrations (setup_status) or launch the suggested goal." }, null, 2);
    },
  },
  {
    name: "setup_status",
    description:
      "Business-setup checklist, priority-ordered (booleans only — never credential values). Use it to tell the user what to connect next, what each integration unlocks, and where to get the key. IMPORTANT: keys are pasted into the dashboard's BUSINESS SETUP card, NOT sent through this chat — never ask the user to paste a secret to you.",
    inputSchema: { type: "object", properties: {} },
    run: async () => {
      const setup = await api("/api/setup");
      return `Paste credentials at ${BASE}/app (BUSINESS SETUP card) — never in chat.\n\n${summarizeSetup(setup)}`;
    },
  },
  {
    name: "company_status",
    description:
      "Live snapshot of the whole company: agents (role + status), goals, tasks with progress, recent messages, autonomy mode, run memory. Poll this while work is running to narrate what is happening — who is working, who is blocked, what just finished, real vs SIMULATION.",
    inputSchema: {
      type: "object",
      properties: {
        messageLimit: { type: "number", description: "How many recent bus messages to include (default 25)" },
      },
    },
    run: async (args) => {
      const snap = await api("/api/snapshot");
      const limit = Math.max(0, Math.min(200, args?.messageLimit ?? 25));
      return JSON.stringify({
        autonomyMode: snap.autonomyMode,
        agents: snap.agents.map((a: any) => ({
          id: a.id, name: a.spec.name, role: a.spec.role, status: a.status,
          objective: a.spec.objective, lastEvent: a.log?.at(-1)?.message,
        })),
        goals: snap.goals,
        tasks: snap.tasks.map((t: any) => ({
          id: t.id, goalId: t.goalId, title: t.title, agentId: t.agentId, status: t.status,
          progress: t.progress, mode: t.mode, dependsOn: t.dependsOn, output: t.output,
        })),
        runMemory: snap.runs,
        openEscalations: snap.escalations.filter((e: any) => !e.resolved),
        pendingPlans: snap.pendingPlans,
        recentMessages: snap.messages.slice(-limit),
      }, null, 2);
    },
  },
  {
    name: "launch_goal",
    description:
      "Give the CEO a business goal (e.g. \"Launch a Shopify store for trending shoes\"). The CEO may ask a clarifying question in the goal thread — check company_status and answer via message_agent. In assisted autonomy the org plan then waits for approval (pending_approvals).",
    inputSchema: {
      type: "object",
      properties: { text: { type: "string", description: "The goal, in plain business language" } },
      required: ["text"],
    },
    run: async (args) => {
      const goal = await api("/goal", { method: "POST", body: { text: args.text } });
      return JSON.stringify({ goal, note: `Goal ${goal.id} started (status: ${goal.status}). Watch it with company_status; if status is "clarifying", answer the CEO's question via message_agent on thread ${goal.threadId}.` }, null, 2);
    },
  },
  {
    name: "message_agent",
    description:
      "Post a message on the company bus as the user — to the CEO, a specific agent (set `to`), or a goal thread (set `threadId`). Use it to answer the CEO's clarifying questions or to talk to any worker directly.",
    inputSchema: {
      type: "object",
      properties: {
        body: { type: "string", description: "The message" },
        threadId: { type: "string", description: 'Goal thread id, or "company" (default)' },
        to: { type: "string", description: "Agent id for a direct message (optional)" },
      },
      required: ["body"],
    },
    run: async (args) => {
      const msg = await api("/message", { method: "POST", body: { body: args.body, threadId: args.threadId, to: args.to, from: "user" } });
      return JSON.stringify(msg, null, 2);
    },
  },
  {
    name: "pending_approvals",
    description:
      "Everything waiting on a human decision: security escalations (flagged content with scan categories and a redacted excerpt) and pending org-plan approvals. Explain each to the user in plain language — what was flagged, why, and what approve/deny would do.",
    inputSchema: { type: "object", properties: {} },
    run: async () => {
      const snap = await api("/api/snapshot");
      const esc = snap.escalations.filter((e: any) => !e.resolved);
      if (!esc.length && !snap.pendingPlans?.length) return "Nothing is waiting on approval.";
      return JSON.stringify({ escalations: esc, pendingPlans: snap.pendingPlans }, null, 2);
    },
  },
  {
    name: "resolve_approval",
    description:
      "Approve or deny a pending item ON THE USER'S EXPLICIT INSTRUCTION ONLY — these gates exist for human judgment; never decide autonomously. kind=escalation resolves a security escalation by id; kind=plan resolves the CEO's org plan by goal id.",
    inputSchema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["escalation", "plan"] },
        id: { type: "string", description: "Escalation id, or goal id for a plan" },
        decision: { type: "string", enum: ["approve", "deny"] },
      },
      required: ["kind", "id", "decision"],
    },
    run: async (args) => {
      const approve = args.decision === "approve";
      const path = args.kind === "plan"
        ? `/${approve ? "approve-plan" : "deny-plan"}/${args.id}`
        : `/${approve ? "approve" : "deny"}/${args.id}`;
      const r = await api(path, { method: "POST", body: {} });
      if (!r.ok) throw new Error(`No pending ${args.kind} with id "${args.id}" — it may already be resolved. Check pending_approvals.`);
      return JSON.stringify(r, null, 2);
    },
  },
  {
    name: "set_autonomy",
    description:
      "Set company autonomy mode: \"assisted\" (org plans wait for human approval before agents spawn), \"supervised\" (default — spawns proceed, flagged detections still pause for a human), or \"autonomous\" (flagged detections auto-approve; critical blocks still stop everything). Confirm with the user before switching to autonomous.",
    inputSchema: {
      type: "object",
      properties: { mode: { type: "string", enum: ["assisted", "supervised", "autonomous"] } },
      required: ["mode"],
    },
    run: async (args) => JSON.stringify(await api("/autonomy", { method: "POST", body: { mode: args.mode } }), null, 2),
  },
  {
    name: "run_security_demo",
    description:
      "Red-team demo: feed a poisoned document (prompt injection + exfiltration attempt) to the research agent's ingestion gate. The SecurityGate flags it, the agent goes blocked, and a real escalation appears — walk the user through what fired and let THEM approve/deny. Requires a research agent to exist (launch a goal first).",
    inputSchema: {
      type: "object",
      properties: { text: { type: "string", description: "Custom poisoned payload (optional — a default injection is used if omitted)" } },
    },
    run: async (args) => {
      const r = await api("/attack", { method: "POST", body: { text: args?.text } });
      if (!r.ok) return r.error ?? "No research agent exists yet — launch a goal first (launch_goal), wait for the org to spawn, then retry.";
      return JSON.stringify({ ...r, note: "Escalation raised — show the user pending_approvals and explain the scan categories. Even if approved, the OpenShell egress policy independently blocks the exfil host (defense in depth)." }, null, 2);
    },
  },
  {
    name: "latest_eval_report",
    description:
      "Latest Instruction-Following Ladder run: which models cleared which tiers (format -> structured -> constraint -> adversarial -> long-horizon), CSR/ISR scores, and each model's breaking point. Use it to explain which model+backend is demo-safe for workers.",
    inputSchema: { type: "object", properties: {} },
    run: async () => {
      const runs = await api("/api/eval-runs");
      if (!runs.length) return `No eval runs found. Run one with \`npm run eval\`; results render at ${BASE}/evals.`;
      return `Full report: ${BASE}/evals\n\n${JSON.stringify(runs[0], null, 2).slice(0, 6000)}`;
    },
  },
  {
    name: "system_check",
    description:
      "Run the full system self-check (same checks as the /setup page and `npm run doctor`): environment, network, and LIVE validation of every saved key — it catches keys that are pasted but rejected, expired, or out of credit. Call this whenever the user says something seems broken, stuck, or 'my key isn't working', and before a demo. Returns plain-English results with the exact fix per failing item.",
    inputSchema: {
      type: "object",
      properties: { live: { type: "boolean", description: "Really call the providers to test keys (default true)" } },
    },
    run: async (args) => JSON.stringify(await api(`/api/doctor${args?.live === false ? "?live=0" : ""}`), null, 2),
  },
  {
    name: "explain",
    description:
      "Explain how Agent-Maker works, for narrating to the user. Topics: overview (what this product is), security (the three defense layers), setup-chain (priority-ordered integrations), whats-real-vs-sim (honest labeling), architecture (CEO/Factory/bus/dashboard).",
    inputSchema: {
      type: "object",
      properties: { topic: { type: "string", enum: Object.keys(EXPLAIN) } },
      required: ["topic"],
    },
    run: async (args) => EXPLAIN[args.topic] ?? `Unknown topic. Available: ${Object.keys(EXPLAIN).join(", ")}`,
  },
];

// ---------------------------------------------------------------------------
// Stdio JSON-RPC transport (newline-delimited, per the MCP stdio spec)
// ---------------------------------------------------------------------------

const SERVER_INSTRUCTIONS = `You are connected to the user's Agent-Maker company — a self-expanding
agent company they own. Act as their concierge and guide:
1. Call get_started first. Welcome them and give them their dashboard link.
2. If they are not onboarded, interview them conversationally and call onboard_company.
3. Guide business setup via setup_status — but credentials are ALWAYS pasted in the dashboard,
   never in chat. Never ask the user for a secret value.
4. When work is running, poll company_status and narrate: who is working, what is real vs
   SIMULATION, what just finished, and anything blocked.
5. Surface pending approvals and explain them plainly; resolve only on the user's explicit decision.
6. Use explain(...) to answer "what is this / how does it work / is this safe" questions.`;

function send(msg: Record<string, unknown>) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

async function handle(req: any): Promise<void> {
  const { id, method, params } = req;
  const reply = (result: unknown) => send({ jsonrpc: "2.0", id, result });
  const fail = (code: number, message: string) => send({ jsonrpc: "2.0", id, error: { code, message } });

  switch (method) {
    case "initialize":
      return reply({
        protocolVersion: typeof params?.protocolVersion === "string" ? params.protocolVersion : "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "agent-maker", version: "0.1.0" },
        instructions: SERVER_INSTRUCTIONS,
      });
    case "notifications/initialized":
    case "notifications/cancelled":
      return; // notifications get no response
    case "ping":
      return reply({});
    case "tools/list":
      return reply({ tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
    case "tools/call": {
      const tool = TOOLS.find((t) => t.name === params?.name);
      if (!tool) return fail(-32602, `Unknown tool: ${params?.name}`);
      try {
        const text = await tool.run(params?.arguments ?? {});
        return reply({ content: [{ type: "text", text }], isError: false });
      } catch (err: any) {
        return reply({ content: [{ type: "text", text: `Error: ${err.message}` }], isError: true });
      }
    }
    case "resources/list":
      return reply({ resources: [] });
    case "prompts/list":
      return reply({ prompts: [] });
    default:
      if (id === undefined) return; // unknown notification — ignore
      return fail(-32601, `Method not found: ${method}`);
  }
}

// Exit when stdin closes — but only after in-flight tool calls have replied,
// or async responses (anything that awaits the dashboard API) get lost.
let inflight = 0;
let stdinClosed = false;
const maybeExit = () => { if (stdinClosed && inflight === 0) process.exit(0); };

const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
  if (!line.trim()) return;
  let req: any;
  try { req = JSON.parse(line); } catch { return console.error("[mcp] dropped unparseable line"); }
  inflight++;
  handle(req)
    .catch((err) => console.error(`[mcp] handler error: ${err.message}`))
    .finally(() => { inflight--; maybeExit(); });
});
rl.on("close", () => { stdinClosed = true; maybeExit(); });

console.error(`[mcp] agent-maker MCP server on stdio — dashboard: ${BASE}`);
