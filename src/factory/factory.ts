// Factory — turns an AgentSpec from the CEO into a running, contained worker.
//
// Reconciled provisioning pipeline (factory-provisioning.spec.md §2, C13):
//
//     issueIdentity → assertRoleSandboxHealthy → mintSession(role, taskId) → upsert
//
// The durable unit is the per-ROLE sandbox (one per role, pre-baked, reused
// across goals — nemoclaw-spawn §3). The per-HIRE unit is an agent record + a
// per-TASK session inside that sandbox. The Factory does NOT create a sandbox per
// hire; it health-checks the role's sandbox (via the real NemoClaw seam,
// src/worker/nemoclaw.ts) and mints an isolated session workdir.
//
// Retired here (C13): `renderPolicy()` (templated `{{AGENT_ID}}`/`{{SANDBOX_NAME}}`
// into a schema OpenShell does not have) and the per-hire `sandbox-${id}` name.
// Per-role policies are authored files applied once inside spawnWorker's Phase B;
// there is no per-agent render.
//
// Failure honesty (C12): a record is never left with `identity: null`. Any
// provisioning failure (vault miss, unhealthy sandbox) records the agent `failed`
// with a truthful reason and RETURNS it — it never throws into the CEO/plan loop.

import { randomUUID } from "node:crypto";
import { rmSync, mkdirSync } from "node:fs";
import path from "node:path";
import type { AgentRecord, AgentSpec } from "../types.js";
import { issueIdentity, revokeIdentity } from "../vault/vault.js";
import { registry } from "../registry/registry.js";
import { spawnWorker, toolchainAvailable, type WorkerHandle } from "../worker/nemoclaw.js";

// Isolation mode (C6 / worker-mode-containment §6). `nemoclaw` drives the real
// OpenShell sandbox seam and honors the fail-closed health gate (§2: unhealthy →
// failed). `local` is the break-glass / no-live-sandbox path: the worker is
// UNCONTAINED but provisioning still succeeds so the offline demo runs — the
// HONEST label for a box with no sandbox toolchain.
//
// WORKER_MODE resolution:
//   nemoclaw  — FORCE containment (real demo box). Provisioning fails closed if
//               the toolchain is missing/unhealthy — never a silent uncontained run.
//   local     — FORCE break-glass (explicit uncontained, e.g. offline dev).
//   unset     — AUTO (default): contain when the NemoClaw + OpenShell binaries are
//               actually installed, else fall back to local. This makes
//               containment the default wherever the box can honor it, without
//               breaking the keyless offline demo on a box that can't.
async function containmentMode(): Promise<"nemoclaw" | "local"> {
  const forced = (process.env.WORKER_MODE ?? "").trim().toLowerCase();
  if (forced === "nemoclaw") return "nemoclaw"; // operator intent — fail closed if unavailable
  if (forced === "local") return "local";
  return (await toolchainAvailable()) ? "nemoclaw" : "local";
}

let warnedLocalOnce = false;
function warnLocalOnce(): void {
  if (warnedLocalOnce) return;
  warnedLocalOnce = true;
  const forced = (process.env.WORKER_MODE ?? "").trim().toLowerCase() === "local";
  console.warn(
    forced
      ? "[Factory] WORKER_MODE=local — workers run UNCONTAINED (break-glass). Sessions are still isolated."
      : "[Factory] No NemoClaw/OpenShell toolchain detected — workers run LOCAL (UNCONTAINED). " +
          "Install the toolchain (or set WORKER_MODE=nemoclaw on a box that has it) for OpenShell containment. Sessions are still isolated.",
  );
}

// Per-session workdir root (factory-provisioning §3a). On a live sandbox this
// mirrors the in-sandbox `/workspace/<session>/`; the Factory owns a host-side
// directory per session so cross-goal isolation + wipe-on-end are real and
// demonstrable. Under REGISTRY_DIR by default so tests/verify can point it at tmp.
function workspaceRoot(): string {
  return process.env.WORKSPACE_ROOT ?? path.join(process.env.REGISTRY_DIR ?? "./data", "workspace");
}

// The in-sandbox path a worker would see for its session (display + real-sandbox
// contract). The host mirror lives under workspaceRoot()/<session>.
function sandboxWorkdir(session: string): string {
  return `/workspace/${session}/`;
}
function hostWorkdir(session: string): string {
  return path.join(workspaceRoot(), session);
}

/**
 * The reconciled provisioning pipeline. Never throws — a bad spec fails THIS
 * agent (record `failed`) so the goal-halt path can handle it; it must not crash
 * the hire loop (factory-provisioning §4).
 *
 * @param taskId  the per-task unit; becomes the session id (nemoclaw dispatch
 *                keys on it). Optional so isolated callers (verify-spawn-wiring)
 *                still work; a fresh session id is minted when absent.
 */
