# Spec — Learning Loop (Recursive Intelligence entry)

Status: **spec only, planning mode — no code until flag lifted.**
Owner: Sky (security lane — the mechanism reuses the audit/escalation logs the
security lane already produces). Consumers: CEO harness, Factory, dashboard.
Track: **Recursive Intelligence** (co-focus with HiddenLayer per PLAN §Primary Story).

> Why this is a spec, not a PLAN footnote: PLAN §Primary Story lists Recursive
> Intelligence as "near-zero extra code" (log run #1 vs #2). Against the actual
> judging bar that is too thin — the track is judged on a **performance delta
> first→last run** PLUS **bonus for a clear learning mechanism**. "troublemaker has
> MEMORY.md" is an assertion, not a mechanism. This spec defines the metric, the
> mechanism, and the evidence so the entry is defensible.

---

## 1. The claim we must demonstrate

An agent that **measurably gets smarter the more it runs** on a defined task —
here: *launch a store*. Run N is faster / cleaner than run 1 because the system
captured what it learned and fed it forward. No model retraining.

The security lane gives us an angle no other team will have: **the agent learns
its own containment boundaries.** Run 1 hits `policy_denied` trying something the
OpenShell policy forbids; the retro records it; run 2 doesn't even attempt it. "The
agent got smarter about its sandbox" is a learning story that falls straight out of
the audit logs the NemoClaw/OpenShell bounty already produces. Double-counts the work.

---

## 2. Metrics (the performance delta — logged every run)

Written to `data/runs.json` (append one record per run). All already observable
from the registry + gate, so this is instrumentation, not new machinery:

| Metric | Source | Why it shows "smarter" |
|---|---|---|
| `wallclock_s` | run start→done timestamps | primary judged delta (speed) |
| `spawn_to_ready_s` | `spawnWorker` events (nemoclaw-spawn §4) | already a dashboard metric |
| `tasks_total` / `tasks_failed` | registry task states | decision quality |
| `escalations` | gate `flagged` count → Slack | fewer human interrupts over time |
| `policy_denied_count` | OpenShell audit log | **the containment-learning signal** — should drop to ~0 by last run |
| `retries` | worker loop | wasted work shrinks as memory grows |

One record shape:
```jsonc
{ "run": 3, "goal": "shoe store", "wallclock_s": 210, "spawn_to_ready_s": 34,
  "tasks_total": 6, "tasks_failed": 0, "escalations": 1,
  "policy_denied_count": 0, "retries": 0, "used_memories": ["apify-actor-x", "no-customers-endpoint"] }
```

`used_memories` (which learnings the run actually pulled) is the causal link — it
proves the delta came from the learning mechanism, not warm caches or luck.

---

## 3. The mechanism (the bonus-credit part — a real learning loop)

Not "MEMORY.md exists." A closed loop with a causal story:

1. **Capture (post-run retro).** After each run, the CEO writes a short structured
   retro to `MEMORY.md` (append-only, one fact per line, keyed by goal type):
   - `policy: storebuilder cannot POST /orders — don't attempt, use /products` (from a `policy_denied`)
   - `tool: apify actor <id> returns cleaner trending data than <other>` (from a task result)
   - `assumption-corrected: shopify collection must exist before product assign` (from a failed task)
   - `injection-seen: "data-sync mode" phrasing in ingested docs → flag` (from a gate `flagged`)
2. **Compound (persistent store).** `MEMORY.md` is the knowledge base; each run
   appends, dedupes against existing lines. Optional stretch: cluster into a small
   knowledge-graph JSON (`data/knowledge.json`) keyed by `{role, topic}` for the
   "clear learning mechanism" bonus — only if core delta is already proven.
3. **Retrieve (feed-forward).** At the start of run N, the CEO and each worker
   prompt is seeded with the memories matching its role/goal. This is what makes
   run N behave differently — e.g. StoreBuilder never even tries `/orders` because
   the retrieved memory told it not to.

The loop is **capture → compound → retrieve**, and the security lane supplies the
richest capture source (denials + detections), which is the differentiator.

> **⚠️ Retrieval re-injection hazard (deep review 2026-07-18) — SECURITY.** Step 1
> captures `injection-seen: "data-sync mode" phrasing → flag` (the raw attack
> phrasing) and step 3 **seeds worker prompts** with matching memories. Feeding a
> captured injection string back into a live prompt is self-poisoning: best case
> the gate flags our own memory every run (escalation noise on stage); worst case
> the model acts on the re-injected instruction. The security lane's richest
> capture source is also the most dangerous to replay. Two rules close it:
> 1. **`injection-seen` entries store the detector name + a content hash, NEVER the
>    raw phrasing.** The lesson the agent needs is "phrasings like this get
>    flagged," which is carried by the detector label; the raw string belongs only
>    in the read-only harness corpus (`injections.jsonl`), never in a prompt-fed
>    memory. (The boundary-learning path — `policy-tightening-loop.spec.md` — is
>    where a phrasing legitimately becomes a *rule*; that is enforced outside the
>    agent, not injected into it.)
> 2. **`scan()` retrieved memories at retrieve time** (`ingested_document`) before
>    they enter any prompt — a memory line is untrusted input like any other. A
>    flagged memory is dropped, not fed forward.
>
> This also supplies the mechanism behind §5.4's no-regression test (a poisoned/
> incorrect memory must degrade gracefully) — today that test has no enforcement
> behind it. Cross-ref `code-fixes.spec.md` C4 (recall correctness) and
> `adversarial-harness.spec.md` §3 (`clean` false-positive guard must include
> retrieved-memory lines).

