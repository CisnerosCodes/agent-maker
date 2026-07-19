# ClawColony — Vision Plan: from demo to venture builder

> Status: **for review** (nothing here is implemented yet unless marked DONE).
> The vision, in one line: a founder states a goal; the CEO interviews them, researches,
> discovers which capabilities exist, **asks the human when none do**, hires agents that
> *build the missing tools*, makes things, validates them, ships them to a store, and hands
> back a link. The founder answers questions and drops photos. That's it.

The two canonical journeys (both now illustrated on the landing page):

- **Unity 3D assets**: goal → CEO interview (Unity Asset Store, horror packs) → research
  finds *no AI asset tooling* → decision to human: "build one?" → yes → toolsmith builds an
  asset-maker (MCP tool) → maker generates packs → QA validates/rejects/regenerates →
  store agent preps listings → founder gets the publisher link.
- **Shoes online**: goal → interview finds local-only sales → research ranks channels →
  webmaster + connector wire storefront/Shopify/Stripe → founder drops photos → listing
  agent titles/describes/prices onto the live store → link in her inbox.

---

## 1 · Where we actually are (verified against the code, Jul 18)

| Subsystem | State |
|---|---|
| CEO brain | **Scripted, not LLM.** `orchestrator.startGoal` → one hardcoded clarifying question (store-goals only), `matchPlaybook()` regex keyword match ([src/roles/library.ts](../src/roles/library.ts)). Swap point for a model is explicitly marked. |
| Roles | Data entries (`RoleTemplate`): research, store-builder, copywriter, strategist, analyst. 3 playbooks. **No runtime synthesis** — off-script goals fall back to market-research. |
| Execution | Real work runs **in-process** ([src/factory/worker.ts](../src/factory/worker.ts)); REAL integrations today: Apify scrape, Shopify product-create, Anthropic/NVIDIA/Featherless brains, HiddenLayer scanning. strategist/analyst are SIM-only. |
| Sandbox | **Built but not wired.** `factory.createAgent` has `TODO(Sky)` where NemoClaw spawn goes; [src/worker/nemoclaw.ts](../src/worker/nemoclaw.ts) + [src/security/spawn-authority.ts](../src/security/spawn-authority.ts) exist, tested only by `scripts/verify-tier1.ts`. |
| Integrations | Flat `INTEGRATIONS[]` list ([src/config/env.ts](../src/config/env.ts)) — 7 entries, booleans-only status, no categories, no search, no manifest. Adding an API = editing three places by hand. |
| Memory | Exact-`nicheKey` recall of prior runs ([src/memory/runs.ts](../src/memory/runs.ts)). Real speedup demo, but string-match only. |
| Security | Gate + escalations + autonomy dial are real and fail-closed. **Only security escalations exist** — there is no "decision request" escalation (the *"no tool exists, build one?"* moment has no channel today). |
| QA / validation | Absent. No validator role; only the SecurityGate and the eval ladder (model benchmarking, not artifact QA). |
| Tool-building agents | Absent. "Self-expanding" today means a human edits the role library. |
| Account automation | Shopify product-create is real. Account *creation* is deliberately out of scope (CAPTCHA/ToS) — a human pastes admin tokens; comments in env.ts document this. |

**Honest distance from the vision: the demo shows the story; the engine executes ~30% of it.**
The security spine, approval loop, role library, memory, and one real commerce pipeline
(scrape → Shopify → copy) exist. The venture-builder loop — interview, capability discovery,
build-the-missing-tool, QA, ship-with-link — is not yet real.

---

## 2 · The seven workstreams

### W1 — Capability Catalog (the API categorization/search system you asked for)
The foundation everything else queries. Replace the flat `INTEGRATIONS[]` with manifests:

```ts
// src/capabilities/catalog.ts
interface CapabilityManifest {
  id: string;                       // "shopify-admin"
  label: string;
  category: "commerce" | "payments" | "media" | "research" | "deploy"
          | "outreach" | "brain" | "security" | "storage";
  verbs: string[];                  // ["create-product", "update-listing", ...] — what it can DO
  keys: { name: string; hint: string }[];
  connectSteps: string[];           // human-readable "how to get this key" (doctor-verifiable)
  doctorCheck?: string;             // id of live verification in doctor.ts
  simFallback: boolean;             // can workers run SIM without it?
  source: "builtin" | "colony-built" | "user-added";
}
```

- `searchCapabilities(query | verbs[])` — planner asks "who can `create-product` in
  `commerce`?" and gets ranked candidates. Plain keyword/verb match first; no vectors needed.
