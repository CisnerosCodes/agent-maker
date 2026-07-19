// Orchestrator — goal intake, clarifying questions, planning, and the demo
// work loop. The "brain" (goal → org plan) is scripted for now so the whole
// flow runs offline; swap `plan()` for a ModelBackend call (same interface as
// src/evals/backends.ts) once API/CLI auth is available. Everything else —
// bus, tasks, registry, dashboard — is the real pipeline.

import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import type { AgentRecord, AgentSpec, AgentStatus, BusMessage, Goal, PlanApproval, Task } from "../types.js";
import { governance } from "../governance/governance.js";
import { bus } from "../bus/bus.js";
import { registry } from "../registry/registry.js";
import { createAgent, endAgentSession, terminateAgent } from "../factory/factory.js";
import { clearRevocations } from "../vault/vault.js";
import { validateSpawn, type SpawnDecision } from "../security/spawn-authority.js";
import { workerMode, runResearch, runStoreBuilder, runCopywriter, runGenericRole, gateOrEscalate, type Product } from "../factory/worker.js";
import { escalations } from "../security/escalations.js";
import { runMemory, type RunRecord } from "../memory/runs.js";
import { missingFor } from "../config/env.js";
import { companyProfile, clearCompanyProfile } from "../config/company.js";
import { friendlyError } from "../config/errors.js";
import { matchPlaybook, milestoneFor } from "../roles/library.js";
import { nicheFor } from "../config/niche.js";

const CEO_ID = "ceo-01";
const TICK_MS = 1200;
// CEO heartbeat: slower, separate clock that stays alive while ANY goal is active
// (not just active tasks). Reacts to blocked/failed/done transitions.
const HEARTBEAT_MS = 5000;

interface PlannedRole {
  spec: AgentSpec;
  title: string;
  estimateSec: number;
  dependsOnIndex: number[]; // indices into the same plan array
}

export class Orchestrator extends EventEmitter {
  goals = new Map<string, Goal>();
  tasks = new Map<string, Task>();
  private ticker?: NodeJS.Timeout;
  private heartbeat?: NodeJS.Timeout;
  private heartbeatFirstTick = true;
  private niche = new Map<string, string>();          // goalId -> niche
  private research = new Map<string, Product[]>();     // goalId -> research output
  private realRunning = new Set<string>();            // task ids executing a real worker
  private lastResearchId?: string;                    // most recent research agent (attack target)
  private recalled = new Map<string, RunRecord>();    // goalId -> prior run being reused
  private runNumber = new Map<string, number>();      // goalId -> run number for its niche
  private pendingPlans = new Map<string, PlanApproval>();       // goalId -> plan awaiting approval
  private planResolvers = new Map<string, (ok: boolean) => void>();

  constructor() {
    super();
    bus.on("message", (m: BusMessage) => this.onMessage(m).catch(console.error));
  }

  snapshot() {
    return {
      goals: [...this.goals.values()],
      tasks: [...this.tasks.values()],
      runs: runMemory.all(),
      autonomyMode: governance.mode,
      pendingPlans: [...this.pendingPlans.values()],
    };
  }

  resolvePlan(goalId: string, ok: boolean): boolean {
    const resolve = this.planResolvers.get(goalId);
    if (!resolve) return false;
    this.planResolvers.delete(goalId);
    resolve(ok);
    return true;
  }

