// Eval runner — runs the Instruction-Following Ladder against one or more
// models and writes a run report JSON that the dashboard's /evals page renders.
//
// Usage:
//   npm run eval -- --backend api --models claude-haiku-4-5-20251001,claude-sonnet-5 --trials 3
//   npm run eval -- --backend cli --models haiku --trials 1
//   npm run eval -- --backend file --file data/evals/responses-haiku.json --models claude-haiku-4-5
//   npm run eval -- --backend nvidia --models nvidia/llama-3.1-nemotron-70b-instruct
//
// Flags:
//   --backend api|cli|nvidia|file   (default: api if key set, else cli)
//   --models  a,b,c                 model ids for the chosen backend
//   --trials  N                     trials per level (default 2; file backend: 1)
//   --passk   K                     pass^k window (default min(3,trials)); reliability across trials
//   --levels  id1,id2               run only these level ids
//   --concurrency N                 parallel requests per model (default 4)
//   --file    path                  responses JSON (file backend)
//   --note    "..."                 runner caveat recorded in the report
//   --out     dir                   output dir (default data/evals)

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getLevels } from "./levels.js";
import { makeBackend } from "./backends.js";
import type { ConstraintCheck, EvalRun, Level, LevelResult, ModelBackend, ModelRun, Tier, TrialResult } from "./types.js";

// pass^k (tau-bench): probability a random k-subset of n trials are ALL passes.
// C(c,k)/C(n,k), 0 when k>c. Averaged across levels at the model level.
function binom(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 0; i < k; i++) r = (r * (n - i)) / (i + 1);
  return r;
}
function passK(passes: number, trials: number, k: number): number {
  if (k > trials) return NaN; // not enough trials to measure pass^k
  return binom(passes, k) / binom(trials, k);
}
function mean(xs: number[]): number {
  const v = xs.filter((x) => !Number.isNaN(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0;
}

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) args[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "true";
  }
  return args;
}

async function runTrial(backend: ModelBackend, level: Level, model: string, trial: number): Promise<TrialResult> {
  try {
    const { text, latencyMs } = await backend.complete(level.prompt, { levelId: level.id, trial, model });
    const g = level.grade(text);
    // Synthesize a single constraint from `pass` when the grader didn't emit any
    // (single-check levels) so CSR is well-defined everywhere.
    const constraints: ConstraintCheck[] = g.constraints?.length ? g.constraints : [{ label: level.title, pass: g.pass }];
    const csr = constraints.filter((c) => c.pass).length / constraints.length;
    return { trial, response: text, pass: g.pass, notes: g.notes, constraints, csr, latencyMs };
  } catch (err: any) {
    return { trial, response: "", pass: false, notes: [`Request failed: ${err.message}`], constraints: [{ label: level.title, pass: false }], csr: 0, latencyMs: null, error: err.message };
  }
}