- **Missing-capability event**: when planning needs a verb nothing provides, emit a
  `capability-gap` — which flows into W3 (decision escalation) instead of silently falling
  back to SIM.
- **New/unknown APIs** (your "system for APIs we might not have"): a `user-added` manifest
  can be created *at runtime* from a form or by the CEO (name, category, verbs, key names,
  docs URL). Doctor gains a generic "key present + optional ping URL" check. Workers can't
  use what has no adapter — so unknown APIs start life as **guided-connect + SIM**, and
  graduate to REAL when an adapter (or a colony-built MCP tool, W4) exists.
- Migration: today's 7 integrations become builtin manifests; `setupStatus()` and the
  Connections panel read from the catalog (same booleans-only hygiene).

### W2 — Real CEO: multi-turn interview + org synthesis
- Swap `matchPlaybook()` behind a flag: `CEO_BRAIN=model` uses `resolveBrain()` (already
  exists for copywriter) with a structured prompt: goal + company profile + interview
  answers + **catalog search results** → JSON org plan `{ roles: RoleSpec[], rationale,
  capabilityGaps[] }`. Keyword path stays as offline/SIM fallback — never break keyless demo.
- Interview becomes multi-turn: CEO keeps asking while `confidence < threshold` (cap 3–4
  questions; the wizard answers pre-seed it). Uses the existing `clarifying` status + thread
  reply loop — the plumbing is already there, it just only fires once today.
- Role synthesis: model composes a `RoleSpec` from **primitives** (objective, tools ⊂
  catalog verbs, policy template, dependsOn) instead of picking only from 5 fixed templates.
  `spawn-authority`'s `AUTHORITY_TABLE` (W5) is the hard ceiling on what a synthesized role
  may request — a prompt-injected CEO cannot mint a role with more credentials than the
  table allows.

### W3 — Decision escalations (the "no tool exists — build it?" moment)
- New escalation kind alongside security: `kind: "decision"` with `question`,
  `options[]`, `context`. Same UI banner, honey-colored; same MCP `pending_approvals`.
- Emitted by: capability gaps (W1), budget/scope questions, "store account needed — here
  are the connect steps" handoffs. This is the single most vision-critical *small* change:
  it turns dead-ends into conversations.

### W4 — Toolsmith: the colony builds missing tools
- New role `toolsmith`: given a capability gap + research findings, writes a small MCP
  tool (TypeScript, stdio) in its **sandbox** (needs W5), runs its self-test, and registers
  it in the catalog as `source: "colony-built"` with declared verbs.
- Guardrails: toolsmith output is code — it runs **only inside NemoClaw** with the rendered
  OpenShell policy (egress allowlist from its declared API), its registration goes through
  a human decision escalation (W3) in supervised mode, and every I/O passes the gate.
- First target: the Unity journey's "AI asset maker" (wraps an image/3D generation API the
  user connects, e.g. Higgsfield MCP / Meshy). Second: photo→listing describer (shoes journey)
  — that one we should ship as a *builtin* first (W6) and let toolsmith re-derive it later
  as the showcase.

### W5 — Wire the sandbox + spawn authority (Sky's seam, integration only)
- `factory.createAgent` calls `validateSpawn(spec)` (deterministic authority check) and the
  NemoClaw spawn instead of the TODO stub; task execution routes real work through
  `nemoclaw.dispatch` where a sandbox exists, falling back to in-process for SIM.
- This is mostly plumbing Sky already built and adversarially tested (`npm run adversarial`,
  specs in `specs/security/nemoclaw-spawn-fixes.spec.md`). Coordinate with Sky — it's his lane.

### W6 — Maker + QA + deliverables
- `qa` role (data entry): validates artifacts against the goal's acceptance list
  (counts, formats, banned content, price sanity); rejects → re-queues the maker task with
  the failure note (bounded retries). Runs on the brain; SIM without one.
- Deliverable objects instead of a single URL string: `{ kind: "store"|"listing"|"tool"|
  "report", url?, files?, summary }` accumulated on the goal; dashboard renders them as the
  green "Deliverable ready" card (the landing demo already shows this UI).
- Builtin `listing` worker (shoes journey, REAL path): image upload → brain
  (vision-capable) writes title/description/price → Shopify product-create with image.
  All the pieces (Shopify adapter, brains) exist today — this is the cheapest REAL win.

