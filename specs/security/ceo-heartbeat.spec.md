# Spec — CEO Heartbeat (autonomous reconcile loop)

Status: **spec only, planning mode — no code until flag lifted.**
Owner: Sky (security lane) drafting; **Adrian implements** (CEO harness owner). Consumers: dashboard, poisoned-doc demo, learning loop.
Depends on: `poisoned-doc-demo.spec.md` §3.7 (the on-screen beat this mechanism must produce), `ceo-sandbox.spec.md` (the CEO runs this loop *inside* its sandbox), `docs/ORCHESTRATION.md` §3 (the build-order bullet this expands).

> Why this is a spec, not a footnote: two deliverables ASSERT an autonomous
> heartbeat but nothing DEFINES it. poisoned-doc §3.7 needs the CEO to react on
> camera with no human prompt ("claw-agent eligibility"), and ORCHESTRATION §3
> lists a one-line "heartbeat: read registry, act on blocked/failed/done." The
> current `orchestrator.ts` has a ticker that advances TASK progress but **no CEO
> reconcile loop** — nothing reacts to a `blocked` agent autonomously. So the
> single moment that proves the "heartbeat-driven, not prompt-driven" definition
> (Hackathon_Docs §What is a Claw Agent) is unbuilt and unspecified. This closes
> that.

---

## 1. The claim to demonstrate

A **Claw Agent** is defined by acting on a time/state trigger, not solely a human
prompt. The Slack-triggered build demo is prompt-driven and does NOT prove this.
The proof is: after the poisoned-doc block flips an agent to `blocked`, the CEO's
**next heartbeat tick** — fired by a timer, reading state, with no new user
message — reacts autonomously (reassign / retry / report). That one tick is the
eligibility evidence.

---

## 2. Trigger — a real tick, separate from the task ticker

Two distinct clocks; do not conflate them:

| Clock | Exists today | Drives | Cadence |
|---|---|---|---|
| Task ticker (`orchestrator.tick`) | yes | sim task progress bars | `TICK_MS` = 1200ms |
| **CEO heartbeat (this spec)** | **no** | reconcile registry state → CEO actions | slower, e.g. `HEARTBEAT_MS` = 3000–5000ms |

The heartbeat is a `setInterval` in the CEO harness (inside the CEO sandbox) that,
each tick, reads `registry.all()` + `orchestrator.snapshot()` and reconciles. It
must keep firing while any goal is active AND for a short window after a security
event, so the reaction tick lands on camera even if all tasks are paused/blocked.

> Note: this is the ONE place the task-ticker's "stop when nothing active"
> (`orchestrator.tick` clears the interval when `!anyActive`) actively works
> against the demo — a `blocked` agent with no running task can leave nothing to
> keep the loop alive. The heartbeat clock must NOT gate on `anyActive`; it gates
> on "any goal not yet done/failed," so a fully-blocked company still ticks and
> still reacts. Cross-ref `code-fixes.spec.md` (ticker/heartbeat separation).

---

## 3. Reconcile table — what each tick does per state

