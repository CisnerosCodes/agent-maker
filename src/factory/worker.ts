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
import { registry } from "../registry/registry.js";
import { bus } from "../bus/bus.js";

export interface Product { title: string; price: number; image?: string }

const RESEARCH_SOURCE = process.env.RESEARCH_SOURCE_URL ?? "https://dummyjson.com/products/category/mens-shoes?limit=10";

export function resolveBrain(): ModelBackend | null {
  if (process.env.SIM_MODE === "1") return null;
  const pick = process.env.WORKER_BACKEND;
  if (pick === "api" || (!pick && process.env.ANTHROPIC_API_KEY))
    return new AnthropicApiBackend(process.env.ANTHROPIC_API_KEY!);
  if (pick === "nvidia" || (!pick && process.env.NVIDIA_INFERENCE_API_KEY))
    return new OpenAICompatBackend(process.env.NVIDIA_INFERENCE_API_KEY!, process.env.NVIDIA_API_BASE ?? undefined);
  if (pick === "cli") return new ClaudeCliBackend();
  return null;
}

export function workerMode(role: string): "real" | "sim" {
  if (process.env.SIM_MODE === "1") return "sim";
  if (role === "research") return "real";
  if (role === "store-builder") return process.env.SHOPIFY_ADMIN_TOKEN && process.env.SHOPIFY_STORE_URL ? "real" : "sim";
  if (role === "copywriter") return resolveBrain() ? "real" : "sim";
  return "sim";
}

// Gate helper: scan content; flagged -> escalate and await the human. Returns
// true to proceed, false if denied (caller fails the task).
export async function gateOrEscalate(agent: AgentRecord, content: string, kind: Parameters<typeof scan>[1], threadId: string, reason: string): Promise<boolean> {
  const result: ScanResult = await scan(content, kind, agent.id);
  if (result.verdict === "clean") return true;
  if (result.verdict === "blocked") {
    bus.post({ threadId, from: agent.id, kind: "system", body: `BLOCKED by SecurityGate (${result.categories.join(", ")}): ${reason}` });
    return false;
  }
  const prev = agent.status;
  agent.status = "blocked";
  registry.upsert(agent, `Escalation: ${reason} [${result.categories.join(", ")}]`);
  const { escalation, decision } = escalations.create(agent.id, reason, result, content);
  bus.post({ threadId, from: agent.id, kind: "question", body: `Security escalation ${escalation.id}: ${reason} — detections [${result.categories.join(", ")}]. Awaiting operator approve/deny.` });
  const verdict = await decision;
  agent.status = verdict === "approved" ? (prev === "blocked" ? "working" : prev) : agent.status;
  if (verdict === "approved") {
    registry.upsert(agent, `Escalation ${escalation.id} approved — continuing`);
    bus.post({ threadId, from: agent.id, kind: "status", body: `Operator approved ${escalation.id} — continuing.` });
    return true;
  }
  registry.upsert(agent, `Escalation ${escalation.id} DENIED`);
  bus.post({ threadId, from: agent.id, kind: "system", body: `Operator denied ${escalation.id} — content quarantined.` });
  return false;
}

// --- role implementations (real path) ---

export async function runResearch(agent: AgentRecord, task: Task, niche: string, onProgress: (p: number) => void): Promise<Product[]> {
  onProgress(10);
  bus.post({ threadId: task.goalId, from: agent.id, kind: "status", body: `Fetching live product data: ${RESEARCH_SOURCE}` });

  const res = await fetch(RESEARCH_SOURCE, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`source fetch failed: HTTP ${res.status}`);
  const data: any = await res.json();
  const rawProducts: any[] = data.products ?? data.items ?? [];
  const products: Product[] = rawProducts.slice(0, 10).map((p) => ({
    title: p.title ?? p.name ?? "unknown",
    price: Number(p.price ?? 0),
    image: p.thumbnail ?? p.image,
  }));
  onProgress(50);

  // Ingested external content goes through the gate before anyone reasons on it.
  const ok = await gateOrEscalate(agent, JSON.stringify(rawProducts).slice(0, 2000), "ingested_document", task.goalId, "External research data ingested");
  if (!ok) throw new Error("ingested data quarantined by security policy");
  onProgress(65);

  let summary: string;
  const brain = resolveBrain();
  if (brain) {
    const prompt = `You are a retail research analyst. In 3 sentences, summarize the opportunity for a "${niche}" store given these products (title/price): ${products.map((p) => `${p.title} ($${p.price})`).join("; ")}. Be concrete about price band and which 3 products to lead with.`;
    if (!(await gateOrEscalate(agent, prompt, "user_prompt", task.goalId, "Model prompt"))) throw new Error("prompt quarantined");
    const out = await brain.complete(prompt, { model: modelFor(brain), levelId: "worker", trial: 1, maxTokens: 300 });
    if (!(await gateOrEscalate(agent, out.text, "model_response", task.goalId, "Model response"))) throw new Error("response quarantined");
    summary = out.text.trim();
  } else {
    const sorted = [...products].sort((a, b) => a.price - b.price);
    const mid = sorted.slice(Math.floor(sorted.length / 3), Math.floor(sorted.length / 3) + 3);
    summary = `Real data, no-model synthesis (add a key for LLM analysis): ${products.length} live products found, $${sorted[0]?.price}–$${sorted[sorted.length - 1]?.price}. Lead with mid-band: ${mid.map((p) => `${p.title} ($${p.price})`).join(", ")}.`;
  }
  onProgress(90);
  bus.post({ threadId: task.goalId, from: agent.id, kind: "finding", body: `Research complete — ${summary}` });
  return products;
}

export async function runStoreBuilder(agent: AgentRecord, task: Task, products: Product[], onProgress: (p: number) => void): Promise<string> {
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

export async function runCopywriter(agent: AgentRecord, task: Task, niche: string, products: Product[], onProgress: (p: number) => void): Promise<string> {
  const brain = resolveBrain()!;
  onProgress(20);
  const prompt = `Write a punchy one-line product description for each of these ${niche} products (format "Title — description"): ${products.slice(0, 3).map((p) => p.title).join("; ")}`;
  if (!(await gateOrEscalate(agent, prompt, "user_prompt", task.goalId, "Model prompt"))) throw new Error("prompt quarantined");
  const out = await brain.complete(prompt, { model: modelFor(brain), levelId: "worker", trial: 1, maxTokens: 300 });
  if (!(await gateOrEscalate(agent, out.text, "model_response", task.goalId, "Model response"))) throw new Error("response quarantined");
  onProgress(90);
  bus.post({ threadId: task.goalId, from: agent.id, kind: "finding", body: `Copy delivered:\n${out.text.trim().slice(0, 500)}` });
  return out.text.trim();
}

function modelFor(brain: ModelBackend): string {
  if (brain.name === "api") return process.env.WORKER_MODEL ?? "claude-haiku-4-5-20251001";
  if (brain.name === "nvidia") return process.env.WORKER_MODEL ?? "nvidia/llama-3.1-nemotron-70b-instruct";
  return process.env.WORKER_MODEL ?? "haiku";
}
