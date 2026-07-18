# Fix Spec — Code Fixes (from quality review 2026-07-18)

Status: **spec only, planning mode — no code until flag lifted.**
Owner: Sky flags; owner-per-row below. Scope: corrections to EXISTING code found in
the quality review. Each row: location, defect, fix, priority, spec cross-ref.

Priority key: **P0** = fix before any demo (correctness/security). **P1** = fix
before scale or if time allows. **P2** = hygiene / honesty polish.

> These are FIXES to shipped code, not new features. New capabilities live in their
> own specs (`ceo-heartbeat`, `adversarial-harness`, etc.). Where a fix aligns code
> to an existing spec, that spec is cited — the spec is already right; the code drifted.

---

## C1 — SecurityGate fails OPEN on scanner failure (P0, SECURITY)

**Location:** `src/security/gate.ts:40`.
**Defect:** `verdict = categories.some((c) => c !== "scanner_degraded") ? "flagged" : "clean"`. When HiddenLayer errors, `scanner_degraded` is pushed; if heuristics are also clean, verdict resolves to **`clean`** — a degraded scanner silently passes content through. `hiddenlayer-gate.spec.md` §6 already mandates fail-**closed** (`flagged` + `scanner_unavailable`). Code contradicts its own spec.
**Fix:** on any scanner degradation/unavailability, return `verdict: "flagged"` with category `scanner_unavailable`, never `clean`. Add a single `FAIL_OPEN` const (default `false`) per gate spec §6; only the no-credentials dev path may fail open, and it must `console.warn` loudly.
**Owner:** Sky. **Cross-ref:** hiddenlayer-gate §6, adversarial-harness §3 (`scanner-down` case asserts this), demo-recovery §3 row 1.

---

## C2 — Escalation await has no timeout → agent hangs forever (P0)

**Location:** `src/factory/worker.ts:91` (`const verdict = await decision;`), `src/security/escalations.ts`.
**Defect:** `escalations.create()` returns a promise resolved only by an operator approve/deny. No timeout. If nobody clicks, the worker awaits forever, `realRunning` holds the task, the ticker busy-spins. This is the single highest-risk on-stage failure (demo-recovery §3 row 2).
**Fix:** add an optional timeout to the escalation decision (e.g. `ESCALATION_TIMEOUT_MS`, default off for dev, ON for demo). On timeout → resolve as `denied` (fail-closed) and post a bus line "escalation auto-denied after Ns — content quarantined." First resolution still wins (escalations.ts already guards `resolved`).
**Owner:** Sky/Adrian. **Cross-ref:** demo-recovery §3 (removes the manual-Deny reflex), escalations.ts:29-37.

---

## C3 — Per-message HiddenLayer scan on the bus (P0 cost / P1 correctness)

**Location:** `dashboard/server.ts:34-40`.
**Defect:** `bus.on("message")` calls `scan(msg.body, "tool_result", msg.from)` on EVERY inter-agent message. Two problems: (1) with a real `HIDDENLAYER_API_KEY`, that is one HL API call per chatter message (status/finding/etc.) — at demo volume this can exhaust the free-tier quota mid-demo and adds latency to every message; (2) it double-scans content already scanned in `gateOrEscalate`, and (3) mislabels every message as `IoKind: "tool_result"` regardless of true kind, muddying detection provenance.
**Fix:** on the passive bus path, run **heuristics only** (call `heuristicScan` directly, never the HL API) — the bus annotation is a cheap "gate is watching" signal, not an authoritative scan. Authoritative HL scanning stays at the worker boundary (`gateOrEscalate`). Alternatively debounce/dedupe by content hash. Do NOT send bus chatter to HL.
**Owner:** Sky. **Cross-ref:** gate.ts:24 (heuristics are separable), plan-fixes §HL-call-volume, detect.ts.

---

## C4 — Run-memory `recall()` fuzzy match can reuse the WRONG run (P1, correctness)

**Location:** `src/memory/runs.ts:44`.
**Defect:** `r.nicheKey === key || r.nicheKey.includes(key) || key.includes(r.nicheKey)`. Bidirectional substring after `normalize()` strips common words, so short keys collide: `"shoes"` recalls `"shoe rack"`; `"running"` recalls `"running shoes"`. The learning loop could present stale products from an unrelated niche as fresh findings — a correctness bug in the headline "gets smarter" feature, and a live-demo embarrassment if it mis-recalls on stage.
**Fix:** require exact `nicheKey` equality for recall (the demo runs the SAME goal string, so exact match is sufficient and is what `learning-loop.spec.md` §5.2 "vary nothing" implies). If fuzzy is wanted later, use token-set overlap ≥ a threshold, not bidirectional substring. Pin the match key definition in learning-loop spec.
**Owner:** Sky. **Cross-ref:** learning-loop §5.2, adversarial-harness §3 (`learning-causal`).

