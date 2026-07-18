// Worker execution loop — the REAL path. A worker gets a brain (ModelBackend,
// if auth exists), real tools, and runs its objective; every tool result and
// model I/O passes through the SecurityGate, and flagged content becomes a
// human escalation before the worker may proceed.
//
// Mode resolution per role (SIM_MODE=1 forces sim everywhere — stage insurance;
// sim is always LABELED on the dashboard):
//   research    real when outbound fetch works (brain optional — without one,
//               findings are deterministically synthesized from real data)
//   store-build real when SHOPIFY_ADMIN_TOKEN + SHOPIFY_STORE_URL are set
//   copywriter  real when a brain is available
//
// Brain selection: WORKER_BACKEND=api|nvidia|cli overrides; else auto by key.

import type { AgentRecord, ScanResult, Task } from "../types.js";
import type { ModelBackend } from "../evals/types.js";
import { AnthropicApiBackend, ClaudeCliBackend, OpenAICompatBackend } from "../evals/backends.js";
import { scan } from "../security/gate.js";
import { escalations } from "../security/escalations.js";
import { governance } from "../governance/governance.js";
import { registry } from "../registry/registry.js";
import { bus } from "../bus/bus.js";
import { executionClassOf, type OutputSchema, type PlanContext, type RoleTemplate } from "../roles/library.js";

export interface Product { title: string; price: number; image?: string }

// Research data source, in order of preference:
//   1. Apify actor (real scrape) when APIFY_TOKEN + APIFY_ACTOR are set
//   2. RESEARCH_SOURCE_URL if the operator points it at a real feed
//   3. a labeled sample catalog SEARCHED BY NICHE (never presented as live,
//      and never off-topic — a desk-accessories goal must not return sneakers)
// Env is read at call time so keys pasted into BUSINESS SETUP apply instantly.
const apifyToken = () => process.env.APIFY_TOKEN;
const apifyActor = () => process.env.APIFY_ACTOR; // e.g. "junglee/amazon-crawler"

export function researchSourceLabel(): string {
  if (apifyToken() && apifyActor()) return `live Apify scrape (actor ${apifyActor()})`;
  if (process.env.RESEARCH_SOURCE_URL) return `operator feed (${process.env.RESEARCH_SOURCE_URL})`;
  return "sample catalog matched to your niche (connect Apify in BUSINESS SETUP for a live scrape)";
}