---

## 4. Evidence to produce (judges can't read a JSON file)

- **≥3 runs of the same goal, Saturday night** (PLAN schedules 2 — bump to 3+; more
  runs = a real curve, not a single before/after point).
- **A delta chart on the dashboard**: `wallclock_s` and `policy_denied_count` per run,
  descending. One SSE-fed `<canvas>` or even a static bar row. The curve going down
  is the whole pitch, on screen.
- **Narration line**: *"Run 1 fought its own sandbox — three policy denials, two
  escalations, 6 minutes. Run 3: zero denials, one escalation, 3 minutes. It learned
  its own boundaries and stopped hitting them."*
- Capture the `MEMORY.md` diff between run 1 and run 3 (shows what it learned).

---

## 5. Test / build plan

1. **Metric logging first.** Wire `data/runs.json` append before the mechanism — a
   flat delta with no mechanism still scores the primary criterion; a mechanism with
   no logged delta scores nothing.
2. **Determinism guard.** Same goal each run, or the delta is noise. Pin the goal
   string; vary nothing else between runs.
3. **Causal proof.** Run 3 with memory retrieval DISABLED → confirm the delta
   collapses (times/denials go back up). This is the "the mechanism caused it" test —
   without it a skeptic says "second run is just warmer." Rehearse showing it.
4. **No-regression.** A bad memory (wrong learning) must not brick run N — retrieval
   is advisory context, not hard control flow. Confirm a poisoned/incorrect memory
   line degrades gracefully.

---

## 6. Open items

- [ ] **Confirm with organizers a single build may enter both a track (Recursive
      Intelligence) and the HiddenLayer track / bounties.** Bounties say "any track";
      tracks don't state multi-entry. This decides how much to invest here vs. treat
      as garnish. Ask Friday.
- [ ] Reconcile `MEMORY.md` format with troublemaker's existing memory file (append
      schema, dedupe) — coordinate with Adrian (CEO owner).
- [ ] Decide knowledge-graph stretch (`data/knowledge.json`) IN or OUT at Saturday
      7 PM ladder check — only if core delta already demos.
- [ ] Where the retro is written from: CEO heartbeat post-run vs a dedicated
      end-of-run hook. Heartbeat is simpler and reuses existing loop.
