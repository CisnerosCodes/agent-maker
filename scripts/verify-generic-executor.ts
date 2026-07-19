// Verify Tier 1.4 — generic worker executor + handoff contract.
// Proves worker-capability §6 acceptance within the worker/roles lane (no
// orchestrator wiring): the generic executor runs any role for real, a scratch
// role runs on promptFor+outputSchema alone, and empty handoffs halt honestly.
//
//   npx tsx scripts/verify-generic-executor.ts
//
// Uses a stub ModelBackend so the pipeline is exercised end-to-end offline; the
// point is that model I/O is ROUTED and VALIDATED generically, not canned.

import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";

// Keep bus/registry writes out of ./data.
process.env.REGISTRY_DIR = path.join(os.tmpdir(), `verify-exec-${randomUUID().slice(0, 6)}`);
process.env.SIM_MODE = "0";

const { executeRole, runCopywriter, validateOutput, assertHandoff, HandoffError, workerMode } = await import("../src/factory/worker.js");
const { matchPlaybook, roleTemplateFor } = await import("../src/roles/library.js");
const { bus } = await import("../src/bus/bus.js");
type RoleTemplate = import("../src/roles/library.js").RoleTemplate;
type PlanContext = import("../src/roles/library.js").PlanContext;
type ModelBackend = import("../src/evals/types.js").ModelBackend;
type AgentRecord = import("../src/types.js").AgentRecord;
type Task = import("../src/types.js").Task;

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
}

const noop = () => {};
const CANNED = ["Halfway — interim notes posted.", "Done:"]; // orchestrator milestoneMsg ghost text

function fakeAgent(role: string): AgentRecord {
  const now = new Date().toISOString();
  return {
    id: `agent-${role}-${randomUUID().slice(0, 4)}`,
    spec: { role, name: `${role}-01`, objective: "verify", tools: [], credentials: [], policyTemplate: "worker-minimal.yaml" },
    identity: { name: `${role}-01`, email: `${role}@x.dev`, issuedCredentials: {}, issuedAt: now },
    status: "working",
    parent: "ceo",
    createdAt: now,
    updatedAt: now,
    log: [],
  };
}
function fakeTask(goalId: string): Task {
  return { id: `task-${randomUUID().slice(0, 4)}`, goalId, title: "verify", status: "running", progress: 0, estimateSec: 10, dependsOn: [] };
}

const stubBrain: ModelBackend = {
  name: "stub",
  async complete(prompt) {
    return { text: `BRIEF// 3 takeaways + 2 actions derived from prompt starting "${prompt.slice(0, 32)}…"`, latencyMs: 1 };
  },
};

// ── Test 1: fallback playbook produces real model output (not canned) ────────
console.log("\n[1] Ghost-role kill — fallback playbook analyst runs REAL");
{
  const pb = matchPlaybook("research the drone market");
  const analyst = pb.roles.find((r) => r.role === "analyst")!;
  check("fallback playbook is market-research", pb.id === "market-research", pb.id);
  check("analyst has a real execution class", analyst.executionClass === "pure-LLM", analyst.executionClass);
  const goalId = "goal-fallback";
  const agent = fakeAgent("analyst");
  const task = fakeTask(goalId);
  const ctx: PlanContext = { goalText: "research the drone market", niche: "drone", idSuffix: "1" };
  const upstream = [{ title: "FPV racing drone", price: 129 }, { title: "camera drone", price: 499 }];
  const out = (await executeRole(agent, task, analyst, ctx, upstream, noop, { brain: stubBrain })) as string;
  check("analyst returned model output", typeof out === "string" && out.startsWith("BRIEF//"), out.slice(0, 40));
  check("output is NOT canned milestone text", !CANNED.some((c) => out.includes(c)));
  const finding = bus.thread(goalId).find((m) => m.kind === "finding" && m.body.includes("BRIEF//"));
  check("model output posted to the bus as a finding", !!finding);
}