async function fetchProducts(niche: string): Promise<any[]> {
  const token = apifyToken(), actor = apifyActor();
  if (token && actor) {
    // Apify run-sync-get-dataset-items: runs the actor and returns its dataset.
    const url = `https://api.apify.com/v2/acts/${actor.replace("/", "~")}/run-sync-get-dataset-items?token=${token}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ search: niche, maxItems: 10 }),
      signal: AbortSignal.timeout(90000),
    });
    if (!res.ok) throw new Error(`Apify actor ${actor} failed: HTTP ${res.status} ${(await res.text()).slice(0, 150)}`);
    return await res.json();
  }
  if (process.env.RESEARCH_SOURCE_URL) {
    const res = await fetch(process.env.RESEARCH_SOURCE_URL, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`source fetch failed: HTTP ${res.status}`);
    const data: any = await res.json();
    return data.products ?? data.items ?? (Array.isArray(data) ? data : []);
  }
  // Sample catalog: search dummyjson by the niche terms so the findings are at
  // least on-topic; fall back to a generic top-10 only if the search is empty.
  const q = encodeURIComponent(niche.split(/\s+/).slice(0, 3).join(" "));
  const search = await fetch(`https://dummyjson.com/products/search?q=${q}&limit=10`, { signal: AbortSignal.timeout(15000) });
  if (search.ok) {
    const data: any = await search.json();
    if (Array.isArray(data.products) && data.products.length > 0) return data.products;
  }
  const res = await fetch("https://dummyjson.com/products?limit=10", { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`sample catalog fetch failed: HTTP ${res.status}`);
  return ((await res.json()) as any).products ?? [];
}

let warnedBrain = "";
function warnBrainOnce(msg: string) {
  if (warnedBrain === msg) return;
  warnedBrain = msg;
  console.warn(`[worker] ${msg}`);
}

export function resolveBrain(): ModelBackend | null {
  if (process.env.SIM_MODE === "1") return null;
  const pick = process.env.WORKER_BACKEND;
  // An explicit WORKER_BACKEND with no matching key must NOT construct a
  // backend around an undefined key (that crashed mid-task with a cryptic
  // 401). Fall back to sim, loudly.
  // Featherless first: when no explicit pick, its key wins the auto-detect so a
  // demo only needs FEATHERLESS_API_KEY pasted. Reuses the OpenAI-compat class.
  if (pick === "featherless" || (!pick && process.env.FEATHERLESS_API_KEY)) {
    if (process.env.FEATHERLESS_API_KEY)
      return new OpenAICompatBackend(
        process.env.FEATHERLESS_API_KEY,
        process.env.FEATHERLESS_API_BASE ?? "https://api.featherless.ai/v1",
        "featherless",
      );
    warnBrainOnce("WORKER_BACKEND=featherless but FEATHERLESS_API_KEY is not set — workers fall back to simulation. Paste the key in Connections or unset WORKER_BACKEND.");
    return null;
  }
  if (pick === "api") {
    if (process.env.ANTHROPIC_API_KEY) return new AnthropicApiBackend(process.env.ANTHROPIC_API_KEY);
    warnBrainOnce("WORKER_BACKEND=api but ANTHROPIC_API_KEY is not set — workers fall back to simulation. Paste the key in Connections or unset WORKER_BACKEND.");
    return null;
  }
  if (pick === "nvidia") {
    if (process.env.NVIDIA_INFERENCE_API_KEY) return new OpenAICompatBackend(process.env.NVIDIA_INFERENCE_API_KEY, process.env.NVIDIA_API_BASE ?? undefined);
    warnBrainOnce("WORKER_BACKEND=nvidia but NVIDIA_INFERENCE_API_KEY is not set — workers fall back to simulation. Paste the key in Connections or unset WORKER_BACKEND.");
    return null;
  }
  if (pick === "cli") return new ClaudeCliBackend();
  if (process.env.ANTHROPIC_API_KEY) return new AnthropicApiBackend(process.env.ANTHROPIC_API_KEY);
  if (process.env.NVIDIA_INFERENCE_API_KEY) return new OpenAICompatBackend(process.env.NVIDIA_INFERENCE_API_KEY, process.env.NVIDIA_API_BASE ?? undefined);
  return null;
}

// Roles the CURRENT orchestrator work-loop (runReal) can dispatch directly.
// The generic executor (executeRole) already runs EVERY pure-LLM role for real,
// but until runReal is wired to call it (follow-up — see PR notes), returning
// "real" for strategist/analyst would make them run with no visible output.
// Keeping them on the labeled sim path until then avoids a live regression while
// the capability + data (execution class, promptFor, outputSchema) ship now.
const ORCHESTRATOR_WIRED_REAL = new Set(["research", "store-builder", "copywriter"]);

// Mode is now derived from the role's execution class (worker-capability §1),
// not a hardcoded role list — a new pure-LLM role needs only a library entry.
export function workerMode(role: string): "real" | "sim" {
  if (process.env.SIM_MODE === "1") return "sim";
  if (!ORCHESTRATOR_WIRED_REAL.has(role)) return "sim"; // ghost roles: sim until runReal calls executeRole
  switch (executionClassOf(role)) {
    case "broker-ingest":
      return "real";
    case "tool-workflow":
      return process.env.SHOPIFY_ADMIN_TOKEN && process.env.SHOPIFY_STORE_URL ? "real" : "sim";
    case "pure-LLM":
      return resolveBrain() ? "real" : "sim";
    default:
      return "sim";
  }
}

// Gate helper: scan content; flagged -> escalate and await the human. Returns
// true to proceed, false if denied (caller fails the task).
export async function gateOrEscalate(agent: AgentRecord, content: string, kind: Parameters<typeof scan>[1], threadId: string, reason: string): Promise<boolean> {
  const result: ScanResult = await scan(content, kind, agent.id);
  if (result.verdict === "clean") return true;
  if (result.verdict === "blocked") {
    // The cage: critical verdicts hard-stop in every autonomy mode.
    bus.post({ threadId, from: agent.id, kind: "system", body: `BLOCKED by SecurityGate (${result.categories.join(", ")}): ${reason}` });
    return false;
  }
  // Flagged (non-critical): in autonomous mode, log + auto-proceed (no human gate).
  // In assisted/supervised, pause for operator approve/deny.
  if (governance.autoApprovesFlagged(result.verdict)) {
    registry.upsert(agent, `Auto-approved (autonomous mode): ${reason} [${result.categories.join(", ")}]`);
    bus.post({ threadId, from: agent.id, kind: "status", body: `Detection auto-approved in autonomous mode — logged, not stopped [${result.categories.join(", ")}]. (Critical exfil would still hard-block.)` });
    return true;
  }
  const prev = agent.status;
  agent.status = "blocked";
  registry.upsert(agent, `Escalation: ${reason} [${result.categories.join(", ")}]`);
  const { escalation, decision } = escalations.create(agent.id, reason, result, content);
  bus.post({ threadId, from: agent.id, kind: "question", body: `Security escalation ${escalation.id}: ${reason} — detections [${result.categories.join(", ")}]. Awaiting operator approve/deny.` });

  // C2: never await a human forever. ESCALATION_TIMEOUT_MS (off in dev, ON for
  // the demo) auto-denies (fail-closed) if nobody clicks, so the worker unblocks
  // and the ticker stops spinning. escalations.resolve() guards double-resolve,
  // so a click still wins if it lands first; here we just clear our timer.
  const timeoutMs = Number(process.env.ESCALATION_TIMEOUT_MS ?? 0);
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  if (timeoutMs > 0) {
    timer = setTimeout(() => {
      if (escalation.resolved) return; // an operator click already won the race
      timedOut = true;
      escalations.resolve(escalation.id, "denied");
      bus.post({ threadId, from: agent.id, kind: "system", body: `Escalation ${escalation.id} auto-denied after ${Math.round(timeoutMs / 1000)}s — content quarantined.` });
    }, timeoutMs);
  }
  const verdict = await decision;
  if (timer) clearTimeout(timer);

  // Whatever the verdict, the escalation is RESOLVED — the agent must not stay
  // "blocked" (a blocked row keeps showing approve/deny buttons with nothing
  // left to resolve). Approved -> back to work; denied -> callers either fail
  // the task (which sets "failed") or the agent resumes its previous status.
  agent.status = prev === "blocked" ? "working" : prev;
  if (verdict === "approved") {
    registry.upsert(agent, `Escalation ${escalation.id} approved — continuing`);
    bus.post({ threadId, from: agent.id, kind: "status", body: `Operator approved ${escalation.id} — continuing.` });
    return true;
  }
  registry.upsert(agent, `Escalation ${escalation.id} ${timedOut ? "auto-denied (timeout)" : "DENIED"}`);
  if (!timedOut) bus.post({ threadId, from: agent.id, kind: "system", body: `Operator denied ${escalation.id} — content quarantined.` });
  return false;
}

// --- handoff contract (worker-capability §4) --------------------------------
// Dependency edges carry DATA, not just timing. Each outputSchema tag has one
// validator; upstream output is validated BEFORE it feeds a downstream prompt.
// An empty [] or "" must NOT cross an edge silently — that is the bug where a
// copywriter "succeeds" on zero products.

export type HandoffResult = { ok: true; value: unknown } | { ok: false; reason: string };

export function validateOutput(schema: OutputSchema, data: unknown): HandoffResult {
  switch (schema) {
    case "products": {
      if (!Array.isArray(data) || data.length === 0) return { ok: false, reason: "no products produced (empty result)" };
      const bad = (data as any[]).findIndex((p) => !p || typeof p.title !== "string" || typeof p.price !== "number");
      if (bad >= 0) return { ok: false, reason: `product #${bad + 1} missing a string title or numeric price` };
      return { ok: true, value: data };
    }
    case "text": {
      if (typeof data !== "string" || data.trim() === "") return { ok: false, reason: "empty text output" };
      return { ok: true, value: data.trim() };
    }
    case "url": {
      try {
        const u = new URL(String(data));
        if (u.protocol !== "https:") return { ok: false, reason: `url is not https (${u.protocol})` };
        return { ok: true, value: u.toString() };
      } catch {
        return { ok: false, reason: "unparseable url" };
      }
    }
  }
}

// Thrown when a role's own output fails its schema (the producer is at fault).
// The orchestrator's existing try/catch marks the task failed → goal-halt path.
export class HandoffError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HandoffError";
  }
}

