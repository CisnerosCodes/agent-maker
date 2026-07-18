// NemoClaw worker spawn — the ONE stable seam between the Factory and the sandbox.
// Spec: nemoclaw-spawn.spec.md §3-7.  Owner: Sky (security lane); Adrian imports.
//
// Adrian's factory.ts depends on this file, so the exported signatures
// (spawnWorker / dispatch / workerStatus) are FROZEN — CLI details never leak
// into his interface. NemoClaw is alpha; every command is pinned to the spec's
// researched invocation (re-verify with `nemoclaw onboard --help` at onboarding).
//
// Three hard rules this module enforces:
//   1. NEVER trust exit code (NemoClaw exits 0 on failure — issue #4224). Assert
//      health via `sandbox status --json` + an inference smoke test.
//   2. The raw nvapi- key NEVER enters a handle, a return value, or a log line
//      (redact() scrubs every captured stream before it is surfaced).
//   3. dispatch() scans the sandbox boundary (§6.1): scan(prompt) in,
//      scan(completion) out — this is how `nemoclaw` mode keeps HiddenLayer depth,
//      because the worker's model calls happen inside the sandbox where guarded()
//      cannot see them.

import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import type { ScanResult } from "../types.js";
import { scan } from "../security/gate.js";

const DEFAULT_MODEL = process.env.NEMOCLAW_MODEL ?? "nvidia/nemotron-3-super-120b-a12b";
const INFERENCE_PROVIDER = "nvidia-nim";
// Guardrail so a hung CLI can never wedge the demo. Onboard is the heavy step.
const ONBOARD_TIMEOUT_MS = Number(process.env.NEMOCLAW_ONBOARD_TIMEOUT_MS ?? 180_000);
const DISPATCH_TIMEOUT_MS = Number(process.env.NEMOCLAW_DISPATCH_TIMEOUT_MS ?? 90_000);
const STATUS_TIMEOUT_MS = Number(process.env.NEMOCLAW_STATUS_TIMEOUT_MS ?? 20_000);

export interface SpawnOptions {
  role: string; // "research" | "store-builder" | ...
  policyPath: string; // policies/worker-<role>.yaml
  model?: string; // default Nemotron slug if omitted
  reasoning?: "low" | "medium" | "high"; // spec §6.2; Factory defaults per role
  /**
   * Optional lifecycle hook so the Factory can mirror provisioning->ready/failed
   * into the registry (registry is keyed by AgentRecord, not role, so we stay
   * decoupled and let the Factory own the record). Never receives raw secrets.
   */
  onProgress?: (handle: WorkerHandle, message: string) => void;
}

export interface WorkerHandle {
  role: string;
  sandbox: string; // nemoclaw sandbox name (== role)
  status: "provisioning" | "ready" | "failed";
  model: string;
  /** Populated on failure so the dashboard can show WHY (already redacted). */
  error?: string;
}

export interface AgentResult {
  role: string;
  taskId: string;
  completion: string;
  /** Verdict from scanning the inbound prompt BEFORE the model ran (§6.1). */
  promptScan: ScanResult;
  /** Verdict from scanning the outbound completion (§6.1). */
  responseScan: ScanResult;
  /** false if the boundary refused the task or the sandbox produced nothing. */
  ok: boolean;
  /** Present when ok === false. */
  error?: string;
}

// Lifecycle events for callers that prefer a bus over the onProgress callback.
// Payload is a WorkerHandle (already secret-free). Dashboard SSE can subscribe.
export const nemoclawEvents = new EventEmitter();

// --- secret hygiene -------------------------------------------------------

// Scrub anything that looks like an nvapi- key (or a generic long bearer) before
// it can reach a log, a handle, or a thrown error. §5.6 secret hygiene: a grep
// for `nvapi-` across logs + registry must return zero hits.
const SECRET_RE = /\bnvapi-[A-Za-z0-9_-]{8,}/g;
export function redact(text: string): string {
  return text.replace(SECRET_RE, "nvapi-[REDACTED]");
}

// --- CLI runner -----------------------------------------------------------

interface CliResult {
  code: number | null;
  stdout: string; // redacted
  stderr: string; // redacted
  timedOut: boolean;
}

