# Fix Spec — Plan / Doc Fixes (from plan review 2026-07-18)

Status: **spec only, planning mode — no code until flag lifted.**
Owner: Adrian (plan owner) + Sky (security rows). Scope: corrections and additions to
`docs/PLAN.md`, `docs/ORCHESTRATION.md`, `docs/IMPROVEMENTS.md`, and the spec index —
NOT code. Each row: target doc, gap, fix.

> These resolve ambiguities and unassigned work in the planning docs. Where the fix
> is a new process/gate, the detail lives in `readiness-and-cut-gates.spec.md`; this
> file records the concrete doc edit to make.

---

## PF1 — Resolve the Apify "optional vs load-bearing" contradiction (P0 decision)

**Target:** `docs/PLAN.md` §Two Money Demos #1, `docs/ORCHESTRATION.md` §Go-live #1.
**Gap:** money demo #1 says "Research returns trending shoes (Apify)" (load-bearing);
the go-live checklist calls Apify "optional," defaulting to the dummyjson sample
catalog. So the HEADLINE build demo might run on obviously-fake sample data, and the
recursive-intelligence delta (which only looks dramatic when a real scrape's seconds
are skipped on run 2) hinges on the same "optional" item. Two submissions silently
depend on an undecided flag.
**Fix — make the decision explicitly and write it down:**
- **Decision (recommended):** Apify is a **verify-by-Saturday-midday upgrade, NOT
  load-bearing.** The build demo is honest on the labeled sample catalog; Apify makes
  it more credible and makes the learning delta dramatic, but its absence does not
  sink either demo.
- Record in both docs: "If Apify is wired by Sat midday → REAL scrape, and the
  learning delta is the strong version. If not → labeled sample catalog; the learning
  delta is narrated as 'the gap grows with real scrape cost' (already the CEO's line,
  orchestrator.ts:390)."
- Owner + deadline: Adrian, Sat midday (see readiness §3 table).
**Cross-ref:** readiness-and-cut-gates §3, learning-loop §2, orchestrator.ts:390.

---

## PF2 — Put the fail-open→fail-closed flip on the timeline with an owner (P0)

**Target:** `docs/PLAN.md` §Timeline (Saturday), `docs/ORCHESTRATION.md` §4.
**Gap:** the flip from fail-open to fail-closed (code-fixes C1) is mentioned in
ORCHESTRATION §4 and IMPROVEMENTS #6.1 as a sub-bullet, on no timeline, with no
owner/time. A security demo that fails OPEN if HL hiccups inverts the whole pitch on
stage. Easy to forget precisely because it's buried.
**Fix:** add a dated line to the Saturday timeline: "Sky — flip `FAIL_OPEN=false`,
verify with the `scanner-down` adversarial case (adversarial-harness §8.3)." Make it
a checklist item in the §2 dry-run pass criteria (readiness §2).
**Cross-ref:** code-fixes C1, hiddenlayer-gate §6, readiness §2.

---

## PF3 — Add a HiddenLayer call-volume / rate budget (P1)

**Target:** `docs/PLAN.md` §Risks table (HiddenLayer row), `docs/ORCHESTRATION.md`
§Go-live #2.
**Gap:** no doc estimates HL call volume. Three consumers hit the API: the worker
boundary (`gateOrEscalate`), the passive bus scan (code-fixes C3 — currently one call
PER message), and Saturday testing (adversarial-harness full corpus × repeats +
phrasing selection). On a free tier these can collectively exhaust the quota before
or during the demo.
**Fix:** document the budget: (1) apply C3 so the bus path is heuristics-only (zero HL
calls) — this is the big saver; (2) cap adversarial-harness Saturday runs and reserve
quota headroom for demo day; (3) note the actual free-tier limit once the key is in
(gate spec §8 open item). Add a `--smoke` subset to the harness for pre-rehearsal
(adversarial-harness §8 open item) so full runs are deliberate.
**Cross-ref:** code-fixes C3, adversarial-harness §9, readiness §6.