// Validate a role's produced output against its schema. Throws HandoffError on
// empty/invalid so the producing task fails honestly instead of shipping junk.
export function parseOutput(schema: OutputSchema, data: unknown): unknown {
  const r = validateOutput(schema, data);
  if (!r.ok) throw new HandoffError(`output failed "${schema}" schema: ${r.reason}`);
  return r.value;
}

// Validate an UPSTREAM edge before building a downstream prompt. Throws
// HandoffError (goal-halt) rather than let an empty/invalid handoff cross.
export function assertHandoff(schema: OutputSchema, upstream: unknown, edge: string): unknown {
  const r = validateOutput(schema, upstream);
  if (!r.ok) throw new HandoffError(`handoff halted on ${edge}: ${r.reason}`);
  return r.value;
}

// --- shared model-dispatch seam ---------------------------------------------
// buildPrompt → scan(user_prompt) → dispatch → scan(model_response). EVERY role
// that talks to a model routes its I/O through here, so the scan→escalate seam
// (gateOrEscalate) is applied identically everywhere.

export interface ExecOptions {
  brain?: ModelBackend | null; // inject a backend (tests); default resolveBrain()
  maxTokens?: number;
}

async function dispatchModel(agent: AgentRecord, task: Task, prompt: string, opts: ExecOptions = {}): Promise<string> {
  if (!(await gateOrEscalate(agent, prompt, "user_prompt", task.goalId, "Model prompt"))) throw new Error("prompt quarantined by security policy");
  const brain = opts.brain ?? resolveBrain();
  if (!brain) throw new Error("no model brain available — paste a worker key in Connections (this role needs an LLM)");
  const out = await brain.complete(prompt, { model: modelFor(brain), levelId: "worker", trial: 1, maxTokens: opts.maxTokens ?? 300 });
  if (!(await gateOrEscalate(agent, out.text, "model_response", task.goalId, "Model response"))) throw new Error("response quarantined by security policy");
  return out.text.trim();
}

