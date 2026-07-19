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
  /**
   * Hosts an in-sandbox tool call tried to reach that the OpenShell fail_closed
   * network policy DENIED (F4). Present only when the sandbox audit reported a
   * denied egress attempt; each is also emitted as an `incident` event.
   */
  deniedEgress?: string[];
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

export interface CliResult {
  code: number | null;
  /**
   * RAW stdout — NOT redacted. This is the DETECTION path (F2): the outbound
   * gate.scan must observe an `nvapi-` leak in the completion before it can be
   * blocked. Redaction happens only when a field is surfaced (logged, stored,
   * or returned) — see `redact()` at the call sites, never here.
   */
  stdout: string;
  stderr: string; // RAW; never surfaced to a log/handle in this module.
  timedOut: boolean;
}

export type CliRunner = (cmd: string, args: string[], timeoutMs: number) => Promise<CliResult>;

// Runs a command, capturing stdout and stderr SEPARATELY (spec §3 Phase C: the
// registration banner goes to stderr, JSON to stdout — parse stdout only).
// Secrets are passed via env, NEVER as argv (issue #579). Output is returned RAW
// so the security gate can see a leak on the detection path (F2); the surfacing
// path (completion returned to callers, error strings, logs) redacts explicitly.
// Never rejects on non-zero exit — the caller decides based on the parsed
// payload, not the exit code (rule 1).
function runCli(cmd: string, args: string[], timeoutMs: number): Promise<CliResult> {
  return new Promise((resolve) => {
    // Ensure ~/.local/bin is on PATH so `openshell` resolves in a non-interactive
    // shell (issue #4224 ENOENT). Prepending it to the spawn env here is the
    // durable, host-static fix — no sudo symlink into /usr/local/bin, which would
    // clobber a system-wide OpenShell on a pre-configured prod box. A missing dir
    // is harmlessly ignored; a system install already on PATH still resolves.
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
      resolve({ code: null, stdout, stderr: stderr + String(err), timedOut });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
  });
}

// --- injectable CLI seam (F3) ---------------------------------------------
//
// Production always spawns real binaries via `runCli`. TESTS ONLY (the
// adversarial harness) swap in a fixture runner with `__setCli` so dispatch /
// spawn can be driven WITHOUT a live NemoClaw/OpenShell install. The sim fakes
// only the subprocess — the REAL gate.scan calls and the REAL verdict routing
// below still run. Zero production dependency on this seam.
let cli: CliRunner = runCli;

/** Test-only: inject a fake CLI runner. Never called from production code. */
export function __setCli(fn: CliRunner): void {
  cli = fn;
}

/** Test-only: restore the real subprocess runner. */
export function __resetCli(): void {
  cli = runCli;
}

// --- toolchain probe (auto-containment default) ---------------------------
//
// The Factory defaults WORKER_MODE to AUTO: contain via OpenShell when the
// NemoClaw + OpenShell binaries are actually installed, else run local
// (uncontained, honestly labeled) so the offline demo still works. This probe
// answers "is the toolchain present?" WITHOUT onboarding anything — it runs the
// cheapest read-only command for each binary and treats an ENOENT (binary
// missing) as unavailable. A present-but-unhealthy install still returns true
// here; spawnWorker's Phase B/C health gate is what fails THAT closed. Cached
// once per process (the install state does not change mid-run).
let toolchainCache: boolean | null = null;

async function binaryPresent(cmd: string, args: string[]): Promise<boolean> {
  const r = await cli(cmd, args, STATUS_TIMEOUT_MS);
  // runCli surfaces a missing binary as { code: null, stderr: "...ENOENT..." }.
  // Anything that produced an exit code or JSON means the binary ran.
  const missing = r.code === null && /ENOENT|not recognized|not found|no such file/i.test(r.stderr);
  return !missing;
}

/**
 * True when BOTH `nemoclaw` and `openshell` resolve on PATH (auto-containment
 * gate). Read-only probes, never onboards. Cached per process; reset in tests.
 */
