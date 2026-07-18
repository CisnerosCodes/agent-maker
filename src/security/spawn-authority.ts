// Spawn-authority broker — the injected-goal defense.
// Spec: ceo-brain-and-spawn-authority.spec.md Part A; ceo-sandbox.spec.md §5.1.
// Owner: Sky (security lane).
//
// A DETERMINISTIC, NON-LLM host process. The CEO (however prompt-injected) can
// only emit an AgentSpec struct; this broker validates that struct against a fixed
// role x credentials x policy x tools table BEFORE the Factory's createAgent runs.
// A fully compromised planner's blast radius is bounded by this table, not by the
// CEO model's goodwill — the same philosophy as OpenShell policy vs agent goodwill.
//
// This module has NO LLM dependency and imports nothing that can be talked into a
// different answer. Its input is a struct; its output is allow/deny + a reason.

import type { AgentSpec } from "../types.js";

export interface RoleAuthority {
  /** Credentials this role may hold. A spec asking for MORE is rejected. */
  allowedCredentials: readonly string[];
  /** The one policy template pinned to this role. No substituting a looser one. */
  policyTemplate: string;
  /** Tools this role may request. A spec asking for MORE is rejected. */
  allowedTools: readonly string[];
}

// A.1 Authority table — the whole defense in one place. Credentials use the
// canonical names (worker-capability.spec.md §5): SHOPIFY_ADMIN_TOKEN is the
// sandbox-issued store credential; NVIDIA_API_KEY lives in gateway env (never a
// spec credential).
//
// RECONCILIATION NOTE (worker-capability.spec.md §5 vs live library): the canonical
// end-state marks `research` broker-ingest — inference egress only, NO issued
// credential (the harness scrapes and passes text in). The ACTIVE role library
// (src/roles/library.ts) still emits `apify`/`APIFY_TOKEN` on the research template,
// even though the worker resolves APIFY_TOKEN from process.env, not from an issued
// credential (src/factory/worker.ts). Until that library row is reconciled to drop
// the harness-brokered capability, the table permits it on the `research` role ONLY
// so the legit fleet can spawn; the marginal grant is bounded by worker-research.yaml
// egress policy. Every CROSS-role escalation is still refused — a `research` spec
// asking for SHOPIFY_ADMIN_TOKEN, an unknown role, a policy-template swap, or any
// out-of-table tool is rejected. Tighten this row back to [] once library.ts drops
// apify from research.
export const AUTHORITY_TABLE: Readonly<Record<string, RoleAuthority>> = Object.freeze({
  research: {
    allowedCredentials: ["APIFY_TOKEN"], // harness-brokered; see reconciliation note above
    policyTemplate: "worker-research.yaml",
    allowedTools: ["apify", "web-fetch"], // apify is harness-brokered (env-resolved), not raw sandbox egress
  },
  "store-builder": {
    allowedCredentials: ["SHOPIFY_ADMIN_TOKEN"],
    policyTemplate: "worker-storebuilder.yaml",
    allowedTools: ["shopify-admin"],
  },
  copywriter: {
    allowedCredentials: [],
    policyTemplate: "worker-minimal.yaml",
    allowedTools: [],
  },
  strategist: {
    allowedCredentials: [],
    policyTemplate: "worker-minimal.yaml",
    allowedTools: [],
  },
  analyst: {
    allowedCredentials: [],
    policyTemplate: "worker-minimal.yaml",
    allowedTools: [],
  },
});

export interface SpawnDecision {
  allowed: boolean;
  role: string;
  /** Present when allowed === false. One human-readable rejection reason. */
  reason?: string;
}

// Counter the adversarial harness asserts on (ceo-brain §A.2). Every rejection
// increments it. Read via rejectedCount(); reset via resetRejectedCount() in tests.
let rejected = 0;
export function rejectedCount(): number {
  return rejected;
}
export function resetRejectedCount(): void {
  rejected = 0;
}

// Optional sink for the one-line denial notice (bus/Slack mirror). Defaults to
// stderr so a missing wiring never swallows a security event.
export type DenyLogger = (line: string) => void;
let denyLogger: DenyLogger = (line) => console.warn(`[spawn-authority] ${line}`);
export function setDenyLogger(fn: DenyLogger): void {
  denyLogger = fn;
}

const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === "string");

/**
 * Validate a CEO-emitted AgentSpec against the authority table. Deterministic:
 * same struct in -> same decision out. On rejection, increments the counter and
 * emits one denial line; NEVER throws (a malformed spec is a normal rejection,
 * not a crash — a crashing broker would be a DoS the injection could trigger).
 */
export function validateSpawn(spec: unknown): SpawnDecision {
  // Reject rule 5 — malformed AgentSpec (missing required fields / wrong types).
  // Checked first so later rules can trust the shape.
  if (spec === null || typeof spec !== "object") {
    return reject("<malformed>", "spec is not an object");
  }
  const s = spec as Partial<AgentSpec>;
  if (typeof s.role !== "string" || s.role.length === 0) {
    return reject("<malformed>", "missing or invalid `role`");
  }
  const role = s.role;
  if (typeof s.name !== "string" || s.name.length === 0) {
    return reject(role, "missing or invalid `name`");
  }
  if (typeof s.objective !== "string") {
    return reject(role, "missing or invalid `objective`");
  }
  if (typeof s.policyTemplate !== "string") {
    return reject(role, "missing or invalid `policyTemplate`");
  }
  if (!isStringArray(s.credentials)) {
    return reject(role, "missing or invalid `credentials` (must be string[])");
  }
  if (!isStringArray(s.tools)) {
    return reject(role, "missing or invalid `tools` (must be string[])");
  }

  // Reject rule 1 — role not in the table.
  const authority = AUTHORITY_TABLE[role];
  if (!authority) {
    return reject(role, `role '${role}' is not in the spawn-authority table`);
  }

  // Reject rule 2 — credentials must be a subset of the role's allowed set.
  const allowedCreds = new Set(authority.allowedCredentials);
  for (const cred of s.credentials) {
    if (!allowedCreds.has(cred)) {
      return reject(role, `requested credential '${cred}' exceeds role authority`);
    }
  }

  // Reject rule 3 — policyTemplate must be the role's pinned template exactly.
  if (s.policyTemplate !== authority.policyTemplate) {
    return reject(
      role,
      `policyTemplate '${s.policyTemplate}' != pinned '${authority.policyTemplate}' for role '${role}'`,
    );
  }

  // Reject rule 4 — tools must be a subset of the role's allowed set.
  const allowedTools = new Set(authority.allowedTools);
  for (const tool of s.tools) {
    if (!allowedTools.has(tool)) {
      return reject(role, `requested tool '${tool}' exceeds role authority`);
    }
  }

  return { allowed: true, role };
}

function reject(role: string, reason: string): SpawnDecision {
  rejected += 1;
  denyLogger(`spawn request for '${role}' denied: ${reason}`);
  return { allowed: false, role, reason };
}