// --- generic executor (worker-capability §2) --------------------------------
// ONE pipeline for every role, selected by execution class. Pure-LLM roles run
// with NOTHING but their promptFor + outputSchema — no per-role branch here or
// in the orchestrator. research/store-builder keep their specialized pre/post
// (broker ingest; Shopify calls) but route model I/O through the same seam.
export async function executeRole(
  agent: AgentRecord,
  task: Task,
  tmpl: RoleTemplate,
  ctx: PlanContext,
  upstream: unknown,
  onProgress: (p: number) => void,
  opts: ExecOptions = {},
): Promise<unknown> {
  switch (tmpl.executionClass) {
    case "broker-ingest": {
      // Harness fetches + scans, model summarizes; returns validated products.
      const products = await runResearch(agent, task, ctx.niche, onProgress, opts);
      return parseOutput(tmpl.outputSchema, products);
    }
    case "tool-workflow": {
      // Consumes validated upstream products, drives allowlisted tool calls.
      const products = assertHandoff("products", upstream, `upstream → ${tmpl.role}`) as Product[];
      const url = await runStoreBuilder(agent, task, products, onProgress);
      return parseOutput(tmpl.outputSchema, url);
    }
    case "pure-LLM":
      return runPureLLM(agent, task, tmpl, ctx, upstream, onProgress, opts);
  }
}

// Pure-LLM role: prompt in (objective + validated upstream), completion out.
export async function runPureLLM(
  agent: AgentRecord,
  task: Task,
  tmpl: RoleTemplate,
  ctx: PlanContext,
  upstream: unknown,
  onProgress: (p: number) => void,
  opts: ExecOptions = {},
): Promise<string> {
  onProgress(15);
  const prompt = tmpl.promptFor(ctx, upstream);
  onProgress(30);
  const text = await dispatchModel(agent, task, prompt, { brain: opts.brain, maxTokens: tmpl.reasoning === "high" ? 500 : 300 });
  onProgress(90);
  const value = parseOutput(tmpl.outputSchema, text) as string;
  bus.post({ threadId: task.goalId, from: agent.id, kind: "finding", body: `${tmpl.role} complete:\n${value.slice(0, 500)}` });
  return value;
}

// --- role implementations (real path) ---

