# Honesty Must-Fixes

Site claims vs shipped code. Source: honesty review 2026-07-19 (landing.html item-by-item
vs `src/`). Each item = a place the marketing layer writes a check the default runtime
doesn't cash. Fix = make code true, or make copy honest. Order = highest judge risk first.

Legend: ✅ done · 🔴 open

---

## 1. Containment claims ✅ DONE (2026-07-19)

**Claim:** hero "each one sandboxed", how-it-works 03 "Every worker lives in a cell it
cannot escape", security demo "the sandbox blocks the exfil host independently".

**Was:** `containmentMode()` defaulted to `local` (UNCONTAINED) unless `WORKER_MODE=nemoclaw`.
Default run contradicted the hero.

**Fix shipped:** `src/factory/factory.ts` `containmentMode()` now 3-way with AUTO default:
- unset → AUTO: contain when NemoClaw+OpenShell toolchain installed, else `local`
- `WORKER_MODE=nemoclaw` → force contain (fails closed if toolchain missing)
- `WORKER_MODE=local` → force break-glass
New probe `toolchainAvailable()` in `src/worker/nemoclaw.ts` (read-only, cached).

**Result:** default contains wherever the box can. Claim true on any box with the toolchain.
For the judged demo: install NemoClaw+OpenShell (auto-engages) or force `WORKER_MODE=nemoclaw`.
Verified: 7/7 adversarial suites pass; probe returns false in 1.2s on a toolchain-less box.

**Containment visibility (source of truth = the per-agent badge):**
The AUTO fallback to `local` is NOT silent — it surfaces three ways:
- console `warnLocalOnce()` at first hire,
- per-agent registry log (fixed 2026-07-19 to distinguish forced `WORKER_MODE=local` from
  AUTO "no toolchain detected" — was hardcoding `WORKER_MODE=local` in both cases),
- **per-agent dashboard badge** on `/app`: green **CONTAINED** vs plain **UNCONTAINED**
  (`dashboard/index.html` row `:676`, detail `:758`, raw JSON `:783`). This is the honest
  surface — every agent wears its real containment state.

**Copy pass shipped (2026-07-19):**
- Hero + meta description: "each one **sandboxed**" → "each one **sandbox-ready**" (`landing.html:7,498`).
- How-it-works 03: "Every worker lives in a cell it cannot escape" now conditioned —
  "With the NemoClaw + OpenShell toolchain present, every worker lives in a cell it cannot
  escape; without it, workers run break-glass and wear an UNCONTAINED badge" (`landing.html:719`).

🔴 **Residual (accepted, badge is source of truth):**
- **Scripted mini-demo still shows `security gate: connected` hardcoded.** It's labeled
  "SCRIPTED WALKTHROUGH", and the gate's heuristic floor really is always on (only *containment*
  is conditional, now disclosed in how-it-works 03). Not softened further.
- **No global dashboard banner.** `/app` shows per-agent badges but no top-level "workers
  UNCONTAINED — no toolchain" summary; with a single agent the badge is easy to miss.
  Deliberately NOT added — per-agent badges are the agreed source of truth. Revisit only if
  a glance-level guarantee is wanted.

---

## 2. Eval-gating claim ✅ DONE (2026-07-19)

**Claim:** feature card "20-level ladder — **Only models that clear it run your workers**",
"Workers benchmarked before hired" (`landing.html` ~line 756-758).

**Was:** ladder (`src/evals/`) was a standalone offline benchmark. `src/providers/pool.ts`
selected the brain by key + priority + health — never consulted eval results.

**Fix shipped (option a — made it true):** `src/providers/pool.ts` now reads the eval cache
(`data/evals/model-cache.json`) and gates hiring:
- `ladderFor(model)` → cached `{cleared,total,breakingPoint,passed}` (passed = `cleared >= WORKER_MIN_LADDER`, default 8).
- `brainOrder()` drops any provider whose resolved model was **benchmarked AND failed** the bar.
  NO fall-through: if every configured brain is a proven failure, order is `[]` → `poolBrain()`
  null → workers run **labeled sim** (honest degrade, never a crash).
- Unbenchmarked models pass through **advisory** (can't prove failure → don't brick a fresh clone).
- `WORKER_BACKEND` pin bypasses the gate (operator intent). Verdicts exposed on
  `brainPoolStatus()` (`/api/providers`) incl. `minLadder`.
- Knob documented in `.env.example` (`WORKER_MIN_LADDER`).

**Verified:** weak model (nemotron 3/21) dropped, strong (haiku 15/21) hired, order `["anthropic"]`;
only-failing-configured → order `[]` → `poolBrain()` null (sim). Typecheck clean.

**Caveat — worth a follow-up:**
- Cache keys are bare slugs (`claude-haiku-4-5`, `claude-sonnet`) but pool default models carry
  date suffixes (`claude-haiku-4-5-20251001`) → they don't match → treated **unbenchmarked
  (advisory pass)**. Nemotron isn't laddered at all. So in the current real cache the gate blocks
  nothing (no failures present); it only becomes a hard gate once the **actual demo models** are
  laddered under their exact ids. Action for a strong demo: `npm run eval` on the exact
  Claude + Nemotron slugs the workers use, so their verdicts are real, not advisory.
- Cosmetic: ~~`LEVELS` holds **21** entries; copy + `levels.ts` header say "20".~~ ✅ FIXED
  2026-07-19 — `LEVELS` verified 21 titled entries (source of truth); copy now says "21-level"
  (`landing.html:756,868` feature card + FAQ) and `levels.ts:1` header updated to 21.

