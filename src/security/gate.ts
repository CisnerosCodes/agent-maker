// SecurityGate — the single choke point for HiddenLayer Runtime Security.
//
// EVERY model input/output in the system passes through scan():
//   user prompts, model responses, tool calls, tool results, ingested docs.
// One choke point = maximum "depth of instrumentation" and one place to demo.
//
// Detection routing policy (our design call, per the track brief):
//   clean   -> pass through
//   flagged -> log + escalate to Slack for human approve/deny (agent status: blocked)
//   blocked -> refuse immediately, log, notify CEO
//
// HiddenLayer docs: get API key at the event link, code AITX-2026.

import type { IoKind, ScanResult, Verdict } from "../types.js";

const HL_API_URL = process.env.HIDDENLAYER_API_URL ?? "https://api.hiddenlayer.ai"; // TODO: confirm exact runtime-security endpoint from docs
const HL_API_KEY = process.env.HIDDENLAYER_API_KEY;

export async function scan(content: string, kind: IoKind, agentId: string): Promise<ScanResult> {
  if (!HL_API_KEY) {
    // Fail-open in dev, but LOUDLY. Flip to fail-closed before the demo.
    console.warn(`[SecurityGate] HIDDENLAYER_API_KEY not set — passing ${kind} from ${agentId} unscanned`);
    return { verdict: "clean", categories: [] };
  }

  // TODO(Sky): real HiddenLayer Runtime Security API call.
  // Shape: POST prompt/response for analysis, map their findings to our Verdict.
  const res = await fetch(`${HL_API_URL}/v1/scan`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${HL_API_KEY}` },
    body: JSON.stringify({ content, kind, agent: agentId }),
  });

  if (!res.ok) {
    console.error(`[SecurityGate] HiddenLayer error ${res.status} — failing CLOSED for ${kind}`);
    return { verdict: "flagged", categories: ["scanner_unavailable"] };
  }

  const raw = await res.json();
  return mapFindings(raw);
}

function mapFindings(raw: any): ScanResult {
  // TODO(Sky): map HiddenLayer's actual response schema.
  const categories: string[] = raw?.detections?.map((d: any) => d.category) ?? [];
  let verdict: Verdict = "clean";
  if (categories.includes("prompt_injection") || categories.includes("data_leakage")) verdict = "flagged";
  if (raw?.severity === "critical") verdict = "blocked";
  return { verdict, categories, raw };
}

// Convenience wrapper: scan, then route by verdict.
export async function guarded<T>(
  content: string,
  kind: IoKind,
  agentId: string,
  onFlagged: (scan: ScanResult) => Promise<"approved" | "denied">,
): Promise<{ allowed: boolean; scan: ScanResult }> {
  const result = await scan(content, kind, agentId);
  if (result.verdict === "clean") return { allowed: true, scan: result };
  if (result.verdict === "blocked") return { allowed: false, scan: result };
  const decision = await onFlagged(result); // escalate: Slack message + dashboard button
  return { allowed: decision === "approved", scan: result };
}