---

## C5 — Memory-retrieval has no OFF switch, but the causal-proof demo needs one (P1)

**Location:** `src/orchestrator/orchestrator.ts:171` (`runMemory.recall`), `src/memory/runs.ts`.
**Defect:** `adversarial-harness.spec.md` §3 (`learning-causal`) and `learning-loop.spec.md` §5.3 both require running a goal with memory retrieval DISABLED to prove the delta collapses ("mechanism caused it, not warm cache"). There is no flag to disable recall. The spec's key causal test is currently unimplementable.
**Fix:** add an env/flag (e.g. `MEMORY_RETRIEVAL=off`) that makes `plan()` skip `recall()`/reuse. Advisory only — retrieval is context, never hard control flow (learning-loop §5.4 no-regression rule).
**Owner:** Sky. **Cross-ref:** learning-loop §5.3, adversarial-harness §3.

---

## C6 — `Task.mode` can't express containment (`contained` vs `local`) (P1)

**Location:** `src/types.ts:86` (`mode?: "real" | "sim"`), `src/factory/worker.ts:69` (`workerMode`), dashboard.
**Defect:** `worker-mode-containment.spec.md` §3 requires a loud red **UNCONTAINED** badge whenever a worker runs `local` (in-process, no OpenShell). The data model only has `real | sim` — there is no `contained | local` dimension. If NemoClaw slips and the demo falls to local, the dashboard shows "real," which is the exact **silent downgrade the spec forbids**.
**Fix:** add an orthogonal `containment?: "nemoclaw" | "local"` field (to `Task` and/or `AgentRecord`), surfaced as an UNCONTAINED badge in the dashboard when `local`. Keep `real/sim` (data authenticity) separate from `contained/local` (isolation) — they are different axes.
**Owner:** Adrian (data model) + Sky (badge semantics). **Cross-ref:** worker-mode-containment §3, demo-recovery §3 row 4.

---

## C7 — Full-file JSON rewrite on every event → O(n²), blocking (P1, efficiency)

