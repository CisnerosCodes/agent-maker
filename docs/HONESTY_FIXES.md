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

🔴 **Residual dishonesty risk (accepted, badge is source of truth):**
- **Landing page does NOT reflect real containment.** The scripted Mission Control mini-demo
  and hero copy imply "secured / sandboxed" unconditionally; `security gate: connected` is
  hardcoded. A visitor who never opens `/app` sees only the secured framing. This is the copy
  half of item #1 — the CODE is honest (badges), the MARKETING is not. Fix in the copy pass:
  soften hero/how-it-works to "sandbox-ready; contained when the toolchain is present," or add
  a CONTAINED/UNCONTAINED indicator to the scripted demo.
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
- Cosmetic: `LEVELS` holds **21** entries; copy + `levels.ts` header say "20". Fix in the copy pass.

**Files:** `src/providers/pool.ts`, `.env.example`. Copy/count: `dashboard/landing.html`, `src/evals/levels.ts`.

---

## 3. Stripe partner 🔴 OPEN

**Claim:** marquee "SECURED & POWERED BY … **STRIPE**", story "connector-1 wires Stripe",
storefront footer "Payments by Stripe".

**Reality:** **zero Stripe code** in `src` (grep confirms). Shopify + Apify are real; Stripe
is not integrated at all. Only fully-absent partner on the marquee.

**Fix options:**
- **(a)** remove STRIPE from the marquee + the sneaker story + storefront footer. Cheapest.
- **(b)** add a real Stripe call (payments/checkout in `store-builder`). Big scope.

**Files:** `dashboard/landing.html` (marquee ~line 694-695, story ~line 795, footer ~line 678).

---

## 4. Supervised plan-approval copy 🔴 OPEN

**Claim:** FAQ "In **supervised mode (the default)** every org plan and every security
escalation stops and waits for your approve or deny" (`landing.html` ~line 864). How-it-works
04 "approve/deny on every plan and security escalation".

**Reality:** `governance.planGate()` returns true **only in `assisted`** (`src/governance/governance.js`).
In supervised (default) the plan proceeds straight to hire (`orchestrator.plan()` else-branch,
"Hiring now"). Only *escalations* gate in supervised. Mini-demo also shows a plan-approval
banner while labeled "supervised" — reinforces the wrong claim.

**Fix options:**
- **(a) fix copy** — plan approval is an ASSISTED-mode behavior; supervised gates escalations
  only. Update FAQ + how-it-works + mini-demo label. Cheapest, matches code.
- **(b) fix code** — make supervised also gate plans (`governance.planGate()` → `assisted ||
  supervised`). Changes default friction.

**Files:** `dashboard/landing.html` (FAQ, how-it-works 04, mini-demo strip), or
`src/governance/governance.ts` `planGate()`.

---

## 5. Capability-catalog + toolsmith stories 🔴 OPEN

**Claim:** catalog note "a **capability catalog** — commerce, payments, media, research,
deploy, outreach — the CEO searches when it drafts an org … a **tool the colony builds
itself**" (`landing.html` ~line 802-807). Stories use named agents `toolsmith-1`, `maker-1`,
`qa-1`, `store-1`, `connector-1`, `listing-1`.

**Reality:** no capability catalog with those 6 categories. Org = keyword `matchPlaybook()`
(`src/roles/library.ts`). No toolsmith / self-building-tool code. None of those story agents
exist — store playbook is research → store-builder → copywriter only.

**Fix options:**
- **(a)** frame the stories unambiguously as ROADMAP (not "shipped"); drop or asterisk the
  named agents that don't exist. Keep the real playbook roles. Cheapest.
- **(b)** build a toolsmith role + capability catalog. Large.

**Files:** `dashboard/landing.html` (stories section ~line 773-808).

---

## Summary

| # | Item | Risk | Cheapest fix | Status |
|---|------|------|--------------|--------|
| 1 | Containment default | High | code (done) | ✅ |
| 2 | Eval-gating | High | code gate (done) | ✅ |
| 3 | Stripe absent | Med | remove from marquee | 🔴 |
| 4 | Supervised plan-approval | Med | fix FAQ copy | 🔴 |
| 5 | Catalog/toolsmith stories | Med | frame as roadmap | 🔴 |

Underneath the copy the engineering is strong (fail-closed gate, brain-pool failover,
handoff-schema validation, spawn-authority broker, deterministic eval ladder, run-memory).
The gap is only the marketing layer. Items 2-5 are all ~15-min copy edits if the cheapest
path is taken; the site then matches the system.