  // Red-team: feed a poisoned document to the research agent's ingestion gate.
  // Uses gateOrEscalate so the flow is identical to a real ingested source —
  // the gate flags it and a real, resolvable escalation is raised.
  //
  // Returns IMMEDIATELY (the escalation resolves later via the approve/deny
  // buttons). Awaiting the human here made the HTTP POST /attack — and the MCP
  // run_security_demo tool call — hang until someone clicked, which read as
  // "the button does nothing".
  async injectAttack(payload: string): Promise<{ ok: boolean; agentId?: string; error?: string }> {
    const agent = registry.get(this.lastResearchId ?? "") ?? registry.all().find((a) => a.spec.role === "research");
    if (!agent) return { ok: false, error: "No research agent exists yet — launch a goal first (the attack targets the research agent's ingestion gate)." };
    const threadId = [...this.tasks.values()].find((t) => t.agentId === agent.id)?.goalId ?? "company";
    const wasStatus = agent.status;
    bus.post({ threadId, from: "external-source", to: agent.id, kind: "finding", body: `Ingested document from research source: ${payload}` });
    // Fire and forget: the decision continuation runs when the human clicks.
    gateOrEscalate(agent, payload, "ingested_document", threadId, "Poisoned document from external research source")
      .then((allowed) => {
        if (allowed) {
          bus.post({ threadId, from: agent.id, kind: "status", body: "Operator approved the ingested document — proceeding (note: OpenShell egress policy still blocks the exfil host independently)." });
        } else {
          bus.post({ threadId, from: agent.id, kind: "system", body: "Poisoned document quarantined. Defense in depth: even if approved, the OpenShell policy denies the evil.example egress host." });
        }
        // Either way the demo attack is OVER — the agent goes back to what it
        // was doing. Leaving it "blocked" after a deny left zombie rows with
        // approve/deny buttons that had nothing left to resolve.
        if (agent.status === "blocked") {
          agent.status = wasStatus === "blocked" ? "waiting" : wasStatus;
          registry.upsert(agent, "Back to previous status after attack demo resolution");
        }
      })
      .catch((err) => console.error(`[attack] ${err.message}`));
    return { ok: true, agentId: agent.id };
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

    // Concurrency refusal (factory-provisioning §6, C16): one company, one job at
    // a time for the demo. A second goal would spawn a second agent record per
    // role sharing ONE per-role sandbox + niche-keyed run memory — a live race on
    // shared state, on stage. Refuse honestly and keep the active goal running.
    const active = [...this.goals.values()].find((g) => g.status === "clarifying" || g.status === "planning" || g.status === "awaiting-approval" || g.status === "running");
    if (active) {
      bus.post({
        threadId: "company", from: "ceo", kind: "chat",
        body: `Let me finish the current goal first — one company, one job at a time for this demo. I'm still on "${active.text.slice(0, 80)}". Ask again once it wraps and I'll staff the next one.`,
      });
      return active;
    }

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
    return [...this.goals.values()].some(
      (g) => g.status === "clarifying" || g.status === "planning" || g.status === "awaiting-approval" || g.status === "running"
    );
  }

  // --- planning: select a playbook from the role library, instantiate roles ---
  // (keyword match today; swap matchPlaybook for a ModelBackend classifier to
  //  compose roles for off-script goals.)

  private rolesFor(goal: Goal): PlannedRole[] {
    const niche = nicheFor(goal.text);
    const suffix = goal.id.slice(5);
    const ctx = { goalText: goal.text, niche, idSuffix: suffix };
    const playbook = matchPlaybook(goal.text);
    return playbook.roles.map((r) => ({
      title: r.titleFor(ctx),
      estimateSec: r.estimateSec,
      dependsOnIndex: r.dependsOn,
      spec: {
        role: r.role,
        name: `${r.role}-${suffix}`,
        objective: r.objectiveFor(ctx),
        tools: r.tools,
        credentials: r.credentials,
        policyTemplate: r.policyTemplate,
        reasoning: r.reasoning,
        handoff: r.handoff,
      },
    }));
  }

