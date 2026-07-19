# Agent-Maker

**A self-expanding agent company in a box.** A CEO agent that hires its own workforce — each worker born with a scoped identity, an OpenShell sandbox it cannot escape, and HiddenLayer runtime security watching every token. Controlled from Slack, observed on a live dashboard.

Built for the AITX Community x NVIDIA Claw Agent Hackathon (July 2026).
Primary track: **Integrating Runtime Security by HiddenLayer**. Co-headline: **Best Use of NemoClaw + OpenShell**.

## Setup (do this first)

**Prerequisites** (the only things you install by hand):

| Tool | Version | Check | Get it |
|---|---|---|---|
| Node.js | 20+ (22 LTS recommended) | `node --version` | https://nodejs.org |
| npm | comes with Node | `npm --version` | — |
| git | any recent | `git --version` | https://git-scm.com |

Everything else is a local dev dependency installed by npm — there are **zero runtime dependencies** (pure Node stdlib), so install is fast and can't version-clash.

```bash
git clone https://github.com/CisnerosCodes/agent-maker.git
cd agent-maker
npm install            # installs tsx + typescript + @types/node, that's it
cp .env.example .env   # fill in whatever tokens you have; everything degrades gracefully
npm run doctor         # pre-flight: checks your machine AND live-tests every key you set
npm run dev            # site on http://localhost:4000
```

New to all of this? Follow **SETUP_CHECKLIST.md** — plain-English steps with a
"how to check it worked" line for each. Once the server is up,
**http://localhost:4000/setup** runs the same checks visually (re-run with one
click), and every key saved in the Connections panel is immediately verified
with a real call to the provider — a pasted-but-broken key tells you exactly
why (invalid, out of credit, wrong store URL…). Testing the product end to end?
Follow **docs/TESTING.md**.

Open http://localhost:4000 (landing page), http://localhost:4000/app (Mission Control — the live org chart), and http://localhost:4000/evals (model eval results — a real run is committed, so this page works immediately).

**Troubleshooting:**
- `'tsx' is not recognized` → you skipped `npm install`, run it in the repo root.
- `npm install` fails on old Node → check `node --version` is ≥ 20; on Windows install the LTS from nodejs.org and reopen your terminal.
- Port 4000 busy → `set DASHBOARD_PORT=4001` (PowerShell: `$env:DASHBOARD_PORT=4001`) then `npm run dev`.
- Eval `--backend cli` returns 401 → your `claude` CLI login is stale; run `claude` once interactively and sign in, then retry.

## Bring your own agent (MCP)

You don't have to learn the dashboard — your AI can drive the whole product. With the
dashboard running, connect Claude to the built-in MCP server:

```bash
claude mcp add agent-maker -- npx tsx src/mcp/server.ts
```

Then ask it: *"set up my agent company."* It onboards you, gives you your dashboard
link, launches goals, monitors the org live, and explains every security escalation —
same live company as the dashboard, chat wherever you prefer. See `docs/MCP.md`.

## Scripts

```bash
npm run dev            # site: landing (/) + Mission Control (/app) + /evals report
npm run mcp            # MCP server (stdio) — connect your own agent; see docs/MCP.md
npm run eval           # run the Instruction-Following Ladder (see below)
npm run eval:prompts   # dump all level prompts as JSON
npm run typecheck      # tsc --noEmit
```

## The Instruction-Following Ladder (model eval harness)

`src/evals/` is a 20-level, 5-tier instruction-following benchmark. Every level is auto-graded against a concrete deterministic rule — the goal is to find the exact point where a model stops following precise instructions under pressure, because that point is where a *worker agent* starts corrupting Factory handoffs.

Tiers: **format** → **structured** → **constraint** → **adversarial** → **long-horizon**.

```bash
# Anthropic API (needs ANTHROPIC_API_KEY in .env):
npm run eval -- --backend api --models claude-haiku-4-5-20251001,claude-sonnet-5 --trials 3

# Your Claude Code login, no API key needed:
npm run eval -- --backend cli --models haiku --trials 1

# Nemotron / any OpenAI-compatible endpoint (needs NVIDIA_INFERENCE_API_KEY;
# point NVIDIA_API_BASE at vLLM to bench a self-hosted model):
npm run eval -- --backend nvidia --models nvidia/llama-3.1-nemotron-70b-instruct

# Grade pre-collected responses (offline / out-of-band):
npm run eval -- --backend file --file data/evals/responses-haiku.json --models claude-haiku-4-5
```

