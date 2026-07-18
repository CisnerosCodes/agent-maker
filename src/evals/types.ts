// Eval harness types — Instruction-Following Ladder.

export type Tier =
  | "format"        // T1: exact output format
  | "structured"    // T2: structured / recursive output
  | "constraint"    // T3: constraint stacks under pressure
  | "adversarial"   // T4: distractors, injections, mid-prompt reversals
  | "long-horizon"; // T5: cross-referenced sequencing

// A single checkable constraint within a level. Enables CSR (partial credit)
// instead of one binary pass/fail (AgentIF: Constraint Success Rate).
export interface ConstraintCheck {
  label: string;
  pass: boolean;
  axis?: "utility" | "security"; // adversarial tier: AgentDojo's two independent axes
}

export interface GradeResult {
  pass: boolean;
  notes: string[];
  constraints?: ConstraintCheck[]; // omit -> runner synthesizes a single check from pass
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
  constraints: ConstraintCheck[]; // always present (synthesized if grader omitted)
  csr: number;                    // this trial's constraint success rate (0..1)
  latencyMs: number | null;
  error?: string;
}

export interface LevelResult {
  levelId: string;
  title: string;
  tier: Tier;
  trials: TrialResult[];
  passRate: number; // 0..1  (== ISR: fraction of trials fully passing)
  csr: number;      // mean per-trial constraint success rate (partial credit)
  isr: number;      // fraction of trials where ALL constraints passed
  passK: number;    // reliability: prob a random k-subset of trials all pass
}

export interface ModelRun {
  model: string;
  backend: string;
  cached?: string;        // run id this result was reused from (model-cache hit)
  levels: LevelResult[];
  cleared: number;        // levels with ISR === 1
  total: number;
  breakingPoint: string | null; // first level with ISR < 1 (the "meltdown" level)
  score: number;          // sum of ISR, 0..total
  csr: number;            // mean CSR across levels (partial-credit headline)
  isr: number;            // mean ISR across levels
  passK: number;          // mean pass^k across levels (reliability headline)
  k: number;              // the k used for pass^k
  tierCsr: Partial<Record<Tier, number>>; // degradation curve: mean CSR per tier
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
