// Policy-Tightening Loop — flag → boundary self-improvement.
// Spec: policy-tightening-loop.spec.md §11-14. Owner: Sky (security lane).
//
// After run N flags/blocks an attack, this promotes the detection from agent
// goodwill into the HARD OpenShell boundary: a generated `deny` fragment the
// agent cannot forget or be argued out of. "The sandbox got tighter because it
// learned" made literal.
//
// The load-bearing invariant (§2): TIGHTEN automatically, LOOSEN only with a
// human. `TighteningRule.direction` is the literal "deny" — the compiler emits no
// other value and applyRule asserts it before shelling out. A widen has NO code
// path in v1. Worst case of an auto-tighten is over-restriction: fails loud,
// trivially reviewable, never a security regression.
//
// Runs ONLY when explicitly invoked (§6 determinism firewall) — never from the
// timed store-launch orchestrator. Every OpenShell call goes through the SAME
// injectable `cli` seam dispatch uses (runOpenshell in nemoclaw.ts), so the whole
// loop is testable with no live gateway (§8, §15).

import { readFileSync, existsSync } from "node:fs";
import { runOpenshell, nemoclawEvents } from "../worker/nemoclaw.js";
import { appendRow, readLog } from "./tightening-log.js";

// Guardrail so a hung gateway can never wedge the loop. Apply is the heavy step
// (real merge + validate); list/dry-run are cheap reads.
const APPLY_TIMEOUT_MS = Number(process.env.POLICY_APPLY_TIMEOUT_MS ?? 30_000);
const READ_TIMEOUT_MS = Number(process.env.POLICY_READ_TIMEOUT_MS ?? 20_000);

const POLICY_DIR = process.env.POLICY_DIR ?? "./policies";

export type RuleKind = "deny_host" | "deny_path";

export interface CapturedSignal {
  role: string;
  detector: string;      // ScanResult category, or "openshell:egress_denied"
  target: string;        // host or path glob
  kind: RuleKind;
  run?: string;          // RunRecord.runId if the signal is tied to a recorded run
  sourceCaseId?: string; // adversarial corpus id when known
}

export interface TighteningRule extends CapturedSignal {
  direction: "deny";     // §2 invariant — the ONLY legal value in v1
}

export interface ApplyResult {
  ok: boolean;
  revision: number | null;
  exitCode: number | null;
  error?: string;
}

// ---- (1) CAPTURE ----------------------------------------------------------
// Turn a dispatch result + its scans into deduped signals. Pure; no I/O.
// Hosts come from AgentResult.deniedEgress, detectors from the ScanResult
// categories co-located with them (so a deny_host carries WHY — hl:prompt_injection
// vs a bare egress denial). No host/path without a target is ever emitted.
export function capture(input: {
  role: string;
  run?: string;
  deniedEgress?: string[];
  scans?: Array<{ categories: string[]; sourceCaseId?: string }>;
  deniedPaths?: string[];
}): CapturedSignal[] {
  const scanCats = (input.scans ?? []).flatMap((s) => s.categories).filter(Boolean);
  // A scan with categories is a non-clean verdict; label the co-located signals
  // with it. Bare egress denials (no scan fired) carry the openshell detector.
  const detector = scanCats.length ? `hl:${scanCats[0]}` : "openshell:egress_denied";
  const sourceCaseId = (input.scans ?? []).find((s) => s.sourceCaseId)?.sourceCaseId;

  const signals: CapturedSignal[] = [];
  const seen = new Set<string>(); // dedupe by (role, kind, target)
  const push = (kind: RuleKind, target: string) => {
    const t = target.trim();
    if (!t) return; // never emit a signal without a target
    const key = `${input.role}|${kind}|${t}`;
    if (seen.has(key)) return;
    seen.add(key);
    signals.push({ role: input.role, detector, target: t, kind, run: input.run, sourceCaseId });
  };

  for (const host of input.deniedEgress ?? []) push("deny_host", host);
  for (const path of input.deniedPaths ?? []) push("deny_path", path);
  return signals;
}

