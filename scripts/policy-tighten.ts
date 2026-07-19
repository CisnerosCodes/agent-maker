// scripts/policy-tighten.ts
//
// The §6 EXPLICIT entrypoint for the policy-tightening loop. This is the ONLY way
// the loop runs (besides POLICY_TIGHTENING=1) — it is NEVER called from the timed
// store-launch orchestrator, so it can never confound the learning-loop speed
// delta (spec §6 determinism firewall).
//
//   tsx scripts/policy-tighten.ts <role> --host <host> [--host …] [--path <glob> …]
//   tsx scripts/policy-tighten.ts <role> --host <host> --dry-run   # show the diff only
//
// One capture→conflict-check→apply→log cycle from the denied hosts/paths a run
// surfaced (AgentResult.deniedEgress / denied paths). Auto-TIGHTEN only: every
// generated rule is a `deny`; a widen has no code path (§2).

import { loadEnv } from "../src/config/env.js";

loadEnv();

const { capture, compile, renderDiff, policyTightener } = await import("../src/security/tightening.js");

function collect(argv: string[], flag: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === flag && argv[i + 1]) out.push(argv[i + 1]);
  }
  return out;
}

async function main() {
  const argv = process.argv.slice(2);
  const role = argv.find((a) => !a.startsWith("--"));
  const hosts = collect(argv, "--host");
  const paths = collect(argv, "--path");
  const dryRun = argv.includes("--dry-run");

  if (!role || (hosts.length === 0 && paths.length === 0)) {
    console.error("usage: tsx scripts/policy-tighten.ts <role> --host <host> [--path <glob>] [--dry-run]");
    process.exit(2);
  }

  console.log(`── policy-tighten · role=${role} ${dryRun ? "(dry-run)" : ""} ──`);

  if (dryRun) {
    // Show the before/after the gateway WOULD merge — no gateway call (§4.5).
    const rules = compile(capture({ role, deniedEgress: hosts, deniedPaths: paths }), role);
    if (rules.length === 0) {
      console.log("nothing to tighten (all targets already denied — idempotent).");
      return;
    }
    for (const rule of rules) {
      console.log(`\n# ${rule.kind} ${rule.target}`);
      console.log(await renderDiff(rule));
    }
    return;
  }

  const { applied, escalated, rejected } = await policyTightener.run({
    role,
    deniedEgress: hosts,
    deniedPaths: paths,
  });

  console.log(`applied:   ${applied.map((r) => r.target).join(", ") || "—"}`);
  console.log(`escalated: ${escalated.map((r) => r.target).join(", ") || "—"}  (allowlist collision → human review)`);
  console.log(`rejected:  ${rejected.map((r) => r.target).join(", ") || "—"}  (fail-closed: non-zero exit)`);
  console.log(`audit → policies/generated/tightening-log.jsonl`);

  // Fail loud if a requested tighten neither applied nor was deliberately held.
  if (applied.length === 0 && escalated.length === 0) process.exit(1);
}

main().catch((e) => {
  console.error("policy-tighten crashed:", e);
  process.exit(1);
});
