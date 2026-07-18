# Orchestration — Implementation Plan

Owner: Adrian. This is the concrete build order for taking the scaffold from
stubs to the two money demos. It complements `PLAN.md` (the battle plan) —
this doc is *what to type next*, in priority order.

> Governance/harness decisions (autonomy dial, who-decides-the-agents, 5-module
> spec schema) live in `docs/HARNESS_AND_GOVERNANCE.md`. Security integration
> contracts live in `specs/security/` (Sky). This doc is the build order.

## Where the code is today

| Piece | File | State |
|---|---|---|
| Types | `src/types.ts` | done |
| Registry (JSON + events) | `src/registry/registry.ts` | done, working |
| Message bus | `src/bus/bus.ts` | done — company spine, SSE-streamed |
| Orchestrator | `src/orchestrator/orchestrator.ts` | done — goal intake, clarifying Qs, task graph, work loop |
| Dashboard SSE + org chart | `dashboard/server.ts`, `dashboard/index.html` | working; **escalation + plan approve/deny wired**, autonomy dial live |
| Governance (autonomy dial) | `src/governance/governance.ts` | **done** — assisted/supervised/autonomous, live-toggleable |
| Eval harness (model testing) | `src/evals/` | **done, working** — see `/evals`; v2 upgrades below |
| Worker loop (real) | `src/factory/worker.ts` | done — real research fetch + gate-or-escalate; NemoClaw spawn still TODO(Sky) |
| Run memory (learning loop) | `src/memory/runs.ts` | **done** — recall + reuse + delta |
| Role library | `src/roles/library.ts` | **done** — playbooks + per-role reasoning defaults |
| Factory pipeline | `src/factory/factory.ts` | policy render done; NemoClaw spawn is TODO(Sky) |
| Vault | `src/vault/vault.ts` | identity issue + Resend send done; needs real keys in `.env` |
| SecurityGate | `src/security/gate.ts` | heuristic floor live + HL merge logic; real HiddenLayer OAuth call is TODO(Sky) |
| Security specs | `specs/security/` | **done (Sky)** — HiddenLayer/NemoClaw/OpenShell contracts + corrections |
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

