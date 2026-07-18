// Orchestrator — goal intake, clarifying questions, planning, and the demo
// work loop. The "brain" (goal → org plan) is scripted for now so the whole
// flow runs offline; swap `plan()` for a ModelBackend call (same interface as
// src/evals/backends.ts) once API/CLI auth is available. Everything else —
// bus, tasks, registry, dashboard — is the real pipeline.

import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import type { AgentRecord, AgentSpec, BusMessage, Goal, Task } from "../types.js";
import { bus } from "../bus/bus.js";
import { registry } from "../registry/registry.js";
import { createAgent } from "../factory/factory.js";
import { workerMode, runResearch, runStoreBuilder, runCopywriter, gateOrEscalate, type Product } from "../factory/worker.js";
import { escalations } from "../security/escalations.js";

const CEO_ID = "ceo-01";
const TICK_MS = 1200;

interface PlannedRole {
  spec: AgentSpec;
  title: string;
  estimateSec: number;
  dependsOnIndex: number[]; // indices into the same plan array
}

class Orchestrator extends EventEmitter {
  goals = new Map<string, Goal>();
  tasks = new Map<string, Task>();
  private ticker?: NodeJS.Timeout;
  private niche = new Map<string, string>();          // goalId -> niche
  private research = new Map<string, Product[]>();     // goalId -> research output
  private realRunning = new Set<string>();            // task ids executing a real worker
  private lastResearchId?: string;                    // most recent research agent (attack target)

  constructor() {
    super();
    bus.on("message", (m: BusMessage) => this.onMessage(m).catch(console.error));
  }

  snapshot() {
    return { goals: [...this.goals.values()], tasks: [...this.tasks.values()] };
  }

  // Red-team: feed a poisoned document to the research agent's ingestion gate.
  // Uses gateOrEscalate so the flow is identical to a real ingested source —
  // the gate flags it and a real, resolvable escalation is raised.
  async injectAttack(payload: string): Promise<{ ok: boolean; agentId?: string; allowed?: boolean }> {
    const agent = registry.get(this.lastResearchId ?? "") ?? registry.all().find((a) => a.spec.role === "research");
    if (!agent) return { ok: false };
    const threadId = [...this.tasks.values()].find((t) => t.agentId === agent.id)?.goalId ?? "company";
    bus.post({ threadId, from: "external-source", to: agent.id, kind: "finding", body: `Ingested document from research source: ${payload}` });
    const allowed = await gateOrEscalate(agent, payload, "ingested_document", threadId, "Poisoned document from external research source");
    if (allowed) bus.post({ threadId, from: agent.id, kind: "status", body: "Operator approved the ingested document — proceeding (note: OpenShell egress policy still blocks the exfil host independently)." });
    else bus.post({ threadId, from: agent.id, kind: "system", body: "Poisoned document quarantined. Defense in depth: even if approved, the OpenShell policy denies the evil.example egress host." });
    return { ok: true, agentId: agent.id, allowed };
  }

  private ensureCeo() {
    if (registry.get(CEO_ID)) return;
    const record: AgentRecord = {
      id: CEO_ID,
      spec: { role: "ceo", name: "ceo-01", objective: "Decompose goals, hire workers, report progress", tools: [], credentials: [], policyTemplate: "ceo.yaml" },
      identity: { name: "ceo-01", email: `ceo-01@${process.env.AGENT_EMAIL_DOMAIN ?? "agentcorp.dev"}`, issuedCredentials: {}, issuedAt: new Date().toISOString() },
      status: "waiting",
      parent: "user",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      log: [],
    };
    registry.upsert(record, "CEO online");
  }

  // --- goal intake ---

  async startGoal(text: string) {
    this.ensureCeo();
    const id = `goal-${randomUUID().slice(0, 6)}`;
    const goal: Goal = { id, text, status: "planning", threadId: id, createdAt: new Date().toISOString() };
    this.goals.set(id, goal);
    bus.post({ threadId: id, from: "user", kind: "chat", body: text });

    // Clarify before hiring: a store goal with no niche is underspecified.
    const storeLike = /store|shop|shopify|e-?commerce/i.test(text);
    const hasNiche = /\bfor\b\s+\S+/i.test(text);
    if (storeLike && !hasNiche) {
      goal.status = "clarifying";
      this.emitGoal(goal);
      bus.post({
        threadId: id, from: "ceo", kind: "question",
        body: "Hold up — before I hire anyone: which niche is this store for, and roughly how many products should we launch with? Reply here and I'll draft the org.",
      });
      return goal;
    }
    this.emitGoal(goal);
    await this.plan(goal);
    return goal;
  }

