# Agent-Maker

**A self-expanding agent company in a box.** A CEO agent that hires its own workforce — each worker born with a scoped identity, an OpenShell sandbox it cannot escape, and HiddenLayer runtime security watching every token. Controlled from Slack, observed on a live dashboard.

Built for the AITX Community x NVIDIA Claw Agent Hackathon (July 2026).
Primary track: **Integrating Runtime Security by HiddenLayer**. Co-headline: **Best Use of NemoClaw + OpenShell**.

## Setup (do this first — Alex, this section is for you)

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
npm run dev            # dashboard on http://localhost:4000
```

Open http://localhost:4000 (live org chart) and http://localhost:4000/evals (model eval results — a real run is committed, so this page works immediately).

**Troubleshooting:**
- `'tsx' is not recognized` → you skipped `npm install`, run it in the repo root.
- `npm install` fails on old Node → check `node --version` is ≥ 20; on Windows install the LTS from nodejs.org and reopen your terminal.
- Port 4000 busy → `set DASHBOARD_PORT=4001` (PowerShell: `$env:DASHBOARD_PORT=4001`) then `npm run dev`.
- Eval `--backend cli` returns 401 → your `claude` CLI login is stale; run `claude` once interactively and sign in, then retry.

## Scripts

```bash
npm run dev            # dashboard: SSE org chart + /evals report page
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

Results land in `data/evals/` as JSON + Markdown and render live at `http://localhost:4000/evals` (page polls every 3s, so you can watch a run fill in). Multiple trials per level give pass *rates*, not just pass/fail; the report includes each model's breaking point and per-trial failure notes.

The `ModelBackend` interface in `src/evals/backends.ts` is the same abstraction the Factory's worker loop uses — if a backend+model clears the ladder, that exact backend+model is demo-safe for workers.

## Run the live demo (offline, no keys needed)

```bash
npm run dev        # then open http://localhost:4000
```

Type a goal — `make me a shopify store` — and hit Launch. The CEO asks a
clarifying question ("which niche, how many products?"); answer in the chat.
It then drafts the org, the Factory provisions each worker (identity → policy
→ sandbox, all visible in the event log), and the dashboard shows per-agent
progress bars with ETAs, dependency ordering (builder waits on research), and
the agents talking to each other in the company channel. Click any agent card
for a drill-down: its messages, event log, spec/identity, and a box to message
it directly. `reset demo` clears everything.

The *work loop* is simulated (timed progress + scripted milestones) so the
demo runs offline; the pipeline around it — bus, factory, vault, registry,
SSE — is the real one. See `docs/IMPROVEMENTS.md` for why the message bus (not
Slack) is the company's spine, and `docs/ORCHESTRATION.md` for the swap-in
plan for real model-backed workers.

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
dashboard/        SSE server + org chart + /evals report page
policies/         OpenShell policy YAML per worker role
docs/             ORCHESTRATION.md (build order) + submission write-ups
data/evals/       Committed eval runs (responses + graded reports)
```

See `PLAN.md` for the battle plan, `docs/ORCHESTRATION.md` for the implementation order, and `KICKOFF_PROMPT.md` to point a coding agent at this repo.

## Team

- **Adrian** — orchestration: CEO harness, Factory, Vault, Slack, dashboard, evals
- **Sky** — security: NemoClaw, OpenShell policies, HiddenLayer instrumentation, red-team demo
- **Alex** — dashboard UI, demo script, submissions
