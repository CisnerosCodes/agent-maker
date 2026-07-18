// Eval harness types — Instruction-Following Ladder.

export type Tier =
  | "format"        // T1: exact output format
  | "structured"    // T2: structured / recursive output
  | "constraint"    // T3: constraint stacks under pressure
  | "adversarial"   // T4: distractors, injections, mid-prompt reversals
  | "long-horizon"; // T5: cross-referenced sequencing

export interface GradeResult {
  pass: boolean;
  notes: string[];
}

export interface Level {
  id: string;
  title: string;
  tier: Tier;
  description: string;
  prompt: string;
  grade(text: string): GradeResult;
}

export interface TrialResult {
  trial: number;
  response: string;
  pass: boolean;
  notes: string[];
  latencyMs: number | null;
  error?: string;
}

export interface LevelResult {
  levelId: string;
  title: string;
  tier: Tier;
  trials: TrialResult[];
  passRate: number; // 0..1
}

export interface ModelRun {
  model: string;
  backend: string;
  levels: LevelResult[];
  cleared: number;        // levels with passRate === 1
  total: number;
  breakingPoint: string | null; // first level id with passRate < 1
  score: number;          // sum of passRates, 0..total
  avgLatencyMs: number | null;
}

export interface EvalRun {
  id: string;
  startedAt: string;
  finishedAt?: string;
  backend: string;
  trials: number;
  runnerNote?: string;    // caveats about how responses were obtained
  models: ModelRun[];
}

// A backend turns a bare prompt into the model's raw text response.
export interface ModelBackend {
  name: string;
  complete(
    prompt: string,
    opts: { model: string; levelId: string; trial: number; maxTokens?: number },
  ): Promise<{ text: string; latencyMs: number | null }>;
}
