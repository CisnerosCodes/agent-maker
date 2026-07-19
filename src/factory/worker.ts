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
//   any other library role (strategist, analyst, product-manager, architect…)
//               real when a brain is available: a generic gated artifact turn
//               (runGenericRole) — objective + upstream handoffs in, named
//               artifact out. A failed brain call (dead key, 402) degrades
//               THAT task to labeled sim instead of failing the goal.
//
// Brain selection: WORKER_BACKEND=api|nvidia|cli overrides; else auto by key.

import type { AgentRecord, ScanResult, Task } from "../types.js";
import type { ModelBackend } from "../evals/types.js";
import { poolBrain, pinnedBrain } from "../providers/pool.js";
import { simForced } from "../config/mode.js";
import { scan } from "../security/gate.js";
import { escalations } from "../security/escalations.js";
import { governance } from "../governance/governance.js";
import { registry } from "../registry/registry.js";
import { bus } from "../bus/bus.js";
import { executionClassOf, milestoneFor, renderUpstream, type OutputSchema, type PlanContext, type RoleTemplate } from "../roles/library.js";
import { friendlyError } from "../config/errors.js";

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

async function fetchProducts(niche: string): Promise<{ items: any[]; nicheMatched: boolean }> {
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
    return { items: await res.json(), nicheMatched: true };
  }
  if (process.env.RESEARCH_SOURCE_URL) {
    const res = await fetch(process.env.RESEARCH_SOURCE_URL, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`source fetch failed: HTTP ${res.status}`);
    const data: any = await res.json();
    return { items: data.products ?? data.items ?? (Array.isArray(data) ? data : []), nicheMatched: true };
  }
  // Sample catalog: search dummyjson by the niche terms so the findings are at
  // least on-topic. Run-1 learning (Atlas): when the search comes up EMPTY the
  // generic top-10 fallback is OFF-topic (mascara for a planter store) — that
  // must be said out loud, not laundered downstream as "niche-matched".
  const q = encodeURIComponent(niche.split(/\s+/).slice(0, 3).join(" "));
  const search = await fetch(`https://dummyjson.com/products/search?q=${q}&limit=10`, { signal: AbortSignal.timeout(15000) });
  if (search.ok) {
    const data: any = await search.json();
    if (Array.isArray(data.products) && data.products.length > 0) return { items: data.products, nicheMatched: true };
  }
  const res = await fetch("https://dummyjson.com/products?limit=10", { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`sample catalog fetch failed: HTTP ${res.status}`);
  return { items: ((await res.json()) as any).products ?? [], nicheMatched: false };
}

let warnedBrain = "";
function warnBrainOnce(msg: string) {
  if (warnedBrain === msg) return;
  warnedBrain = msg;
  console.warn(`[worker] ${msg}`);
}

// The brain is now the POOL (src/providers/pool.ts): every configured provider
// in failover order, health-tracked. An explicit WORKER_BACKEND still pins one
// provider with no failover (operator intent); a pinned-but-keyless backend
// falls back to sim, loudly — never a backend constructed around an undefined
// key (that crashed mid-task with a cryptic 401).
export function resolveBrain(): ModelBackend | null {
  if (simForced()) return null;
  const { pin, provider, missingKeys } = pinnedBrain();
  if (pin && !provider) {
    warnBrainOnce(
      missingKeys.length
        ? `WORKER_BACKEND=${pin} but ${missingKeys.join(" and ")} is not set — workers fall back to simulation. Paste the key in Connections or unset WORKER_BACKEND.`
        : `WORKER_BACKEND=${pin} matches no known brain provider — workers fall back to simulation. Use one of: featherless | api | nvidia | cli.`,
    );
    return null;
  }
  return poolBrain();
}