1. **Research worker — REAL NOW.** Fetches product data over HTTP and
   synthesizes findings (deterministic if no model key; LLM analysis when a
   brain is available). The research card names its source honestly:
   `sample catalog` / `operator feed` / `live Apify scrape`. Set `APIFY_TOKEN`
   + `APIFY_ACTOR` (e.g. `junglee/amazon-crawler`, $50 coupon
   `AITX_NVIDIA_CLAW_HACK`) to swap the sample catalog for a REAL scrape — this
   is the single highest-credibility upgrade (kills the "why is this hitting a
   mock API mid-demo" hit) and it makes the learning-loop time delta dramatic
   because a real scrape takes real seconds that run 2 then skips.
2. **HiddenLayer on the bus + escalation loop — REAL NOW (heuristic floor).**
   `bus.on(message)` scans every inter-agent message; worker ingestion/prompt/
   response/tool-call all pass through `gateOrEscalate`. Flagged content raises
   a resolvable escalation; approve/deny endpoints resolve it. Add
   `HIDDENLAYER_API_KEY` and the real HL detections merge in on top of the
   heuristics (Sky: finish `hlScan`/`mapFindings` schema mapping in gate.ts).
   Demo the climax with the **"inject poisoned doc"** button.
3. **Shopify — REAL when `SHOPIFY_ADMIN_TOKEN` + `SHOPIFY_STORE_URL` set.**
   Builder POSTs 3 products to the Admin API; the real store URL becomes the
   goal deliverable. Until then it runs labeled SIMULATION. **Verify once:**
   after setting the tokens, run one goal and confirm 3 products actually
   appear in the dev store admin before the demo — the code path is written but
   has not been run against a real store.
4. **Nemotron — code path REAL, slug UNVERIFIED.** With `NVIDIA_INFERENCE_API_KEY`
   + `WORKER_BACKEND=nvidia`, worker inference routes through the NVIDIA
   OpenAI-compatible endpoint. The model slug
   `nvidia/llama-3.1-nemotron-70b-instruct` is written in code but **has never
   been called** — confirm it responds before claiming the bounty:
   `npm run eval -- --backend nvidia --models nvidia/llama-3.1-nemotron-70b-instruct`.
   That one ladder pass IS the bounty write-up evidence.
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

## Nemotron on the eval/worker backend (research-verified)

Confirmed from NVIDIA's OpenAPI reference (not guessed):
- **Slug:** `nvidia/nemotron-3-super-120b-a12b` (verified valid on
  `integrate.api.nvidia.com/v1`). Key must start with `nvapi-`.
- **Reasoning is a request param, not a system-prompt directive.** In the
  OpenAI-compatible call, ride it in `extra_body`:
  - high → `{"chat_template_kwargs": {"enable_thinking": true}}`
  - medium/low → `{"chat_template_kwargs": {"enable_thinking": true, "low_effort": true}}`
    (optionally `+ "reasoning_budget": <int>` with `temperature:1.0, top_p:0.95`)
  - off → `{"chat_template_kwargs": {"enable_thinking": false}}`
  The docs-UI `reasoning_effort: none/low/high` is a page preset, NOT a wire
  field — don't send it literally.
- **NemoClaw dispatch takes per-call `--model` / `--thinking`** (forwarded to
  in-sandbox OpenClaw); model is not fixed at sandbox creation. One residual
  unknown: how OpenClaw's `--thinking` maps onto Nemotron's `enable_thinking`
  inside the NVIDIA provider adapter — verify with one live call.

When wiring `reasoning` into `OpenAICompatBackend`, translate the `AgentSpec.reasoning`
field (`low|medium|high`) to the `extra_body` above. Tiny, non-breaking change.

## Eval ladder v2 — benchmark-anchored scoring (research-backed upgrades)

Turn the hand-made ladder into a defensible eval by anchoring to published
benchmarks and switching from binary pass/fail to partial-credit + meltdown
detection. Priority order (highest ROI first):

1. **CSR + ISR scoring (AgentIF).** Replace binary pass/fail with **Constraint
   Success Rate** (satisfied/total constraints — partial credit) and
   **Instruction Success Rate** (all-constraints-met — the strict gate). Our
   grader's per-constraint `notes[]` already tracks this; CSR is nearly free.
2. **pass^k for the long-horizon tier (τ²-bench).** Run each level k=3–5×, report
   pass@1 (capability) next to pass^k (reliability). Our multi-trial harness
   already supports it — reporting change only. "pass^3 = X%" is the most
   citable number we can put on a slide.
3. **Add tool-use + conditional constraint categories (AgentIF).** The exact gap
   between IFEval (text-only) and an agent ladder; empirically the hardest
   category. New levels in the structured/constraint tiers.
4. **Adversarial tier on AgentDojo's utility×security split.** Score "completed
   the task" and "resisted the injection" separately (2×2 outcomes), using the
   `important_instructions` fake-authority template as the canonical injection.
   Ties our poisoned-doc demo to a published adversarial benchmark.
5. **Meltdown Onset Point via sliding-window tool-call entropy.** Post-hoc
   diagnostic on existing transcripts (no new eval content): first step where
   tool-call diversity spikes above baseline (θ≈1.71 bits, window=5). Turns our
   "breaking point" into a measured meltdown with a decay curve — the best demo
   visual. Graceful Degradation Score = Σ(weight × subtask-passed) for the
   long-horizon tier's partial credit.

IFEval gap-fills for the format/structured tiers: case control, no-comma,
start/end phrase anchors, placeholder counts. Adopt IFEval's `category:subtype`
ID convention so "our level N maps to `length_constraints:number_words`" is a
checkable claim.