// Runs a command, capturing stdout and stderr SEPARATELY (spec §3 Phase C: the
// registration banner goes to stderr, JSON to stdout — parse stdout only).
// Secrets are passed via env, NEVER as argv (issue #579), and redacted from all
// captured output. Never rejects on non-zero exit — the caller decides based on
// the parsed payload, not the exit code (rule 1).
function runCli(cmd: string, args: string[], timeoutMs: number): Promise<CliResult> {
  return new Promise((resolve) => {
    // Ensure ~/.local/bin is on PATH so `openshell` resolves in a non-interactive
    // shell (issue #4224 ENOENT). The Friday-night symlink into /usr/local/bin is
    // the durable fix; this is the belt-and-suspenders for the spawn env.
    const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
    const extraPath = home ? `${home}/.local/bin` : "";
    const PATH = [extraPath, process.env.PATH ?? ""].filter(Boolean).join(pathSep());
    const child = spawn(cmd, args, {
      env: { ...process.env, PATH },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", (err) => {
      clearTimeout(timer);
      // ENOENT (binary missing) surfaces here — report, don't crash.
      resolve({ code: null, stdout: redact(stdout), stderr: redact(stderr + String(err)), timedOut });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout: redact(stdout), stderr: redact(stderr), timedOut });
    });
  });
}

function pathSep(): string {
  return process.platform === "win32" ? ";" : ":";
}

// Parse the first JSON object from a stdout stream (banner may still leak a line
// on some builds; tolerate leading noise). Returns null if no JSON is present.
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

// --- public API -----------------------------------------------------------

/**
 * Phase A (onboard) + B (policy set) + C-gate (health + inference smoke test).
 * Idempotent: a healthy existing sandbox short-circuits to a fast status check
 * (test §5). Never throws on CLI exit code alone — asserts health via
 * status --json + a real completion (rules 1-2). Emits provisioning->ready/failed.
 */
export async function spawnWorker(opts: SpawnOptions): Promise<WorkerHandle> {
  const model = opts.model ?? DEFAULT_MODEL;
  const handle: WorkerHandle = {
    role: opts.role,
    sandbox: opts.role,
    status: "provisioning",
    model,
  };
  emit(handle, `provisioning ${opts.role}`, opts);

  // Idempotency (§3, test §5): if the sandbox already exists and is healthy, skip
  // the heavy onboard and just re-gate.
  const existing = await workerStatus(opts.role);
  if (existing.status === "ready") {
    return finish(handle, "ready", `reused healthy sandbox ${opts.role}`, opts);
  }

  // Phase A — provision (heavy; creates the OpenShell sandbox). Env from .env
  // (NEMOCLAW_PROVIDER=routed, NVIDIA_API_KEY, NEMOCLAW_MODEL,
  // NEMOCLAW_ACCEPT_THIRD_PARTY_SOFTWARE=1) — key via env only, never argv.
  const onboard = await runCli(
    "nemoclaw",
    ["onboard", "--non-interactive", "--yes-i-accept-third-party-software", "--name", opts.role],
    ONBOARD_TIMEOUT_MS,
  );
  if (onboard.timedOut) {
    return finish(handle, "failed", `onboard timed out after ${ONBOARD_TIMEOUT_MS}ms`, opts);
  }

  // Phase B — apply the (dynamic) network policy. Static fs/process sections were
  // baked at onboard; this hot-reloads network_policies.
  await runCli("openshell", ["policy", "set", opts.role, "--file", opts.policyPath], STATUS_TIMEOUT_MS);

  // Fix issue #447: key saved to credentials.json but not registered with the
  // gateway inference config → inference silently fails. Register it explicitly.
  await runCli(
    "openshell",
    ["inference", "set", "--provider", INFERENCE_PROVIDER, "--model", model],
    STATUS_TIMEOUT_MS,
  );

  // C-gate step 1: sandbox status --json must report healthy (rule 1 — do NOT
  // trust the onboard exit code, which is 0 even on failure).
  const status = await workerStatus(opts.role);
  if (status.status !== "ready" && status.status !== "provisioning") {
    return finish(handle, "failed", status.error ?? "sandbox status not healthy after onboard", opts);
  }

  // C-gate step 2: inference smoke test (§5.3). A throwaway completion that MUST
  // return non-empty text before we declare the worker ready — this is what
  // catches the silent-inference bug the exit code hides.
  const smoke = await runCli(
    "nemoclaw",
    [opts.role, "agent", "--agent", "main", "--json", "--session-id", "smoke", "-m", "reply OK"],
    DISPATCH_TIMEOUT_MS,
  );
  const smokePayload = parseJson(smoke.stdout);
  const completion = extractCompletion(smokePayload);
  if (smoke.timedOut || !completion) {
    return finish(handle, "failed", "inference smoke test returned no completion", opts);
  }

  return finish(handle, "ready", `sandbox ${opts.role} ready`, opts);
}