  private async onMessage(m: BusMessage) {
    if (m.from !== "user") return;

    // Answer to a pending clarification resumes planning.
    const goal = this.goals.get(m.threadId);
    if (goal && goal.status === "clarifying") {
      goal.text = `${goal.text} — ${m.body}`;
      goal.status = "planning";
      this.emitGoal(goal);
      bus.post({ threadId: goal.id, from: "ceo", kind: "chat", body: `Got it. Drafting the org for: "${goal.text}".` });
      await this.plan(goal);
      return;
    }

    // Direct message to a worker: acknowledge and fold into its work.
    if (m.to && m.to !== CEO_ID && registry.get(m.to)) {
      const agent = registry.get(m.to)!;
      setTimeout(() => {
        bus.post({ threadId: m.threadId, from: agent.id, to: "user", kind: "chat", body: `Noted — factoring "${m.body}" into my current task.` });
        registry.upsert(agent, `User note received: ${m.body.slice(0, 60)}`);
      }, 900);
      return;
    }

    // Chat with no pending goal: the CEO nudges for a goal.
    if (m.threadId === "company" && !this.anyActiveGoal()) {
      bus.post({ threadId: "company", from: "ceo", kind: "chat", body: 'Give me a business goal (e.g. "launch a Shopify store for trending sneakers") and I\'ll hire the workforce.' });
    }
  }

  private anyActiveGoal() {
    return [...this.goals.values()].some((g) => g.status === "clarifying" || g.status === "planning" || g.status === "running");
  }

  // --- planning (scripted brain; swap for a ModelBackend call later) ---

  private rolesFor(goal: Goal): PlannedRole[] {
    // Niche: prefer "for X", else the clarification answer (text after the last
    // "—", first comma-chunk), else a generic fallback.
    const forMatch = goal.text.match(/\bfor\b\s+(.+?)(?:\s*—|$)/i)?.[1];
    const answer = goal.text.split("—").length > 1 ? goal.text.split("—").pop()!.split(",")[0] : undefined;
    const niche = (forMatch ?? answer ?? "the target market").trim();
    if (/store|shop|shopify|e-?commerce/i.test(goal.text)) {
      return [
        {
          title: `Research: best-selling ${niche} products & competitors`,
          estimateSec: 28, dependsOnIndex: [],
          spec: { role: "research", name: `research-${goal.id.slice(5)}`, objective: `Find 10 trending ${niche} products with prices, images and competitor positioning`, tools: ["apify", "web-fetch"], credentials: ["APIFY_TOKEN"], policyTemplate: "worker-research.yaml" },
        },
        {
          title: "Build: products & collections in the dev store",
          estimateSec: 40, dependsOnIndex: [0],
          spec: { role: "store-builder", name: `builder-${goal.id.slice(5)}`, objective: "Create products, collections and theme settings in the Shopify dev store from research output", tools: ["shopify-admin"], credentials: ["SHOPIFY_ADMIN_TOKEN"], policyTemplate: "worker-storebuilder.yaml" },
        },
        {
          title: `Copy: descriptions & brand voice for ${niche}`,
          estimateSec: 22, dependsOnIndex: [0],
          spec: { role: "copywriter", name: `copy-${goal.id.slice(5)}`, objective: `Write product descriptions and store copy for ${niche}`, tools: [], credentials: [], policyTemplate: "worker-minimal.yaml" },
        },
      ];
    }
    // Generic goal: research + analyst.
    return [
      {
        title: `Research: ${goal.text.slice(0, 60)}`,
        estimateSec: 25, dependsOnIndex: [],
        spec: { role: "research", name: `research-${goal.id.slice(5)}`, objective: `Research and gather sources for: ${goal.text}`, tools: ["web-fetch"], credentials: [], policyTemplate: "worker-research.yaml" },
      },
      {
        title: "Synthesize findings into a brief",
        estimateSec: 20, dependsOnIndex: [0],
        spec: { role: "analyst", name: `analyst-${goal.id.slice(5)}`, objective: `Turn research findings into an actionable brief for: ${goal.text}`, tools: [], credentials: [], policyTemplate: "worker-minimal.yaml" },
      },
    ];
  }

  private async plan(goal: Goal) {
    const roles = this.rolesFor(goal);
    this.niche.set(goal.id, (goal.text.match(/\bfor\b\s+(.+?)(?:\s*—|$)/i)?.[1] ?? goal.text.split("—").pop() ?? "the target market").trim());
    bus.post({
      threadId: goal.id, from: "ceo", kind: "status",
      body: `Org plan: ${roles.map((r, i) => `${i + 1}) ${r.spec.name} — ${r.title}`).join("  ")}. Hiring now.`,
    });

