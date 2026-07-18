# Orchestration — Implementation Plan

Owner: Adrian. This is the concrete build order for taking the scaffold from
stubs to the two money demos. It complements `PLAN.md` (the battle plan) —
this doc is *what to type next*, in priority order.

## Where the code is today

| Piece | File | State |
|---|---|---|
| Types | `src/types.ts` | done |
| Registry (JSON + events) | `src/registry/registry.ts` | done, working |
| Dashboard SSE + org chart | `dashboard/server.ts`, `dashboard/index.html` | working; approve/deny endpoints are no-ops |
| Eval harness (model testing) | `src/evals/` | **done, working** — see `/evals` on the dashboard |
| Factory pipeline | `src/factory/factory.ts` | skeleton; policy render + NemoClaw spawn are TODO(Sky) |
| Vault | `src/vault/vault.ts` | identity issue + Resend send done; needs real keys in `.env` |
| SecurityGate | `src/security/gate.ts` | routing logic done; real HiddenLayer call is TODO(Sky) |
| CEO | `src/ceo/CEO_PROMPT.md` | prompt v1; not yet wired to troublemaker |

## Model policy (from the eval harness)

Workers should run the cheapest model that clears the ladder tiers their role
needs. The harness (`npm run eval`) measures exactly that: T1–T2 (format,
structured output) is the minimum bar for any tool-using worker; T4
(adversarial) is the bar for any worker that ingests external documents
(Research agent). Re-run the ladder against Nemotron via `--backend nvidia`
once the NVIDIA key lands, and pick worker models from the matrix instead of
guessing. The `ModelBackend` interface in `src/evals/backends.ts` is the same
abstraction the worker loop uses below — an eval pass on a backend means that
exact backend+model is demo-safe.

## Build order

### 1. Escalation loop end-to-end (highest ROI — it is both money demos' climax)

- Add an `escalations` map to the registry (`Escalation` type already exists in
  `src/types.ts`) with `create/resolve` methods that emit SSE events.
- `guarded()` in `gate.ts`: `onFlagged` creates an escalation, sets the agent
  `blocked`, and returns a Promise that resolves when the escalation resolves.
- Wire `/approve/:id` and `/deny/:id` in `dashboard/server.ts` to
  `registry.resolveEscalation(id, verdict)` — the dashboard buttons already
  POST there.
- Slack mirror: CEO posts the escalation with approve/deny instructions; either
  surface resolves it (first one wins).

### 2. Worker execution loop (make workers real without waiting on NemoClaw)

- `src/factory/worker.ts`: a loop that takes an `AgentSpec`, a `ModelBackend`,
  and a small tool table (`apify`, `shopify-admin`, `resend`), and runs
  plan→act→observe until objective done or blocked. Every model I/O and tool
  result goes through `guarded()`.
- Factory step 3 gets two modes: `WORKER_MODE=nemoclaw` (Sky's sandbox spawn)
  and `WORKER_MODE=local` (this loop, in-process). Local mode is the fallback
  that keeps the demo alive if NemoClaw slips — same registry events, same
  dashboard, same gate.
- Credentials: Factory resolves `env:*` refs from the Vault at spawn time and
  passes only that role's keys into the worker's tool table (or sandbox env).

### 3. CEO on troublemaker

- Slack goal message → CEO decomposes (per `CEO_PROMPT.md`) → emits
  `AgentSpec[]` as JSON → calls `createAgent()` for each.
- Heartbeat: read `registry.all()`, act on `blocked`/`failed`/`done`, post one
  Slack line per meaningful change.
- CEO's own model I/O also goes through `guarded()` — "every token" means the
  boss too.

### 4. Security depth (Sky, interfaces already fixed)

- Real HiddenLayer call in `scan()` + `mapFindings()` against their actual
  response schema; flip fail-open to fail-closed before the demo.
- Policy render in `factory.ts`: template `policies/<role>.yaml`, restrict
  egress to the endpoints implied by the role's credentials.
- Poisoned-document red-team doc for the Research agent (money demo #2).

### 5. Vault polish

- Resend domain verified; `sendAsAgent()` smoke-tested.
- Optional: Cloudflare Email Routing webhook → registry event, so an agent
  visibly *receives* mail on the dashboard.

### 6. Recursive-intelligence metrics (cheap, do Saturday night)

- Log per-run timings/errors in `data/runs.json`; second store-launch vs first
  is the submission evidence.

## Go-live checklist (each item flips one worker/layer from sim to real)

The code paths are built and default to sim when a dependency is missing. Add
the key/box and the dashboard label flips REAL automatically — no code change.

1. **Research worker — REAL NOW.** Fetches live product data over HTTP and
   synthesizes findings (deterministic if no model key; LLM analysis when a
   brain is available). Set `RESEARCH_SOURCE_URL` to an Apify actor dataset
   URL to swap the demo source for a real scrape.
2. **HiddenLayer on the bus + escalation loop — REAL NOW (heuristic floor).**
   `bus.on(message)` scans every inter-agent message; worker ingestion/prompt/
   response/tool-call all pass through `gateOrEscalate`. Flagged content raises
   a resolvable escalation; approve/deny endpoints resolve it. Add
   `HIDDENLAYER_API_KEY` and the real HL detections merge in on top of the
   heuristics (Sky: finish `hlScan`/`mapFindings` schema mapping in gate.ts).
   Demo the climax with the **"inject poisoned doc"** button.
3. **Shopify — REAL when `SHOPIFY_ADMIN_TOKEN` + `SHOPIFY_STORE_URL` set.**
   Builder POSTs 3 products to the Admin API; the real store URL becomes the
   goal deliverable. Until then it runs labeled SIMULATION.
4. **Nemotron — REAL when `NVIDIA_INFERENCE_API_KEY` set + `WORKER_BACKEND=nvidia`.**
   Worker inference routes through the NVIDIA OpenAI-compatible endpoint. Run
   one ladder pass for the bounty write-up:
   `npm run eval -- --backend nvidia --models nvidia/llama-3.1-nemotron-70b-instruct`
5. **NemoClaw sandbox (Sky's box) — the one contained worker.** Factory step 3
   currently marks the sandbox in-registry; wire the real `nemoclaw onboard`
   spawn and mount the rendered policy (`policies/rendered/<agent>.yaml`, now
   actually written). The research policy already declares `deny evil.example`
   egress — that's the "blocks the exfil attempt" moment for the NemoClaw judges.

## Testing the orchestration itself

The eval harness doubles as the orchestration's regression suite: after wiring
the worker loop, point `npm run eval -- --backend nvidia --models <worker-model>`
at the exact backend workers use. A worker model that can't clear T1–T2 will
corrupt Factory JSON handoffs — catch it on the ladder, not on stage.
