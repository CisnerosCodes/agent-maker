// Company mode — the ONE switch that says whether this instance is a
// demonstration or a business.
//
//   demo  — no keys required. Every worker runs as LABELED simulation,
//           deterministic and offline-safe. This is the judge/first-run path.
//   real  — requires at least one working model key. Goals are REFUSED with an
//           actionable message until a brain is connected; once running, an
//           individual key dying mid-run still degrades that one task to
//           labeled sim (resilience), but the company never STARTS a goal it
//           knows it cannot execute for real.
//
// Resolution order:
//   1. COMPANY_MODE=demo|real (operator intent, set in /setup or .env)
//   2. SIM_MODE=1 (legacy stage-insurance flag) -> demo
//   3. auto: real if any brain key is configured, demo otherwise
//
// NOTE for other modules: pool.ts must stay import-free of this file (env vars
// are the shared ground truth) to avoid a cycle — mode.ts reads pool's
// configuredBrains() for the auto derivation.

import { configuredBrains, pinnedBrain } from "../providers/pool.js";

export type CompanyMode = "demo" | "real";

export interface ModeStatus {
  mode: CompanyMode;
  source: "env" | "sim-mode" | "auto";
  ready: boolean;    // demo: always true; real: at least one brain configured
  reason: string;    // plain-English banner line for the dashboard
  brains: string[];  // configured brain provider ids, in failover order
}

export function companyMode(): CompanyMode {
  // SIM_MODE=1 is stage insurance and ALWAYS wins — a REAL badge over
  // force-simmed workers would be a lie.
  if (process.env.SIM_MODE === "1") return "demo";
  const env = (process.env.COMPANY_MODE ?? "").trim().toLowerCase();
  if (env === "demo" || env === "real") return env;
  return configuredBrains().length > 0 ? "real" : "demo";
}

// True when brain calls and business writes must stay off (demo mode).
// NOTE: this does NOT force the keyless research fetch to sim — demo mode
// still does the real HTTP fetch with its source honestly labeled. Only
// SIM_MODE=1 (fully offline stage insurance) sims everything; workerMode
// checks that flag separately.
export function simForced(): boolean {
  return companyMode() === "demo";
}

export function modeStatus(): ModeStatus {
  const env = (process.env.COMPANY_MODE ?? "").trim().toLowerCase();
  const source: ModeStatus["source"] =
    process.env.SIM_MODE === "1" ? "sim-mode" : env === "demo" || env === "real" ? "env" : "auto";
  const mode = companyMode();
  const brains = configuredBrains().map((b) => b.id);
  const { pin, provider } = pinnedBrain();

  if (mode === "demo") {
    return {
      mode, source, ready: true, brains,
      reason:
        source === "env"
          ? "DEMO mode (set by you) — no keys are used and nothing touches your business systems. Research still fetches real data (source labeled); everything else runs as labeled simulation."
          : source === "sim-mode"
            ? "DEMO mode (SIM_MODE=1, fully offline) — every agent runs as labeled simulation, including research."
            : "DEMO mode — no model key connected yet. Research fetches real data (source labeled); everything else runs as labeled simulation. Connect a key in Connections to go real.",
    };
  }

  const pinNote = pin ? (provider ? ` Pinned to ${provider.id} (WORKER_BACKEND).` : ` WARNING: WORKER_BACKEND=${pin} is pinned but its key is missing.`) : "";
  if (brains.length === 0 && !(pin && provider)) {
    return {
      mode, source, ready: false, brains,
      reason: `REAL mode is on, but no model key is connected — goals are refused until you paste a working key in Connections (/setup).${pinNote}`,
    };
  }
  return {
    mode, source, ready: true, brains,
    reason: `REAL mode — model calls go to ${pin && provider ? provider.id : brains.join(" → ")}. A key dying mid-run degrades that task to labeled sim, never the goal.${pinNote}`,
  };
}