export async function runResearch(agent: AgentRecord, task: Task, niche: string, onProgress: (p: number) => void, opts: ExecOptions = {}): Promise<Product[]> {
  onProgress(10);
  bus.post({ threadId: task.goalId, from: agent.id, kind: "status", body: `Sourcing ${niche} products — ${researchSourceLabel()}` });

  const rawProducts = await fetchProducts(niche);
  const products: Product[] = rawProducts.slice(0, 10).map((p) => ({
    title: p.title ?? p.name ?? p.productName ?? "unknown",
    price: Number(p.price?.value ?? p.price ?? p.priceValue ?? 0),
    image: p.thumbnail ?? p.image ?? p.imageUrl ?? p.images?.[0],
  }));
  onProgress(50);

  // Handoff contract §4: an empty research result must NOT cross the edge
  // silently (that let a downstream copywriter "succeed" on zero products).
  // Fail the research task here → orchestrator's failure cascade halts the goal.
  parseOutput("products", products);

  // Ingested external content goes through the gate before anyone reasons on it.
  const ok = await gateOrEscalate(agent, JSON.stringify(rawProducts).slice(0, 2000), "ingested_document", task.goalId, "External research data ingested");
  if (!ok) throw new Error("ingested data quarantined by security policy");
  onProgress(65);

  let summary: string;
  const brain = opts.brain ?? resolveBrain();
  if (brain) {
    const prompt = `You are a retail research analyst. In 3 sentences, summarize the opportunity for a "${niche}" store given these products (title/price): ${products.map((p) => `${p.title} ($${p.price})`).join("; ")}. Be concrete about price band and which 3 products to lead with.`;
    // Route model I/O through the shared seam (same scan→escalate order everywhere).
    summary = await dispatchModel(agent, task, prompt, { brain, maxTokens: 300 });
  } else {
    const sorted = [...products].sort((a, b) => a.price - b.price);
    const mid = sorted.slice(Math.floor(sorted.length / 3), Math.floor(sorted.length / 3) + 3);
    summary = `${products.length} products from ${researchSourceLabel()}, $${sorted[0]?.price}–$${sorted[sorted.length - 1]?.price}. Rule-based synthesis (add a model key for LLM analysis). Lead with mid-band: ${mid.map((p) => `${p.title} ($${p.price})`).join(", ")}.`;
  }
  onProgress(90);
  bus.post({ threadId: task.goalId, from: agent.id, kind: "finding", body: `Research complete — ${summary}` });
  return products;
}

export async function runStoreBuilder(agent: AgentRecord, task: Task, products: Product[], onProgress: (p: number) => void): Promise<string> {
  // Handoff contract §4: refuse to build a store on an empty/invalid shortlist.
  assertHandoff("products", products, "research → store-builder");
  const token = process.env.SHOPIFY_ADMIN_TOKEN!;
  const store = process.env.SHOPIFY_STORE_URL!.replace(/\/$/, "");
  const picks = products.slice(0, 3);
  let created = 0;
  for (const p of picks) {
    const body = JSON.stringify({ product: { title: p.title, variants: [{ price: String(p.price) }], images: p.image ? [{ src: p.image }] : [] } });
    if (!(await gateOrEscalate(agent, body, "tool_call", task.goalId, `Shopify create product: ${p.title}`))) throw new Error("tool call quarantined");
    const res = await fetch(`${store}/admin/api/2024-01/products.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
      body,
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`Shopify API ${res.status}: ${(await res.text()).slice(0, 200)}`);
    created++;
    onProgress(20 + (70 * created) / picks.length);
    bus.post({ threadId: task.goalId, from: agent.id, kind: "status", body: `Created product ${created}/${picks.length}: ${p.title}` });
  }
  bus.post({ threadId: task.goalId, from: agent.id, kind: "finding", body: `Store populated with ${created} real products: ${store}` });
  return store;
}

export async function runCopywriter(agent: AgentRecord, task: Task, niche: string, products: Product[], onProgress: (p: number) => void, opts: ExecOptions = {}): Promise<string> {
  // Handoff contract §4: don't write copy for a store with nothing in it.
  assertHandoff("products", products, "research → copywriter");
  onProgress(20);
  const prompt = `Write a punchy one-line product description for each of these ${niche} products (format "Title — description"): ${products.slice(0, 3).map((p) => p.title).join("; ")}`;
  const text = await dispatchModel(agent, task, prompt, { brain: opts.brain, maxTokens: 300 });
  onProgress(90);
  const value = parseOutput("text", text) as string;
  bus.post({ threadId: task.goalId, from: agent.id, kind: "finding", body: `Copy delivered:\n${value.slice(0, 500)}` });
  return value;
}

function modelFor(brain: ModelBackend): string {
  if (brain.name === "api") return process.env.WORKER_MODEL ?? "claude-haiku-4-5-20251001";
  if (brain.name === "nvidia") return process.env.WORKER_MODEL ?? "nvidia/llama-3.1-nemotron-70b-instruct";
  // Cheapest Featherless Nemotron (input $0.05/M, output $0.20/M) for testing.
  // Swap to nvidia/NVIDIA-Nemotron-3-Super-120B-A12B-BF16 (or set WORKER_MODEL) for the demo.
  if (brain.name === "featherless") return process.env.WORKER_MODEL ?? "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B-BF16";
  return process.env.WORKER_MODEL ?? "haiku";
}
