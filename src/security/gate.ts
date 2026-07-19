// SecurityGate — the single choke point for runtime security.
//
// EVERY model input/output in the system passes through scan():
//   user prompts, model responses, tool calls, tool results, ingested docs.
// One choke point = maximum "depth of instrumentation" and one place to demo.
//
// Two detection layers, merged:
//   1. Local heuristics (detect.ts) — always on, keyless, keeps demos honest.
//   2. HiddenLayer Runtime Security — when client credentials are set
//      (OAuth2 client-credentials, see hl-auth.ts). Portal: event code AITX-2026.
//
// Detection routing policy (our design call, per the track brief):
//   clean   -> pass through
//   flagged -> escalate for human approve/deny (agent status: blocked)
//   blocked -> refuse immediately, log, notify CEO
//
// FAIL POSTURE (hiddenlayer-gate.spec.md §6): fail-CLOSED. A degraded/unreachable
// scanner returns `flagged` + `scanner_unavailable` — it NEVER silently passes.
// Only the no-credentials dev path fails open, and it warns loudly.

import type { IoKind, ScanResult, Verdict, AgentRecord } from "../types.js";
import { heuristicScan } from "./detect.js";
import { getToken, invalidateToken, hlConfigured } from "./hl-auth.js";
import { bus } from "../bus/bus.js";
import { escalations } from "./escalations.js";
import { governance } from "../governance/governance.js";

const HL_API_URL = process.env.HIDDENLAYER_API_URL ?? "https://api.hiddenlayer.ai";
const HL_PROJECT_ID = process.env.HIDDENLAYER_PROJECT_ID;

// Single fail-open switch (spec §6). Default false = fail closed on scanner
// failure. Set HL_FAIL_OPEN=1 only for local dev where a hard-stop is noise.
const FAIL_OPEN = process.env.HL_FAIL_OPEN === "1";

const RANK: Record<Verdict, number> = { clean: 0, flagged: 1, blocked: 2 };
const worse = (a: Verdict, b: Verdict): Verdict => (RANK[a] >= RANK[b] ? a : b);
const heuristicVerdict = (categories: string[]): Verdict => {
  if (categories.length === 0) return "clean";
  if (categories.some((c) => c.includes("data_exfiltration") || c.includes("suspicious_endpoint"))) return "blocked";
  return "flagged";
};

let warnedNoCreds = false;

export async function scan(content: string, kind: IoKind, agentId: string): Promise<ScanResult> {
  const categories = heuristicScan(content);

  // Dev path: no HiddenLayer credentials. Heuristic floor only, fail-OPEN loud.
  if (!hlConfigured()) {
    if (!warnedNoCreds) {
      console.warn(
        "[SecurityGate] HiddenLayer NOT configured — heuristic floor only (dev fail-open). " +
          "Set HIDDENLAYER_CLIENT_ID / _CLIENT_SECRET / _PROJECT_ID for authoritative scanning.",
      );
      warnedNoCreds = true;
    }
    return { verdict: heuristicVerdict(categories), categories };
  }

  try {
    const hl = await hlScan(content, kind, agentId);
    const merged = [...new Set([...categories, ...hl.categories])];
    // HL is authoritative; heuristics may only raise severity, never lower it.
    return { verdict: worse(hl.verdict, heuristicVerdict(categories)), categories: merged, raw: hl.raw };
  } catch (err: any) {
    console.error(`[SecurityGate] HiddenLayer scan failed (${err.message}) for ${kind}`);
    if (FAIL_OPEN) {
      console.warn("[SecurityGate] HL_FAIL_OPEN=1 — passing on heuristics despite scanner failure.");
      return { verdict: heuristicVerdict(categories), categories: [...categories, "scanner_degraded"] };
    }
    // C1 / spec §6: fail CLOSED. A degraded scanner forces human review.
    return {
      verdict: worse("flagged", heuristicVerdict(categories)),
      categories: [...new Set([...categories, "scanner_unavailable"])],
      raw: { error: err.message },
    };
  }
}

// IoKind -> HiddenLayer message role (spec §4). v2 canonical roles are
// user | assistant | system | tool.
const ROLE_MAP: Record<IoKind, string> = {
  user_prompt: "user",
  ingested_document: "user", // document channel, still a user-side input
  tool_call: "assistant", // outbound action
  model_response: "assistant",
  tool_result: "tool",
};

// metadata.model is REQUIRED (omitting it returns 422). It's a grouping label on
// HL's side, not a real model call. provider is a free label alongside it.
const HL_MODEL_TAG = process.env.HIDDENLAYER_MODEL_TAG ?? "agent-maker-worker";
const HL_PROVIDER_TAG = process.env.HIDDENLAYER_PROVIDER_TAG ?? "anthropic";

