# Spec — Integration Readiness & Cut-Decision Gates

Status: **spec only, planning mode — no code until flag lifted.**
Owner: Adrian (integration lead) + Sky (security lane sign-off). Cross-cutting — governs the seam between the two lanes.
Depends on: `docs/PLAN.md` (timeline, division of labor), `docs/ORCHESTRATION.md` §Go-live checklist, every security spec's Test-plan.

> Why this exists: the plan splits work cleanly into Adrian's plumbing lane and
> Sky's security lane, and both money demos cross the seam (the attack demo =
> Sky's gate + Adrian's Slack card + dashboard). But **no one owns the seam**:
> there is no named owner for "run the whole thing end-to-end and time it," no
> pass/fail gate for the dry-run, and no cut-decision gate for the three
> bounty claims marked "never run / never called." Two-lane weekend projects die
> at the seam and at the unverified-claim. This spec adds the connective tissue:
> integration ownership, a dated end-to-end gate, and explicit cut rules.

---

## 1. Integration ownership (the missing role)

**Adrian is the integration owner.** Responsibilities the plan does not currently
assign to anyone:

- Owns the end-to-end dry-run (§2) — schedules it, runs it, calls pass/fail.
- Owns the seam contracts: `spawnWorker`/`dispatch` (nemoclaw §6), `scan`/`guarded`
  (gate §1), `onFlagged` → Slack card (poisoned-doc §5). When a contract changes,
  he pings the other lane before merging.
- Owns the go-live checklist state (ORCHESTRATION §Go-live) — which flags are REAL
  vs SIM at any moment, posted where both can see.

Sky signs off the security rows of the dry-run; Adrian owns that it happens.

---

## 2. End-to-end dry-run gate (Saturday, before the 7 PM ladder check)

A single, scheduled, timed run of BOTH money demos, start to finish, on the demo
machine, by the integration owner. Not "run the flow twice" as an aside (PLAN
Saturday-night) — a named gate with a checklist and a verdict.

**Pass criteria (all must hold):**

1. Build demo completes end-to-end: goal → plan → workers → deliverable, no crash.
2. Attack demo completes: poisoned doc → Layer 1 flag (escalation card) → Layer 2
   `policy_denied` → heartbeat reaction (`ceo-heartbeat.spec.md` §1).
3. `npm run adversarial` (`--mode full` if sandbox up, else `--mode scan`) green.
4. Total demo wall-clock under the rehearsal budget (build ≤ ~2 min, attack ≤ 90s).
5. Every SIM label is honest and every REAL flag is actually real (no REAL badge on
   an unverified path — cross-ref §3).

**On fail:** the failing lane is the Saturday-night priority; the ladder check
(§4) auto-defaults to "polish, do not climb."

---

## 3. Go-live verification — owner + deadline per flag

ORCHESTRATION §Go-live lists five flip-to-real items; three are marked *never run /
never called*. Assign each an owner and a **verify-by deadline**, and a cut rule.

| Flag | Owner | Verify-by | Verify action | If unverified by deadline |
|---|---|---|---|---|
| Research (sample→Apify) | Adrian | Sat midday | run one goal with `APIFY_TOKEN`+`APIFY_ACTOR`; confirm real products | ship sample catalog (labeled) — see `plan-fixes.spec.md` §Apify |
| HiddenLayer real call | Sky | Sat AM | `scan()` a known injection with live key → `flagged` | ship heuristic floor only; do NOT claim HL track depth beyond the floor |
| Shopify build | Adrian | Sat midday | set tokens, run one goal, confirm 3 products in dev-store admin | ship SIM (labeled); build demo stands on sim |
| Nemotron slug | Sky | **Sat 7 PM (hard)** | `npm run eval -- --backend nvidia --models <slug>` returns a completion | **cut the Nemotron bounty write-up** — do not submit an unverified claim |
| NemoClaw sandbox | Sky | Sat night | `spawnWorker` + `dispatch` returns real completion; egress block confirmed; **AND one real in-sandbox tool call** (store-builder posts one product from a dispatch prompt) — a completion alone does NOT prove the sandbox can do the *work* (worker-capability §7) | fall to `local` mode with UNCONTAINED badge; downgrade NemoClaw claim to "attempted" (IMPROVEMENTS #6.4) |

> **Capability vs containment (deep review 2026-07-18):** the NemoClaw row's raised
> bar exists because containment and capability are separate risks. The specs prove
> the sandbox *contains* a worker thoroughly; almost nothing rehearses whether a
> sandboxed OpenClaw+Nemotron worker can *drive a multi-call tool workflow from a
> prompt*. A green containment check with a dead capability = the build demo fails
> at "can't do the work," not "can't be contained" — the less-defensible failure.
> One real in-sandbox tool call closes it before the REAL badge flips.

**Cut rule (the discipline the plan lacks):** a bounty write-up may only claim what
has been verified by its deadline. An unverified claim is CUT, not submitted with a
hedge. Judges penalize an overclaim harder than an honest omission. The Nemotron and
NemoClaw rows are the two live-claim risks; both have explicit downgrade paths.

---

## 4. Ladder check becomes a gate, not a vibe (Saturday 7 PM)

PLAN §The Ladder says "if core works end-to-end by dinner, climb." Make the input to
that decision the §2 dry-run verdict, not a feeling:

- Dry-run PASS → may climb one rung (spec 8 red-team stretch, or spec 9 tightening
  loop — spec 9 is the higher-value rung per README).
- Dry-run FAIL → freeze; the failing lane is the only Saturday-night work. No climbing.
- Either way, set the phone reminder (PLAN already says this) and record the verdict
  in the go-live state doc (§1).

---

## 5. Seam-contract freeze (Sunday, before code freeze 11 AM)

After the Sunday 9–10:30 freeze buffer, the seam contracts (§1) are FROZEN — no
signature changes to `spawnWorker`/`dispatch`/`scan`/`onFlagged`. A late contract
change is the classic Sunday-morning demo-breaker across a two-lane split. Bug fixes
inside a contract are fine; changing the contract is not.

---

## 6. Open items

- [ ] Confirm multi-entry (Recursive Intelligence track + HiddenLayer track/bounties
      on one build) — gates how much of spec 7/9 to invest (README §Cross-cutting #10,
      learning-loop §6). Ask organizers Friday.
- [ ] Put the §3 deadlines on the actual PLAN timeline (see `plan-fixes.spec.md`).
- [ ] Decide who runs the §2 dry-run if Adrian is mid-fix — a backup driver.
- [ ] Reconcile the HL call-volume budget (`plan-fixes.spec.md` §HL-call-volume) with
      the dry-run + adversarial-harness runs so Saturday testing doesn't exhaust the
      demo-day quota.
