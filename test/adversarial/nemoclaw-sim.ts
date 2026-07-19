// test/adversarial/nemoclaw-sim.ts
//
// TEST-ONLY fixture CLI runner for the NemoClaw spawn/dispatch seam (F3).
// It fakes ONLY the subprocess (`nemoclaw` / `openshell`) so the adversarial
// harness can drive spawnWorker/dispatch on a box with no live install. The
// REAL gate.scan calls and REAL verdict routing in nemoclaw.ts still run — this
// module never touches security logic, it just canned the stdout the CLI would
// have produced.
//
// Wire it with nemoclaw's `__setCli(makeSimCli(scenario))`; reset with
// `__resetCli()`. Fixtures are keyed by (cmd, subcommand, session-id) and shaped
// per a small scenario object so each harness row selects the behavior it needs.

import type { CliResult } from "../../src/worker/nemoclaw.js";

type Health = "healthy" | "unhealthy" | "missing";

export interface SimScenario {
  /** sandbox status --json health bucket (used when statusSequence is absent). */
  status?: Health;
  /**
   * Per-call health for successive `sandbox status` invocations (the last entry
   * sticks). Lets the idempotency probe see "unhealthy" (so spawnWorker runs the
   * full onboard→policy→smoke path) while the C-gate probe then sees "healthy".
   */
  statusSequence?: Health[];
  /** whether `openshell policy get` returns parseable JSON (false = gateway down). */
  policyGetOk?: boolean;
  /** the network section's fail_closed flag as re-read by verifyPolicyApplied. */
  policyFailClosed?: boolean;
  /**
   * Dispatch completion. A string (or array of {type:"text"} parts to exercise
   * F5) is placed under the payload; the smoke call always returns a fixed "OK".
   */
  completion?: string | Array<{ type: string; text: string }>;
  /** where to place the completion in the payload — exercises extractCompletion shapes. */
  completionShape?: "completion" | "message.content";
  /** hosts the in-sandbox tool step attempted and the fail_closed policy denied (F4). */
  deniedEgress?: string[];
  /** what `openshell policy update <role> --add-deny … --wait` returns (§15). Default 0. */
  policyUpdateExit?: 0 | 1 | 124;
  /** what `openshell policy list <role> --json` reports as the revision (§15). Default 1. */
  policyRevision?: number;
  /** canned `openshell policy update … --dry-run` stdout for renderDiff (§15). */
  dryRunText?: string;
}

function ok(stdout: string): CliResult {
  return { code: 0, stdout, stderr: "", timedOut: false };
}

function unavailable(stderr: string): CliResult {
  // Mirrors a missing binary / dead gateway: code null, no JSON on stdout.
  return { code: null, stdout: "", stderr, timedOut: false };
}

function argValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

function buildAgentPayload(s: SimScenario, args: string[]): any {
  const sessionId = argValue(args, "--session-id");
  // The provisioning smoke test must succeed so spawnWorker can reach `ready`;
  // dispatch rows get the scenario-specific completion.
  if (sessionId === "smoke") return { completion: "OK" };

  const payload: any = {};
  const completion = s.completion ?? "task complete";
  if ((s.completionShape ?? "completion") === "message.content") {
    payload.message = { content: completion };
  } else {
    payload.completion = completion;
  }
  if (s.deniedEgress?.length) {
    payload.tool_events = s.deniedEgress.map((host) => ({
      type: "egress",
      host,
      action: "policy_denied",
    }));
  }
  return payload;
}

export function makeSimCli(scenario: SimScenario = {}) {
  const s: Required<Pick<SimScenario, "status" | "policyGetOk" | "policyFailClosed">> & SimScenario = {
    status: scenario.status ?? "healthy",
    policyGetOk: scenario.policyGetOk ?? true,
    policyFailClosed: scenario.policyFailClosed ?? true,
    ...scenario,
  };

  const statusQueue = [...(scenario.statusSequence ?? [])];
  const nextHealth = (): Health => {
    if (statusQueue.length > 1) return statusQueue.shift() as Health;
    if (statusQueue.length === 1) return statusQueue[0];
    return s.status;
  };

  return async function simCli(cmd: string, args: string[], _timeoutMs: number): Promise<CliResult> {
    const sub = args[0];

    if (cmd === "nemoclaw") {
      if (sub === "onboard") return ok("{}");
      if (sub === "sandbox" && args[1] === "status") {
        const health = nextHealth();
        if (health === "missing") return ok(JSON.stringify({ found: false }));
        if (health === "unhealthy") return ok(JSON.stringify({ healthy: false }));
        return ok(JSON.stringify({ healthy: true, state: "running" }));
      }
      // nemoclaw <role> agent ... (smoke or dispatch)
      if (args[1] === "agent") return ok(JSON.stringify(buildAgentPayload(s, args)));
    }

    if (cmd === "openshell") {
      if (sub === "policy" && args[1] === "set") return ok("{}");
      if (sub === "policy" && args[1] === "get") {
        if (!s.policyGetOk) return unavailable("openshell: gateway unavailable");
        return ok(
          JSON.stringify({ network: { fail_closed: s.policyFailClosed, allowlist: [] } }),
        );
      }
      // Policy-tightening loop (§15). `policy update … --dry-run` never calls the
      // gateway → canned merged-policy text. `policy update … --wait` returns the
      // scenario exit (0 loaded / 1 validation-failed / 124 timeout). `policy list`
      // reports the revision the merge produced.
      if (sub === "policy" && args[1] === "update") {
        if (args.includes("--dry-run")) {
          const target = argValue(args, "--add-deny") ?? "";
          return ok(s.dryRunText ?? `network_policies:\n  denied:\n    - host: ${target}  # +learned deny`);
        }
        const exit = s.policyUpdateExit ?? 0;
        if (exit === 124) return { code: null, stdout: "", stderr: "policy update timed out", timedOut: true };
        if (exit === 0) return ok("{}");
        return { code: exit, stdout: "", stderr: "validation failed", timedOut: false };
      }
      if (sub === "policy" && args[1] === "list") {
        return ok(JSON.stringify({ revision: s.policyRevision ?? 1 }));
      }
      if (sub === "inference") return ok("{}");
    }

    // Unknown command — behave like a benign no-op rather than a crash.
    return ok("{}");
  };
}