async function hlScan(content: string, kind: IoKind, agentId: string): Promise<ScanResult> {
  // Beta runtime endpoint (the SDK's client.runtime.evaluate_interaction). This is
  // the endpoint our OAuth key is authorized for — no web-console project setup
  // needed; the project auto-resolves server-side. Body is the canonical
  // interaction: a messages[] list where content is an array of typed parts (a
  // plain string is rejected — text must be wrapped in a {type:"text"} part).
  const body = JSON.stringify({
    interaction: {
      messages: [{ role: ROLE_MAP[kind], content: [{ type: "text", text: content }] }],
    },
    metadata: { requester_id: agentId, model: HL_MODEL_TAG, provider: HL_PROVIDER_TAG },
  });

  let res = await postInteraction(body, await getToken());
  if (res.status === 401) {
    // Token may have expired between cache and call — refresh once, retry once.
    invalidateToken();
    res = await postInteraction(body, await getToken());
  }
  if (!res.ok) throw new Error(`interaction-evaluations HTTP ${res.status}`);
  return mapFindings(await res.json());
}

function postInteraction(body: string, token: string): Promise<Response> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
  // Optional: the project auto-resolves server-side; only send an explicit
  // override if the operator set one.
  if (HL_PROJECT_ID) headers["HL-Project-Id"] = HL_PROJECT_ID;
  return fetch(`${HL_API_URL}/detection/v2/interaction-evaluations`, {
    method: "POST",
    headers,
    body,
    signal: AbortSignal.timeout(15000),
  });
}

// CEO helper: run a prompt through the security gate, call the model, then
// scan the response. Returns the model response text if clean/flagged-autoapproved,
// throws if blocked. CEO model I/O MUST go through this (ceo-heartbeat.spec.md §5).
export async function guarded(
  agent: AgentRecord,
  prompt: string,
  complete: (prompt: string) => Promise<string>,
  threadId: string,
  reason: string
): Promise<string> {
  // Inbound scan: prompt
  const promptScan = await scan(prompt, "user_prompt", agent.id);
  if (promptScan.verdict === "blocked") {
    bus.post({ threadId, from: agent.id, kind: "system", body: `CEO prompt blocked: ${promptScan.categories.join(", ")} — ${reason}` });
    throw new Error(`CEO prompt blocked: ${promptScan.categories.join(", ")}`);
  }
  if (promptScan.verdict === "flagged" && !governance.autoApprovesFlagged(promptScan.verdict)) {
    // In assisted/supervised, flagged prompts need approval too
    const { decision } = escalations.create(agent.id, reason, promptScan, prompt);
    const verdict = await decision;
    if (verdict === "denied") {
      bus.post({ threadId, from: agent.id, kind: "system", body: `Operator denied CEO prompt: ${reason}` });
      throw new Error("CEO prompt denied by operator");
    }
  }

  // Call the model
  const response = await complete(prompt);

  // Outbound scan: response
  const responseScan = await scan(response, "model_response", agent.id);
  if (responseScan.verdict === "blocked") {
    bus.post({ threadId, from: agent.id, kind: "system", body: `CEO response blocked: ${responseScan.categories.join(", ")} — ${reason}` });
    throw new Error(`CEO response blocked: ${responseScan.categories.join(", ")}`);
  }
  if (responseScan.verdict === "flagged" && !governance.autoApprovesFlagged(responseScan.verdict)) {
    const { decision } = escalations.create(agent.id, reason, responseScan, response);
    const verdict = await decision;
    if (verdict === "denied") {
      bus.post({ threadId, from: agent.id, kind: "system", body: `Operator denied CEO response: ${reason}` });
      throw new Error("CEO response denied by operator");
    }
  }

  return response;
}

function mapFindings(raw: any): ScanResult {
  // Beta v2 schema (interaction-evaluations / evaluate_interaction):
  //   raw.outcome = { action: "NONE"|"DETECT"|"REDACT"|"BLOCK",
  //                   threat_level: "NONE"|"LOW"|"MEDIUM"|"HIGH"|"CRITICAL",
  //                   detections: [ { ...name/type/category } ] }
  // NOTE: we intentionally read outcome.detections, NOT the per-message
  // analysis.signals dict — every signal type is always present there (schema
  // defaults when nothing fired), so it can't tell us what actually triggered.
  const outcome = raw?.outcome ?? {};
  const detections: any[] = outcome.detections ?? [];
  const categories = [
    ...new Set(
      detections.map((d) => String(d?.rule_name ?? d?.name ?? d?.type ?? d?.category ?? "detection")),
    ),
  ];
  const action = String(outcome.action ?? "NONE").toUpperCase();
  const threat = String(outcome.threat_level ?? "NONE").toLowerCase();
  const isExfil = categories.some((c) => /data_leak|leakage|exfil|pii|entity|secret/i.test(c));

  // Verdict decision table (spec §5). Prompt-injection stays `flagged` (the
  // human approve/deny is the demo); exfil/critical hard-`blocked`.
  let verdict: Verdict = "clean";
  if (isExfil || (action === "BLOCK" && (threat === "high" || threat === "critical"))) {
    verdict = "blocked";
  } else if (action === "BLOCK" || action === "REDACT" || action === "DETECT" || categories.length) {
    verdict = "flagged";
  }
  return { verdict, categories, raw };
}