// ── Test 2: scratch role runs on promptFor + outputSchema alone ──────────────
console.log("\n[2] Generic executor — scratch role, zero orchestrator changes");
{
  const scratch: RoleTemplate = {
    role: "scratch-summarizer",
    titleFor: () => "Scratch",
    objectiveFor: () => "summarize",
    tools: [], credentials: [], policyTemplate: "worker-minimal.yaml",
    estimateSec: 10, dependsOn: [], reasoning: "low",
    executionClass: "pure-LLM",
    outputSchema: "text",
    promptFor: (c, up) => `Summarize ${c.niche} from: ${JSON.stringify(up)}`,
  };
  const agent = fakeAgent("scratch-summarizer");
  const task = fakeTask("goal-scratch");
  const ctx: PlanContext = { goalText: "anything", niche: "widgets", idSuffix: "2" };
  const out = (await executeRole(agent, task, scratch, ctx, "some upstream note", noop, { brain: stubBrain })) as string;
  check("scratch role ran via the generic path", typeof out === "string" && out.startsWith("BRIEF//"), out.slice(0, 40));
}

// ── Test 3: empty handoff halts honestly (no silent copywriter success) ──────
console.log("\n[3] Handoff contract — empty upstream halts, never crosses silently");
{
  const agent = fakeAgent("store-builder");
  const task = fakeTask("goal-empty");
  const sb = roleTemplateFor("store-builder")!;
  let threw: unknown;
  try {
    await executeRole(agent, task, sb, { goalText: "store", niche: "x", idSuffix: "3" }, [], noop, { brain: stubBrain });
  } catch (e) { threw = e; }
  check("store-builder halts on empty products (HandoffError)", threw instanceof HandoffError, (threw as Error)?.message);

  let copyThrew: unknown;
  try {
    await runCopywriter(fakeAgent("copywriter"), fakeTask("goal-empty"), "x", [], noop, { brain: stubBrain });
  } catch (e) { copyThrew = e; }
  check("copywriter does NOT fake-succeed on [] products", copyThrew instanceof HandoffError, (copyThrew as Error)?.message);

  check("assertHandoff('products', []) throws", (() => { try { assertHandoff("products", [], "edge"); return false; } catch { return true; } })());
  check("assertHandoff('text', '') throws", (() => { try { assertHandoff("text", "", "edge"); return false; } catch { return true; } })());
}

// ── Test 4: validators accept good, reject bad ───────────────────────────────
console.log("\n[4] Schema validators");
{
  check("products: non-empty valid array ok", validateOutput("products", [{ title: "a", price: 1 }]).ok);
  check("products: [] rejected", !validateOutput("products", []).ok);
  check("products: missing price rejected", !validateOutput("products", [{ title: "a" }]).ok);
  check("text: 'hi' ok", validateOutput("text", "hi").ok);
  check("text: '   ' rejected", !validateOutput("text", "   ").ok);
  check("url: https ok", validateOutput("url", "https://a.myshopify.com").ok);
  check("url: http rejected", !validateOutput("url", "http://a.com").ok);
}

// ── Test 5: workerMode derives from brain availability for generic roles ─────
console.log("\n[5] workerMode — generic roles flip real with a brain key");
{
  const saved = {
    FEATHERLESS_API_KEY: process.env.FEATHERLESS_API_KEY,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    NVIDIA_INFERENCE_API_KEY: process.env.NVIDIA_INFERENCE_API_KEY,
    WORKER_BACKEND: process.env.WORKER_BACKEND,
  };
  delete process.env.FEATHERLESS_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.NVIDIA_INFERENCE_API_KEY;
  delete process.env.WORKER_BACKEND;
  check("research → real (broker-ingest, no brain needed)", workerMode("research") === "real");
  check("strategist → sim with no brain key", workerMode("strategist") === "sim");
  process.env.ANTHROPIC_API_KEY = "verify-dummy"; // presence check only — no call is made
  check("strategist → real once a brain key exists", workerMode("strategist") === "real");
  check("analyst → real once a brain key exists", workerMode("analyst") === "real");
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
