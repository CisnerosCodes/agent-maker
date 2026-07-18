# Kickoff Prompt

Paste this into Claude Code / Cursor from the repo root. One copy for Adrian, one adapted for Sky (swap the "Your lane" section).

---

You are working on **agent-maker**, a hackathon project (code freeze Sunday 11 AM). Read `PLAN.md` and `README.md` fully before writing any code — they are the source of truth for scope and priorities.

## Context

We are building a self-expanding agent ecosystem: a CEO agent (running on the troublemaker runtime, https://github.com/tinyfatco/troublemaker) that delegates to a Factory which spawns NVIDIA NemoClaw worker agents inside OpenShell sandboxes. Every model input/output passes through a HiddenLayer SecurityGate. A Slack channel is the control plane; a live SSE dashboard shows the org chart, statuses, and human approval buttons.

Primary judging story: HiddenLayer runtime security track + NemoClaw/OpenShell bounty. The demo is: (1) "launch a Shopify store for trending shoes" end-to-end with 3 workers, (2) a poisoned document that HiddenLayer flags AND the OpenShell policy independently blocks.

## Your lane (Adrian — orchestration)

Work in this order, and get each step DEMOABLE before moving on:

1. Wire the CEO: run troublemaker with the Slack Socket Mode adapter, load `src/ceo/CEO_PROMPT.md` as its memory/system context, confirm it responds in #agent-corp.
2. Make `src/factory/factory.ts` real: spec in → registry updated with live events → a NemoClaw worker actually spawns (coordinate with Sky on the exact CLI invocation; keep it behind one function so his interface is stable).
3. Vault: seed `.env` credentials, verify `sendAsAgent` works via Resend, ensure raw secrets never land in the registry or logs.
4. Dashboard: `npm run dev`, confirm SSE updates render as agents change status; wire /approve and /deny to actually unblock agents.
5. Only then: polish, extra agents, ladder goals.

## Your lane (Sky — security), if this copy is Sky's

1. NemoClaw: get ONE OpenClaw worker alive in an OpenShell sandbox using NVIDIA hosted endpoints (`NEMOCLAW_PROVIDER=build`). Non-interactive env vars only — the Factory must be able to spawn without menus.
2. Replace the TODOs in `src/security/gate.ts` with the real HiddenLayer Runtime Security API (key uses event code AITX-2026). Verify a known prompt-injection string gets flagged.
3. Make `policies/worker-research.yaml` match the REAL OpenShell schema, then write `worker-storebuilder.yaml`. Test each policy by trying to break it from inside the sandbox — the bounty is judged adversarially.
4. Build the poisoned-document demo: a file that triggers HiddenLayer detection AND an exfil attempt the policy blocks.

## Rules

- Boring and working beats clever and broken. Judges give 15 pts for "completes core workflow without crashing."
- Never commit secrets; `.env` is gitignored, keep it that way.
- Every external integration goes behind a small interface (see `gate.ts`, `vault.ts`) so a broken API on demo day can be stubbed in five minutes.
- Commit small and often to `main`; we are two people, no PR ceremony, but pull before push.
- If a task is not on the Friday/Saturday list in PLAN.md, ask before building it.
- Update PLAN.md's checklist as things land, so the team always knows the true state.

Start by reading PLAN.md, then tell me your first three concrete actions before touching code.
