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

**Security bonus:** one bus = one choke point. `SecurityGate.scan()` can wrap
`bus.post()` and every inter-agent message is scanned — "depth of
instrumentation" gets deeper for free.

## 2. "Claude Design, but for business" — intake that interrogates (SHIPPED, v1)

The goal flow is not fire-and-forget. `orchestrator.startGoal()`:
underspecified goal → CEO posts a *question* to the thread ("which niche, how
many products?") → user answers in dashboard (or later Slack) → planning
proceeds with the enriched goal. This is the differentiator: the company
pushes back before hiring, like a real exec would.

**Next steps for intake:**
- Replace the scripted heuristic with a model call (same `ModelBackend`
  interface as evals) that extracts {niche, budget, product count, deadline}
  and asks only for what's missing.
- Skills/templates: a `skills/` dir of org templates (store-launch, market
  research, content pipeline) the CEO pulls from — "pulls on skills" — with
  per-template role specs and estimates, instead of hardcoded `rolesFor()`.

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

## 5. Remaining structural gaps (build order)

1. **Escalation loop** — approve/deny endpoints are still no-ops; wire to an
   escalation store + `guarded()` promise (ORCHESTRATION.md §1). This is the
   climax of both money demos; highest priority after the demo polish.
2. **Real worker loop** — plan→act→observe against a `ModelBackend` +
   role-scoped tool table, replacing the simulation behind the same task API.
3. **Gate on the bus** — scan every `bus.post()` when HIDDENLAYER_API_KEY is
   set; detections become `question` messages + `blocked` status.
4. **Estimates from data** — derive `estimateSec` from eval latency ×
   task size instead of constants; show estimate vs actual on the goal strip
   (the Recursive Intelligence metric, run 1 vs run 2).
5. **Slack adapter** — the ~60-line mirror, once tokens exist. Socket Mode,
   no public URL.
6. **Registry hygiene** — log arrays grow unbounded; cap per-agent log at
   ~200 events. JSON file writes are last-wins; fine solo, swap for Supabase
   only if credits arrive and it's free time-wise.
7. **Factory hardening** — `identity: null as any` placeholder; add failure
   states (vault miss → agent `failed`, event logged) so a bad spec doesn't
   crash the CEO.