    const taskIds: string[] = [];
    for (const role of roles) {
      const record = await createAgent(role.spec, CEO_ID);
      if (role.spec.role === "research") this.lastResearchId = record.id;
      const mode = workerMode(role.spec.role);
      const task: Task = {
        id: `task-${randomUUID().slice(0, 6)}`,
        goalId: goal.id,
        title: role.title,
        agentId: record.id,
        status: "pending",
        progress: 0,
        estimateSec: role.estimateSec,
        dependsOn: role.dependsOnIndex.map((i) => taskIds[i]),
        mode,
      };
      taskIds.push(task.id);
      this.tasks.set(task.id, task);
      this.emitTask(task);
      if (task.dependsOn.length > 0) {
        record.status = "waiting";
        registry.upsert(record, `Waiting on ${task.dependsOn.length} upstream task(s)`);
      }
    }
    goal.status = "running";
    this.emitGoal(goal);
    this.startTicker();
  }

  // --- the demo work loop ---

  private startTicker() {
    if (this.ticker) return;
    this.ticker = setInterval(() => this.tick(), TICK_MS);
  }

  private tick() {
    let anyActive = false;
    for (const task of this.tasks.values()) {
      if (task.status === "pending") {
        anyActive = true;
        const ready = task.dependsOn.every((d) => this.tasks.get(d)?.status === "done");
        if (ready) this.startTask(task);
      } else if (task.status === "running") {
        anyActive = true;
        if (task.mode !== "real") this.advance(task); // real tasks drive their own progress
      }
    }
    if (this.realRunning.size > 0) anyActive = true;
    if (!anyActive && this.ticker) {
      clearInterval(this.ticker);
      this.ticker = undefined;
    }
  }

  private startTask(task: Task) {
    task.status = "running";
    task.startedAt = new Date().toISOString();
    this.emitTask(task);
    const agent = task.agentId ? registry.get(task.agentId) : undefined;
    if (agent) {
      agent.status = "working";
      registry.upsert(agent, `Task started (${task.mode}): ${task.title}`);
      const upstream = task.dependsOn.map((d) => this.tasks.get(d)?.agentId).filter(Boolean);
      const intro = upstream.length
        ? `Picking up ${upstream.join(" & ")}'s output — starting: ${task.title}`
        : `Starting: ${task.title}`;
      bus.post({ threadId: task.goalId, from: agent.id, to: upstream[0], kind: "status", body: intro });
    }
    if (task.mode === "real" && agent) this.runReal(task, agent);
  }

  private async runReal(task: Task, agent: AgentRecord) {
    this.realRunning.add(task.id);
    const onProgress = (p: number) => { task.progress = Math.max(task.progress, Math.min(99, p)); this.emitTask(task); };
    try {
      const niche = this.niche.get(task.goalId) ?? "the target market";
      if (agent.spec.role === "research") {
        const products = await runResearch(agent, task, niche, onProgress);
        this.research.set(task.goalId, products);
        task.outputData = products;
        task.output = `${products.length} live products`;
      } else if (agent.spec.role === "store-builder") {
        const url = await runStoreBuilder(agent, task, this.research.get(task.goalId) ?? [], onProgress);
        task.output = url;
      } else if (agent.spec.role === "copywriter") {
        task.output = await runCopywriter(agent, task, niche, this.research.get(task.goalId) ?? [], onProgress);
      }
      this.completeTask(task, agent, "done");
    } catch (err: any) {
      task.status = "failed";
      task.finishedAt = new Date().toISOString();
      agent.status = "failed";
      registry.upsert(agent, `Task failed: ${err.message}`);
      bus.post({ threadId: task.goalId, from: agent.id, kind: "system", body: `Task failed: ${err.message}` });
      this.emitTask(task);
      this.maybeFinishGoal(task.goalId);
    } finally {
      this.realRunning.delete(task.id);
    }
  }

  private completeTask(task: Task, agent: AgentRecord, _status: "done") {
    task.progress = 100;
    task.status = "done";
    task.finishedAt = new Date().toISOString();
    agent.status = "done";
    registry.upsert(agent, `Task complete: ${task.title}`);
    this.emitTask(task);
    this.maybeFinishGoal(task.goalId);
  }

  private advance(task: Task) {
    const step = (100 / (task.estimateSec / (TICK_MS / 1000))) * (0.7 + Math.random() * 0.6);
    const before = task.progress;
    task.progress = Math.min(100, task.progress + step);
    const agent = task.agentId ? registry.get(task.agentId) : undefined;

    const crossed = (mark: number) => before < mark && task.progress >= mark;
    if (agent && crossed(40)) {
      bus.post({ threadId: task.goalId, from: agent.id, kind: "finding", body: this.milestoneMsg(agent, task, "mid") });
    }
    if (task.progress >= 100) {
      task.status = "done";
      task.finishedAt = new Date().toISOString();
      if (agent) {
        agent.status = "done";
        registry.upsert(agent, `Task complete: ${task.title}`);
        bus.post({ threadId: task.goalId, from: agent.id, kind: "finding", body: this.milestoneMsg(agent, task, "done") });
      }
      this.maybeFinishGoal(task.goalId);
    }
    this.emitTask(task);
  }

  private milestoneMsg(agent: AgentRecord, task: Task, phase: "mid" | "done"): string {
    const peers = [...this.tasks.values()]
      .filter((t) => t.goalId === task.goalId && t.dependsOn.includes(task.id))
      .map((t) => t.agentId)
      .filter(Boolean);
    switch (agent.spec.role) {
      case "research":
        return phase === "mid"
          ? "Signal so far: 3 product clusters trending up 30d; margins look best in the mid-price band. Full shortlist coming."
          : `Research complete — 10 products with prices, images and positioning posted to this thread${peers.length ? ` for ${peers.join(" & ")}` : ""}.`;
      case "store-builder":
        return phase === "mid"
          ? "6/10 products created, 2 collections up; wiring images and variants now."
          : "Store populated: 10 products, 3 collections, theme configured. Preview: https://agentcorp-dev.myshopify.com";
      case "copywriter":
        return phase === "mid"
          ? "Brand voice locked; 5/10 descriptions drafted."
          : "Copy delivered for all 10 products plus homepage hero.";
      default:
        return phase === "mid" ? "Halfway — interim notes posted." : `Done: ${task.title}`;
    }
  }

  private maybeFinishGoal(goalId: string) {
    const goal = this.goals.get(goalId);
    if (!goal) return;
    const tasks = [...this.tasks.values()].filter((t) => t.goalId === goalId);
    if (!tasks.every((t) => t.status === "done" || t.status === "failed")) return;
    if (tasks.some((t) => t.status === "failed")) {
      goal.status = "failed";
      this.emitGoal(goal);
      bus.post({ threadId: goalId, from: "ceo", kind: "status", body: `Goal halted — a worker failed or was denied. See the thread.` });
      const ceoRec = registry.get(CEO_ID);
      if (ceoRec) { ceoRec.status = "waiting"; registry.upsert(ceoRec, `Goal failed: ${goal.text.slice(0, 60)}`); }
      return;
    }
    goal.status = "done";
    const builderUrl = tasks.find((t) => registry.get(t.agentId ?? "")?.spec.role === "store-builder")?.output;
    goal.deliverable = builderUrl ?? (/store|shop/i.test(goal.text) ? "https://agentcorp-dev.myshopify.com (simulated)" : "Brief posted in thread");
    this.emitGoal(goal);
    const ceo = registry.get(CEO_ID);
    if (ceo) { ceo.status = "waiting"; registry.upsert(ceo, `Goal complete: ${goal.text.slice(0, 60)}`); }
    bus.post({
      threadId: goalId, from: "ceo", kind: "status",
      body: `Goal complete. Deliverable: ${goal.deliverable}. Workforce of ${tasks.length} finished in ${this.elapsed(tasks)}s (est ${tasks.reduce((s, t) => s + t.estimateSec, 0)}s).`,
    });
  }

  private elapsed(tasks: Task[]): number {
    const starts = tasks.map((t) => +new Date(t.startedAt ?? 0)).filter(Boolean);
    const ends = tasks.map((t) => +new Date(t.finishedAt ?? 0)).filter(Boolean);
    if (!starts.length || !ends.length) return 0;
    return Math.round((Math.max(...ends) - Math.min(...starts)) / 1000);
  }

  reset() {
    if (this.ticker) { clearInterval(this.ticker); this.ticker = undefined; }
    this.tasks.clear();
    this.goals.clear();
    this.niche.clear();
    this.research.clear();
    this.realRunning.clear();
    escalations.clear();
    bus.clear();
    registry.clear();
  }

  private emitTask(task: Task) { this.emit("task", task); }
  private emitGoal(goal: Goal) { this.emit("goal", goal); }
}

export const orchestrator = new Orchestrator();