---

## PF4 — Add integration ownership + the end-to-end dry-run gate to the plan (P1)

**Target:** `docs/PLAN.md` §Division of labor, §Timeline (Saturday PM).
**Gap:** no one owns the seam between the two lanes; "run the full flow twice"
(Saturday night) is ownerless and has no pass/fail criteria. The attack demo crosses
both lanes and is where integration bugs hide.
**Fix:** name Adrian integration owner; add the scheduled, timed end-to-end dry-run as
a named Saturday gate (before the 7 PM ladder check) whose verdict feeds the ladder
decision. Full detail in `readiness-and-cut-gates.spec.md` §1–2; the PLAN edit is a
one-line pointer + the timeline slot.
**Cross-ref:** readiness §1, §2, §4.

---

## PF5 — Add bounty cut-decision gates (P1)

**Target:** `docs/PLAN.md` §Layered-on-top (bounties), §Timeline.
**Gap:** three bounty claims (Nemotron slug, Shopify, NemoClaw containment) are marked
"never run / never called." The plan schedules "verify once" but has no rule for what
happens if verification fails. The Nemotron bounty REQUIRES a real call; submitting an
unverified claim is an overclaim judges penalize.
**Fix:** add the cut rule: "A bounty write-up may claim only what is verified by its
deadline; an unverified claim is CUT, not hedged." Add the per-flag owner/deadline/
downgrade table (readiness §3) to the plan. Hard gate: Nemotron slug verified by Sat
7 PM or the write-up is cut; NemoClaw containment downgrades to 'attempted' without
shame (already IMPROVEMENTS #6.4).
**Cross-ref:** readiness §3, IMPROVEMENTS #6.4.

---

## PF6 — Spec index now complete; add the new cross-cutting specs (P2, bookkeeping)

**Target:** `specs/security/README.md` §The specs, and a new "Related (cross-cutting)"
pointer.
**Gap:** the security README index already lists specs 1–9 (8 and 9 now exist). Three
new specs written 2026-07-18 live outside `specs/security/` and aren't indexed:
`specs/security/ceo-heartbeat.spec.md`, `specs/demo/demo-recovery-runbook.spec.md`,
`specs/integration/readiness-and-cut-gates.spec.md`, plus the two fix files under
`specs/fixes/`.
**Fix:** add `ceo-heartbeat` to the security index (supporting table — it's a
security-lane spec that Adrian implements), and add a short "Related (cross-cutting)"
list pointing to the demo/integration/fixes specs. Keep it a pointer, not a copy.
**Cross-ref:** all five new specs.

---

## PF7 — CEO heartbeat mechanism was asserted, never defined (P1)

**Target:** `docs/ORCHESTRATION.md` §3 (CEO on troublemaker — "Heartbeat: read
registry.all()...").
**Gap:** ORCHESTRATION §3 lists the heartbeat as a one-line build bullet;
poisoned-doc §3.7 depends on it for claw-agent eligibility; the current
`orchestrator.ts` has no such reconcile loop (only a task-progress ticker). The
mechanism was assumed to exist.
**Fix:** replace the ORCHESTRATION §3 heartbeat bullet with a pointer to the new
`ceo-heartbeat.spec.md` (the mechanism, reconcile table, and boring-dispatcher
constraints). Flag it as a real build item, not a given.
**Cross-ref:** ceo-heartbeat spec, poisoned-doc §3.7.

---

## Priority summary

| P0 (decide/schedule now) | PF1 Apify decision, PF2 fail-closed on timeline |
|---|---|
| **P1** | PF3 HL budget, PF4 integration owner+gate, PF5 cut gates, PF7 heartbeat pointer |
| **P2** | PF6 index bookkeeping |

PF1 and PF2 are the two that silently gate multiple deliverables (Apify → build demo +
learning delta; fail-closed → the entire security pitch). Decide both explicitly.
