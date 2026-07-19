# OIE Run — Topic: "What makes agent-maker win this hackathon?"

Ran the Orthogonal Innovation Engine protocol against the project itself, not a
market. Same discipline: evidence before ideation, arithmetic kill gates,
adversarial pass, calibrated verdict. Style laws honored — full words, every
claim labeled OBSERVED / INFERRED / ASSUMPTION.

Context: AITX x NVIDIA Claw Agent Hackathon, judged Sunday July 19. Sponsors:
HiddenLayer (runtime security), NemoClaw + OpenShell (sandbox), Nemotron, vLLM,
Antler. Today is day 2 of 3 — every idea below is scored by impact-per-hour, not
by ideal.

---

## Act 01 — Evidence (what the code actually is right now)

Mined from the repo directly. Each row is OBSERVED with a file reference.

| Claim in README / PITCH | Code reality | Label |
|---|---|---|
| "OpenShell sandbox it cannot escape" | `factory.ts` never spawns a sandbox — `record.sandbox = "sandbox-${id}"` is a string; the real spawn is `TODO(Sky)` (factory.ts:37-42) | OBSERVED — claim exceeds code |
| "HiddenLayer watching every token" | `gate.ts` hits a guessed endpoint `/v1/scan` with a guessed schema, both `TODO(Sky): confirm` (gate.ts:21, 58-73). No key = heuristic floor only | OBSERVED — integration is a stub |
| SecurityGate fails closed | Correct. Scanner error → `scanner_unavailable` → flagged, not clean (gate.ts:44-48). C1 is done | OBSERVED — real |
| Escalation cannot hang the worker | Correct. `ESCALATION_TIMEOUT_MS` auto-denies fail-closed (escalations.ts:31-42). C2 is done | OBSERVED — real |
| Bus does not burn HL quota | Correct. Passive bus path is heuristics-only (server.ts:37-41). C3 is done | OBSERVED — real |
| Research agent is REAL | Correct. Real `fetch`, gate on ingested data, rule-based or LLM synthesis (worker.ts:119-152) | OBSERVED — real |
| Run memory / "gets faster" | Correct. `runs.json` recall + reuse + delta, exact-nicheKey match (runs.ts:43-47). C4 done | OBSERVED — real |
| CEO reacts autonomously (heartbeat) | Not found. There is a task ticker (orchestrator.ts:265-287) but no separate heartbeat reacting to blocked/failed/done with no human prompt | OBSERVED — missing |
| Typechecks clean | `tsc --noEmit` passes, zero errors | OBSERVED — real |

**RECEIPT_COUNT: 9.** No evidence desert. The spine is real; the two headline
sponsor claims (OpenShell containment, HiddenLayer depth) rest on stubbed code.

### The load-bearing assumption of the project
Every incumbent agent platform (CrewAI, AutoGen, Lindy) sells *capability*. The
PITCH already names the correct wedge: **trust is the product, not capability.**
That is right. But the current build *demonstrates* capability (research → store)
far more convincingly than it demonstrates trust — because the trust layer
(factory spawn, real HL calls, containment badge) is the least-finished code. The
pitch and the demo point in opposite directions. Fixing that gap is the whole game.

---

## Act 02 — Gravity Well (what every other team will build)

Name the obvious so we can avoid it.

- GW1 — "an agent that spawns agents" + an org-chart dashboard. Commodity for-loop.
- GW2 — "we blocked a prompt injection" one-shot demo. Every security-track team has this.
- GW3 — a slick org chart with progress bars. Presentation, not substance.

agent-maker already sits partly outside GW1 (role library, issued identity). The
ideas below push it fully orthogonal to all three.

---

## Act 03 — Ideation → Kill Gates

Six candidates generated. Gates: G1 buildable in the hours left, G2 orthogonal to
the gravity well, G3 covers a scored rubric line or sponsor bounty, G4 arithmetic
(hours-to-demo × judge-visible payoff). Killed on first failure.

| # | Candidate | Gate result |
|---|---|---|
| A | **Self-tightening cage** — a flag in run N auto-writes an OpenShell `deny` rule; run N+1 is provably more contained. Show the YAML diff live | SURVIVES — the one idea that crosses HiddenLayer × OpenShell × Recursive-Intelligence at once |
| B | **Flight recorder** — replay any attack token-by-token from the persisted bus: where detected, where blocked, what layer 2 did | SURVIVES — audit trail becomes tangible; ~3 hrs, data already persisted |
| C | **Live red-team agent** — spawn a real adversarial worker that tries to escape/exfiltrate/inject on stage and fails | SURVIVES but GATED — needs a real NemoClaw sandbox first (blocked on factory.ts) |
| D | **Containment scoreboard** — N attacks, M blocked L1, K blocked L2, 0 succeeded, mean detection latency ms | SURVIVES — cheapest quantification of the entire trust claim; ~2 hrs |
| E | **Cost/latency proof via Nemotron routing** — small-model worker at equal task success cuts $/run X%, proven by the eval ladder you already built | SURVIVES — turns the unused eval harness into a business claim |
| F | "BYO API key, hire a workforce in 60s" onboarding | KILLED at G2 — table stakes, sits inside GW1 |

