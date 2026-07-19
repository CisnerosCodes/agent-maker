// Tightening-log sidecar — the audit trail for the policy-tightening loop.
// Spec: policy-tightening-loop.spec.md §12 (data contract) / §4.2 (provenance).
//
// The learned deny rules themselves live in the live OpenShell policy revision
// (native additive merge, §4), NOT here. This file is the git-tracked provenance
// record — one JSONL row per applied/escalated/rejected rule — so a human (or a
// judge with `cat`) can audit WHY the boundary tightened. Same fs idiom as
// src/memory/runs.ts (readFileSync/writeFileSync + mkdirSync recursive).

import { readFileSync, appendFileSync, existsSync, mkdirSync } from "node:fs";

// Overridable so the adversarial harness can redirect writes to a scratch dir and
// keep the git-tracked file clean (§16 idempotent/apply-success cases). Default is
// the real, committed sidecar location.
const DIR = process.env.TIGHTENING_LOG_DIR ?? "./policies/generated";
const FILE = `${DIR}/tightening-log.jsonl`;

export interface TighteningLogRow {
  ts: string;                 // ISO, when the rule was applied
  run: string;                // RunRecord.runId when available, else "adhoc"
  role: string;               // sandbox the rule tightened (== nemoclaw sandbox name)
  detector: string;           // ScanResult category / "openshell:egress_denied"
  target: string;             // host or path glob that got denied
  kind: "deny_host" | "deny_path";
  direction: "deny";          // ALWAYS "deny" in v1 (§2 invariant)
  revision: number | null;    // OpenShell policy revision the merge produced; null offline
  sourceCaseId: string | null; // adversarial-corpus id when known, else null
  applied: boolean;           // false when conflictCheck routed to escalate/reject
}

/** mkdir -p + append one JSONL row. Append-only; never rewrites prior rows. */
export function appendRow(row: TighteningLogRow): void {
  mkdirSync(DIR, { recursive: true });
  appendFileSync(FILE, JSON.stringify(row) + "\n");
}

/** All rows (optionally filtered by role) for dedupe + the dashboard audit panel. */
export function readLog(role?: string): TighteningLogRow[] {
  if (!existsSync(FILE)) return [];
  let rows: TighteningLogRow[];
  try {
    rows = readFileSync(FILE, "utf8")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => JSON.parse(l) as TighteningLogRow);
  } catch {
    return [];
  }
  return role ? rows.filter((r) => r.role === role) : rows;
}
