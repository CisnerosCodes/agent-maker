# Improvements — Fundamental Changes

Written July 17 after the eval harness landed. This is the "fight me" doc:
what's structurally weak, what to change, and in what order. Companion to
`docs/ORCHESTRATION.md` (tactical build order).

## 1. Slack is a window, not a nervous system (the fundamental change — SHIPPED)

**The claim to fight:** "everyone uses Slack, so agents should talk in Slack."

**The counter:** Slack is where *humans* watch the company; it is a bad
transport for the company itself.

- **Rate limits & latency** — Slack Web API throttles per-channel; a 3-agent
  org posting progress ticks hits limits fast. A 10-agent org is unusable.
- **Unstructured** — agents exchanging JSON specs through a chat UI means
  parsing markdown out of messages. Fragile exactly where the ladder showed
  models are weakest (markdown fences!).
- **Not replayable / not testable** — you can't unit-test a Slack thread, or
  re-run yesterday's org from its transcript.
- **Auth + demo risk** — Socket Mode tokens, workspace invites, conference
  wifi. Judges can't see it without joining your workspace.
- **The actual emerging standard** for agent-to-agent is not chat apps: it's
  structured protocols (MCP for tools, A2A-style messaging for peers) or an
  owned event bus, with human surfaces as adapters.

**What we shipped instead:** `src/bus/bus.ts` — a persisted, SSE-streamed
message bus that is the single source of truth. Threads per goal, typed
message kinds (`chat/status/question/finding/system`), full history on disk.
The dashboard chat is adapter #1 (offline-safe, judges see everything).
Slack becomes adapter #2: a thin mirror that forwards bus messages to a
channel and posts replies back onto the bus (~60 lines with Socket Mode,
build when tokens exist). If Slack dies on stage, the company doesn't.

**Security bonus:** one bus = one choke point. `SecurityGate.scan()` now wraps
`bus.post()` (SHIPPED) and every inter-agent message is scanned — "depth of
instrumentation" for free.

## 2. "Claude Design, but for business" — intake that interrogates (SHIPPED, v1)

The goal flow is not fire-and-forget. `orchestrator.startGoal()`:
underspecified goal → CEO posts a *question* to the thread ("which niche, how
many products?") → user answers in dashboard (or later Slack) → planning
proceeds with the enriched goal. This is the differentiator: the company
pushes back before hiring, like a real exec would.

**Role library — SHIPPED (was the "3 hardcoded templates" gap).**
`src/roles/library.ts` holds playbooks (store-launch, marketing-agency,
market-research) as data; the CEO matches a playbook and instantiates its
roles. Adding a role = a library entry + a policy YAML. This makes "hires from
a growing library of roles" literally true. Say that line, not "makes any
agent" — see `docs/PITCH.md`. Swap `matchPlaybook()` for a `ModelBackend`
classifier to compose roles for fully off-script goals.

**Next steps for intake:**
- Replace the scripted clarify heuristic with a model call (same `ModelBackend`
  interface) that extracts {niche, budget, product count, deadline} and asks
  only for what's missing.

## 3. Don't re-test known models (SHIPPED)

`data/evals/model-cache.json` stores each model's full ladder result. The
runner skips any cached model (zero tokens) and only actually tests models
new to the system; `--force` re-tests. Cache entries record which run they
came from. Re-test deliberately when a model version bumps.

## 4. Progress you can *see* (SHIPPED, v1)

Tasks now carry `progress`, `estimateSec`, `startedAt/finishedAt`, and
dependencies. Dashboard renders per-agent progress bars, ETA ("~18s left ·
est 40s"), a goal strip (tasks done / total est), click-through drawer per
agent (objective, messages, event log, spec/identity JSON, direct-message
box), and the live company channel with thread filtering.

**Honesty note:** the work loop is *simulated* (timed ticks + scripted
milestone messages) so the demo runs offline today. The pipeline around it —
factory provisioning, vault identities, registry events, bus messages,
dashboard — is real. Swapping the simulation for real workers is exactly the
`ModelBackend` worker loop in ORCHESTRATION.md §2; estimates then come from
eval latency data instead of constants.

## 5. Recursive intelligence — SHIPPED (was "0% real")

`src/memory/runs.ts` writes every completed goal back to `data/runs.json`:
niche, findings, and per-run timing. A later goal in the same niche recalls the
prior run, skips re-research (0 re-scrapes, 0 research API calls, reuses the
findings), and the CEO reports the delta. The dashboard's Run Memory strip
shows run-1 vs run-N. This is the only place the system writes knowledge back
about itself — "gets better on repeat work" made literal and demonstrable.
Verified live: run 2 for the same niche cites run 1 by id and reuses its 5
findings. The wall-clock delta is small with the fast sample source and
becomes large with a real Apify scrape (run 2 skips seconds run 1 spent).

## 6. Remaining structural gaps (build order)

1. **HiddenLayer real call** — `mapFindings()` in gate.ts still maps a guessed
   schema (Sky, tonight). Heuristic floor is live; the real API merges on top
   with `HIDDENLAYER_API_KEY`. This is the track-eligibility item.
2. **Shopify verify-once** — code path written; run it against the real dev
   store once and confirm 3 products appear (ORCHESTRATION §Go-live).
3. **Nemotron slug verify** — `nvidia/llama-3.1-nemotron-70b-instruct` has never
   been called; confirm it responds via one ladder pass before claiming the bounty.
4. **NemoClaw containment** — spawn the research worker in a real OpenShell
   sandbox mounting `policies/rendered/<agent>.yaml` (already written). Downgrade
   to "attempted" without shame if time runs out.
5. **Estimates from data** — derive `estimateSec` from eval latency × task size
   instead of constants.
6. **Slack adapter** — the ~60-line Socket Mode mirror, once tokens exist.
7. **Registry hygiene** — cap per-agent log at ~200 events; JSON writes are
   last-wins (fine solo).
8. **Factory hardening** — `identity: null as any` placeholder; add failure
   states (vault miss → agent `failed`) so a bad spec doesn't crash the CEO.
