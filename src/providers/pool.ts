// Brain pool — ONE place that knows every model provider, its runtime health,
// and the failover order. This is the seam that lets the business add keys
// without touching worker code: a new provider is one BRAIN_PROVIDERS entry
// (+ an INTEGRATIONS row in env.ts for the setup card and a doctor probe).
//
// Why health matters: "key is pasted" and "key works" are different facts.
// A valid-looking Featherless key with zero credit passes every presence check
// and then 402s on EVERY task. Before the pool, that dead key also WON the
// auto-detect, so a working Anthropic key sitting right next to it was never
// tried. Now: the first failure classifies the error, marks the provider down
// with a cooldown, and the same call fails over to the next configured brain.
//
// Semantics:
//   - WORKER_BACKEND pins ONE provider (operator intent — no failover past an
//     explicit pin; a pinned-but-broken brain degrades to labeled sim exactly
//     as before, loudly).
//   - No pin: every configured provider is tried in priority order; down
//     providers are skipped until their cooldown expires. If ALL are down we
//     still try the least-recently-failed one (state may have changed; one
//     probe per call is cheap and self-heals).
//   - WORKER_MODEL applies to the FIRST choice only — model slugs are not
//     portable across providers; failover attempts use each provider's default.
//
// SECRET HYGIENE: this module reads env keys and passes them to backend
// constructors. It never logs, returns, or posts a key value; health reports
// carry booleans, provider ids and friendly error text only.

import type { ModelBackend } from "../evals/types.js";
import { AnthropicApiBackend, ClaudeCliBackend, OpenAICompatBackend } from "../evals/backends.js";

export interface BrainProvider {
  id: string;               // stable id ("featherless" | "anthropic" | "nvidia" | "cli" | ...)
  label: string;            // plain-English name for status lines
  integrationId: string;    // matching INTEGRATIONS row in src/config/env.ts
  envKeys: string[];        // ALL must be set for the provider to be "configured"
  pin: string;              // WORKER_BACKEND value that pins this provider
  priority: number;         // auto-detect order (lower wins)
  pinOnly?: boolean;        // never auto-detected (cli: uses local login, dev-only)
  defaultModel: () => string;
  make: () => ModelBackend; // assumes envKeys are present
}

// Adding a provider = adding an entry here. Priority mirrors the historical
// auto-detect order (featherless first so a demo needs only that one key).
export const BRAIN_PROVIDERS: BrainProvider[] = [
  {
    id: "featherless",
    label: "Featherless AI",
    integrationId: "brain-featherless",
    envKeys: ["FEATHERLESS_API_KEY"],
    pin: "featherless",
    priority: 1,
    defaultModel: () => "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B-BF16",
    make: () =>
      new OpenAICompatBackend(
        process.env.FEATHERLESS_API_KEY!,
        process.env.FEATHERLESS_API_BASE ?? "https://api.featherless.ai/v1",
        "featherless",
      ),
  },
  {
    id: "anthropic",
    label: "Claude",
    integrationId: "brain-anthropic",
    envKeys: ["ANTHROPIC_API_KEY"],
    pin: "api",
    priority: 2,
    defaultModel: () => "claude-haiku-4-5-20251001",
    make: () => new AnthropicApiBackend(process.env.ANTHROPIC_API_KEY!),
  },
  {
    id: "nvidia",
    label: "NVIDIA Nemotron",
    integrationId: "brain-nvidia",
    envKeys: ["NVIDIA_INFERENCE_API_KEY"],
    pin: "nvidia",
    priority: 3,
    defaultModel: () => "nvidia/llama-3.1-nemotron-70b-instruct",
    make: () => new OpenAICompatBackend(process.env.NVIDIA_INFERENCE_API_KEY!, process.env.NVIDIA_API_BASE ?? undefined),
  },
  {
    id: "cli",
    label: "Claude Code login",
    integrationId: "brain-anthropic",
    envKeys: [], // uses the local `claude` login, not an env key
    pin: "cli",
    priority: 99,
    pinOnly: true,
    defaultModel: () => "haiku",
    make: () => new ClaudeCliBackend(),
  },
];

// --- runtime health ---------------------------------------------------------

export type FailReason = "credit" | "auth" | "rate-limit" | "timeout" | "network" | "other";