export async function createAgent(spec: AgentSpec, parentId: string, taskId?: string): Promise<AgentRecord> {
  const id = `${spec.role}-${randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();
  // Two-phase (C12): the record exists BEFORE identity, with no `identity` field
  // (optional) rather than `null as any`. Status starts `provisioning`.
  const record: AgentRecord = {
    id,
    spec,
    status: "provisioning",
    parent: parentId,
    createdAt: now,
    updatedAt: now,
    log: [],
  };
  registry.upsert(record, "Factory received spec");

  // 1. issueIdentity — record-level identity + credential refs. A vault miss
  //    (unknown credential) marks THIS agent failed and returns; never throws.
  try {
    record.identity = await issueIdentity(spec);
  } catch (err: any) {
    return fail(record, `identity issuance failed: ${err?.message ?? String(err)}`);
  }
  registry.upsert(record, `Identity issued: ${record.identity.email}`);

  // 2. assertRoleSandboxHealthy — drive the real NemoClaw seam (spawnWorker is
  //    idempotent: reuses a healthy role sandbox, onboards one if missing). Do
  //    NOT trust an exit code — the handle status is parsed from `sandbox status
  //    --json` + a smoke test inside spawnWorker. Unhealthy → failed (§2), reusing
  //    the F6 "never became healthy" truth rather than a fake ready.
  const mode = await containmentMode();
  record.containment = mode;
  if (mode === "nemoclaw") {
    const handle = await assertRoleSandboxHealthy(spec);
    record.sandbox = handle.sandbox; // == role
    if (handle.status !== "ready") {
      return fail(record, `role sandbox '${handle.sandbox}' ${handle.error ?? "never became healthy"}`);
    }
    registry.upsert(record, `Role sandbox healthy: ${handle.sandbox} (per-role, reused across sessions)`);
  } else {
    warnLocalOnce();
    record.sandbox = spec.role; // logical role sandbox name even when local
    // Distinguish the two ways we land here so the log tells the truth: an
    // explicit break-glass opt-out vs the AUTO default finding no toolchain.
    const forcedLocal = (process.env.WORKER_MODE ?? "").trim().toLowerCase() === "local";
    registry.upsert(
      record,
      forcedLocal
        ? `UNCONTAINED (WORKER_MODE=local, break-glass) — no OpenShell sandbox; unset WORKER_MODE or install the toolchain to contain`
        : `UNCONTAINED (no NemoClaw/OpenShell toolchain detected) — no OpenShell sandbox; install the toolchain or set WORKER_MODE=nemoclaw to contain`,
    );
  }

  // 3. mintSession(role, taskId) — per-task session + isolated, clean workdir so
  //    goal-1's poisoned document cannot sit in goal-2's workspace (§3).
  const session = mintSession(spec.role, taskId);
  record.session = session;
  record.workdir = sandboxWorkdir(session);

  // 4. upsert the provisioned record. Status `working`; the orchestrator downgrades
  //    to `waiting` for a task that has upstream dependencies.
  record.status = "working";
  registry.upsert(record, `Session ${session} minted in sandbox ${record.sandbox} · workdir ${record.workdir}`);
  return record;
}

// Health-check the role's sandbox via the frozen NemoClaw seam. spawnWorker owns
// onboard(A) + policy set/verify(B) + health + smoke(C-gate); we consume its
// handle. Never throws (spawnWorker returns a failed handle instead).
async function assertRoleSandboxHealthy(spec: AgentSpec): Promise<WorkerHandle> {
  return spawnWorker({
    role: spec.role,
    policyPath: `policies/${spec.policyTemplate}`,
    model: spec.model,
    reasoning: spec.reasoning,
  });
}

// Mint a per-task session and its clean host workdir. Session id == taskId (the
// real per-hire unit; nemoclaw dispatch keys on it). A fresh workdir is created
// (and any stale one wiped first) so every session starts clean (§3).
function mintSession(_role: string, taskId?: string): string {
  const session = taskId ?? `sess-${randomUUID().slice(0, 8)}`;
  const dir = hostWorkdir(session);
  try {
    rmSync(dir, { recursive: true, force: true }); // clean any prior contents
    mkdirSync(dir, { recursive: true });
  } catch (err) {
    // A workdir the host can't create is not fatal to provisioning (the sandbox
    // owns the real /workspace); log and continue rather than crash the hire.
    console.warn(`[Factory] could not prepare session workdir ${dir}: ${String(err)}`);
  }
  return session;
}

// End a task session (factory-provisioning §3): wipe its workdir on task
// completion / failure / terminate so no session's data persists into the shared
// role sandbox. Idempotent; never throws. Clears the record's session refs.
export function endAgentSession(record: AgentRecord): void {
  if (record.session) {
    const dir = hostWorkdir(record.session);
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch (err) {
      console.warn(`[Factory] could not wipe session workdir ${dir}: ${String(err)}`);
    }
  }
  record.session = undefined;
  record.workdir = undefined;
}

// Terminate / revoke (factory-provisioning §5): deliver the vault's "REVOCABLE"
// claim at the session + record grain. Wipes the session workdir and revokes the
// identity; sets status `terminated` with one registry line. The role-level
// sandbox is NOT torn down (it is shared + pre-baked). Never throws.
export function terminateAgent(record: AgentRecord, reason: string): AgentRecord {
  endAgentSession(record);
  const didRevoke = revokeIdentity(record.identity);
  record.status = "terminated";
  registry.upsert(
    record,
    `Terminated: ${reason}. Session workdir wiped${didRevoke ? "; identity revoked" : ""}.`,
  );
  return record;
}

// Record a provisioning failure honestly and return the record (never throw).
function fail(record: AgentRecord, reason: string): AgentRecord {
  record.status = "failed";
  registry.upsert(record, `Provisioning failed: ${reason}`);
  return record;
}