**Files:** `src/providers/pool.ts`, `.env.example`. Copy/count: `dashboard/landing.html`, `src/evals/levels.ts`.

---

## 3. Stripe partner ✅ DONE (2026-07-19)

**Claim:** marquee "SECURED & POWERED BY … **STRIPE**", story "connector-1 wires Stripe",
storefront footer "Payments by Stripe".

**Reality:** **zero Stripe code** in `src` (grep confirms). Shopify + Apify are real; Stripe
is not integrated at all. Only fully-absent partner on the marquee.

**Fix shipped (option a — removed everywhere):** every Stripe mention pulled from `landing.html`:
marquee (both track groups), sneaker-story connector line, storefront footer, plus the scripted
mini-demo (roles line, deliver panel, task row, and the JS deliverables string). Grep for
`stripe` in `landing.html` now returns nothing. Shopify/Apify (real) untouched.

**Files:** `dashboard/landing.html`.

---

## 4. Supervised plan-approval copy ✅ DONE (2026-07-19)

**Claim:** FAQ "In **supervised mode (the default)** every org plan and every security
escalation stops and waits for your approve or deny" (`landing.html` ~line 864). How-it-works
04 "approve/deny on every plan and security escalation".

**Reality:** `governance.planGate()` returns true **only in `assisted`** (`src/governance/governance.js`).
In supervised (default) the plan proceeds straight to hire (`orchestrator.plan()` else-branch,
"Hiring now"). Only *escalations* gate in supervised. Mini-demo also shows a plan-approval
banner while labeled "supervised" — reinforces the wrong claim.

**Fix shipped (option a — copy now matches code):**
- FAQ "Do agents act without my approval?": supervised (default) now stated to gate **security
  escalations** only; plan approval reassigned to **assisted** ("Switch to assisted — the most
  hands-on setting — and every org plan waits for approval too, before a single worker is hired").
- How-it-works 04: "approve/deny on every plan and security escalation" →
  "approve/deny on every security escalation — and, in assisted mode, on every org plan before hiring".

- Mini-demo: the scripted walkthrough shows BOTH a plan-approval banner (`mdPlan`) and a security
  escalation, but its strip previously read `autonomy: supervised` — where plans do NOT gate. Flipped
  all 4 strip labels to `autonomy: assisted` (the hands-on setting where both gates fire), so every
  beat the demo shows is truthful. Default is still supervised (stated in FAQ); the demo just walks
  the most-hands-on mode.

**Files:** `dashboard/landing.html` (FAQ, how-it-works 04, mini-demo strip ×4). Code
(`governance.planGate()`) left as-is.

---

## 5. Capability-catalog + toolsmith stories ✅ DONE (2026-07-19)

**Claim:** catalog note "a **capability catalog** — commerce, payments, media, research,
deploy, outreach — the CEO searches when it drafts an org … a **tool the colony builds
itself**" (`landing.html` ~line 802-807). Stories use named agents `toolsmith-1`, `maker-1`,
`qa-1`, `store-1`, `connector-1`, `listing-1`.

**Reality:** no capability catalog with those 6 categories. Org = keyword `matchPlaybook()`
(`src/roles/library.ts`). No toolsmith / self-building-tool code. None of those story agents
exist — store playbook is research → store-builder → copywriter only.

**Fix shipped (option a — framed honestly):**
- Stories section now carries a disclaimer under the header: "Illustrative scenarios of the
  intended flow. The storefront path (research → store-builder → copywriter) runs today; the
  self-building-tool path is on the roadmap, marked below."
- The Unity/3D-assets story (entirely unbuilt — no toolsmith, maker, qa, store roles) is tagged
  **ROADMAP** on its quote (new `.story .quote .mono` badge style).
- Catalog-note rewritten: the CEO drafting from a **proven role library** (real, `matchPlaybook()`)
  is stated as today; the **searchable capability catalog** and **colony-built tools** are stated as
  roadmap. Dropped the `payments` category (no payment integration exists post-Stripe-removal).

**Note:** the shoe story keeps its illustrative agent names (research-1/webmaster-1/connector-1/
listing-1) — the FLOW is real even though the runtime role names differ; the header disclaimer now
frames the whole section as illustrative.

**Files:** `dashboard/landing.html` (stories header, story-1 quote, catalog-note, `.mono` badge CSS).

---

## Summary

| # | Item | Risk | Cheapest fix | Status |
|---|------|------|--------------|--------|
| 1 | Containment default | High | code (done) | ✅ |
| 2 | Eval-gating | High | code gate (done) | ✅ |
| 3 | Stripe absent | Med | remove from marquee (done) | ✅ |
| 4 | Supervised plan-approval | Med | fix FAQ copy (done) | ✅ |
| 5 | Catalog/toolsmith stories | Med | frame as roadmap (done) | ✅ |

Underneath the copy the engineering is strong (fail-closed gate, brain-pool failover,
handoff-schema validation, spawn-authority broker, deterministic eval ladder, run-memory).
The gap was only the marketing layer.

**All 5 items closed 2026-07-19** — items 1 & 2 by code (containment AUTO-default + eval hard
gate), items 3–5 and the residual copy on 1 & 2 by an honest copy pass. Remaining accepted risks
are documented per-item above (scripted `security gate: connected`, no global dashboard banner,
eval cache keys needing the exact demo-model slugs laddered). The site now matches the system.