export interface BrainHealth {
  state: "unknown" | "healthy" | "down";
  reason?: FailReason;
  lastError?: string;      // friendly-ish, never a key value
  downUntil?: number;      // epoch ms; skip until then (unless nothing else works)
  lastOkAt?: string;
  lastFailAt?: string;
  consecutiveFails: number;
}

const health = new Map<string, BrainHealth>();

function healthOf(id: string): BrainHealth {
  let h = health.get(id);
  if (!h) {
    h = { state: "unknown", consecutiveFails: 0 };
    health.set(id, h);
  }
  return h;
}

// Cooldowns per failure class. Auth/credit problems do not fix themselves in
// seconds — probing them on every task just burns latency; rate limits and
// network blips usually do clear quickly.
const COOLDOWN_MS: Record<FailReason, number> = {
  credit: 5 * 60_000,
  auth: 5 * 60_000,
  "rate-limit": 60_000,
  timeout: 30_000,
  network: 30_000,
  other: 60_000,
};

export function classifyFailure(raw: string): FailReason {
  if (/insufficient[_ ]credits|\b402\b/i.test(raw)) return "credit";
  if (/\b(401|403)\b|unauthorized|invalid[_ ]api[_ ]key/i.test(raw)) return "auth";
  if (/\b429\b|rate.?limit/i.test(raw)) return "rate-limit";
  if (/timed? ?out|aborted/i.test(raw)) return "timeout";
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|network/i.test(raw)) return "network";
  return "other";
}

export function noteBrainSuccess(id: string): void {
  const h = healthOf(id);
  h.state = "healthy";
  h.reason = undefined;
  h.lastError = undefined;
  h.downUntil = undefined;
  h.consecutiveFails = 0;
  h.lastOkAt = new Date().toISOString();
}

export function noteBrainFailure(id: string, raw: string): FailReason {
  const h = healthOf(id);
  const reason = classifyFailure(raw);
  h.state = "down";
  h.reason = reason;
  h.lastError = raw.slice(0, 200);
  h.consecutiveFails += 1;
  h.lastFailAt = new Date().toISOString();
  // Back off harder on repeat offenders (cap x4).
  h.downUntil = Date.now() + COOLDOWN_MS[reason] * Math.min(h.consecutiveFails, 4);
  return reason;
}

// A freshly saved key is a new fact — forget the old verdict for that provider.
export function resetHealthForKey(envKey: string): void {
  for (const p of BRAIN_PROVIDERS) {
    if (p.envKeys.includes(envKey)) health.delete(p.id);
  }
}

// --- selection --------------------------------------------------------------

export function configuredBrains(): BrainProvider[] {
  return BRAIN_PROVIDERS
    .filter((p) => !p.pinOnly && p.envKeys.length > 0 && p.envKeys.every((k) => process.env[k]))
    .sort((a, b) => a.priority - b.priority);
}

export function pinnedBrain(): { provider: BrainProvider | null; pin: string | null; missingKeys: string[] } {
  const pin = process.env.WORKER_BACKEND || null;
  if (!pin) return { provider: null, pin: null, missingKeys: [] };
  const p = BRAIN_PROVIDERS.find((x) => x.pin === pin) ?? null;
  if (!p) return { provider: null, pin, missingKeys: [] };
  const missing = p.envKeys.filter((k) => !process.env[k]);
  return { provider: missing.length ? null : p, pin, missingKeys: missing };
}

// The order this call would try providers in. Pin -> exactly that provider.
// Auto -> configured providers, up-first, expired-cooldown allowed; if every
// one is inside a cooldown, fall back to trying them anyway (least recently
// failed first) so a recovered account self-heals without a restart.
export function brainOrder(): BrainProvider[] {
  // Env-string check (not mode.ts) to keep this module cycle-free.
  if (process.env.SIM_MODE === "1" || (process.env.COMPANY_MODE ?? "").trim().toLowerCase() === "demo") return [];
  const { provider, pin } = pinnedBrain();
  if (pin) return provider ? [provider] : [];
  const configured = configuredBrains();
  const now = Date.now();
  const up = configured.filter((p) => {
    const h = healthOf(p.id);
    return h.state !== "down" || (h.downUntil ?? 0) <= now;
  });
  if (up.length) return up;
  return [...configured].sort(
    (a, b) => Date.parse(healthOf(a.id).lastFailAt ?? "0") - Date.parse(healthOf(b.id).lastFailAt ?? "0"),
  );
}

