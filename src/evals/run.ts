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
//   --levels  id1,id2               run only these level ids
//   --concurrency N                 parallel requests per model (default 4)
//   --file    path                  responses JSON (file backend)
//   --note    "..."                 runner caveat recorded in the report
//   --out     dir                   output dir (default data/evals)

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getLevels } from "./levels.js";
import { makeBackend } from "./backends.js";
import type { EvalRun, Level, LevelResult, ModelBackend, ModelRun, TrialResult } from "./types.js";

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
    const { pass, notes } = level.grade(text);
    return { trial, response: text, pass, notes, latencyMs };
  } catch (err: any) {
    return { trial, response: "", pass: false, notes: [`Request failed: ${err.message}`], latencyMs: null, error: err.message };
  }
}

async function runModel(
  backend: ModelBackend,
  model: string,
  levels: Level[],
  trials: number,
  concurrency: number,
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
      const mark = res.pass ? "PASS" : "FAIL";
      console.log(`  [${model}] ${job.level.id} trial ${job.trial}: ${mark}${res.error ? ` (${res.error})` : ""}`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker));

  const levelResults: LevelResult[] = levels.map((l) => {
    const ts = results.get(l.id)!.sort((a, b) => a.trial - b.trial);
    const passRate = ts.length ? ts.filter((t) => t.pass).length / ts.length : 0;
    return { levelId: l.id, title: l.title, tier: l.tier, trials: ts, passRate };
  });

  const cleared = levelResults.filter((r) => r.passRate === 1).length;
  const breaking = levelResults.find((r) => r.passRate < 1);
  const latencies = levelResults.flatMap((r) => r.trials.map((t) => t.latencyMs)).filter((x): x is number => x != null);
  return {
    model,
    backend: backend.name,
    levels: levelResults,
    cleared,
    total: levelResults.length,
    breakingPoint: breaking ? breaking.levelId : null,
    score: levelResults.reduce((s, r) => s + r.passRate, 0),
    avgLatencyMs: latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : null,
  };
}

function markdownReport(run: EvalRun): string {
  const md: string[] = [];
  md.push(`# Instruction-Following Ladder — run ${run.id}`);
  md.push(`Backend: **${run.backend}** · Trials/level: **${run.trials}** · Started: ${run.startedAt}`);
  if (run.runnerNote) md.push(`> ${run.runnerNote}`);
  md.push("");
  md.push(`| Level | Tier | ${run.models.map((m) => m.model).join(" | ")} |`);
  md.push(`|---|---|${run.models.map(() => "---").join("|")}|`);
  const levelIds = run.models[0]?.levels ?? [];
  levelIds.forEach((lr, i) => {
    const cells = run.models.map((m) => {
      const r = m.levels[i];
      return r.passRate === 1 ? "✅" : r.passRate === 0 ? "❌" : `${Math.round(r.passRate * 100)}%`;
    });
    md.push(`| ${i + 1}. ${lr.title} | ${lr.tier} | ${cells.join(" | ")} |`);
  });
  md.push("");
  for (const m of run.models) {
    md.push(
      `**${m.model}** — cleared ${m.cleared}/${m.total}, score ${m.score.toFixed(1)}, breaking point: ${m.breakingPoint ?? "none (full clear)"}${m.avgLatencyMs != null ? `, avg latency ${m.avgLatencyMs}ms` : ""}`,
    );
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
  for (let i = 0; i < models.length; i++) {
    console.log(`\n=== ${models[i]} ===`);
    run.models.push(await runModel(backendFor(i), models[i], levels, trials, concurrency));
  }
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
