// Tier-1 (Sky lane) acceptance checks — the done-when tests for 1.2/1.3/1.7/1.8.
// Run: npx tsx scripts/verify-tier1.ts   (no HiddenLayer key needed — heuristic floor).
//
// These are the offline-runnable slices of the per-spec test plans. The parts
// that need a live NemoClaw sandbox (cold spawn, in-sandbox egress block) are
// noted and belong to the Saturday go-live verification (IMPLEMENTATION_PLAN §1.9).

import { readFileSync } from "node:fs";
import { scan } from "../src/security/gate.js";
import {
  validateSpawn,
  rejectedCount,
  resetRejectedCount,
  setDenyLogger,
} from "../src/security/spawn-authority.js";
import { redact } from "../src/worker/nemoclaw.js";
import type { AgentSpec } from "../src/types.js";

let failures = 0;
function check(name: string, cond: boolean, detail = ""): void {
  const tag = cond ? "PASS" : "FAIL";
  if (!cond) failures++;
  console.log(`  [${tag}] ${name}${detail ? ` — ${detail}` : ""}`);
}

async function main(): Promise<void> {
  // --- 1.7 spawn-authority broker (ceo-brain §A.2 reject rules) --------------
  console.log("\n1.7 Spawn-authority broker");
  const denials: string[] = [];
  setDenyLogger((line) => denials.push(line));
  resetRejectedCount();

  const goodResearch: AgentSpec = {
    role: "research",
    name: "research-01",
    objective: "find trending shoes",
    tools: ["web-fetch"],
    credentials: [],
    policyTemplate: "worker-research.yaml",
  };
  check("valid research spec allowed", validateSpawn(goodResearch).allowed);

  const goodStore: AgentSpec = {
    role: "store-builder",
    name: "store-01",
    objective: "build the store",
    tools: ["shopify-admin"],
    credentials: ["SHOPIFY_ADMIN_TOKEN"],
    policyTemplate: "worker-storebuilder.yaml",
  };
  check("valid store-builder spec allowed", validateSpawn(goodStore).allowed);

  // Rule 2: research asking for a credential above its authority.
  const credEscalation = { ...goodResearch, credentials: ["SHOPIFY_ADMIN_TOKEN"] };
  const d1 = validateSpawn(credEscalation);
  check("credential escalation rejected", !d1.allowed, d1.reason);

  // Rule 3: substituting a looser policy template.
  const policySwap = { ...goodStore, policyTemplate: "worker-research.yaml" };
  check("policy-template swap rejected", !validateSpawn(policySwap).allowed);

  // Rule 1: unknown role.
  const rogueRole = { ...goodResearch, role: "exfiltrator" };
  check("unknown role rejected", !validateSpawn(rogueRole).allowed);

  // Rule 4: tool above authority.
  const toolEscalation = { ...goodResearch, tools: ["shell-exec"] };
  check("tool escalation rejected", !validateSpawn(toolEscalation).allowed);

  // Rule 5: malformed spec never crashes the broker.
  check("null spec rejected (no throw)", !validateSpawn(null).allowed);
  check("missing-field spec rejected", !validateSpawn({ role: "research" }).allowed);

  // The counter the adversarial harness asserts on: 6 rejections above.
  check("rejection counter incremented", rejectedCount() === 6, `count=${rejectedCount()}`);
  check("each rejection logged one line", denials.length === 6, `lines=${denials.length}`);
  setDenyLogger((line) => console.warn(`[spawn-authority] ${line}`)); // restore

  // --- 1.8 poisoned-doc Layer 1 (HiddenLayer / heuristic floor) --------------
  console.log("\n1.8 Poisoned-doc Layer 1 (detection)");
  const doc = readFileSync(new URL("../demo/poisoned-shoe-report.md", import.meta.url), "utf8");
  const docScan = await scan(doc, "ingested_document", "research-1");
  check("poisoned doc flagged (not clean)", docScan.verdict !== "clean", `verdict=${docScan.verdict}`);
  check(
    "prompt_injection detected",
    docScan.categories.some((c) => /prompt_injection/i.test(c)),
    docScan.categories.join(","),
  );
  check(
    "exfil/suspicious-endpoint detected",
    docScan.categories.some((c) => /exfil|suspicious|evil|data_/i.test(c)),
  );
  // A clean control document must pass — proves the detector isn't flagging everything.
  const clean = await scan("Air Zoom Pulse up 34%. Retro Court 85 restock demand high.", "ingested_document", "research-1");
  check("clean control doc passes", clean.verdict === "clean", `verdict=${clean.verdict}`);

  // --- 1.2 nemoclaw seam (offline-testable slices) ---------------------------
  console.log("\n1.2 NemoClaw seam");
  // Secret hygiene (§5.6): redact scrubs nvapi- from any stream.
  const leak = 'boot ok. key=nvapi-abcDEF1234567890secret registered. model ready.';
  const scrubbed = redact(leak);
  check("nvapi- key redacted", !/nvapi-[A-Za-z0-9]{8}/.test(scrubbed), scrubbed);
  check("redaction leaves marker", scrubbed.includes("nvapi-[REDACTED]"));

  // dispatch fail-closed on inbound block is exercised end-to-end only with a live
  // sandbox; the inbound scan() itself is covered by the 1.8 checks above (same gate).
  console.log("  [NOTE] cold spawn + in-sandbox egress block = Saturday go-live (§1.9), needs live NemoClaw.");

  console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
