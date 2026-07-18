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

import type { IoKind, ScanResult, Verdict } from "../types.js";
import { heuristicScan } from "./detect.js";
import { getToken, invalidateToken, hlConfigured } from "./hl-auth.js";

const HL_API_URL = process.env.HIDDENLAYER_API_URL ?? "https://api.hiddenlayer.ai";
const HL_PROJECT_ID = process.env.HIDDENLAYER_PROJECT_ID;

// Single fail-open switch (spec §6). Default false = fail closed on scanner
// failure. Set HL_FAIL_OPEN=1 only for local dev where a hard-stop is noise.
const FAIL_OPEN = process.env.HL_FAIL_OPEN === "1";

const RANK: Record<Verdict, number> = { clean: 0, flagged: 1, blocked: 2 };
const worse = (a: Verdict, b: Verdict): Verdict => (RANK[a] >= RANK[b] ? a : b);
const heuristicVerdict = (categories: string[]): Verdict => (categories.length ? "flagged" : "clean");

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

// IoKind -> HiddenLayer interaction role (spec §4).
const ROLE_MAP: Record<IoKind, string> = {
  user_prompt: "user",
  ingested_document: "user", // document channel, still a user-side input
  tool_call: "assistant", // outbound action
  model_response: "assistant",
  tool_result: "tool",
};

// metadata.model is REQUIRED by the interactions endpoint (verified live: omitting
// it returns 422). It's a grouping label on HL's side, not a real model call.
const HL_MODEL_TAG = process.env.HIDDENLAYER_MODEL_TAG ?? "agent-maker-worker";

async function hlScan(content: string, kind: IoKind, agentId: string): Promise<ScanResult> {
  const body = JSON.stringify({
    metadata: { requester_id: agentId, source: "agent-maker", model: HL_MODEL_TAG },
    input: { role: ROLE_MAP[kind], content },
  });

  let res = await postInteraction(body, await getToken());
  if (res.status === 401) {
    // Token may have expired between cache and call — refresh once, retry once.
    invalidateToken();
    res = await postInteraction(body, await getToken());
  }
  if (!res.ok) throw new Error(`interactions HTTP ${res.status}`);
  return mapFindings(await res.json());
}

function postInteraction(body: string, token: string): Promise<Response> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
  // Optional: the project auto-resolves server-side; only send an explicit
  // override if the operator set one.
  if (HL_PROJECT_ID) headers["hl-project-id"] = HL_PROJECT_ID;
  return fetch(`${HL_API_URL}/detection/v1/interactions`, {
    method: "POST",
    headers,
    body,
    signal: AbortSignal.timeout(15000),
  });
}

function mapFindings(raw: any): ScanResult {
  // Real HiddenLayer V1 schema (verified live 2026-07-18):
  //   raw.evaluation = { action: "Allow"|"Block"|"Redact"|..., threat_level:
  //                      "None"|"Low"|"Medium"|"High"|"Critical", has_detections: bool }
  //   raw.analysis   = [ { name, phase: "input"|"output", detected: bool, findings } ]
  const evaluation = raw?.evaluation ?? {};
  const analysis: any[] = raw?.analysis ?? [];
  const categories = [
    ...new Set(analysis.filter((a) => a?.detected).map((a) => String(a?.name ?? "detection"))),
  ];
  const action = String(evaluation.action ?? "Allow").toUpperCase();
  const threat = String(evaluation.threat_level ?? "None").toLowerCase();
  const isExfil = categories.some((c) => /data_leak|leakage|exfil|pii|entity|secret/i.test(c));

  // Verdict decision table (spec §5). Prompt-injection stays `flagged` (the
  // human approve/deny is the demo); exfil/critical hard-`blocked`.
  let verdict: Verdict = "clean";
  if (isExfil || (action === "BLOCK" && (threat === "high" || threat === "critical"))) {
    verdict = "blocked";
  } else if (action === "BLOCK" || action === "REDACT" || evaluation.has_detections || categories.length) {
    verdict = "flagged";
  }
  return { verdict, categories, raw };
}