export async function toolchainAvailable(): Promise<boolean> {
  if (toolchainCache !== null) return toolchainCache;
  const [nemo, shell] = await Promise.all([
    binaryPresent("nemoclaw", ["sandbox", "status", "__toolchain_probe__", "--json"]),
    binaryPresent("openshell", ["policy", "get", "__toolchain_probe__", "--json"]),
  ]);
  toolchainCache = nemo && shell;
  return toolchainCache;
}

/** Test-only: forget the cached toolchain probe result. */
export function __resetToolchainCache(): void {
  toolchainCache = null;
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
  const onboard = await cli(
    "nemoclaw",
    ["onboard", "--non-interactive", "--yes-i-accept-third-party-software", "--name", opts.role],
    ONBOARD_TIMEOUT_MS,
  );
  if (onboard.timedOut) {
    return finish(handle, "failed", `onboard timed out after ${ONBOARD_TIMEOUT_MS}ms`, opts);
  }

  // Phase B — apply the (dynamic) network policy, then HARD-GATE fail-CLOSED (F1).
  // A silently-unapplied policy leaves the sandbox uncontained (able to reach
  // 169.254.169.254 and every exfil host) while looking healthy. We do NOT trust
  // the exit code (alpha CLI exits 0 on failure, base spec §5.2): we re-read the
  // applied policy and assert the network section is present AND fail_closed.
  const policySet = await cli(
    "openshell",
    ["policy", "set", opts.role, "--file", opts.policyPath],
    STATUS_TIMEOUT_MS,
  );
  const contained = policySet.timedOut ? false : await verifyPolicyApplied(opts.role);
  if (!contained) {
    // Fail CLOSED: never reach the smoke test with an unpoliced sandbox.
    return finish(handle, "failed", "policy not applied (uncontained)", opts);
  }

  // Fix issue #447: key saved to credentials.json but not registered with the
  // gateway inference config → inference silently fails. Register it explicitly.
  await cli(
    "openshell",
    ["inference", "set", "--provider", INFERENCE_PROVIDER, "--model", model],
    STATUS_TIMEOUT_MS,
  );

  // C-gate step 1: sandbox status --json must report healthy (rule 1 — do NOT
  // trust the onboard exit code, which is 0 even on failure). A present-but-not
  // -healthy sandbox (workerStatus → "provisioning") is treated as a failure with
  // the truer reason (F6) rather than being let through to mislabel as "smoke
  // failed" downstream.
  const status = await workerStatus(opts.role);
  if (status.status !== "ready") {
    return finish(handle, "failed", "sandbox never became healthy", opts);
  }

  // C-gate step 2: inference smoke test (§5.3). A throwaway completion that MUST
  // return non-empty text before we declare the worker ready — this is what
  // catches the silent-inference bug the exit code hides.
  const smoke = await cli(
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
  const run = await cli(
    "nemoclaw",
    [role, "agent", "--agent", "main", "--json", "--session-id", taskId, "-m", prompt],
    DISPATCH_TIMEOUT_MS,
  );
  const payload = parseJson(run.stdout);
  // RAW completion — the detection path (F2). We scan this un-redacted so the
  // outbound gate can actually SEE an `nvapi-` leak; only the surfaced copy is
  // redacted below.
  const rawCompletion = extractCompletion(payload);

  // F4: in-sandbox egress containment. Tool calls the worker makes INSIDE the
  // sandbox never reach this gate — enforcement is the OpenShell fail_closed
  // network policy (made trustworthy by F1). We do NOT scan them inline (no
  // network_middlewares hook yet — base spec §6.1 stretch / §8, documented
  // boundary limit). What we DO here is surface the sandbox's audit trail: any
  // egress the policy denied is logged as an incident and returned to the caller.
  const deniedEgress = extractDeniedEgress(payload);
  for (const host of deniedEgress) {
    nemoclawEvents.emit("incident", {
      role,
      taskId,
      kind: "egress_denied",
      host,
      message: `egress to ${host} denied by fail_closed policy`,
    });
  }

  if (run.timedOut || rawCompletion === null) {
    return {
      ...base,
      completion: "",
      responseScan: { verdict: "clean", categories: [] },
      ok: false,
      error: run.timedOut ? "dispatch timed out" : "no completion in sandbox output",
      deniedEgress: deniedEgress.length ? deniedEgress : undefined,
    };
  }

  // §6.1 out-bound scan of the model_response, on the RAW completion (a leak
  // pattern such as an `nvapi-` key flags here even though the model call
  // happened inside the sandbox).
  const responseScan = await scan(rawCompletion, "model_response", role);

  return {
    ...base,
    // Surfacing path: redact before the completion is returned/logged/stored so
    // no `nvapi-` key ever leaves this boundary (base spec §5.6), even though the
    // gate above scanned the raw text.
    completion: redact(rawCompletion),
    responseScan,
    // A blocked completion (e.g. exfil in the output) is not a successful task.
    ok: responseScan.verdict !== "blocked",
    error: responseScan.verdict === "blocked" ? `outbound response blocked: ${responseScan.categories.join(", ")}` : undefined,
    deniedEgress: deniedEgress.length ? deniedEgress : undefined,
  };
}

/** Wraps `nemoclaw sandbox status <role> --json` (§4). Never throws. */
export async function workerStatus(role: string): Promise<WorkerHandle> {
  const res = await cli("nemoclaw", ["sandbox", "status", role, "--json"], STATUS_TIMEOUT_MS);
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
  // F5: OpenAI-shaped / routed-NVIDIA payloads put content as an ARRAY of typed
  // parts. Join the text parts before the string check so a real completion is
  // not mis-read as "no completion" (which the smoke test and F2's exfil path
  // both depend on).
  const text = coerceContentToText(candidate);
  if (text === null) return null;
  const trimmed = text.trim();
  return trimmed.length ? trimmed : null;
}

// Normalize a content field to a string. Strings pass through; arrays of typed
// parts join their {type:"text"} text; anything else is genuinely empty → null.
function coerceContentToText(candidate: any): string | null {
  if (typeof candidate === "string") return candidate;
  if (Array.isArray(candidate)) {
    return candidate
      .filter((p) => p && typeof p === "object" && p.type === "text" && typeof p.text === "string")
      .map((p) => p.text)
      .join("");
  }
  return null;
}

// F1: re-read the applied policy and assert it is present AND fail_closed. Never
// trusts the exit code of `policy set` (alpha CLI exits 0 on failure). Returns
// false on any doubt (timeout, missing JSON, missing/absent network section, or
// a network section that is not fail_closed) — fail CLOSED.
async function verifyPolicyApplied(role: string): Promise<boolean> {
  const res = await cli("openshell", ["policy", "get", role, "--json"], STATUS_TIMEOUT_MS);
  if (res.timedOut) return false;
  const policy = parseJson(res.stdout);
  if (!policy) return false;
  const network = policy.network ?? policy.network_policy ?? policy.network_policies;
  if (!network) return false;
  return (
    network.fail_closed === true ||
    network.mode === "fail_closed" ||
    policy.fail_closed === true
  );
}

// F4: pull the list of egress hosts the sandbox tried to reach and the OpenShell
// fail_closed policy DENIED, from the agent JSON audit trail. Tolerates the field
// shapes NemoClaw/OpenShell builds emit; returns [] when there is no denial.
function extractDeniedEgress(payload: any): string[] {
  if (!payload) return [];
  const events: any[] = payload.tool_events ?? payload.audit ?? payload.egress ?? [];
  if (!Array.isArray(events)) return [];
  const hosts = events
    .filter(
      (e) =>
        e &&
        typeof e === "object" &&
        /policy[_-]?denied|denied|blocked/i.test(String(e.action ?? e.result ?? e.status ?? "")),
    )
    .map((e) => String(e.host ?? e.target ?? e.url ?? "").trim())
    .filter(Boolean);
  return [...new Set(hosts)];
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
