// `npm run doctor` — the pre-flight checklist, in the terminal.
// Runs every system check (including LIVE key validation) and prints a
// plain-English report with the exact fix for anything broken.
// Exit code 0 = demo-ready (warnings allowed), 1 = something needs fixing.
//
// Flags:
//   --no-live   skip the real API calls (offline / airplane mode)

import "../src/config/load-env.js";
import { runDoctor, type CheckResult } from "../src/config/doctor.js";

const ICON = { pass: "✅", warn: "🟡", fail: "❌", skip: "▫️ " } as const;

function printGroup(title: string, checks: CheckResult[]) {
  if (!checks.length) return;
  console.log(`\n${title}`);
  for (const c of checks) {
    console.log(`  ${ICON[c.status]} ${c.label}${c.live ? "  (live-tested)" : ""}`);
    console.log(`     ${c.detail}`);
    if (c.fix && c.status !== "pass") console.log(`     → ${c.fix}`);
  }
}

async function main() {
  const live = !process.argv.includes("--no-live");
  console.log(`Agent-Maker doctor — checking your setup${live ? " (with live key tests)" : " (offline mode, keys not called)"}...`);
  const report = await runDoctor({ live });

  printGroup("System", report.checks.filter((c) => c.group === "core"));
  printGroup("Connections (keys)", report.checks.filter((c) => c.group === "keys"));
  printGroup("Data", report.checks.filter((c) => c.group === "data"));

  const s = report.summary;
  console.log(`\n${s.verdict}`);
  console.log(`(${s.pass} pass · ${s.warn} warn · ${s.fail} fail · ${s.skip} not connected)`);
  console.log(`\nTip: the same checks run visually at http://localhost:${process.env.DASHBOARD_PORT ?? 4000}/setup once the dashboard is up (npm run dev).`);
  process.exit(s.fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(`doctor crashed: ${err.message}`);
  process.exit(1);
});
