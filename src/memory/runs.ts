// Run memory — the recursive-intelligence mechanism. Every completed goal is
// written back to data/runs.json: its niche, the research findings, and per-run
// timing. On a later goal in the SAME niche the CEO recalls the prior run,
// skips re-research, reuses the findings, and finishes measurably faster. The
// dashboard shows the run-1 vs run-N delta. This is the ONLY place the system
// writes knowledge back about itself — "learns and gets better" made literal.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import type { Product } from "../factory/worker.js";

const DATA_DIR = process.env.REGISTRY_DIR ?? "./data";
const FILE = `${DATA_DIR}/runs.json`;

export interface RunRecord {
  runId: string;
  goalId: string;
  niche: string;
  nicheKey: string;          // normalized for matching
  goalText: string;
  products: Product[];
  researchSec: number;       // time the research task took (0 when reused)
  totalSec: number;
  reusedFrom?: string;       // runId this run's research was reused from
  timestamp: string;
}

function normalize(niche: string): string {
  return niche.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\b(the|a|an|for|market|store|shop)\b/g, "").replace(/\s+/g, " ").trim();
}

class RunMemory {
  private runs: RunRecord[] = [];

  constructor() {
    if (existsSync(FILE)) {
      try { this.runs = JSON.parse(readFileSync(FILE, "utf8")); } catch { this.runs = []; }
    }
  }

  // Prior run in the same niche, if any (most recent first). Exact nicheKey
  // match ONLY (C4): bidirectional substring made "shoes" recall "shoe rack" —
  // wrong-niche stale data presented as fresh findings.
  recall(niche: string): RunRecord | undefined {
    const key = normalize(niche);
    if (!key) return undefined;
    return [...this.runs].reverse().find((r) => r.nicheKey === key);
  }

  runNumberFor(niche: string): number {
    const key = normalize(niche);
    return this.runs.filter((r) => r.nicheKey === key).length + 1;
  }

  record(rec: Omit<RunRecord, "nicheKey" | "timestamp">) {
    const full: RunRecord = { ...rec, nicheKey: normalize(rec.niche), timestamp: new Date().toISOString() };
    this.runs.push(full);
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(FILE, JSON.stringify(this.runs, null, 2));
    return full;
  }

  all(): RunRecord[] { return this.runs; }
  clear() { this.runs = []; if (existsSync(FILE)) writeFileSync(FILE, "[]"); }
}

export const runMemory = new RunMemory();