function modelForAttempt(p: BrainProvider, isFirstChoice: boolean): string {
  // WORKER_MODEL is provider-specific (a Featherless slug 404s on Anthropic),
  // so it only applies to the operator's first choice; failovers use defaults.
  if (isFirstChoice && process.env.WORKER_MODEL) return process.env.WORKER_MODEL;
  return typeof p.defaultModel === "function" ? p.defaultModel() : p.defaultModel;
}

export interface PoolAttempt {
  providerId: string;
  model: string;
  error: string;
  reason: FailReason;
}

// A ModelBackend whose complete() fails over across the configured providers.
// Callers keep the exact same interface they had with a single backend; the
// opts.model they pass is IGNORED (the pool owns per-provider model choice).
class BrainPoolBackend implements ModelBackend {
  name: string;
  constructor(private order: BrainProvider[]) {
    this.name = order.length === 1 ? order[0].id : `pool:${order.map((p) => p.id).join("→")}`;
  }

  async complete(prompt: string, opts: { model: string; levelId: string; trial: number; maxTokens?: number }) {
    const attempts: PoolAttempt[] = [];
    for (let i = 0; i < this.order.length; i++) {
      const p = this.order[i];
      const model = modelForAttempt(p, i === 0);
      try {
        const backend = p.make();
        const out = await backend.complete(prompt, { ...opts, model });
        noteBrainSuccess(p.id);
        if (attempts.length) {
          console.warn(`[brain-pool] ${p.id} answered after ${attempts.map((a) => `${a.providerId} failed (${a.reason})`).join(", ")}`);
        }
        return out;
      } catch (err: any) {
        const raw = String(err?.message ?? err);
        const reason = noteBrainFailure(p.id, raw);
        attempts.push({ providerId: p.id, model, error: raw.slice(0, 200), reason });
        console.warn(`[brain-pool] ${p.id} failed (${reason}): ${raw.slice(0, 160)}${i < this.order.length - 1 ? " — trying next brain" : ""}`);
      }
    }
    // Every configured brain failed. Surface the FIRST error (the operator's
    // preferred provider) — friendlyError() downstream turns it into a fix.
    const first = attempts[0];
    throw new Error(first ? first.error : "no model brain configured");
  }
}

// Drop-in for the old single-backend resolveBrain(): null when nothing is
// configured (or SIM_MODE) — callers already treat null as "labeled sim".
export function poolBrain(): ModelBackend | null {
  const order = brainOrder();
  if (!order.length) return null;
  return new BrainPoolBackend(order);
}

// --- status (for /api/providers, doctor, and the dashboard) -----------------

export function brainPoolStatus() {
  const { provider: pinProvider, pin, missingKeys } = pinnedBrain();
  const order = brainOrder();
  return {
    simMode: process.env.SIM_MODE === "1" || (process.env.COMPANY_MODE ?? "").trim().toLowerCase() === "demo",
    pinned: pin,
    pinnedSatisfied: pin ? Boolean(pinProvider) : null,
    pinnedMissingKeys: missingKeys,
    active: order[0]?.id ?? null,
    order: order.map((p) => p.id),
    providers: BRAIN_PROVIDERS.map((p) => {
      const h = healthOf(p.id);
      return {
        id: p.id,
        label: p.label,
        integrationId: p.integrationId,
        pin: p.pin,
        pinOnly: Boolean(p.pinOnly),
        configured: p.envKeys.length > 0 && p.envKeys.every((k) => Boolean(process.env[k])),
        envKeys: p.envKeys.map((k) => ({ name: k, set: Boolean(process.env[k]) })),
        state: h.state,
        reason: h.reason ?? null,
        lastError: h.lastError ?? null,
        coolingDownForMs: h.downUntil ? Math.max(0, h.downUntil - Date.now()) : 0,
        lastOkAt: h.lastOkAt ?? null,
        lastFailAt: h.lastFailAt ?? null,
      };
    }),
  };
}
