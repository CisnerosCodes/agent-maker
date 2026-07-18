# Agent-Maker

**A self-expanding agent company in a box.** A CEO agent that hires its own workforce — each worker born with a scoped identity, an OpenShell sandbox it cannot escape, and HiddenLayer runtime security watching every token. Controlled from Slack, observed on a live dashboard.

Built for the AITX Community x NVIDIA Claw Agent Hackathon (July 2026).
Primary track: **Integrating Runtime Security by HiddenLayer**. Co-headline: **Best Use of NemoClaw + OpenShell**.

## How it works

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
                              Dashboard (SSE)
```

## Repo layout

```
src/
  ceo/            CEO agent: system prompt, heartbeat handler, goal decomposition
  factory/        Agent factory: spec → identity → policy → NemoClaw spawn
  vault/          Credential vault: pre-provisioned identities and scoped keys
  security/       SecurityGate: HiddenLayer wrapper, detection routing policy
  registry/       Agent registry: who exists, status, lineage
dashboard/        SSE server + single-page org chart with approvals
policies/         OpenShell policy YAML per worker role
docs/             Plan, demo script, submission write-ups
```

## Quickstart (team)

```bash
git clone https://github.com/CisnerosCodes/agent-maker.git
cd agent-maker
npm install
cp .env.example .env   # fill in tokens
npm run dev            # starts registry + dashboard; CEO runs via troublemaker
```

See `PLAN.md` for the full battle plan and `KICKOFF_PROMPT.md` to point a coding agent at this repo.

## Team

- **Adrian** — orchestration: CEO harness, Factory, Vault, Slack, dashboard
- **Sky** — security: NemoClaw, OpenShell policies, HiddenLayer instrumentation, red-team demo
- **Alex** — (if joining) dashboard UI, demo script, submissions