// ---- (2) COMPILE ----------------------------------------------------------
// CapturedSignal[] → TighteningRule[]. Stamps direction:"deny" and drops any
// (role, kind, target) already applied:true in the tightening-log — idempotent:
// re-running the loop on the same run is a no-op.
export function compile(signals: CapturedSignal[], role: string): TighteningRule[] {
  const already = new Set(
    readLog(role)
      .filter((r) => r.applied)
      .map((r) => `${r.kind}|${r.target}`),
  );
  return signals
    .filter((s) => s.role === role && !already.has(`${s.kind}|${s.target}`))
    .map((s) => ({ ...s, direction: "deny" as const }));
}

// ---- (3) CONFLICT CHECK ---------------------------------------------------
// §5. Never mutates policy. Loads the role's REQUIRED allowlist from the on-disk
// worker-<role>.yaml and classifies each rule:
//   direction !== "deny"           → reject  (defensive; unreachable in v1)
//   host collides with allowlist   → escalate (false-positive candidate; would
//                                    strangle the worker's own legitimate egress)
//   else                           → apply
export function conflictCheck(rule: TighteningRule): "apply" | "escalate" | "reject" {
  if (rule.direction !== "deny") return "reject";
  if (rule.kind === "deny_host" && loadAllowlistHosts(rule.role).has(rule.target)) {
    return "escalate";
  }
  return "apply";
}