// Class-driven, with two guards Sky's rewrite dropped: roles without a declared
// executionClass default to pure-LLM (11 library roles would otherwise sim at
// hire even with a live brain), and simForced() (COMPANY_MODE=demo) blocks
// business writes + key spend — only broker-ingest research stays real in demo
// (its keyless fetch is the honest demo path; SIM_MODE=1 sims even that).
export function workerMode(role: string): "real" | "sim" {
  if (process.env.SIM_MODE === "1") return "sim"; // offline stage insurance — EVERYTHING sim
  const cls = executionClassOf(role) ?? "pure-LLM";
  if (cls === "broker-ingest") return "real"; // real keyless fetch, honestly labeled — even in demo mode
  if (simForced()) return "sim"; // COMPANY_MODE=demo: no key spend, no business writes
  if (cls === "tool-workflow") return process.env.SHOPIFY_ADMIN_TOKEN && process.env.SHOPIFY_STORE_URL ? "real" : "sim";
  return resolveBrain() ? "real" : "sim";
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
    // Run-2 learning (Nova): auto-approvals were invisible to the escalations
    // audit trail (only nested agent logs). Record one, pre-resolved, so
    // after-the-fact review sees every detection decision in ONE place.
    const { escalation } = escalations.create(agent.id, `[auto-approved in autonomous mode] ${reason}`, result, content);
    escalations.resolve(escalation.id, "approved");
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
  // Roles without a declared execution class run as pure-LLM (the generic path).
  switch (tmpl.executionClass ?? "pure-LLM") {
    case "broker-ingest": {
      // Harness fetches + scans, model summarizes; returns validated products.
      const products = await runResearch(agent, task, ctx.niche, onProgress, opts);
      return parseOutput(tmpl.outputSchema ?? "products", products);
    }
    case "tool-workflow": {
      // Consumes validated upstream products, drives allowlisted tool calls.
      const products = assertHandoff("products", upstream, `upstream → ${tmpl.role}`) as Product[];
      const url = await runStoreBuilder(agent, task, products, onProgress);
      return parseOutput(tmpl.outputSchema ?? "url", url);
    }
    default:
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
  // Bespoke promptFor when the library declares one; otherwise the same generic
  // objective+handoff prompt shape runGenericRole uses.
  const prompt = tmpl.promptFor
    ? tmpl.promptFor(ctx, upstream)
    : [
        `You are the ${tmpl.role} in a small agent company. Your objective: ${tmpl.objectiveFor(ctx)}`,
        `Market/niche context: ${ctx.niche}.`,
        upstream != null ? `Upstream input: ${renderUpstream(upstream)}` : "",
        `Deliver your ${tmpl.handoff ?? "deliverable"} now. Be concrete and complete — no placeholder text, no preamble.`,
      ].filter(Boolean).join("\n\n");
  onProgress(30);
  const text = await dispatchModel(agent, task, prompt, { brain: opts.brain, maxTokens: tmpl.reasoning === "high" ? 500 : 300 });
  onProgress(90);
  const value = parseOutput(tmpl.outputSchema ?? "text", text) as string;
  bus.post({ threadId: task.goalId, from: agent.id, kind: "finding", body: `${tmpl.role} complete:\n${value.slice(0, 500)}` });
  return value;
}

// --- role implementations (real path) ---

export async function runResearch(agent: AgentRecord, task: Task, niche: string, onProgress: (p: number) => void, opts: ExecOptions = {}): Promise<Product[]> {
  onProgress(10);
  bus.post({ threadId: task.goalId, from: agent.id, kind: "status", body: `Sourcing ${niche} products — ${researchSourceLabel()}` });

  const { items: rawProducts, nicheMatched } = await fetchProducts(niche);
  const products: Product[] = rawProducts.slice(0, 10).map((p) => ({
    title: p.title ?? p.name ?? p.productName ?? "unknown",
    price: Number(p.price?.value ?? p.price ?? p.priceValue ?? 0),
    image: p.thumbnail ?? p.image ?? p.imageUrl ?? p.images?.[0],
  }));
  if (!nicheMatched) {
    bus.post({
      threadId: task.goalId, from: agent.id, kind: "status",
      body: `Heads up: the sample catalog has no "${niche}" matches — the findings below use GENERAL sample data, not ${niche} products. Connect Apify in Connections for live ${niche} data.`,
    });
  }
  onProgress(50);

  // Handoff contract §4: an empty research result must NOT cross the edge
  // silently (that let a downstream copywriter "succeed" on zero products).
  // Fail the research task here → orchestrator's failure cascade halts the goal.
  parseOutput("products", products);

  // Ingested external content goes through the gate before anyone reasons on it.
  const ok = await gateOrEscalate(agent, JSON.stringify(rawProducts).slice(0, 2000), "ingested_document", task.goalId, "External research data ingested");
  if (!ok) throw new Error("ingested data quarantined by security policy");
  onProgress(65);

  let summary: string | null = null;
  const brain = opts.brain ?? resolveBrain();
  if (brain) {
    const mismatchNote = nicheMatched ? "" : ` IMPORTANT: the catalog had NO "${niche}" matches, so these are general sample products, NOT ${niche} items — say so plainly and base any ${niche}-specific advice on the price bands only.`;
    const prompt = `You are a retail research analyst. In 3 sentences, summarize the opportunity for a "${niche}" store given these products (title/price): ${products.map((p) => `${p.title} ($${p.price})`).join("; ")}. Be concrete about price band and which 3 products to lead with.${mismatchNote}`;
    try {
      // Route model I/O through the shared seam (same scan→escalate order everywhere).
      summary = await dispatchModel(agent, task, prompt, { brain, maxTokens: 300 });
    } catch (err: any) {
      if (/quarantined/.test(String(err?.message))) throw err;
      // Brain died mid-task (dead key, 402, timeout). The fetch was REAL —
      // keep the findings, fall back to rule-based synthesis, and say so
      // instead of failing the goal.
      bus.post({ threadId: task.goalId, from: agent.id, kind: "status", body: `Model analysis unavailable — ${friendlyError(String(err?.message))} Falling back to rule-based synthesis of the real findings.` });
    }
  }
  if (summary === null) {
    const sorted = [...products].sort((a, b) => a.price - b.price);
    const mid = sorted.slice(Math.floor(sorted.length / 3), Math.floor(sorted.length / 3) + 3);
    summary = `${products.length} products from ${researchSourceLabel()}${nicheMatched ? "" : ` (NO "${niche}" matches — general sample data)`}, $${sorted[0]?.price}–$${sorted[sorted.length - 1]?.price}. Rule-based synthesis (add a model key for LLM analysis). Lead with mid-band: ${mid.map((p) => `${p.title} ($${p.price})`).join(", ")}.`;
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
  try {
    const text = await dispatchModel(agent, task, prompt, { brain: opts.brain, maxTokens: 300 });
    onProgress(90);
    // Handoff contract §4: empty copy is a producer fault — fail honestly.
    const value = parseOutput("text", text) as string;
    bus.post({ threadId: task.goalId, from: agent.id, kind: "finding", body: `Copy delivered:\n${value.slice(0, 500)}` });
    return value;
  } catch (err: any) {
    if (/quarantined/.test(String(err?.message)) || err instanceof HandoffError) throw err;
    // Dead key must cost one artifact's realism, not the goal. Degrade to
    // LABELED simulation with the honest reason.
    task.mode = "sim";
    bus.post({ threadId: task.goalId, from: agent.id, kind: "status", body: `Model call unavailable — ${friendlyError(String(err?.message))} Completing this task as LABELED SIMULATION; it flips real once a working key is connected.` });
    registry.upsert(agent, `Brain unavailable — copy degraded to labeled sim`);
    onProgress(90);
    const staged = `Copy delivered for ${Math.min(products.length, 3) || 3} products plus homepage hero. (staged — connect a working model key in BUSINESS SETUP for real copy)`;
    bus.post({ threadId: task.goalId, from: agent.id, kind: "finding", body: staged });
    return staged;
  }
}

// Generic library-role turn — the real path for every role without a bespoke
// implementation above. Upstream handoff artifacts go in as named sections
// (MetaGPT SOP-style), the role's named artifact comes out; prompt and
// response both pass the gate. A failed BRAIN call (dead key, 402, timeout)
// degrades this one task to labeled sim — quarantines still fail the task.
export interface UpstreamArtifact { role: string; handoff?: string; output: string }

export async function runGenericRole(
  agent: AgentRecord,
  task: Task,
  niche: string,
  upstream: UpstreamArtifact[],
  onProgress: (p: number) => void,
): Promise<string> {
  onProgress(10);
  const artifact = agent.spec.handoff ?? "deliverable";
  // 8000 chars/handoff (~2k tokens). The old 1800 cut a PRD mid-requirement
  // and handed the qa-reviewer a build it could only see the CSS header of —
  // observed live on the software-shipping chain. Budget is per-edge; a role
  // with several upstreams still gets each artifact mostly whole. When an
  // artifact exceeds the cap, SAY so in the prompt instead of cutting silently.
  const HANDOFF_CAP = 8000;
  const sections = upstream
    .filter((u) => u.output)
    .map((u) => {
      const body = u.output.length > HANDOFF_CAP
        ? `${u.output.slice(0, HANDOFF_CAP)}\n[…handoff truncated at ${HANDOFF_CAP} chars — ${u.output.length - HANDOFF_CAP} more in the full artifact; flag in ANYTHING_UNCLEAR if the cut part matters]`
        : u.output;
      return `## Handoff from ${u.role}${u.handoff ? ` — ${u.handoff}` : ""}\n${body}`;
    })
    .join("\n\n");
  const prompt = [
    `You are the ${agent.spec.role} in a small agent company. Your objective: ${agent.spec.objective}`,
    `Market/niche context: ${niche}.`,
    sections,
    `Deliver your ${artifact} now. Be concrete and complete — no placeholder text, no preamble. If anything essential is unknown, end with a short ANYTHING_UNCLEAR list; otherwise omit it.`,
  ].filter(Boolean).join("\n\n");

  if (!(await gateOrEscalate(agent, prompt, "user_prompt", task.goalId, "Model prompt"))) throw new Error("prompt quarantined");
  onProgress(30);

  const brain = resolveBrain();
  let text: string | null = null;
  let failNote = "no model key connected";
  if (brain) {
    try {
      // High-reasoning roles (architect, product-manager…) produce structural
      // artifacts that don't fit 700 tokens; builders even less so.
      const out = await brain.complete(prompt, { model: modelFor(brain), levelId: "worker", trial: 1, maxTokens: agent.spec.reasoning === "low" ? 700 : 1600 });
      const trimmed = out.text.trim();
      if (trimmed) text = trimmed;
      else failNote = "model returned an empty response";
    } catch (err: any) {
      failNote = friendlyError(err.message);
    }
  }

  if (text !== null) {
    if (!(await gateOrEscalate(agent, text, "model_response", task.goalId, "Model response"))) throw new Error("response quarantined");
    onProgress(90);
    bus.post({ threadId: task.goalId, from: agent.id, kind: "finding", body: `${artifact} delivered (${brain!.name}):\n${text.slice(0, 600)}` });
    return text;
  }

  // Honest degrade: the brain died mid-task. Complete as LABELED simulation so
  // one dead key costs one artifact's realism, not the whole goal.
  task.mode = "sim";
  const staged = milestoneFor(agent.spec.role, niche)?.done ?? `Done: ${task.title}`;
  bus.post({ threadId: task.goalId, from: agent.id, kind: "status", body: `Model call unavailable (${failNote}) — completing this task as LABELED SIMULATION. It flips real automatically once a working model key is connected in BUSINESS SETUP.` });
  registry.upsert(agent, `Brain unavailable — task degraded to labeled sim: ${failNote.slice(0, 80)}`);
  onProgress(90);
  bus.post({ threadId: task.goalId, from: agent.id, kind: "finding", body: staged });
  return staged;
}

function modelFor(brain: ModelBackend): string {
  if (brain.name === "api") return process.env.WORKER_MODEL ?? "claude-haiku-4-5-20251001";
  if (brain.name === "nvidia") return process.env.WORKER_MODEL ?? "nvidia/llama-3.1-nemotron-70b-instruct";
  // Cheapest Featherless Nemotron (input $0.05/M, output $0.20/M) for testing.
  // Swap to nvidia/NVIDIA-Nemotron-3-Super-120B-A12B-BF16 (or set WORKER_MODEL) for the demo.
  if (brain.name === "featherless") return process.env.WORKER_MODEL ?? "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B-BF16";
  return process.env.WORKER_MODEL ?? "haiku";
}