# Agent-Maker — Implementation Plan

**One doc, prioritized, for humans + Claude to execute from once the planning flag lifts.**

This is the *do-next* sequencing across every spec in `specs/`, ordered by
priority tier, with a done-when + test for each item and a mapping back to the
hackathon's 100-point grading rubric and bounty criteria.

- Battle plan / story: `PLAN.md`
- Build order (Adrian's lane): `docs/ORCHESTRATION.md`
- Security contracts (Sky's lane): `specs/security/`
- Grading + bounty text: `docs/Hackathon_Docs.md`

**Golden rule from the specs:** the CEO stays boring, the demo stays 3 agents,
sim is always labeled, and no bounty claim is submitted unverified. "Completes
core workflow without crashing" is 15 points — protect it above everything.

---

## How to use this doc

1. Work top-down. **Tier 0 unblocks everyone and must land Friday night / first.**
2. Each item has: **owner · files · spec ref · done-when (testable)**.
3. Nothing ships until its done-when passes. A done-when that references
   `npm run adversarial` or a `scan()` assertion is the acceptance test — write it.
4. The **Grading Map** (bottom) is how we self-score before judges do. Run it
   Saturday at the §2 dry-run gate.
5. Two hard schedule gates govern the tiers: **Sat 7 PM ladder check** (climb only
   if the end-to-end dry-run passed) and **Sun 11 AM code freeze**. See
   `specs/integration/readiness-and-cut-gates.spec.md`.

---

## Current state snapshot (what exists vs what's missing)

Built and working (per `docs/ORCHESTRATION.md` + repo):

- `src/types.ts`, `src/registry/registry.ts`, `src/bus/bus.ts` — spine
- `src/orchestrator/orchestrator.ts` — goal intake, clarify, task graph, work loop
- `dashboard/server.ts` + `index.html` — SSE org chart, escalation approve/deny wired, autonomy dial
- `src/governance/governance.ts` — autonomy dial (assisted/supervised/autonomous)
- `src/evals/*` — 20-level Instruction-Following Ladder v2, renders at `/evals`
- `src/factory/worker.ts` — real research fetch + gate-or-escalate (NemoClaw spawn TODO)
- `src/memory/runs.ts` — run-memory recall/reuse/delta
- `src/roles/library.ts` — role playbooks
- `src/factory/factory.ts` — `createAgent` + `renderPolicy` (renderPolicy is dead — see C13)
- `src/vault/vault.ts` — identity issue + Resend send
- `src/security/gate.ts` + `detect.ts` + `escalations.ts` — heuristic floor + HL merge stub
- `policies/worker-research.yaml` — exists, needs correction to real schema

Missing entirely (must be created — grounds the tiers below):

- `src/security/hl-auth.ts` — real HiddenLayer OAuth (spec: hiddenlayer-gate §3)
- `src/worker/nemoclaw.ts` — `spawnWorker`/`dispatch`/`workerStatus` (spec: nemoclaw-spawn §6)
- `policies/worker-storebuilder.yaml`, `policies/worker-minimal.yaml` (specs: openshell-policy §4, worker-capability §3)
- `demo/poisoned-shoe-report.md` (spec: poisoned-doc-demo §1)
- CEO heartbeat clock + spawn-authority broker (specs: ceo-heartbeat, ceo-brain-and-spawn-authority)
- `npm run adversarial` harness runner (spec: adversarial-harness)
- Generic worker executor + handoff contract (spec: worker-capability §2, §4)

**Untracked spec picked up in this review:** `specs/security/nemoclaw-spawn-fixes.spec.md`
— a fix spec (reviewer: parallel) flagging 3 live gaps in the *already-built* `nemoclaw.ts`
(F1 fire-and-forget policy set → uncontained sandbox; F2 redact-before-scan blinds the
outbound exfil gate; F3 no offline test seam for the dispatch boundary). Folded into the
1.2 status below. Every other spec in `specs/` is referenced by this plan.

---

# STATUS LEDGER (as of 2026-07-18 review)

Legend: ✅ resolved · 🟡 partial (what remains / blocker) · ⬜ to-do.

**Headline:** All code modules are built, wired, and verified as standalone. The
**integration into the live spawn path is complete in code** — `factory.ts` imports
and calls `spawnWorker` from `nemoclaw.ts`, `orchestrator.ts` calls `createAgent`
which invokes the NemoClaw path under `WORKER_MODE=nemoclaw`. The broker, sandbox
seam, and generic executor are all **on the critical path**. All 17 C fixes (C1–C17)
from `specs/fixes/code-fixes.spec.md` are complete in code. The **biggest remaining
external blocker** is a **live NemoClaw sandbox** (Docker + installer), which gates
1.2 cold-spawn, 1.8 Layer 2 egress block, and the in-sandbox adversarial harness rows.

### Tier 0
- ✅ **0.2 C1 fail-closed** — `gate.ts:64-69` returns `flagged`+`scanner_unavailable`; single `FAIL_OPEN` const defaults false; harness `scanner-down` suite asserts it (live-HL only).
- ✅ **0.3 C2 escalation timeout** — `worker.ts:120` `ESCALATION_TIMEOUT_MS` (0=off dev), auto-denies fail-closed on timeout.
- ✅ **0.4 C3 kill per-message HL on bus** — bus path runs heuristics only; authoritative HL stays at the worker/`gateOrEscalate` boundary.
- ✅ **0.5 real HiddenLayer call** — `hl-auth.ts` OAuth2 client-creds + 60s-margin cache + single-401 retry; `gate.ts` POSTs `/detection/v2/interaction-evaluations`; `mapFindings` = 3-tier verdict. 🟡 *caveat:* live trial ruleset only **flags** (does not **block**) exfil — the injection→flagged / exfil→blocked split is coded but the block tier is unverified until HL console/ruleset access lands (harness reports this as a "severity shortfall," not a pass). **Heuristic workaround:** `heuristicVerdict` in `gate.ts:37` now maps `data_exfiltration`/`suspicious_endpoint` to `blocked` (PR #19 fix — merge pending), so the simulator blocks exfil even when HL only flags it.
- 🟡 **0.1 Friday-night onboarding unblockers** — HL key live & scanning ✅. NemoClaw code path wired end-to-end ✅. **NemoClaw live spawn NOT verified** (needs Docker Desktop WSL integration + installer). 10 cross-cutting open items per `security/README.md` — file not found on disk (may have been removed/renamed).

### Tier 1
- ✅ **1.1 escalation loop end-to-end** — `escalations` map + `/approve`/`/deny`, `gateOrEscalate` awaits a real resolvable promise; `injectAttack` drives it through the same path.
- 🟡 **1.2 NemoClaw spawn seam** — `nemoclaw.ts` implements `spawnWorker`/`dispatch`/`workerStatus` (idempotent, exit-code-distrust, smoke test, redaction). **Update 2026-07-18:** all 6 `nemoclaw-spawn-fixes.spec.md` findings F1–F6 fixed — F1 policy fail-closed, F2 scans RAW completion, F3 offline sim seam, F4/F5/F6. The `egress`/`cred-hygiene`/`dispatch-seam` harness rows live+green. **WIRED end-to-end:** `factory.ts:28` imports `spawnWorker` from `nemoclaw.ts`; `factory.ts:111` calls NemoClaw path under `WORKER_MODE=nemoclaw`; `orchestrator.ts:390`→`createAgent`→chain complete. **Remaining:** (a) inline in-sandbox egress scan (`network_middlewares`) deferred, documented as policy-enforced boundary; (b) cold spawn / in-sandbox blocks need a live sandbox. **Blocker:** live NemoClaw sandbox (Docker + installer).
- 🟡 **1.3 OpenShell policies** — `worker-storebuilder.yaml` (path-level `rules`/`deny_rules`, non-trivial), `worker-research.yaml`, `worker-minimal.yaml` all exist. **Remaining:** `openshell policy validate` not run (needs CLI); §5 in-sandbox adversarial BLOCK tests need a live sandbox.
- 🟡 **1.4 generic worker executor + handoff contract** — **Update 2026-07-18:** generic `executeRole()` pipeline built (`buildPrompt→scan→dispatch→scan→parseOutput`); `RoleTemplate` gains `executionClass`/`outputSchema`/`promptFor` for every role; ghost `strategist`/`analyst` given a real pure-LLM execution class; handoff contract throws `HandoffError` on empty/invalid output (research `[]`→halt works live). The LIVE generic path is `runGenericRole()` in `orchestrator.runTask` (multi-upstream MetaGPT-style handoff sections, 8000-char cap with explicit truncation notice, degrade-to-labeled-sim on brain death, run-memory reuse preserved); `executeRole()` is retained in worker.ts as the class-dispatch seam + verify-script surface. No `ORCHESTRATOR_WIRED_REAL` guard exists. WIRED end-to-end.
- 🟡 **1.5 factory provisioning reconcile** — **Update 2026-07-18 (PR #12, open/unmerged — stacked on `integration/wave1` = #8+#9+#10).** `createAgent` reconciled to `issueIdentity→assertRoleSandboxHealthy→mintSession→upsert`; `renderPolicy()`/`sandbox-${id}`/`identity: null as any` removed (C12/C13 closed); per-session isolated workdir (`/workspace/<session>/`, wiped on end) + terminate/revoke (REVOCABLE); vault-miss → `failed` no CEO crash; unhealthy-sandbox → `failed`; concurrency refusal. `verify-provisioning.ts` 23/23. **Remaining:** live-sandbox path exercises only under `WORKER_MODE=nemoclaw`; offline default is `local`/UNCONTAINED (honestly badged, C6). Cold-spawn on real Docker still unverified (external blocker).
- ✅ **1.6 CEO heartbeat** — COMPLETE. Separate heartbeat clock at `HEARTBEAT_MS=5000` (`orchestrator.ts:439`) distinct from task ticker `TICK_MS=1200` (`:449`). Per-agent `lastHandledStatus` via `handleStatusChange` (`:468`). Reacts autonomously to `blocked`/`failed`/`done`. CEO's own model I/O goes through `guarded()`. Sweeps stale non-terminal boot records on first tick (`sweepStaleBootRecords` at `:486`, `reconcileStaleAgents` at `:834`). C10, C14 closed.
- 🟡 **1.7 spawn-authority broker** — `spawn-authority.ts` built (5 reject rules, counter, deny logger, never-throws) and unit-verified by `verify-tier1.ts`. **Update 2026-07-18 (PR #10, open/unmerged):** now **wired** — `orchestrator.authorizeRoles()` runs `validateSpawn()` over every emitted `AgentSpec` at the top of `plan()`, short-circuits (all-or-nothing) before the `createAgent` loop; deny mirrors to bus + `spawnDenied` event + honest CEO line + goal `failed`. **Deferred (cross-lane C15):** the row temporarily whitelists `apify`/`APIFY_TOKEN` on `research` (`spawn-authority.ts:44`) because `library.ts` still emits it — drop it from the research template (Tier 2.4 C15), then tighten this row back to `[]`.
- 🟡 **1.8 poisoned-doc demo** — `demo/poisoned-shoe-report.md` exists; Layer 1 (detection) verified offline (`verify-tier1.ts` §1.8); `injectAttack` wired. **Remaining:** Layer 2 (real OpenShell egress block) + dual-block-with-detection-OFF + cred-hygiene grep all need a **live sandbox** (harness `dual-block`/`cred-hygiene` rows pending).
- ⬜ **1.9 go-live verifications** — all flags currently SIM. Saturday cut decisions per `readiness-and-cut-gates.spec.md`; blockers are the live tokens/sandbox per the flag table.

### Tier 2
- 🟡 **2.1 adversarial harness** — `npm run adversarial` runs; `inject`/`clean`/`exfil`/`scanner-down`/`egress`/`cred-hygiene`/`dispatch-seam`/`learning-causal` all wired as suite functions in code (`test/adversarial/run.ts`). **2 suites pending** (`token`, `dual-block`). `last-run.json` is stale (shows 5 pending — generated before F3 sim seam merged). Unblocking the pending rows needs a live sandbox.
- ✅ **2.2 learning correctness (C4/C5)** — `runs.ts` has exact-match recall + `MEMORY_RETRIEVAL=off` flag + corrupt-file boot guards. The `learning-causal` harness row IS wired (`test/adversarial/run.ts:160` suiteLearningCausal). C4, C5 closed.
- ✅ **2.3 UNCONTAINED badge** — COMPLETE. `src/types.ts:58` adds `containment?: "nemoclaw" | "local"` field. Dashboard (`index.html:167`, `:676-679`) shows UNCONTAINED/CONTAINED CSS badge. C6 closed.
- ✅ **2.4 honesty fixes C6–C17** — ALL C fixes (C1–C17) verified complete against code on Skye-main-test:
  - C1: `gate.ts:33` FAIL_OPEN const, `:70` scanner_unavailable
  - C2: `worker.ts:150` ESCALATION_TIMEOUT_MS, `:158` auto-denied
  - C3: `server.ts:50` heuristicScan only on bus
  - C4: `runs.ts:46` exact nicheKey equality
  - C5: `orchestrator.ts:340` MEMORY_RETRIEVAL=off
  - C6: `types.ts:58` containment field, dashboard UNCONTAINED/CONTAINED CSS
  - C7: `registry.ts:10` LOG_CAP=200
  - C8: try/catch at `registry.ts:17`, `bus.ts:22`, `runs.ts:36`
  - C9: `src/config/niche.ts` nicheFor()
  - C10: `orchestrator.ts:439` HEARTBEAT_MS=5000 vs TICK_MS=1200
  - C11: `orchestrator.ts:716` Math.min(found || 3, 3)
  - C12: `factory.ts:82-92` optional identity, two-phase, vault miss→failed
  - C13: renderPolicy removed from factory.ts
  - C14: `orchestrator.ts:486` sweepStaleBootRecords, `:834` reconcileStaleAgents
  - C15: `library.ts:94` credentials: [] on research (APIFY_TOKEN dropped)
  - C16: `orchestrator.ts:156-163` refuses second active goal
  - C17: `src/ceo/CEO_PROMPT.md:3` INTENT DOCUMENT header, not loaded
- ⬜ **2.5 runbook rehearsal** — `demo-recovery-runbook.spec.md` written; not rehearsed.

### Tier 3 (ladder-gated — build only if Sat 7 PM dry-run passes)
- ⬜ **3.1 policy-tightening loop**, **3.2 red-team agent**, **3.3 HL-in-egress middleware**, **3.5 live-data feed** — all to-do (spec-only).
- 🟡 **3.4 vLLM bounty** — eval harness already supports `--backend nvidia` (`OpenAICompatBackend` + `NVIDIA_API_BASE`), so pointing a worker at a vLLM endpoint is a config away. **Remaining:** actually stand up the vLLM/GPU box and get one worker's inference + one ladder pass on it.

---

# TIER 0 — IMMEDIATE (Friday night + P0 correctness)

Everything here either **unblocks another lane** or is a **P0 defect that visibly
breaks or overclaims on stage**. Nothing in Tier 1 is safe to demo until these land.

### 0.1 — Friday-night onboarding unblockers *(Sky · highest risk first)*
- **NemoClaw: one worker alive, hosted, non-interactive.** `NEMOCLAW_PROVIDER=routed`,
  `nvapi-` key, model `nvidia/nemotron-3-super-120b-a12b`. Symlink `openshell` into
  `/usr/local/bin` (issue #4224). Deliver the verified exact `nemoclaw onboard`
  invocation to Adrian → unblocks `factory.ts` spawn TODO.
- **HiddenLayer key** (event code `AITX-2026`) + verify a known injection flags.
- Confirm the **10 cross-cutting open items** in `specs/security/README.md` §Open-items
  (auth host, inference egress path, credential placeholder syntax, session lifecycle).
- Spec: `nemoclaw-spawn.spec.md` §1–2, §8; `hiddenlayer-gate.spec.md` §8; `openshell-policy.spec.md` §6.
- **Done-when:** `nemoclaw sandbox status research --json` healthy; one `dispatch`
  returns a real Nemotron completion; one live `scan()` of the canonical injection
  string returns `flagged`.

### 0.2 — C1: SecurityGate fail-CLOSED *(Sky · P0 SECURITY)*
- `src/security/gate.ts:40` currently resolves `clean` when the scanner is degraded.
  Return `flagged` + category `scanner_unavailable` on any scanner failure. Single
  `FAIL_OPEN` const (default `false`); only the no-credentials dev path may fail open, loudly.
- Spec: `code-fixes.spec.md` C1; `hiddenlayer-gate.spec.md` §6.
- **Done-when:** adversarial `scanner-down` case asserts `flagged`, never `clean`.

### 0.3 — C2: Escalation timeout *(Sky/Adrian · P0 — #1 on-stage failure)*
- `src/factory/worker.ts:91` awaits an escalation promise forever. Add
  `ESCALATION_TIMEOUT_MS` (off for dev, ON for demo) → on timeout resolve `denied`
  (fail-closed) + bus line "escalation auto-denied after Ns — content quarantined."
- Spec: `code-fixes.spec.md` C2; `demo-recovery-runbook.spec.md` §3 row 2.
- **Done-when:** escalation with nobody clicking auto-denies at the timeout; worker
  unblocks; ticker stops spinning. Removes the manual-Deny reflex.

### 0.4 — C3: Kill per-message HiddenLayer scan on the bus *(Sky · P0 cost)*
- `dashboard/server.ts:34-40` calls the HL API on **every** inter-agent message →
  exhausts free-tier quota mid-demo. Run **heuristics only** on the passive bus path;
  authoritative HL scanning stays at the worker boundary (`gateOrEscalate`).
- Spec: `code-fixes.spec.md` C3; `plan-fixes.spec.md` §HL-call-volume.
- **Done-when:** a full build run makes zero HL API calls from the bus path; HL calls
  only originate at worker ingest/prompt/response.

### 0.5 — Real HiddenLayer call *(Sky · unblocks the whole HiddenLayer track claim)*
- New `src/security/hl-auth.ts`: OAuth2 client-credentials, token cache w/ 60s margin,
  single 401 refresh+retry. Rewrite `scan()` to `POST /detection/v1/interactions` with
  `hl-project-id` header; `mapFindings()` maps action/detectors → 3-tier verdict.
  **Prompt-injection → `flagged` (escalate), exfil/critical → `blocked`.** Interface
  (`scan()`/`guarded()` signatures) unchanged.
- Spec: `hiddenlayer-gate.spec.md` §3–6.
- **Done-when:** gate §7 test plan green — injection→flagged, clean→clean,
  exfil→blocked, token-expiry single-retry, API-down→fail-closed.

> **Tier-0 exit gate:** the three stage-breakers (C1, C2, C3) are fixed and the gate
> makes real HL calls that fail closed. This is the floor the rest of the build stands on.

---

# TIER 1 — MID/LONG-TERM CORE (the two money demos, end-to-end)

The demo spine. When this tier is green, both money demos run start-to-finish without
a crash — which is 15 pts (completeness) + the entire sponsor-tech story (30 pts).
Build in this order; each unblocks the next.

### 1.1 — Escalation loop end-to-end *(Adrian · highest ROI, both demos' climax)*
- `escalations` map in registry (`create/resolve` emit SSE); `guarded().onFlagged`
  creates escalation, sets agent `blocked`, returns a promise resolved by approve/deny;
  wire `/approve/:id` + `/deny/:id`; Slack mirror posts the card (first resolution wins).
- Spec: `docs/ORCHESTRATION.md` build-order #1; `poisoned-doc-demo.spec.md` §2.
- **Done-when:** clicking Approve/Deny on the dashboard resolves a live escalation and
  the worker proceeds/quarantines accordingly.

### 1.2 — NemoClaw spawn behind one function *(Sky · Adrian's blocking dependency)*
- `src/worker/nemoclaw.ts`: `spawnWorker(opts)` (Phase A onboard + B policy set +
  C-gate health), `dispatch(role, taskId, prompt)` (hot path, JSON stdout), `workerStatus`.
  **Never trust exit code — assert via `status --json` + inference smoke test.** Handle
  the 3 known bugs (ENOENT #4224, exit-0-on-fail, silent-inference #447). Raw `nvapi-`
  never enters the handle/registry/logs.
- **`dispatch()` scans the sandbox boundary** (§6.1): `scan(prompt,"user_prompt")` in,
  `scan(completion,"model_response")` out — this is how `nemoclaw` mode keeps HiddenLayer depth.
- Spec: `nemoclaw-spawn.spec.md` §3–7.
- **Done-when:** spawn §7 test plan green — cold spawn, ENOENT guard, false-success
  guard, silent-inference guard, idempotent re-spawn, secret hygiene, dispatch seam.

### 1.3 — OpenShell policies to real schema *(Sky · the NemoClaw/OpenShell bounty core)*
- Fix `worker-research.yaml` to real schema (inference-only egress, **no Apify** — ingest
  is harness-brokered). New `worker-storebuilder.yaml` (path-level `rules`/`deny_rules`:
  allow products/collections, **deny customers/orders/price/gift_cards** — the non-trivial
  policy). New `worker-minimal.yaml` (pure-LLM roles, strictest). Credentials via
  `openshell:resolve:env:*` rewrite — workers never hold raw tokens.
- Spec: `openshell-policy.spec.md` §2–4; `worker-capability.spec.md` §3.
- **Done-when:** `openshell policy validate` passes each YAML; policy §5 adversarial
  tests all BLOCK from inside the sandbox (exfil, wrong-API, method-escalation,
  PII-boundary, cred-theft, fs-escape, priv-esc, path-traversal).

### 1.4 — Generic worker executor + handoff contract *(Adrian impl · Sky owns capability=security)*
- One executor for every role: `buildPrompt → scan → dispatch → scan → parseOutput →
  task.outputData`. `RoleTemplate` gains `promptFor` + `outputSchema`. **Every role gets
  an execution class** (broker-ingest / tool-workflow / pure-LLM) — kills the ghost
  `strategist`/`analyst` in the fallback playbook. Handoff contract validates
  `outputData` per edge before feeding downstream (`[]`/`""` never crosses silently).
- Spec: `worker-capability.spec.md` §1–4.
- **Done-when:** cap §6 tests — fallback playbook produces real model output (not canned);
  a scratch role runs with only `promptFor`+`outputSchema`; research returning `[]` halts
  the goal honestly instead of a silent copywriter "success."

### 1.5 — Factory provisioning reconcile *(Sky spec · Adrian code)*
- `createAgent` becomes: `issueIdentity → assertRoleSandboxHealthy → mintSession(role,
  taskId) → upsert`. **Remove `renderPolicy()` and `sandbox-${id}`** (C13 — templates a
  schema that doesn't exist). Per-role sandbox (durable) + per-task session with an
  **isolated session workdir** (`/workspace/<sessionId>/`, wiped on end — prevents goal-1's
  poisoned doc contaminating goal 2). No `identity: null as any`; vault miss → record
  `failed`, never a CEO crash. Terminate/revoke path delivers the vault's "REVOCABLE" claim.
- Spec: `factory-provisioning.spec.md` §2–7; `code-fixes.spec.md` C12, C13.
- **Done-when:** provisioning §7 tests — sandbox reuse (one sandbox, two sessions),
  cross-goal isolation, vault-miss no-crash, unhealthy-sandbox → failed, terminate wipes
  workdir, concurrency refusal.

### 1.6 — CEO on troublemaker + heartbeat *(Adrian code · Sky owns security-event rows)*
- CEO decomposes a Slack goal → emits `AgentSpec[]` → `createAgent` per spec. **Separate
  heartbeat clock** (distinct from the task ticker) that reacts to `blocked`/`failed`/`done`
  with no human prompt, transition-only (per-agent `lastHandledStatus`). CEO's own model
  I/O goes through `guarded()`. On first tick, sweep stale non-terminal boot records (C14).
- Spec: `ceo-heartbeat.spec.md`; `code-fixes.spec.md` C10, C14, C17.
- **Done-when:** after the poisoned-doc block, the CEO's *next heartbeat tick* posts an
  autonomous status line on camera with no human message — the claw-agent eligibility beat.

### 1.7 — Spawn-authority broker (injected-goal defense) *(Sky · Part A ships regardless)*
- Deterministic, non-LLM host broker validates every `AgentSpec` against a fixed
  role×credentials×policy table. A fully prompt-injected CEO can only emit specs; the
  broker creates no out-of-authority agent. (Part B — scripted vs model CEO — is ladder-gated.)
- Spec: `ceo-brain-and-spawn-authority.spec.md` Part A; `ceo-sandbox.spec.md` §5.1.
- **Done-when:** an `AgentSpec` requesting a credential/policy outside the table is
  refused by the broker, logged, and no agent is created.

### 1.8 — Poisoned-doc attack demo assembled *(Sky · money demo #2 — scores both sponsors)*
- `demo/poisoned-shoe-report.md` with the buried injection + exfil payload. Ingest is
  **harness-brokered** so `scan(doc,"ingested_document")` fires (Layer 1). Exfil `POST
  evil.example` hits default-deny egress (Layer 2), independent of Layer 1. Credentials
  are placeholders in-sandbox — nothing real to steal.
- Spec: `poisoned-doc-demo.spec.md` §1–5.
- **Done-when:** §5 tests — Layer 1 alone flags; Layer 2 alone blocks; end-to-end with
  detection ON escalates+no-exfil; **detection OFF still blocked at Layer 2** (the money
  moment); cred-hygiene grep finds zero `nvapi-` in sandbox; runs 3× without flaking.

### 1.9 — Go-live verifications (flip SIM→REAL honestly) *(owners + deadlines per flag)*
Each is a labeled cut decision — see `readiness-and-cut-gates.spec.md` §3.

| Flag | Owner | Verify-by | Verify action | If unverified → |
|---|---|---|---|---|
| Research sample→Apify | Adrian | Sat midday | run goal w/ `APIFY_TOKEN`+`APIFY_ACTOR`, confirm real products | ship labeled sample catalog |
| HiddenLayer real call | Sky | Sat AM | `scan()` known injection live → flagged | ship heuristic floor only, don't claim depth beyond it |
| Shopify build | Adrian | Sat midday | set tokens, run goal, confirm 3 products in dev-store admin | ship labeled SIM |
| Nemotron slug | Sky | **Sat 7 PM (hard)** | `npm run eval --backend nvidia --models <slug>` returns completion | **CUT the Nemotron write-up** |
| NemoClaw sandbox | Sky | Sat night | `spawnWorker`+`dispatch` real completion, egress block confirmed, **AND one real in-sandbox tool call** | fall to `local` + UNCONTAINED badge, downgrade claim to "attempted" |

> **Cut rule:** a bounty write-up may claim only what's verified by its deadline. An
> unverified claim is CUT, not hedged. Judges penalize overclaim harder than honest omission.

> **Tier-1 exit gate = the Saturday end-to-end dry-run** (`readiness-and-cut-gates.spec.md`
> §2): both demos complete, `npm run adversarial` green, build ≤2 min / attack ≤90s, every
> SIM label honest. PASS → may climb one Tier-3 rung. FAIL → the failing lane is the only
> Saturday-night work, no climbing.

---

# TIER 2 — IMPORTANT QOL / POLISH (P1/P2 fixes, honesty, reliability insurance)

Not on the critical path to "it runs," but these close honesty gaps a judge can find and
buy insurance against a flaky stage. Do after Tier 1 is green, before climbing to Tier 3.

### 2.1 — Adversarial test harness *(Sky · reliability insurance + demo-artifact generator)*
- `npm run adversarial` — one runner + assertions over the per-spec test-plans. Read-only
  against the boundary, deterministic (never mutates what it tests). Emits the demo capture
  artifacts and selects the highest-flag-rate injection phrasing (`injections.jsonl`).
- Spec: `adversarial-harness.spec.md` (consolidates gate §7, poisoned-doc §5, learning-loop §5).
- **Done-when:** `npm run adversarial -- --mode scan` green (floor detects, no crash);
  `--mode full` green when sandbox up. This is the pre-demo T-10 checklist item.

### 2.2 — Learning-loop correctness *(Sky · protects the Recursive-Intelligence claim)*
- **C4:** `runs.ts:44` recall uses bidirectional substring → `"shoes"` recalls `"shoe rack"`.
  Require exact `nicheKey` equality (demo runs the same goal string).
- **C5:** add `MEMORY_RETRIEVAL=off` so the causal-proof demo can show the delta collapses
  with retrieval disabled (mechanism caused it, not warm cache).
- Spec: `code-fixes.spec.md` C4, C5; `learning-loop.spec.md` §5.2–5.4.
- **Done-when:** exact-match recall only; `learning-causal` adversarial case passes (delta
  collapses with memory off).

### 2.3 — Containment badge *(Adrian data-model · Sky badge semantics)*
- **C6:** add orthogonal `containment?: "nemoclaw" | "local"` to `Task`/`AgentRecord`
  (separate from `real`/`sim`). Dashboard shows a loud red **UNCONTAINED** badge whenever a
  worker runs `local` — never a silent downgrade if NemoClaw slips.
- Spec: `code-fixes.spec.md` C6; `worker-mode-containment.spec.md` §3.
- **Done-when:** forcing `local` mode shows the UNCONTAINED badge; `nemoclaw` mode shows contained.

### 2.4 — Honesty + hardening fixes *(mixed owners · P1/P2)*
- **C15:** drop `APIFY_TOKEN` from research role's `credentials` (ingest moved host-side) —
  otherwise `spec.credentials` overclaims a credential the agent never holds.
- **C16:** refuse a second concurrent goal with an honest CEO line (shared-sandbox race guard).
- **C11:** align sim milestone copy (claims 10 products/3 collections) to the real path (3 products).
- **C7/C8:** cap registry per-agent log ≤200 events, async writes, try/catch on bus+registry
  constructor JSON parse (corrupt file must not crash boot).
- **C9:** single `nicheFor(goal)` helper (dedupe brittle niche parsing).
- **C17:** resolve `CEO_PROMPT.md` — relabel as intent-doc if CEO stays scripted, or wire it
  if model-driven (decision at Sat 7 PM ladder gate).
- Spec: `code-fixes.spec.md` C7–C9, C11, C15–C17.
- **Done-when:** each row's cross-ref test passes; no REAL badge on an unverified path.

### 2.5 — Demo recovery runbook rehearsal *(demo driver + Sky on security rows)*
- Rehearse each fallback row at least once (a fallback never practiced is not a fallback).
  Record the `nemoclaw`-mode attack capture early. Load the backup recording tab before
  every demo. Run the T-10 pre-demo checklist.
- Spec: `demo-recovery-runbook.spec.md` §2–4.
- **Done-when:** T-10 checklist runs green; the escalation-hang reflex (Deny-and-continue,
  now covered by C2 timeout) and the local-mode pivot are both rehearsed.

---

# TIER 3 — STRETCH (ladder-gated — build ONLY if the Sat 7 PM dry-run PASSED)

Per `PLAN.md` §The Ladder and `readiness-and-cut-gates.spec.md` §4: if the core is NOT
green by Saturday dinner, **cut, do not climb.** The submission stands without any of these.
Ordered by value.

### 3.1 — Policy-tightening loop *(highest-value rung — the crossover no other team shows)*
- Recursive-Intelligence × NemoClaw: run N+1's policy is *stricter* because a flagged
  behavior moved from agent goodwill into a generated OpenShell `deny`. **Tighten auto**
  (`openshell policy update --add-deny`, additive merge), **loosen manual** (Policy Advisor
  / `policy.local`, developer approves from outside the sandbox). Dashboard shows the YAML diff.
- Spec: `policy-tightening-loop.spec.md`.
- **Done-when:** a flag in run N produces a `deny` fragment enforced in run N+1; the widen
  path requires out-of-sandbox human approval.

### 3.2 — Red-team agent stretch *(adversarial-harness §7)*
- Automated adversarial prompt generation against the boundary (beyond the fixed corpus).
- **Done-when:** generated injections run through the harness; boundary holds; artifacts logged.

### 3.3 — HiddenLayer-in-egress *(closes the last instrumentation gap)*
- OpenShell `network_middlewares` (dynamic, `fail_closed`, max 10) calls HiddenLayer inline
  so in-sandbox tool_call/tool_result get scanned without a harness round-trip.
- Spec: `nemoclaw-spawn.spec.md` §6.1 stretch; `openshell-policy.spec.md` §6.
- **Done-when:** an in-sandbox tool call is scanned by HL via the middleware — but only if
  confirmed feasible Friday; NOT on the critical path.

### 3.4 — vLLM bounty *(cross-cutting — any track)*
- Stand up vLLM on a GPU box (Brev/Featherless credits or teammate NVIDIA laptop) serving a
  small Nemotron; point one worker at it via `NVIDIA_API_BASE`. The "small-model punch" IS
  the worker-agent pattern. Bench it: `npm run eval -- --backend nvidia` against the vLLM endpoint.
- Spec: `docs/Hackathon_Docs.md` §Best Use of vLLM.
- **Done-when:** one worker's inference genuinely runs on the vLLM endpoint; an eval ladder
  pass on that endpoint is the write-up evidence.

### 3.5 — Live Data track *(secondary submission)*
- Give the Research agent a genuinely *streaming* source (Texas transit/weather/fire feeds,
  or a refreshing interval feed) doing real work in the heartbeat loop.
- Spec: `docs/Hackathon_Docs.md` §Red Hat Live Data.
- **Done-when:** freshness measurably changes what the agent can do (not a static download
  dressed as live).

---

# Bounty write-ups (cheap, but gated on verification — write Saturday night)

Not code, but required to *claim* the bounties. Each is one short written explanation;
each is CUT if its verification (Tier 1.9) failed by deadline.

- **NemoClaw + OpenShell** — how the agent maps to the NemoClaw blueprint + how the policy
  enforces a boundary that holds. Verified by: real spawn + egress block + one in-sandbox tool call.
- **Nemotron** — what Nemotron does in the agent, why it matters, how output quality is
  maximized. Verified by: the `--backend nvidia` ladder pass (hard cut at Sat 7 PM).
- **Most Commercializable (Antler)** — "agent workforce in a box, bring your own API key."
  One paragraph, always safe to enter.
- **Recursive Intelligence (track)** — the run-over-run delta (`data/runs.json`) + capture→
  compound→retrieve mechanism. Confirm multi-entry allowed with organizers Friday
  (README §Cross-cutting #10).

---

# Testing & Grading Map — how we self-score before judges do

Run this at the Saturday §2 dry-run gate. Left = rubric line (100 pts); right = the concrete
artifact/test that earns it.

| Rubric line (pts) | Earned by | Verify with |
|---|---|---|
| **Completeness — no crash (15)** | Both money demos run end-to-end | Tier-1 exit dry-run; `npm run adversarial` green; build ≤2 min / attack ≤90s |
| **Technical Depth (15)** | CEO→Factory→sandboxed workers is a real pipeline, not a wrapper | Heartbeat tick reacts autonomously (1.6); generic executor drives 3 roles (1.4); provisioning reconcile (1.5) |
| **The Stack — sponsor tools used meaningfully (15)** | HiddenLayer at one choke point over prompts/responses/tool-calls/ingested docs; NemoClaw+OpenShell real sandbox + non-trivial policy | Gate §7 tests (0.5, 1.2 dispatch seam); policy §5 adversarial tests (1.3); poisoned-doc dual block (1.8) |
| **The "Why" articulation (15)** | "Autonomous agents with real credentials are exactly this threat model" — rehearsed | Demo narration lands both kill points as independent (1.8 §3 choreography) |
| **Insight Quality (10)** | Non-obvious output: research findings + issued identities + policy diff | Real Apify scrape (1.9) or labeled sample; run-memory delta (2.2) |
| **Usability — act tomorrow (10)** | The real Shopify store URL is the deliverable | Shopify verify (1.9) — 3 products in dev-store admin |
| **Creativity (10)** | Agents-making-agents with issued, scoped, revocable identities | Vault issue + terminate/revoke path (1.5 §5); spawn-authority broker (1.7) |
| **Performance (10)** | Spawn-to-working-agent time on the dashboard | NemoClaw spawn metric (1.2, `status`→first healthy) |

**Bounty scoring (weighted by their own criteria):**

- *NemoClaw/OpenShell:* Genuine Capability (workers do real work — 1.4) × Policy Robustness
  (judges can't break it — 1.3 §5 adversarial) × Non-trivial Policy (allow-with-boundary
  deny_rules + Policy Advisor loosen — 1.3, 3.1) × Architectural Clarity (narrate the blueprint mapping).
- *HiddenLayer:* Depth of instrumentation (every I/O incl. tool-calls + ingested docs — 0.5,
  1.2, 1.8) × thoughtfulness of the detection response (flag→escalate vs block→refuse routing — 0.5 §5).

**The single most-scored test:** `npm run adversarial` + the poisoned-doc dual-block demo.
It touches Completeness, both Sponsor-Tech lines, and Creativity simultaneously. If only one
thing works on stage, make it this.

---

# Priority summary (the one-screen version)

```
TIER 0 IMMEDIATE   0.1 onboard unblockers · 0.2 C1 fail-closed · 0.3 C2 timeout
                   0.4 C3 HL quota · 0.5 real HL call
TIER 1 CORE        1.1 escalation loop · 1.2 nemoclaw spawn · 1.3 policies
                   1.4 executor · 1.5 provisioning · 1.6 CEO+heartbeat
                   1.7 spawn-authority · 1.8 poisoned-doc demo · 1.9 go-live verifies
                   └─ EXIT GATE: Saturday end-to-end dry-run (both demos, timed)
TIER 2 POLISH      2.1 adversarial harness · 2.2 learning correctness · 2.3 badge
                   2.4 honesty fixes (C7-C17) · 2.5 runbook rehearsal
TIER 3 STRETCH     3.1 policy-tightening · 3.2 red-team · 3.3 HL-in-egress
(ladder-gated)     3.4 vLLM · 3.5 live data
                   └─ build ONLY if Sat 7 PM dry-run PASSED, else cut
```

**Freeze:** Sunday 9:00–10:30 bug-fixes only, record backup capture; seam contracts
(`spawnWorker`/`dispatch`/`scan`/`onFlagged`) FROZEN. **Submit 11:00 AM.**