  // --- spawn-authority enforcement (the injected-goal defense) ---------------
  // Every AgentSpec the CEO emits is validated against the fixed spawn-authority
  // table (src/security/spawn-authority.ts) BEFORE the Factory's createAgent runs.
  // The broker is deterministic and non-LLM — its input is a struct — so a fully
  // prompt-injected CEO can only PROPOSE specs; it cannot talk the broker into
  // provisioning an out-of-authority agent. If ANY spec in the plan is refused the
  // WHOLE plan is refused: no agent is created (a compromised plan spawns zero
  // agents, and there is no partial fleet left with dangling task dependencies).
  // The broker logs + counts each denial itself; here we mirror it to the
  // bus/dashboard and surface an honest status line. This is what makes
  // ceo-sandbox.spec.md §5.1 real (ceo-brain-and-spawn-authority.spec.md §A).
  private authorizeRoles(goal: Goal, roles: PlannedRole[]): boolean {
    const denials: SpawnDecision[] = [];
    for (const role of roles) {
      const decision = validateSpawn(role.spec);
      if (!decision.allowed) denials.push(decision);
    }
    if (denials.length === 0) return true;

    for (const d of denials) {
      bus.post({
        threadId: goal.id, from: "ceo", kind: "system",
        body: `Spawn-authority broker DENIED role '${d.role}': ${d.reason}. No agent created.`,
      });
    }
    this.emit("spawnDenied", { goalId: goal.id, denials });
    goal.status = "failed";
    this.emitGoal(goal);
    bus.post({
      threadId: goal.id, from: "ceo", kind: "status",
      body: `Org plan refused — ${denials.length} spawn request(s) exceeded role authority; nothing hired. The spawn-authority broker is a deterministic host gate: a compromised planner may propose out-of-authority agents but cannot provision them.`,
    });
    const ceo = registry.get(CEO_ID);
    if (ceo) { ceo.status = "waiting"; registry.upsert(ceo, `Plan refused: ${denials.length} out-of-authority spawn(s) blocked`); }
    return false;
  }