### Novelty audit (prior art)
Idea A has no near neighbor at this event. OBSERVED: NVIDIA's own OpenShell blog
frames policies as *static declarative YAML* — a policy that *rewrites itself from
runtime detections* is a genuine extension of the blueprint, not a re-skin
(developer.nvidia.com/blog OpenShell). That is the crown wedge.

---

## Act 04 — Adversarial pass (attack the survivors)

- **Attack on A:** "auto-tightening a security policy from model output is itself
  an injection surface — a poisoned run could widen the cage." **Concede + fix:**
  tighten is auto (additive `deny` only, never widen); *widen requires
  out-of-sandbox human approval*. This is already the exact design in
  `specs/security/policy-tightening-loop.spec.md` — you specced it, never shipped
  it. REBUT holds only if you ship the additive-only constraint.
- **Attack on D:** "a scoreboard of self-run attacks is marking your own homework."
  **Concede:** true if the attacks are canned. **Fix:** include idea C's live
  adversarial worker so at least one scoreboard row is unscripted, and let a judge
  type their own injection into the attack box (the `/attack` endpoint already
  takes arbitrary `text`, server.ts:141).
- **Attack on the whole project:** "the sandbox claim is unverified." This is the
  real one. Your own IMPLEMENTATION_PLAN §1.9 says: if NemoClaw is unverified by
  Saturday night, fall to `local` and show an **UNCONTAINED** badge, downgrade the
  claim to "attempted." That honesty *is* a scoring asset — judges penalize
  overclaim harder than honest omission. Do not hide a stubbed sandbox behind
  confident narration.

RUNNING CONFIDENCE: 78/100 that A+B+D lands a top-tier finish, *conditional on one
genuinely contained worker existing by demo time.*

---

## Verdict

**CROWN — the "Self-Improving Cage" narrative (A + D + B, in that priority).**

One line for the stage:

> Everyone else's agents get more capable. Ours get measurably *safer* every run —
> and here is the scoreboard, the policy diff, and the replay to prove it.

These three compound into one story: the **scoreboard (D)** counts what the
**flight recorder (B)** replays, and the **self-tightening cage (A)** is why run
N+1's scoreboard beats run N's. No other team can say their security posture
improves itself. It hits three sponsor tracks with one mechanism.

### What this beats: the two current money demos
Your build-demo proves capability (crowded). Your attack-demo proves a single
block (also crowded). The self-improving cage proves *capability under a cage that
learns* — which is the literal thesis of the PITCH, finally shown instead of said.

---

## Deliverable — the 24-hour build plan (impact-per-hour ordered)

Prioritized for what a judge sees on Sunday, not for architectural purity.

**Tier 0 — verification (do first, unblocks the honest claim)**
1. Get ONE worker genuinely running in an OpenShell sandbox with a real egress
   block (factory.ts spawn TODO). If it works by Saturday night → contained badge.
   If not → ship the **UNCONTAINED** badge and say "attempted." Either way you are
   honest on camera. (Sky's lane; this is the single highest-leverage item.)
2. Verify the real HiddenLayer endpoint (`POST /detection/v1/interactions`, OAuth2,
   `hl-project-id` header per your plan §0.5) — the current `/v1/scan` guess will
   throw and flood the demo with fail-closed escalations if a key is present.

**Tier 1 — the crown (highest judge payoff)**
3. **Containment scoreboard (D, ~2 hrs):** instrument `gateOrEscalate` to count
   attempts/blocks/layer/latency; render a live strip on the dashboard. Cheapest
   possible quantification of the whole trust story. Let judges fire their own
   injection into the existing `/attack` box.
4. **Self-tightening cage (A, ~4 hrs):** implement `policy-tightening-loop.spec.md`
   minimally — one flagged behavior in run N appends an additive `deny` fragment to
   the rendered policy; run N+1 shows the YAML diff on the dashboard; widen is
   human-gated. This is the crown. Even a scripted-but-real version wins the room.

**Tier 2 — make it tangible**
5. **Flight recorder (B, ~3 hrs):** a "replay" button that scrubs the persisted bus
   for a goal/attack thread, highlighting the detect → block → layer-2 sequence.
   The audit trail stops being a claim.

**Tier 3 — if time remains**
6. **Nemotron cost proof (E):** run the eval ladder on a small Nemotron vs a
   frontier model, put "$/run at equal task success" one line in the pitch. Turns a
   built-but-hidden asset (the 20-level ladder) into a commercial claim.
7. **Heartbeat tick (from your §1.6):** a separate clock that posts an autonomous
   CEO status line after the attack with no human prompt — the "claw-agent
   eligibility" beat. Missing from current code.

### Honest cut rule (borrowed from your own plan)
Claim only what is verified by its deadline. An unverified sandbox is a badge, not
a lie. The scoreboard and the policy diff are cheap and real — build those two even
if everything else slips, because together they *show* the thesis the pitch has
only been *saying*.
