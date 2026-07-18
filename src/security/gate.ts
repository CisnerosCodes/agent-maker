// SecurityGate — the single choke point for runtime security.
//
// EVERY model input/output in the system passes through scan():
//   user prompts, model responses, tool calls, tool results, ingested docs.
// One choke point = maximum "depth of instrumentation" and one place to demo.
//
// Two detection layers, merged:
//   1. Local heuristics (detect.ts) — always on, keyless, keeps demos honest.
//   2. HiddenLayer Runtime Security — when HIDDENLAYER_API_KEY is set.
//      TODO(Sky): confirm endpoint + response schema against HL docs (event
//      code AITX-2026) in hlScan()/mapFindings below.
//
// Detection routing policy (our design call, per the track brief):
//   clean   -> pass through
//   flagged -> escalate for human approve/deny (agent status: blocked)
//   blocked -> refuse immediately, log, notify CEO

import type { IoKind, ScanResult, Verdict } from "../types.js";
import { heuristicScan } from "./detect.js";

const HL_API_URL = process.env.HIDDENLAYER_API_URL ?? "https://api.hiddenlayer.ai"; // TODO(Sky): confirm exact runtime-security endpoint
const HL_API_KEY = process.env.HIDDENLAYER_API_KEY;

export async function scan(content: string, kind: IoKind, agentId: string): Promise<ScanResult> {
  const categories = heuristicScan(content);
  let raw: unknown;

  if (HL_API_KEY) {
    try {
      const hl = await hlScan(content, kind, agentId);
      categories.push(...hl.categories);
      raw = hl.raw;
      if (hl.verdict === "blocked") return { verdict: "blocked", categories, raw };
    } catch (err: any) {
      console.error(`[SecurityGate] HiddenLayer error (${err.message}) — continuing on heuristics for ${kind}`);
      categories.push("scanner_degraded");
    }
  }

  const verdict: Verdict = categories.some((c) => c !== "scanner_degraded") ? "flagged" : "clean";
  return { verdict, categories, raw };
}

async function hlScan(content: string, kind: IoKind, agentId: string): Promise<ScanResult> {
  const res = await fetch(`${HL_API_URL}/v1/scan`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${HL_API_KEY}` },
    body: JSON.stringify({ content, kind, agent: agentId }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return mapFindings(await res.json());
}

function mapFindings(raw: any): ScanResult {
  // TODO(Sky): map HiddenLayer's actual response schema.
  const categories: string[] = raw?.detections?.map((d: any) => `hiddenlayer:${d.category}`) ?? [];
  let verdict: Verdict = categories.length ? "flagged" : "clean";
  if (raw?.severity === "critical") verdict = "blocked";
  return { verdict, categories, raw };
}