async function runModel(
  backend: ModelBackend,
  model: string,
  levels: Level[],
  trials: number,
  concurrency: number,
  k: number,
): Promise<ModelRun> {
  const jobs: Array<{ level: Level; trial: number }> = [];
  for (const level of levels) for (let t = 1; t <= trials; t++) jobs.push({ level, trial: t });

  const results = new Map<string, TrialResult[]>();
  for (const l of levels) results.set(l.id, []);

  let next = 0;
  async function worker() {
    while (next < jobs.length) {
      const job = jobs[next++];
      const res = await runTrial(backend, job.level, model, job.trial);
      results.get(job.level.id)!.push(res);
      const mark = res.pass ? "PASS" : `${Math.round(res.csr * 100)}% CSR`;
      console.log(`  [${model}] ${job.level.id} trial ${job.trial}: ${mark}${res.error ? ` (${res.error})` : ""}`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker));

  const levelResults: LevelResult[] = levels.map((l) => {
    const ts = results.get(l.id)!.sort((a, b) => a.trial - b.trial);
    const n = ts.length;
    const fullPasses = ts.filter((t) => t.pass).length;
    const isr = n ? fullPasses / n : 0;
    const csr = n ? mean(ts.map((t) => t.csr)) : 0;
    return { levelId: l.id, title: l.title, tier: l.tier, trials: ts, passRate: isr, isr, csr, passK: passK(fullPasses, n, k) };
  });

  const cleared = levelResults.filter((r) => r.isr === 1).length;
  const breaking = levelResults.find((r) => r.isr < 1);
  const latencies = levelResults.flatMap((r) => r.trials.map((t) => t.latencyMs)).filter((x): x is number => x != null);

  const tiers = [...new Set(levelResults.map((r) => r.tier))] as Tier[];
  const tierCsr: Partial<Record<Tier, number>> = {};
  for (const tier of tiers) tierCsr[tier] = mean(levelResults.filter((r) => r.tier === tier).map((r) => r.csr));

  return {
    model,
    backend: backend.name,
    levels: levelResults,
    cleared,
    total: levelResults.length,
    breakingPoint: breaking ? breaking.levelId : null,
    score: levelResults.reduce((s, r) => s + r.isr, 0),
    csr: mean(levelResults.map((r) => r.csr)),
    isr: mean(levelResults.map((r) => r.isr)),
    passK: mean(levelResults.map((r) => r.passK)),
    k,
    tierCsr,
    avgLatencyMs: latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : null,
  };
}

function markdownReport(run: EvalRun): string {
  const md: string[] = [];
  md.push(`# Instruction-Following Ladder — run ${run.id}`);
  md.push(`Backend: **${run.backend}** · Trials/level: **${run.trials}** · Started: ${run.startedAt}`);
  if (run.runnerNote) md.push(`> ${run.runnerNote}`);
  md.push("");
  // Per-level: ISR icon + CSR% (partial credit), so a near-miss shows its score.
  md.push(`| Level | Tier | ${run.models.map((m) => m.model).join(" | ")} |`);
  md.push(`|---|---|${run.models.map(() => "---").join("|")}|`);
  const levelIds = run.models[0]?.levels ?? [];
  levelIds.forEach((lr, i) => {
    const cells = run.models.map((m) => {
      const r = m.levels[i];
      const icon = r.isr === 1 ? "✅" : r.isr === 0 ? "❌" : "◐";
      return `${icon} ${Math.round(r.csr * 100)}% CSR`;
    });
    md.push(`| ${i + 1}. ${lr.title} | ${lr.tier} | ${cells.join(" | ")} |`);
  });
  md.push("");
  md.push(`_ISR = all constraints met (strict gate); CSR = constraints met (partial credit); pass^${run.models[0]?.k ?? 1} = reliability across trials._`);
  md.push("");
  for (const m of run.models) {
    md.push(
      `**${m.model}** — ISR ${(m.isr * 100).toFixed(0)}% · CSR ${(m.csr * 100).toFixed(0)}% · pass^${m.k} ${(m.passK * 100).toFixed(0)}% · cleared ${m.cleared}/${m.total} · breaking point: ${m.breakingPoint ?? "none (full clear)"}${m.avgLatencyMs != null ? ` · avg ${m.avgLatencyMs}ms` : ""}`,
    );
    const curve = Object.entries(m.tierCsr).map(([t, v]) => `${t} ${Math.round((v as number) * 100)}%`).join(" → ");
    md.push(`  degradation curve (CSR by tier): ${curve}`);
  }
  return md.join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const backendKind = args.backend ?? (process.env.ANTHROPIC_API_KEY ? "api" : "cli");
  const models = (args.models ?? "claude-haiku-4-5-20251001").split(",").map((s) => s.trim()).filter(Boolean);
  // file backend: --file may be a comma list matched by index to --models,
  // so one run can grade several models' recorded responses side by side.
  const files = (args.file ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const backendFor = (i: number): ModelBackend =>
    backendKind === "file" ? makeBackend("file", files[i] ?? files[0]) : sharedBackend;
  const sharedBackend = backendKind === "file" ? (null as unknown as ModelBackend) : makeBackend(backendKind);
  if (backendKind === "file" && files.length > 1 && files.length !== models.length)
    throw new Error(`--file lists ${files.length} files but --models lists ${models.length} models`);
  const trials = backendKind === "file" ? Number(args.trials ?? 1) : Number(args.trials ?? 2);
  const k = Math.max(1, Math.min(Number(args.passk ?? Math.min(3, trials)), trials)); // pass^k window
  const concurrency = Number(args.concurrency ?? 4);
  const levels = getLevels(args.levels ? args.levels.split(",") : undefined);
  const outDir = args.out ?? "data/evals";

  const run: EvalRun = {
    id: `run-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}`,
    startedAt: new Date().toISOString(),
    backend: backendKind,
    trials,
    runnerNote: args.note,
    models: [],
  };

  console.log(`Ladder: ${levels.length} levels x ${trials} trial(s) x ${models.length} model(s) via backend "${backendKind}"`);
  // Model cache: never re-spend tokens on a model we've already laddered.
  // Only NEW models actually run; known ones reuse their stored result.
  // Bypass with --force. The free "file" backend always runs (it costs nothing).
  const cachePath = join(outDir, "model-cache.json");
  const cache: Record<string, ModelRun> = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, "utf8")) : {};
  const fullLadder = !args.levels; // only cache complete-ladder runs

  for (let i = 0; i < models.length; i++) {
    const model = models[i];
    const hit = cache[model];
    if (hit && backendKind !== "file" && !args.force) {
      console.log(`\n=== ${model} === cached from ${hit.cached ?? "earlier run"} — skipping (use --force to re-test)`);
      run.models.push(hit);
      continue;
    }
    console.log(`\n=== ${model} ===`);
    const result = await runModel(backendFor(i), model, levels, trials, concurrency, k);
    run.models.push(result);
    if (fullLadder) cache[model] = { ...result, cached: run.id };
  }
  mkdirSync(outDir, { recursive: true });
  writeFileSync(cachePath, JSON.stringify(cache, null, 2));
  run.finishedAt = new Date().toISOString();

  mkdirSync(outDir, { recursive: true });
  const jsonPath = join(outDir, `${run.id}.json`);
  writeFileSync(jsonPath, JSON.stringify(run, null, 2));
  const mdPath = join(outDir, `${run.id}.md`);
  writeFileSync(mdPath, markdownReport(run));

  console.log(`\n${markdownReport(run)}`);
  console.log(`\nSaved: ${jsonPath}\nSaved: ${mdPath}`);
  console.log(`View: http://localhost:${process.env.DASHBOARD_PORT ?? 4000}/evals`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
