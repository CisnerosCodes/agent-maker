// Governance — the autonomy dial. Operator-set, live-toggleable from the
// dashboard. It governs APPROVAL FRICTION, never containment.
//
// Hard invariant: containment (OpenShell sandbox) and critical-exfil hard-block
// are NEVER on this dial. A prompt-injected CEO cannot widen its own autonomy —
// the mode is host-side state the agents cannot write. The dial only decides
// which NON-critical decisions pause for a human:
//
//   assisted    — the CEO's org plan pauses for approval BEFORE any spawn,
//                 AND every flagged (non-critical) detection pauses for approve/deny.
//   supervised  — spawns proceed from the vetted role library; flagged detections
//                 pause for approve/deny. (default)
//   autonomous  — spawns proceed; flagged (non-critical) detections are logged and
//                 auto-approved so the run doesn't stop. CRITICAL (blocked) verdicts
//                 still hard-stop regardless of mode — the cage is not on the dial.

import { EventEmitter } from "node:events";
import type { Verdict } from "../types.js";

export type AutonomyMode = "assisted" | "supervised" | "autonomous";

const MODES: AutonomyMode[] = ["assisted", "supervised", "autonomous"];

class Governance extends EventEmitter {
  private _mode: AutonomyMode;

  constructor() {
    super();
    const env = (process.env.AUTONOMY_MODE ?? "").toLowerCase();
    this._mode = MODES.includes(env as AutonomyMode) ? (env as AutonomyMode) : "supervised";
  }

  get mode(): AutonomyMode { return this._mode; }

  setMode(mode: string): AutonomyMode {
    if (!MODES.includes(mode as AutonomyMode)) throw new Error(`invalid autonomy mode: ${mode}`);
    this._mode = mode as AutonomyMode;
    this.emit("change", this._mode);
    return this._mode;
  }

  // Does the org plan require human approval before spawning? (assisted only)
  planGate(): boolean {
    return this._mode === "assisted";
  }

  // For a flagged (non-critical) detection: may the run auto-proceed without a
  // human? Only in autonomous. Critical verdicts ("blocked") are never eligible —
  // they hard-stop in every mode. This method is only consulted for "flagged".
  autoApprovesFlagged(verdict: Verdict): boolean {
    if (verdict === "blocked") return false; // the cage — never auto
    return this._mode === "autonomous";
  }
}

export const governance = new Governance();