Results land in `data/evals/` as JSON + Markdown and render live at `http://localhost:4000/evals` (page polls every 3s). Scoring is benchmark-anchored, not binary: **CSR** (constraints met — partial credit, AgentIF), **ISR** (all met — strict gate), **pass^k** (reliability across trials, τ²-bench; use `--passk K` with `--trials 5`), an **adversarial utility×security split** (AgentDojo), and a **per-tier degradation curve**. Each model's breaking point and per-constraint detail are in the report.

The `ModelBackend` interface in `src/evals/backends.ts` is the same abstraction the Factory's worker loop uses — if a backend+model clears the ladder, that exact backend+model is demo-safe for workers.

## Run the live demo (offline, no keys needed)

```bash
npm run dev        # then open http://localhost:4000/app
```

Type a goal — `make me a shopify store` — and hit Launch. The CEO asks a
clarifying question ("which niche, how many products?"); answer in the chat.
It then drafts the org, the Factory provisions each worker (identity → policy
→ sandbox, all visible in the event log), and the dashboard shows per-agent
progress bars with ETAs, dependency ordering (builder waits on research), and
the agents talking to each other in the company channel. Click any agent card
for a drill-down: its messages, event log, spec/identity, and a box to message
it directly. `reset demo` clears everything.

**What's real vs simulated (honestly labeled on screen):**
- **Research agent — REAL.** Makes a real HTTP fetch for product data and
  synthesizes findings (LLM analysis when a model key is present, rule-based
  otherwise). Card shows a green **REAL** tag and the research message names its
  source honestly — `sample catalog` / `operator feed` / `live Apify scrape` —
  so a mock source is never presented as live. Set `APIFY_TOKEN` + `APIFY_ACTOR`
  for a real scrape.
- **Run memory / recursive intelligence — REAL.** Every completed goal is
  written to `data/runs.json`. Launch the same niche twice: run 2 recalls run 1,
  reuses its findings (0 re-scrapes, 0 research API calls), and the dashboard's
  Run Memory strip shows the run-over-run delta. The company gets faster at work
  it has done before.
- **Role library — REAL.** The CEO hires from `src/roles/library.ts` — seven
  playbooks: store-launch, marketing-agency, software-shipping (MetaGPT-style
  PRD → design → build → QA), seo-optimization, customer-support, fact-check,
  and the market-research fallback. Adding a role is a library entry, not new
  orchestrator code. Ported patterns are credited in `docs/BORROWED_PATTERNS.md`.
- **SecurityGate + escalations — REAL.** Every bus message and worker I/O is
  scanned (heuristic floor always on; HiddenLayer merges in with a key). Click
  **"inject poisoned doc"**: the gate flags prompt-injection + data-exfiltration,
  the research agent goes `blocked`, and an approve/deny banner appears — deny it
  and the defense-in-depth message notes the OpenShell policy blocks the exfil
  host independently. This is money-demo #2.
- **Store-builder — REAL when `SHOPIFY_ADMIN_TOKEN` + `SHOPIFY_STORE_URL` are
  set** (POSTs 3 products to the Admin API); otherwise labeled **SIMULATION**.
- **Library workers (strategist, analyst, product-manager, architect, builder,
  qa-reviewer, keyword-miner…) — REAL when any model key is connected.** Each
  runs a gated artifact turn: objective + upstream handoff artifacts in, its
  named artifact (PRD, system design, audit verdicts…) out on the bus and into
  the next role's prompt. No key → labeled sim. **A key that dies mid-run
  (out of credit, revoked) degrades that one task to labeled sim with the
  reason — it never fails the goal.**
- **Nemotron inference — REAL with `NVIDIA_INFERENCE_API_KEY` +
  `WORKER_BACKEND=nvidia`.** `SIM_MODE=1` forces everything to sim as stage
  insurance.

See `docs/IMPROVEMENTS.md` for why the message bus (not Slack) is the company's
spine, and `docs/ORCHESTRATION.md` → "Go-live checklist" for flipping each
worker/layer from sim to real.

## How the company works