Idempotent: a tick reacts to a *transition*, not a standing state, so the same
`blocked` agent is not re-handled every 3s. Track a per-agent `lastHandledStatus`
(or reuse the registry event log's last kind) and act only when it changed.

| Observed state | CEO heartbeat action | Emits |
|---|---|---|
| agent → `blocked` (new) | post ONE Slack/bus status naming the agent + reason; if a retry policy allows, mark the task for re-dispatch after the escalation resolves | `status` msg; registry log |
| agent → `failed` (new) | halt the goal's dependent tasks; post one failure line; set CEO `waiting` | `status` msg (this is today's `maybeFinishGoal` failure path — heartbeat should OWN it, not the task loop) |
| agent → `done` (new) & all peers done | finalize goal, write run memory, report delta | `goal` done + `run` (today's `maybeFinishGoal` success path) |
| escalation resolved `approved` | let the worker proceed (already handled in `gateOrEscalate`); heartbeat just posts the "continuing" acknowledgment if the worker didn't | `status` msg |
| escalation resolved `denied` | treat the blocked task as failed → goal-halt path; **end the task session + terminate the agent** (factory-provisioning §5): wipe session workdir, set record `terminated`, one line | `status` msg; registry `terminated` |
| **first tick only — stale non-terminal record** (loaded from `registry.json` at boot; deep review 2026-07-18) | **boot reconcile:** a pre-existing `blocked` with no live escalation → `failed`/`terminated`; a pre-existing `working` whose sandbox is dead (Factory health gate) → `failed`. Standing state never transitions, so the normal rows never fire on it | `status` msg per swept agent; registry log |
| nothing changed | no-op (crucial — silence between ticks is correct) | — |

> **Boot-reconcile note (deep review 2026-07-18):** transition-tracking (`lastHandledStatus`)
> is correct for live runs but blind to state that was already standing at boot —
> the registry constructor loads yesterday's records. Without the first-tick sweep
> row above, a stale `blocked` agent is unresolvable forever (its escalation
> resolver is gone) and `injectAttack` (orchestrator.ts:51) can even target the
> dead record. The sweep runs once, on the first tick, before normal reconcile.
> Cross-ref `code-fixes.spec.md` C14, `factory-provisioning.spec.md` §8.

The **poisoned-doc reaction** (§1) is row 1: research agent `blocked` by the gate →
next heartbeat posts "research-01 is blocked on a security escalation — holding its
downstream tasks until an operator decides." No human typed anything. That is the
beat.

---

## 4. Boring-dispatcher discipline (reconcile PLAN §3 tension)

PLAN §3 says the CEO must be a boring, reliable dispatcher, NOT a clever planner.
This spec does not contradict that — a reconcile loop is exactly a boring
dispatcher. Constraints:

- **No model call on the hot heartbeat path.** Reaction is rule-based state → action
  (the table in §3), not "ask the LLM what to do." A model call per tick is a
  latency + cost + failure surface the demo cannot afford, and it is what PLAN §3
  warns against. Planning (goal → org) already happens once at intake
  (`orchestrator.plan`); the heartbeat only reconciles.
- **One message per meaningful change**, never a heartbeat spam line. A tick that
  observes no transition posts nothing.
- **Deterministic.** Same state → same action, so the demo is reproducible and the
  adversarial harness (`adversarial-harness.spec.md`) can assert on it.

---

## 5. Interaction with existing code (migration, not rewrite)

Today `maybeFinishGoal` (goal finalize) and the failure branch in `runReal` are
called inline from the task loop. This spec proposes the heartbeat becomes the
single owner of goal-lifecycle reactions, so there is ONE reconcile path instead of
reactions scattered across `tick`, `runReal`, and `advance`. Lower-risk staged move:

1. Phase 1 (demo-safe): add the heartbeat clock; it OWNS only the new `blocked`
   reaction (the eligibility beat). Leave existing finalize paths as-is.
2. Phase 2 (post-core, if time): migrate `maybeFinishGoal` success/failure into the
   heartbeat reconcile so lifecycle logic lives in one loop.

Phase 1 is the minimum for eligibility; Phase 2 is cleanup, ladder-gated.

---

## 6. Test plan

1. **Autonomous reaction:** drive an agent to `blocked` (via `injectAttack`) with NO
   subsequent user message → assert a CEO status message appears within one
   `HEARTBEAT_MS` window, sourced `from: "ceo"`, referencing the blocked agent.
2. **Idempotency:** hold the agent `blocked` across 5 ticks → assert exactly ONE
   reaction message, not five.
3. **Liveness while blocked:** with every task paused/blocked, assert the heartbeat
   is still ticking (does not clear like the task ticker).
4. **No model on path:** assert the heartbeat reconcile issues zero `ModelBackend`
   calls (grep/spy) — rule-based only.
5. **Silence:** a tick with no state transition emits no bus message.

---

## 7. Open items

- [ ] Reconcile `HEARTBEAT_MS` with the demo pacing — the reaction tick must land
      visibly after the block, not so fast it looks scripted nor so slow the room
      waits. Rehearse the interval (poisoned-doc §3 total ~60–90s).
- [ ] Decide retry policy for row 1 (`blocked`): auto-re-dispatch after approve, or
      leave to the operator. Simplest honest default: re-dispatch only on `approved`,
      hard-halt on `denied`.
- [ ] Coordinate with Adrian: this is his CEO harness (`src/ceo/`); Sky owns only the
      containment (`ceo-sandbox.spec.md`) and the security-event rows.
- [ ] Confirm the heartbeat runs inside the CEO sandbox (ceo-sandbox §4) and its
      `registry`/bus reads work across that boundary (host-shared file vs in-sandbox).