### W7 — Store/account automation, honestly bounded
- We do **not** automate account signup (CAPTCHA, ToS; also our stated security posture).
  Instead: `connectSteps` from the catalog become a generated, checkable **handoff
  checklist** ("create the store, paste the Admin token here — I verify it live").
  This is already our pattern (Connections + doctor); W1 makes it data-driven.
- Unity specifically: no public upload API → the deliverable is a validated, packaged
  `.unitypackage` + prefilled listing copy + guided publish steps. Shopify-class APIs
  (full CRUD) get full automation.

---

## 2.5 · Demo parity contract — the landing demo is a promise, not an illustration

The hero demo on `/` plays a scripted journey. **Every beat in it must be reachable in the
real app**; anything we can't make real gets cut from the demo, not hand-waved. Beat-by-beat:

| Demo beat | Real today? | Owed by |
|---|---|---|
| Intake wizard shapes the org | **Yes** — company profile feeds planning | — |
| Goal → CEO drafts a 4-role org for an off-script goal ("put my sneakers online") | **No** — keyword playbooks would fall back to market-research | W2 (P1.5) |
| "Org plan awaiting approval" in supervised mode | **Partial** — plan gate only fires in *assisted* mode today; demo shows it in supervised. Either flip the default (plan approval always gated) or match the demo to governance | P0 decision |
| Roles `webmaster-1`, `connector-1`, `listing-1` | **No** — library has research/store-builder/copywriter/strategist/analyst. Add these as `RoleTemplate` entries (webmaster ≈ store-builder split; connector = key-wiring + test order; listing = photo→listing) | W6 (P1) |
| Workers provision → work, REAL/SIM tags, listing waits on research | **Yes** — factory states, `dependsOn`, mode tags all real |  — |
| Poisoned doc → escalation → deny → quarantine → colony resumes | **Yes** — the money demo, end-to-end real | — |
| 100% → "Deliverable ready" card with store link | **Partial** — `goal.deliverable` is a bare URL string; the card/object shape is W6 | W6 (P1.7) |
| Clicking the deliverable opens a live store with 12 photographed, priced products | **Partial** — Shopify product-create is real when a store is connected; photo→listing pipeline is W6 (P1.6); product *photos* come from Maya, not generation | W6 (P1.6) |
| Run memory strip ("run 2 reuses all of it") | **Yes** — exact-niche recall works | — |

Rule going forward: a new demo beat lands **only** with a linked plan item that makes it real.

---

## 3 · Phasing

**P0 — hackathon-now (each ≤ ~half day, independently demoable)**
1. Capability catalog data model + migration of the 7 builtins + `searchCapabilities` (W1).
2. Decision escalations end-to-end: type, banner UI, MCP surface (W3).
3. Planner consults catalog and raises a `capability-gap` decision instead of silent SIM (W1+W3) — this alone makes the Unity story *narratable live*.
4. Wire `validateSpawn` into `createAgent` (W5, with Sky).

**P1 — before judging (1–2 days, needs a working brain key)**
5. `CEO_BRAIN=model` planner + multi-turn interview behind flag (W2).
6. Builtin photo→listing worker, REAL against the demo Shopify store (W6).
7. QA role + deliverable objects + dashboard deliverable card (W6).

**P2 — post-hackathon**
8. NemoClaw dispatch for real task execution (W5 full).
9. Toolsmith building + registering MCP tools in-sandbox (W4).
10. Semantic memory: recall by category/verb, not just exact niche; store per-capability
    learnings ("Apify actor X worked for sneakers") (extends `runs.json`).
11. Runtime user-added API manifests + generic doctor checks (W1 full).

**Explicit non-goals**: automated account creation; unattended payments setup; anything
that puts a credential value in front of a model.

---

## 4 · Risks / open questions for review

- **Brain dependency**: W2/W4/W6 need a funded key (Featherless credits pending — see env
  memory). Everything keyless must stay honest-SIM; that's already our design language.
- **Toolsmith safety story** is our differentiator *because* we run it through authority
  table + sandbox + gate + human approval — if judges ask "agents writing code, really?",
  that stack is the answer. Do not ship W4 before W5.
- **Scope for judging**: P0.3 (capability-gap decision) + P1.6 (photo→listing REAL) give
  both landing-page stories a live backend beat. Recommend we cut P1.5 if time is tight —
  a scripted interview reads fine on stage; a dead-end that *asks you* and a photo that
  *becomes a product* do not fake well.
- Naming: catalog "verbs" vs roles' `tools[]` — unify so a role's tools are just verbs.

*Prepared for team review — Adrian / Sky / Alex. Comment inline or in the channel.*