/**
 * Phase C hot path. Scans the sandbox boundary (§6.1), runs the agent, returns
 * parsed JSON (banner stripped — stdout only). Fail-closed: an inbound `blocked`
 * verdict refuses the task without ever running the model.
 */
export async function dispatch(role: string, taskId: string, prompt: string): Promise<AgentResult> {
  // §6.1 in-bound scan. This fires BEFORE the sandbox model runs, so a known
  // injection in the task text surfaces as `flagged`/`blocked` here (test §7).
  const promptScan = await scan(prompt, "user_prompt", role);
  const base = { role, taskId, promptScan } as const;

  if (promptScan.verdict === "blocked") {
    // Fail-closed: never hand a blocked prompt to the model.
    return {
      ...base,
      completion: "",
      responseScan: { verdict: "clean", categories: [] },
      ok: false,
      error: `inbound prompt blocked: ${promptScan.categories.join(", ")}`,
    };
  }

  // A target selector is REQUIRED or the CLI exits 2 "No target session selected";
  // --session-id <taskId> supplies it.
  const run = await runCli(
    "nemoclaw",
    [role, "agent", "--agent", "main", "--json", "--session-id", taskId, "-m", prompt],
    DISPATCH_TIMEOUT_MS,
  );
  const completion = extractCompletion(parseJson(run.stdout));

  if (run.timedOut || completion === null) {
    return {
      ...base,
      completion: "",
      responseScan: { verdict: "clean", categories: [] },
      ok: false,
      error: run.timedOut ? "dispatch timed out" : "no completion in sandbox output",
    };
  }

  // §6.1 out-bound scan of the model_response (a leak pattern in the completion
  // flags here even though the model call happened inside the sandbox).
  const responseScan = await scan(completion, "model_response", role);

  return {
    ...base,
    completion,
    responseScan,
    // A blocked completion (e.g. exfil in the output) is not a successful task.
    ok: responseScan.verdict !== "blocked",
    error: responseScan.verdict === "blocked" ? `outbound response blocked: ${responseScan.categories.join(", ")}` : undefined,
  };
}

/** Wraps `nemoclaw sandbox status <role> --json` (§4). Never throws. */
export async function workerStatus(role: string): Promise<WorkerHandle> {
  const res = await runCli("nemoclaw", ["sandbox", "status", role, "--json"], STATUS_TIMEOUT_MS);
  const payload = parseJson(res.stdout);
  const base: WorkerHandle = { role, sandbox: role, status: "failed", model: DEFAULT_MODEL };

  // `sandbox status --json` emits {found:false} instead of a text error; a
  // missing binary / ENOENT lands as code:null with no JSON.
  if (!payload) {
    return { ...base, error: res.timedOut ? "status timed out" : "sandbox not found / CLI unavailable" };
  }
  if (payload.found === false) {
    return { ...base, error: "sandbox not found" };
  }
  const healthy = payload.healthy === true || payload.status === "ready" || payload.state === "running";
  return { ...base, status: healthy ? "ready" : "provisioning" };
}

// --- helpers --------------------------------------------------------------

// Pull the completion text out of the (alpha, shape-unstable §8) agent JSON.
// Tolerates the fields NemoClaw builds have used; returns null if none present.
function extractCompletion(payload: any): string | null {
  if (!payload) return null;
  const candidate =
    payload.completion ??
    payload.output ??
    payload.text ??
    payload.message?.content ??
    payload.choices?.[0]?.message?.content ??
    null;
  if (typeof candidate !== "string") return null;
  const trimmed = candidate.trim();
  return trimmed.length ? trimmed : null;
}

function emit(handle: WorkerHandle, message: string, opts: SpawnOptions): void {
  opts.onProgress?.(handle, message);
  nemoclawEvents.emit("progress", { ...handle }, message);
}

function finish(
  handle: WorkerHandle,
  status: WorkerHandle["status"],
  message: string,
  opts: SpawnOptions,
): WorkerHandle {
  handle.status = status;
  if (status === "failed") handle.error = message;
  emit(handle, message, opts);
  return handle;
}