  private async plan(goal: Goal) {
    const roles = this.rolesFor(goal);

    // Spawn-authority gate — refuse an out-of-authority plan BEFORE any profile
    // work, approval prompt, or hiring. A prompt-injected CEO gets no agents.
    if (!this.authorizeRoles(goal, roles)) return;

    const profile = companyProfile();
    const niche = nicheFor(goal.text);
    this.niche.set(goal.id, niche);
    this.runNumber.set(goal.id, runMemory.runNumberFor(niche));

    // Company-aware planning: acknowledge what they already have so the org
    // works WITH their business instead of assuming a blank one.
    if (profile) {
      const notes: string[] = [];
      if (profile.hasStore && roles.some((r) => r.spec.role === "store-builder"))
        notes.push(`you already have a store${profile.storeUrl ? ` (${profile.storeUrl})` : ""} — the store-builder will ADD to it, not start over (paste its admin token in BUSINESS SETUP to make that real)`);
      if (profile.hasContext) notes.push("your context notes are on file and will inform research");
      if (notes.length) bus.post({ threadId: goal.id, from: "ceo", kind: "status", body: `Noted from your company profile: ${notes.join("; ")}.` });
    }

    // Guided setup: tell the operator up front which credentials would make
    // this run fully real, with links — then proceed honestly either way.
    // Links + labels only; no secret values ever touch the bus.
    const missing = missingFor(roles.map((r) => r.spec.role));
    if (missing.length) {
      bus.post({
        threadId: goal.id, from: "ceo", kind: "status",
        body: `While I staff this: to make every step fully REAL, connect in BUSINESS SETUP (left panel): ${missing.map((m) => `${m.label} — get it at ${m.link}`).join("  ·  ")}. I'll run the unconnected parts as labeled simulation and they flip real the moment you paste the key.`,
      });
    }

    // Recursive intelligence: if we've researched this niche before, recall it
    // and skip the re-scrape. This is what makes run 2 measurably faster.
    // MEMORY_RETRIEVAL=off disables recall (C5) so the causal test can show the
    // run-2 delta collapses without the mechanism. Advisory only — retrieval is
    // context, never hard control flow.
    const retrievalOff = process.env.MEMORY_RETRIEVAL === "off";
    const prior = retrievalOff ? undefined : runMemory.recall(niche);
    if (retrievalOff) bus.post({ threadId: goal.id, from: "ceo", kind: "status", body: "Run-memory retrieval DISABLED (MEMORY_RETRIEVAL=off) — researching from scratch for the causal test." });
    if (prior && prior.products.length > 0) {
      this.recalled.set(goal.id, prior);
      this.research.set(goal.id, prior.products);
      bus.post({
        threadId: goal.id, from: "ceo", kind: "status",
        body: `Run #${this.runNumber.get(goal.id)} for "${niche}". I already researched this market in ${prior.runId} (${prior.products.length} products, ${prior.researchSec}s). Reusing those findings — skipping re-research.`,
      });
    }

    // Autonomy dial — plan gate. In assisted mode the CEO proposes the org and
    // WAITS for operator approval before spawning. In supervised/autonomous it
    // proceeds. Containment is unaffected either way.
    if (governance.planGate()) {
      bus.post({
        threadId: goal.id, from: "ceo", kind: "question",
        body: `Org plan for approval (assisted mode): ${roles.map((r, i) => `${i + 1}) ${r.spec.name} — ${r.title}`).join("  ")}. Approve to hire.`,
      });
      goal.status = "awaiting-approval";
      this.emitGoal(goal);
      const approval: PlanApproval = { goalId: goal.id, goalText: goal.text, roles: roles.map((r) => ({ name: r.spec.name, role: r.spec.role, title: r.title })) };
      this.pendingPlans.set(goal.id, approval);
      this.emit("planApproval", approval);
      const ok = await new Promise<boolean>((resolve) => this.planResolvers.set(goal.id, resolve));
      this.pendingPlans.delete(goal.id);
      this.emit("planApproval", { ...approval, resolved: true } as any);
      if (!ok) {
        goal.status = "failed";
        this.emitGoal(goal);
        bus.post({ threadId: goal.id, from: "ceo", kind: "status", body: `Org plan denied by operator — no agents hired.` });
        return;
      }
      bus.post({ threadId: goal.id, from: "ceo", kind: "status", body: `Plan approved — hiring now.` });
    } else {
      bus.post({
        threadId: goal.id, from: "ceo", kind: "status",
        body: `Org plan: ${roles.map((r, i) => `${i + 1}) ${r.spec.name} — ${r.title}`).join("  ")}. Hiring now.`,
      });
    }

    const taskIds: string[] = [];
    for (const role of roles) {
      // Mint the task id FIRST so the Factory can key the sandbox session on it
      // (factory-provisioning §2: session == taskId, isolated per-task workdir).
      const taskId = `task-${randomUUID().slice(0, 6)}`;
      // Every role.spec reaching here passed the spawn-authority broker
      // (authorizeRoles, at the top of plan()) — createAgent never runs on an
      // out-of-authority spec.
      const record = await createAgent(role.spec, CEO_ID, taskId);
      if (role.spec.role === "research") this.lastResearchId = record.id;
      const mode = workerMode(role.spec.role);
      const task: Task = {
        id: taskId,
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
      // Honest provisioning failure (factory-provisioning §4): a vault miss or an
      // unhealthy sandbox returns a `failed` record instead of throwing. Fail the
      // task so the tick() cascade + maybeFinishGoal halt the goal — do NOT
      // overwrite it back to `waiting`, and do NOT crash the hire loop (other
      // agents still provision).
      if (record.status === "failed") {
        task.status = "failed";
        task.finishedAt = new Date().toISOString();
        bus.post({ threadId: goal.id, from: "ceo", kind: "system", body: `Could not provision ${role.spec.name} — ${record.log[record.log.length - 1]?.message ?? "provisioning failed"}. Skipping; the goal will halt if this agent was required.` });
      }
      this.tasks.set(task.id, task);
      this.emitTask(task);
      if (record.status !== "failed" && task.dependsOn.length > 0) {
        record.status = "waiting";
        registry.upsert(record, `Waiting on ${task.dependsOn.length} upstream task(s)`);
      }
    }
    goal.status = "running";
    this.emitGoal(goal);
    this.startTicker();
    this.startHeartbeat();
  }

  // --- the demo work loop ---

  private startTicker() {
    if (this.ticker) return;
    this.ticker = setInterval(() => this.tick(), TICK_MS);
  }

  // --- CEO heartbeat: separate clock that reconciles agent state ---
  // Runs every HEARTBEAT_MS while ANY goal is active (not just tasks).
  // Reacts to blocked/failed/done transitions. Idempotent via lastHandledStatus.
  // First tick sweeps stale non-terminal boot records (C14).
  private startHeartbeat() {
    if (this.heartbeat) return;
    this.heartbeat = setInterval(() => this.heartbeatTick(), HEARTBEAT_MS);
  }

  private stopHeartbeat() {
    if (this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = undefined;
    }
  }

  private async heartbeatTick() {
    // If no active goals, stop the heartbeat
    if (!this.anyActiveGoal()) {
      this.stopHeartbeat();
      return;
    }

    const agents = registry.all().filter((a) => a.spec.role !== "ceo");

    // First tick: boot-time stale record sweep (C14)
    if (this.heartbeatFirstTick) {
      this.heartbeatFirstTick = false;
      await this.sweepStaleBootRecords(agents);
    }

    // Normal reconcile: react to status transitions
    for (const agent of agents) {
      const lastHandled = agent.lastHandledStatus;
      const current = agent.status;

      // Only react on transition
      if (lastHandled === current) continue;

      // Update lastHandledStatus BEFORE acting (idempotent even if action throws)
      agent.lastHandledStatus = current;
      registry.upsert(agent, `CEO heartbeat observed status: ${current}`);

      // React to the new status
      await this.handleAgentStatusTransition(agent, current);
    }
  }

  // Sweep stale non-terminal records loaded from registry.json at boot (C14).
  // A pre-existing `blocked` with no live escalation → failed/terminated.
  // A pre-existing `working` whose sandbox is dead → failed.
  private async sweepStaleBootRecords(agents: AgentRecord[]) {
    for (const agent of agents) {
      const inFlight = ["provisioning", "starting", "working", "blocked"] as AgentStatus[];
      if (!inFlight.includes(agent.status)) continue;

      // Stale blocked: no live escalation for this agent
      if (agent.status === "blocked") {
        const pendingEsc = escalations.pending().find((e) => e.agentId === agent.id);
        if (!pendingEsc) {
          agent.status = "failed";
          registry.upsert(agent, "Boot sweep: stale blocked with no live escalation → failed");
          bus.post({ threadId: "company", from: "ceo", kind: "status", body: `Boot sweep: ${agent.id} was blocked with no pending escalation — marked failed.` });
        }
        continue;
      }

      // Stale working: check if the agent has a live task
      if (agent.status === "working") {
        const hasLiveTask = [...this.tasks.values()].some(
          (t) => t.agentId === agent.id && (t.status === "pending" || t.status === "running")
        );
        if (!hasLiveTask) {
          agent.status = "failed";
          registry.upsert(agent, "Boot sweep: stale working with no live task → failed");
          bus.post({ threadId: "company", from: "ceo", kind: "status", body: `Boot sweep: ${agent.id} was working with no task — marked failed.` });
        }
        continue;
      }

      // Stale provisioning/starting: check sandbox health (via Factory health gate)
      if (agent.status === "provisioning" || agent.status === "starting") {
        // If it's from a previous session, it has no live task → fail
        const hasLiveTask = [...this.tasks.values()].some((t) => t.agentId === agent.id);
        if (!hasLiveTask) {
          agent.status = "failed";
          registry.upsert(agent, `Boot sweep: stale ${agent.status} with no task → failed`);
          bus.post({ threadId: "company", from: "ceo", kind: "status", body: `Boot sweep: ${agent.id} was ${agent.status} with no task — marked failed.` });
        }
      }
    }
  }

  // Handle a single agent's status transition. Posts one CEO status line per transition.
  private async handleAgentStatusTransition(agent: AgentRecord, newStatus: AgentStatus) {
    const goalId = this.findGoalIdForAgent(agent.id);
    const threadId = goalId ?? "company";

    switch (newStatus) {
      case "blocked": {
        // Agent entered blocked (new escalation or first observation)
        const esc = escalations.pending().find((e) => e.agentId === agent.id);
        const reason = esc ? esc.reason : "security escalation";
        bus.post({
          threadId,
          from: "ceo",
          kind: "status",
          body: `${agent.id} is blocked on a security escalation (${reason}) — holding downstream tasks until operator decides.`,
        });
        break;
      }

      case "failed": {
        // Agent task failed — halt dependent tasks and report
        bus.post({
          threadId,
          from: "ceo",
          kind: "status",
          body: `${agent.id} failed — halting dependent tasks for this goal.`,
        });
        // The task ticker's maybeFinishGoal will handle goal finalization
        if (goalId) this.maybeFinishGoal(goalId);
        break;
      }

      case "done": {
        // Agent completed — check if all peers are done to finalize goal
        bus.post({
          threadId,
          from: "ceo",
          kind: "status",
          body: `${agent.id} completed its task.`,
        });
        if (goalId) this.maybeFinishGoal(goalId);
        break;
      }

      case "terminated": {
        // Agent terminated (e.g., after escalation denied)
        bus.post({
          threadId,
          from: "ceo",
          kind: "status",
          body: `${agent.id} terminated — task session ended.`,
        });
        break;
      }
    }
  }

  // Find the goalId for an agent by looking at tasks
  private findGoalIdForAgent(agentId: string): string | undefined {
    const task = [...this.tasks.values()].find((t) => t.agentId === agentId);
    return task?.goalId;
  }

  private tick() {
    let anyActive = false;
    for (const task of this.tasks.values()) {
      if (task.status === "pending") {
        anyActive = true;
        // A failed dependency can never complete — cascade the failure so the
        // goal finishes instead of the dependent task waiting forever (which
        // left the goal stuck "running" and the ticker spinning for good).
        const upstreamFailed = task.dependsOn.some((d) => this.tasks.get(d)?.status === "failed");
        if (upstreamFailed) {
          task.status = "failed";
          task.finishedAt = new Date().toISOString();
          const agent = task.agentId ? registry.get(task.agentId) : undefined;
          if (agent) {
            // Terminate = session workdir wiped + identity revoked (§5), not just
            // a status flip, so a skipped agent leaves no session data behind.
            terminateAgent(agent, "Skipped — an upstream task failed, nothing to build on");
            bus.post({ threadId: task.goalId, from: agent.id, kind: "system", body: `Skipping "${task.title}" — the task I depend on failed.` });
          }
          this.emitTask(task);
          this.maybeFinishGoal(task.goalId);
          continue;
        }
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
        const prior = this.recalled.get(task.goalId);
        let products: Product[];
        if (prior) {
          // Reuse path: cite prior run, no re-scrape. This is the speedup.
          products = prior.products;
          onProgress(60);
          bus.post({ threadId: task.goalId, from: agent.id, kind: "finding", body: `Reusing ${products.length} products from ${prior.runId} — no re-scrape needed. Prior lead picks still valid.` });
        } else {
          products = await runResearch(agent, task, niche, onProgress);
        }
        this.research.set(task.goalId, products);
        task.outputData = products;
        task.output = prior ? `${products.length} products (reused ${prior.runId})` : `${products.length} products`;
      } else if (agent.spec.role === "store-builder") {
        const url = await runStoreBuilder(agent, task, this.research.get(task.goalId) ?? [], onProgress);
        task.output = url;
      } else if (agent.spec.role === "copywriter") {
        task.output = await runCopywriter(agent, task, niche, this.research.get(task.goalId) ?? [], onProgress);
      } else {
        // Any other library role: generic gated artifact turn. Upstream task
        // outputs travel as named handoff sections (MetaGPT SOP-style).
        const upstream = task.dependsOn
          .map((d) => this.tasks.get(d))
          .filter((t): t is Task => Boolean(t))
          .map((t) => {
            const spec = t.agentId ? registry.get(t.agentId)?.spec : undefined;
            const data = typeof t.outputData === "string"
              ? t.outputData
              : t.outputData != null ? JSON.stringify(t.outputData).slice(0, 2000) : "";
            const output = (t.output && t.output.length >= data.length ? t.output : data) || t.output || "";
            return { role: spec?.role ?? "upstream", handoff: spec?.handoff, output };
          });
        task.output = await runGenericRole(agent, task, niche, upstream, onProgress);
        task.outputData = task.output;
      }
      this.completeTask(task, agent, "done");
    } catch (err: any) {
      task.status = "failed";
      task.finishedAt = new Date().toISOString();
      agent.status = "failed";
      const human = friendlyError(err.message);
      endAgentSession(agent); // §3: wipe the session workdir on failure
      registry.upsert(agent, `Task failed: ${human}`);
      bus.post({ threadId: task.goalId, from: agent.id, kind: "system", body: `Task failed: ${human}` });
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
    endAgentSession(agent); // §3: wipe the session workdir on completion
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
        endAgentSession(agent); // §3: wipe the session workdir on completion
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
    // C11: sim copy must tell the SAME story as the real path — counts come
    // from the actual research output, never invented.
    const found = this.research.get(task.goalId)?.length ?? 0;
    const built = Math.min(found || 3, 3); // real store-builder creates up to 3 products, 0 collections
    switch (agent.spec.role) {
      case "research":
        return phase === "mid"
          ? "Signal so far: product clusters trending up 30d; margins look best in the mid-price band. Full shortlist coming."
          : `Research complete — ${found || "a shortlist of"} products with prices, images and positioning posted to this thread${peers.length ? ` for ${peers.join(" & ")}` : ""}.`;
      case "store-builder":
        return phase === "mid"
          ? `${Math.max(built - 1, 1)}/${built} products created; wiring images and variants now.`
          : `Store populated: ${built} products, theme configured. Preview: https://agentcorp-dev.myshopify.com (simulated — connect Shopify in BUSINESS SETUP for a real build)`;
      case "copywriter":
        return phase === "mid"
          ? `Brand voice locked; descriptions in progress for ${found || built} products.`
          : `Copy delivered for ${found || built} products plus homepage hero.`;
      default: {
        // Library roles (software-shipping, seo, support, fact-check…) declare
        // their own sim-mode milestone copy; generic line only if none exists.
        const m = milestoneFor(agent.spec.role, this.niche.get(task.goalId) ?? "the target market");
        if (m) return phase === "mid" ? m.mid : m.done;
        return phase === "mid" ? "Halfway — interim notes posted." : `Done: ${task.title}`;
      }
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

    // Write this run back to memory (recursive intelligence) and report the delta.
    const niche = this.niche.get(goalId) ?? "the target market";
    const total = this.elapsed(tasks);
    const prior = this.recalled.get(goalId);
    const researchTask = tasks.find((t) => registry.get(t.agentId ?? "")?.spec.role === "research");
    const researchSec = prior ? 0 : this.taskElapsed(researchTask);
    const rec = runMemory.record({
      runId: `run-${goalId.slice(5)}`, goalId, niche, goalText: goal.text,
      products: this.research.get(goalId) ?? [], researchSec, totalSec: total,
      reusedFrom: prior?.runId,
    });
    this.emit("run", rec);

    let learnLine = "";
    if (prior) {
      const saved = Math.max(0, prior.totalSec - total);
      const researchBudget = researchTask?.estimateSec ?? 0;
      learnLine = ` Learning: reused ${prior.products.length} findings from ${prior.runId} — 0 re-scrapes, 0 research API calls, skipped the ${researchBudget}s research step. Total ${total}s vs ${prior.totalSec}s (${saved}s faster; the wall-clock gap grows with real scrape cost).`;
    }
    bus.post({
      threadId: goalId, from: "ceo", kind: "status",
      body: `Goal complete (run #${this.runNumber.get(goalId)} for "${niche}"). Deliverable: ${goal.deliverable}. Workforce of ${tasks.length} finished in ${total}s (est ${tasks.reduce((s, t) => s + t.estimateSec, 0)}s).${learnLine}`,
    });
  }

  private elapsed(tasks: Task[]): number {
    const starts = tasks.map((t) => +new Date(t.startedAt ?? 0)).filter(Boolean);
    const ends = tasks.map((t) => +new Date(t.finishedAt ?? 0)).filter(Boolean);
    if (!starts.length || !ends.length) return 0;
    return Math.round((Math.max(...ends) - Math.min(...starts)) / 1000);
  }

  private taskElapsed(task?: Task): number {
    if (!task?.startedAt || !task?.finishedAt) return 0;
    return Math.round((+new Date(task.finishedAt) - +new Date(task.startedAt)) / 1000);
  }

  // reset(wipeMemory): clears live state. Pass false to KEEP run memory so the
  // learning delta survives (run 1 then reset then run 2 still shows reuse).
  // Default true = full fresh demo.
  reset(wipeMemory = true) {
    if (this.ticker) { clearInterval(this.ticker); this.ticker = undefined; }
    if (this.heartbeat) { clearInterval(this.heartbeat); this.heartbeat = undefined; }
    this.heartbeatFirstTick = true;
    this.tasks.clear();
    this.goals.clear();
    this.niche.clear();
    this.research.clear();
    this.realRunning.clear();
    this.recalled.clear();
    this.runNumber.clear();
    this.pendingPlans.clear();
    this.planResolvers.forEach((r) => r(false));
    this.planResolvers.clear();
    this.lastResearchId = undefined;
    escalations.clear();
    clearRevocations(); // fresh identity-revocation ledger each demo
    if (wipeMemory) runMemory.clear();
    // Full reset re-runs onboarding: the intake questions (niche, what you
    // already have, starter team) are part of every fresh demo, not one-time
    // setup. keepMemory resets preserve the profile along with the learning.
    if (wipeMemory) clearCompanyProfile();
    bus.clear();
    registry.clear();
  }

  // Called once at server boot. The registry persists agents across restarts,
  // but tasks live in memory — so after a restart, agents can be stranded
  // showing "working"/"blocked" with no task behind them (zombie rows whose
  // buttons resolve nothing). Reconcile: any in-flight agent with no live task
  // is marked terminated with an honest log line.
  reconcileStaleAgents() {
    const inFlight = new Set(["provisioning", "starting", "working", "blocked"]);
    for (const agent of registry.all()) {
      if (agent.spec.role === "ceo") {
        if (agent.status !== "waiting") { agent.status = "waiting"; registry.upsert(agent, "Server restarted — CEO back to waiting"); }
        continue;
      }
      if (inFlight.has(agent.status) && ![...this.tasks.values()].some((t) => t.agentId === agent.id && (t.status === "pending" || t.status === "running"))) {
        // Stale in-flight record from a prior process: terminate it (wipe session
        // workdir + revoke identity, §5) rather than leave a zombie row.
        terminateAgent(agent, "Server restarted — this agent's task did not survive; hire again with a new goal");
      }
    }
  }

  private emitTask(task: Task) { this.emit("task", task); }
  private emitGoal(goal: Goal) { this.emit("goal", goal); }
}

export const orchestrator = new Orchestrator();