// Union of network_policies.*.endpoints[].host across the role's worker YAML.
// No YAML dep in this repo, and we only need the host set — extract `host:` lines
// directly (tolerant of quotes/comments). A missing file → empty set (nothing to
// collide with; the rule applies), which is the safe tighten direction.
function loadAllowlistHosts(role: string): Set<string> {
  for (const name of policyFileCandidates(role)) {
    const path = `${POLICY_DIR}/${name}`;
    if (!existsSync(path)) continue;
    const text = readFileSync(path, "utf8");
    const hosts = new Set<string>();
    for (const m of text.matchAll(/^\s*(?:-\s*)?host:\s*["']?([^"'\s#]+)/gm)) {
      hosts.add(m[1]);
    }
    return hosts;
  }
  return new Set();
}

function policyFileCandidates(role: string): string[] {
  // role "research" → worker-research.yaml; role "store-builder" → both the
  // hyphenated and the collapsed filename this repo actually uses (worker-storebuilder.yaml).
  return [`worker-${role}.yaml`, `worker-${role.replace(/-/g, "")}.yaml`];
}

// ---- (4) APPLY ------------------------------------------------------------
// Shell out through the injectable cli seam:
//   openshell policy update <role> --add-deny <target> --wait
// Asserts direction === "deny" first. Maps exit codes (§4.4 / §15):
//   0   → loaded; read the resulting revision via `policy list <role> --json`
//   1   → validation failed → reject, keep prior revision (fail-closed)
//   124 → timeout           → reject (fail-closed)
// Any non-zero / unparseable output ⇒ ok:false, no applied:true row.
export async function applyRule(rule: TighteningRule): Promise<ApplyResult> {
  if (rule.direction !== "deny") {
    // §2 invariant — a widen never reaches the gateway.
    return { ok: false, revision: null, exitCode: null, error: `refused non-deny direction: ${rule.direction}` };
  }
  const res = await runOpenshell(
    ["policy", "update", rule.role, "--add-deny", rule.target, "--wait"],
    APPLY_TIMEOUT_MS,
  );
  if (res.timedOut) return { ok: false, revision: null, exitCode: 124, error: "policy update timed out" };
  if (res.code !== 0) {
    return { ok: false, revision: null, exitCode: res.code, error: `policy update exit ${res.code} (validation failed)` };
  }
  // exit 0 = loaded. Read the revision the merge produced (best-effort — a missing
  // revision does not un-apply a loaded policy, so we stay ok:true with revision:null).
  const list = await runOpenshell(["policy", "list", rule.role, "--json"], READ_TIMEOUT_MS);
  return { ok: true, revision: parseRevision(list.stdout), exitCode: 0 };
}

function parseRevision(stdout: string): number | null {
  const payload = parseJson(stdout);
  const rev = payload?.revision ?? payload?.current_revision ?? payload?.rev;
  return typeof rev === "number" ? rev : null;
}

// ---- (5) DIFF -------------------------------------------------------------
// openshell policy update <role> --add-deny <target> --dry-run (no gateway call),
// post-processed to a compact before/after string for the dashboard (§4.5).
// NEVER combined with --wait (§4.5): dry-run for the visual, real run to apply.
export async function renderDiff(rule: TighteningRule): Promise<string> {
  const res = await runOpenshell(
    ["policy", "update", rule.role, "--add-deny", rule.target, "--dry-run"],
    READ_TIMEOUT_MS,
  );
  const merged = res.stdout.trim();
  const label = `${rule.kind === "deny_host" ? "deny host" : "deny path"} ${rule.target}`;
  // Compact before/after: the target moves from an IMPLICIT default-deny to a
  // NAMED learned deny. Show the merged doc under that framing.
  return [
    `— before: ${rule.target} blocked only by implicit default-deny`,
    `+ after:  ${label}  (named learned deny, revision pending)`,
    merged ? "" : "",
    merged,
  ]
    .filter((l) => l !== "")
    .join("\n");
}

// ---- orchestrator ---------------------------------------------------------
// capture → compile → conflictCheck → apply → log, for one role. Honors §6 (only
// runs when explicitly invoked — this function is never called from the store-launch
// path). Logs EVERY rule (applied, escalated, rejected) — the full audit trail,
// not just successes. Emits a `tightening` event for the live dashboard (§17).
export interface PolicyTightener {
  run(input: Parameters<typeof capture>[0]): Promise<{
    applied: TighteningRule[];
    escalated: TighteningRule[];
    rejected: TighteningRule[];
  }>;
}

class PolicyTightenerImpl implements PolicyTightener {
  async run(input: Parameters<typeof capture>[0]) {
    const rules = compile(capture(input), input.role);
    const applied: TighteningRule[] = [];
    const escalated: TighteningRule[] = [];
    const rejected: TighteningRule[] = [];

    for (const rule of rules) {
      const verdict = conflictCheck(rule);

      if (verdict === "escalate") {
        // Would strangle the role's own legitimate work — surface for human review,
        // do NOT apply (§5). Logged applied:false for the audit trail.
        escalated.push(rule);
        writeRow(rule, false, null);
        nemoclawEvents.emit("incident", {
          role: rule.role,
          kind: "tightening_escalated",
          host: rule.target,
          message: `tightening ${rule.target} collides with ${rule.role}'s required allowlist — escalated for review`,
        });
        continue;
      }

      if (verdict === "reject") {
        rejected.push(rule);
        writeRow(rule, false, null);
        continue;
      }

      // apply
      const result = await applyRule(rule);
      if (result.ok) {
        applied.push(rule);
        writeRow(rule, true, result.revision);
      } else {
        // Fail-closed: a non-zero exit keeps the prior revision and writes NO
        // applied:true row (§4.4 / §5). Logged applied:false for provenance.
        rejected.push(rule);
        writeRow(rule, false, null);
      }
    }

    nemoclawEvents.emit("tightening", {
      role: input.role,
      applied: applied.map((r) => r.target),
      escalated: escalated.map((r) => r.target),
    });

    return { applied, escalated, rejected };
  }
}

function writeRow(rule: TighteningRule, wasApplied: boolean, revision: number | null): void {
  appendRow({
    ts: new Date().toISOString(),
    run: rule.run ?? "adhoc",
    role: rule.role,
    detector: rule.detector,
    target: rule.target,
    kind: rule.kind,
    direction: "deny",
    revision,
    sourceCaseId: rule.sourceCaseId ?? null,
    applied: wasApplied,
  });
}

// Tolerant first-JSON-object parse (banner may leak a line on alpha builds).
function parseJson(stdout: string): any {
  const trimmed = stdout.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

export const policyTightener: PolicyTightener = new PolicyTightenerImpl();