**Location:** `src/registry/registry.ts:38`, `src/bus/bus.ts:46`, `src/memory/runs.ts:55`.
**Defect:** every `upsert`/`post`/`record` synchronously `writeFileSync`s the ENTIRE array. During a run the bus rewrites all messages on every post; O(n) write per event → O(n²) over a session, on the event loop. Fine at demo scale; the learning-loop plan (≥3 back-to-back runs, learning-loop §4) is exactly where it accumulates.
**Fix:** for the hackathon, cap growth (registry per-agent log ≤200 events — IMPROVEMENTS #6.7) and accept last-wins. Post-hackathon: append-log or a real store. At minimum make writes non-blocking (`writeFile` async) so a slow disk doesn't stall the ticker.
**Owner:** Adrian. **Cross-ref:** IMPROVEMENTS #6.7, learning-loop §4.

---

## C8 — Corrupt-file handling inconsistent; boot crashes on bad JSON (P1)

**Location:** `src/bus/bus.ts:22`, `src/registry/registry.ts:17` (no try/catch) vs `src/memory/runs.ts:36` (has try/catch).
**Defect:** `bus` and `registry` do `JSON.parse(readFileSync(...))` unguarded in their constructors. One corrupt/partial JSON file (e.g. from a mid-write crash, which C7 makes possible) crashes the whole dashboard on boot. `runs.ts` already guards; the other two don't.
**Fix:** wrap both constructor parses in try/catch → fall back to empty on parse failure, log a warning. Consistent with `runs.ts`.
**Owner:** Adrian. **Cross-ref:** C7 (mid-write corruption source).

---

## C9 — Duplicated, brittle niche parsing (P2)

**Location:** `src/orchestrator/orchestrator.ts:142-144` (`rolesFor`) and `:165` (`plan`).
**Defect:** the same `\bfor\b\s+(.+?)...` regex + `split("—").pop()` niche extraction is computed twice, in two methods, and can drift. `split("—")` is fragile against goal text containing em-dashes for other reasons.
**Fix:** compute the niche ONCE (a `nicheFor(goal)` helper), call it from both. Consider storing it on the goal at intake so parsing happens once per goal, not per method.
**Owner:** Adrian. **Cross-ref:** —

---

## C10 — Ticker busy-spins during real/blocked tasks (P2)

**Location:** `src/orchestrator/orchestrator.ts:222-239` (`tick`), `:234` (`realRunning`).
**Defect:** `tick` keeps the 1200ms interval alive while `realRunning.size > 0` or anything is `pending/running`, doing nothing useful for a task that is awaiting an escalation. Minor CPU/wakeups. Also entangled with the heartbeat need (`ceo-heartbeat.spec.md` §2 wants a separate, slower clock that stays alive while blocked).
**Fix:** when adding the CEO heartbeat (ceo-heartbeat spec), separate the two clocks; the task ticker can stop when no task is actively advancing, while the heartbeat keeps the demo reactive. Until then, low priority.
**Owner:** Adrian. **Cross-ref:** ceo-heartbeat §2.

---

## C11 — Real store-builder builds 3 products / 0 collections; sim claims 10 / 3 (P2, honesty)

**Location:** `src/factory/worker.ts:143` (`picks = products.slice(0, 3)`) vs `src/orchestrator/orchestrator.ts:343` (sim milestone "10 products, 3 collections").
**Defect:** the sim milestone message overclaims relative to the real path. On a fallback to sim (demo-recovery §2), the numbers narrated don't match what the real path does — a small but visible honesty gap if a judge compares.
**Fix:** align the sim milestone copy to what the real path actually does (3 products, or make the real path build what the copy claims), so sim and real tell the same story. Cheapest: make the sim message say "3 products" too.
**Owner:** Adrian. **Cross-ref:** demo-recovery §2, IMPROVEMENTS #4.

---

## C12 — Factory `identity: null as any`; no failure state on vault miss (P2)

**Location:** `src/factory/factory.ts:18` (`identity: null as any`), `:26` (`issueIdentity` can throw "Vault has no credential named X").
**Defect:** `createAgent` upserts a record with `identity: null as any` before issuing; if `issueIdentity` throws (unknown credential), the throw propagates and can crash the caller (CEO/plan loop) rather than marking the agent `failed`. IMPROVEMENTS #6.8 already flags this.
**Fix:** wrap provisioning; on vault miss set the record `status: "failed"` with a log line and let the goal-halt path handle it (a bad spec must not crash the CEO). Replace `null as any` with a proper optional or a two-phase construct.
**Owner:** Adrian. **Cross-ref:** IMPROVEMENTS #6.8, vault.ts:24.

---

## C13 — `renderPolicy()` templates a schema that doesn't exist (P1, dead code + honesty)

**Location:** `src/factory/factory.ts:33-34,51-65` (`renderPolicy`, `{{AGENT_ID}}`/`{{SANDBOX_NAME}}`), `:41` (`sandbox = sandbox-${id}`).
**Defect:** `renderPolicy` writes a per-agent YAML injecting `{{AGENT_ID}}`/`{{SANDBOX_NAME}}` — but the REAL OpenShell schema has no `agent`/`sandbox` top-level fields (openshell-policy §2: real keys are `filesystem_policy`/`process`/`landlock`/`network_policies`). The rendered file is unconsumable and unconsumed. The planned model is per-ROLE authored policies applied once at Phase B (`factory-provisioning.spec.md` §1-2), so there is no per-agent render at all. Leaving it in implies a wiring that can't work and produces junk in `policies/rendered/`.
**Fix:** remove `renderPolicy()` and the per-hire `sandbox-${id}` naming; `createAgent` health-checks the role sandbox + mints a task session instead (factory-provisioning §2). Sandbox name = role.
**Owner:** Sky (spec) / Adrian (code). **Cross-ref:** factory-provisioning §1-2, openshell-policy §2.

---

## C14 — Stale non-terminal agent records loaded at boot are never reconciled (P1)

**Location:** `src/registry/registry.ts:16-19` (constructor loads `registry.json`), `src/orchestrator/orchestrator.ts:51-52` (`injectAttack` targets `registry.all().find(role==="research")`).
**Defect:** registry boot-loads prior-run records. A `blocked`/`working` agent from a previous session is a **standing** state — the transition-only heartbeat (`ceo-heartbeat.spec.md` §3) never fires on it, its escalation resolver is gone (unresolvable forever), and `injectAttack` can target a dead agent from yesterday's demo. The recovered-state path is unhandled by both ceo-heartbeat and the Factory.
**Fix:** on first heartbeat tick, sweep pre-existing non-terminal records: a stale `blocked` with no live escalation → mark `failed`/`terminated`; a stale `working` whose sandbox is dead (Factory health gate) → `failed`. `injectAttack` targets only live-session agents. Spec home: ceo-heartbeat §3 boot row + factory-provisioning §8.
**Owner:** Sky (spec) / Adrian (code). **Cross-ref:** ceo-heartbeat §3, factory-provisioning §8.

---

## C15 — Research role still issues `APIFY_TOKEN` after ingest moved harness-side (P1, honesty)

**Location:** `src/roles/library.ts:43-44` (`research.credentials: ["APIFY_TOKEN"]`, `tools: ["apify","web-fetch"]`), `src/vault/vault.ts:15-19`.
**Defect:** harness-brokered ingest (nemoclaw-spawn §6.1, openshell-policy §3) moved the Apify fetch host-side — the research SANDBOX never fetches external docs, so the research agent should not hold `APIFY_TOKEN`. But `library.ts` still lists it in `credentials`, vault still issues it, and the dashboard prints "identity issued: APIFY_TOKEN". `spec.credentials` overclaims: a listed credential the agent never holds. A judge probing cred-hygiene finds the gap.
**Fix:** remove `APIFY_TOKEN` from the research role's `credentials`; keep `apify` as a HARNESS tool label (broker-side), not an issued sandbox credential. Canonical cred table lives in `worker-capability.spec.md` §5.
**Owner:** Sky (spec) / Adrian (code). **Cross-ref:** worker-capability §5, nemoclaw-spawn §6.1, adversarial-harness §3 (cred-hygiene).

---

## C16 — No guard against a second concurrent goal (P1, demo-safety)

**Location:** `src/orchestrator/orchestrator.ts:79` (`startGoal`), `:133-135` (`anyActiveGoal`).
**Defect:** `startGoal` always plans. A judge typing a second goal mid-demo spawns a second agent record per role sharing ONE per-role sandbox + `/workspace` + niche-keyed run memory (factory-provisioning §6). Live races on shared state, on stage.
**Fix:** refuse a second concurrent active goal with an honest CEO line ("one job at a time for this demo") — `anyActiveGoal()` already exists to gate on. Concurrent goals are post-hackathon.
**Owner:** Adrian. **Cross-ref:** factory-provisioning §6.

---

## C17 — `CEO_PROMPT.md` referenced by zero code (P2, honesty)

**Location:** `src/ceo/CEO_PROMPT.md`, planning path `src/orchestrator/orchestrator.ts:141-161` (`rolesFor`/`matchPlaybook` — regex, no prompt).
**Defect:** `CEO_PROMPT.md` describes a heartbeat, retry-twice, MEMORY.md-writing LLM CEO. No code loads or uses it; planning is regex `matchPlaybook`. The file implies a runtime brain that doesn't exist — an overclaim if a judge greps for where the prompt is used.
**Fix:** resolve per `ceo-brain-and-spawn-authority.spec.md` Part B. If CEO stays scripted (Option 1): relabel `CEO_PROMPT.md` as intent-doc, or delete it. If model-driven (Option 2): wire it as the decomposition prompt with a structured `AgentSpec[]` output contract. Decision at the Sat 7 PM ladder gate.
**Owner:** Adrian (CEO owner) + Sky (spawn-authority rows). **Cross-ref:** ceo-brain-and-spawn-authority Part B, ceo-heartbeat §4.

---

## Priority summary

| P0 (before any demo) | C1 fail-open, C2 escalation timeout, C3 HL-per-message quota |
|---|---|
| **P1 (before scale / if time)** | C4 recall collision, C5 memory-off toggle, C6 containment badge, C7 persistence, C8 corrupt-file, C13 dead renderPolicy, C14 stale-record boot reconcile, C15 research APIFY overclaim, C16 concurrent-goal guard |
| **P2 (hygiene/honesty)** | C9 niche parse, C10 ticker, C11 sim/real product count, C12 factory hardening, C17 CEO_PROMPT unwired |

C1, C2, C3 are the three that can visibly break or overclaim on stage. Do those first.

> **C13–C17 added 2026-07-18** (agent-creation deep review). These are the code-side
> consequences of the three new specs — `worker-capability`, `factory-provisioning`,
> `ceo-brain-and-spawn-authority`. C13/C15/C17 are honesty fixes (code contradicts the
> planned containment story); C14/C16 are demo-safety. All are fix *descriptions* here,
> not code changes — code stays frozen until the planning flag lifts.