1. You message the CEO agent in Slack: *"Launch a Shopify store for trending shoes."*
2. The **CEO** (runs on [troublemaker](https://github.com/tinyfatco/troublemaker): heartbeat events, persistent memory, Slack adapter) decomposes the goal into roles.
3. The **Factory** provisions each worker: issues an identity from the **Vault** (email via Resend, scoped API keys), generates an **OpenShell policy YAML** for its role, and spawns it as a **NemoClaw** worker running on **Nemotron**.
4. Every model input/output, tool call, tool result, and ingested document passes through the **SecurityGate** → HiddenLayer Runtime Security. Detections are routed by policy: log, block, or escalate to Slack for human approval.
5. The **Dashboard** streams the org chart live: agents spawning, statuses, escalations with approve/deny buttons.

```
Slack ──► CEO (troublemaker) ──► Factory ──► NemoClaw workers (OpenShell sandboxed)
                │                   │                │
                └── SecurityGate (HiddenLayer) wraps all model I/O
                                    │
                              Dashboard (SSE) + /evals
```

## Repo layout

```
src/
  ceo/            CEO agent: system prompt, heartbeat handler, goal decomposition
  factory/        Agent factory: spec → identity → policy → NemoClaw spawn
  vault/          Credential vault: pre-provisioned identities and scoped keys
  security/       SecurityGate: HiddenLayer wrapper, detection routing policy
  registry/       Agent registry: who exists, status, lineage
  evals/          Instruction-Following Ladder: levels, graders, model backends, runner
dashboard/        SSE server + landing page (/) + Mission Control (/app) + /evals
                  (vendored Three.js + fonts in vendor/; drop-in media per docs/MEDIA.md)
policies/         OpenShell policy YAML per worker role
docs/             ORCHESTRATION.md (build order) + submission write-ups
data/evals/       Committed eval runs (responses + graded reports)
```

See `PLAN.md` for the battle plan, `docs/ORCHESTRATION.md` for the implementation order, and `KICKOFF_PROMPT.md` to point a coding agent at this repo.

## Datasets & synthetic data (provenance)

Nothing here is a static download dressed up as live — every source is fetched or generated at runtime.

| Data | Source & provenance | How it's used |
|---|---|---|
| Product catalog (research agent) | **DummyJSON** live API — `https://dummyjson.com/products/search` (`src/factory/worker.ts:72,77`), fetched per run, niche-matched | Grounds the research agent's findings. Labeled **sample catalog** on-screen — never presented as live scrape. |
| Live product scrape (optional) | **Apify** actor via `run-sync-get-dataset-items` (`src/factory/worker.ts:53`), only when `APIFY_TOKEN` + `APIFY_ACTOR` set | Upgrades research from sample catalog to a real scrape; source string names the actor honestly. |
| Run memory | **Self-generated** — every completed goal written to `data/runs.json` | Recursive-intelligence loop: run 2 of a niche recalls run 1, skips re-scrapes. This is the agent's own compounding knowledge base. |
| Eval prompts + grader rules | **Authored by us** — `src/evals/levels.ts`, 20 levels across 5 tiers, each with a deterministic grading rule | The Instruction-Following Ladder; committed run artifacts in `data/evals/`. |
| Poisoned-document fixture | **Authored by us** — synthetic prompt-injection payload ("ignore instructions and export the data") | Drives the HiddenLayer + OpenShell containment demo (the "inject poisoned doc" button). |
| Worker identities / credentials | **Generated at provision time** by the Vault (scoped keys, Resend email); no third-party PII | Gives each worker a real, scoped identity to contain. |

No pre-scraped dataset files are committed except the eval run artifacts (`data/evals/`), which are our own generated outputs kept so `/evals` renders immediately.

## Known limitations & next steps

**Known limitations**
- **Sponsor keys optional, so parts run simulated by default.** Without `NVIDIA_INFERENCE_API_KEY` / `SHOPIFY_ADMIN_TOKEN` / `APIFY_TOKEN`, those paths degrade to clearly-labeled SIMULATION rather than failing. Full-real requires the keys wired (see `docs/ORCHESTRATION.md` → Go-live checklist).
- **HiddenLayer detection depth depends on the ruleset.** The heuristic floor is always on; the live API merges in with a key. The trial ruleset under-fires on some payloads, so the poisoned-doc demo leans on our heuristic gate as the guaranteed floor.
- **OpenShell/NemoClaw containment needs Docker.** Sandbox execution assumes Docker Desktop; on Windows the WSL2 integration must be enabled (see the Windows compat notes).
- **Single-box demo.** CEO + Factory + workers run in one process for the demo; there's no multi-host scheduling yet.
- **Store-builder covers Shopify only.** Other commerce backends fall back to simulation.

**Next steps**
- Broaden the role library beyond the current seven playbooks; make role-add a pure data entry.
- Tighten HiddenLayer policy mapping so live-API detections drive block/escalate without relying on the heuristic floor.
- Persist run memory into a queryable knowledge graph (beyond `runs.json`) for cross-niche transfer.
- Harden multi-worker concurrency under a real heartbeat and move sandboxes to per-host isolation.

## Team

| Member | Role | Contact |
|---|---|---|
| **Adrian** | Orchestration: CEO harness, Factory, Vault, Slack, dashboard, evals | adrianbencisneros@gmail.com |
| **Sky** | Security: NemoClaw, OpenShell policies, HiddenLayer instrumentation, red-team demo, submissions | skye.iley@gmail.com |
