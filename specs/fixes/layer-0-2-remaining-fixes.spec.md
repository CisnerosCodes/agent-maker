# Fix Spec — Layer 0–2 Remaining Code Fixes (review 2026-07-18)

Status: **spec only — implement in the final fix pass.**
Owner: Sky (security lane). Scope: the code-only remainders in `IMPLEMENTATION_PLAN.md`
tiers 0–2 that do **not** need a live NemoClaw sandbox or an `openshell policy` CLI run.
Every partial/incomplete in tiers 0–2 was triaged against the code on `Skye-main-test`;
only two genuine product-code drifts survive. Everything else that is still 🟡/⬜ is a
**test-only** row blocked on a live sandbox / live HL console (see "Deliberately left"
at the bottom) and is out of scope per the ask.

Priority key: **P0** = correctness/security before demo. **P1** = honesty polish.

> These are corrections to shipped code, not new features. Where a fix aligns code to an
> existing spec, that spec is cited — the spec is already right; the code drifted.

---

## R1 — Heuristic floor caps exfil at `flagged`; must `blocked` (P0, plan §0.5)

**Location:** `src/security/gate.ts:37`
(`const heuristicVerdict = (categories) => categories.length ? "flagged" : "clean";`).

**Defect:** the HiddenLayer path already hard-`blocks` exfil (`mapFindings`, `gate.ts:194-199`
maps `isExfil` → `blocked`). But **three code paths bypass that** and route through
`heuristicVerdict`, which can only return `flagged`/`clean`:
1. no-creds dev path (`gate.ts:53`) — returns `heuristicVerdict(categories)` directly;
2. scanner fail-closed path (`gate.ts:69`) — `worse("flagged", heuristicVerdict(...))`;
3. the HL merge (`gate.ts:60`) when the **trial ruleset only flags** exfil (documented
   block-tier shortfall, plan §0.5) — `worse(hl.verdict="flagged", heuristicVerdict())`.

In all three, a genuine exfil attempt (`heuristic:data_exfiltration` /
`heuristic:suspicious_endpoint` from `detect.ts:10-12`) resolves to **`flagged`**, not
`blocked`. The adversarial `exfil` suite (`test/adversarial/run.ts:240-256`) expects
`blocked`, so it only passes with live HL creds and fails on the offline floor — and the
"detection-still-stops-exfil" claim collapses whenever HL is absent or only flags.

**Fix:** make `heuristicVerdict` verdict-aware by category severity, mirroring
`mapFindings`' exfil rule:
- category matching `data_exfiltration` **or** `suspicious_endpoint` → `blocked`;
- any other heuristic category (`prompt_injection`, `privilege_escalation`) → `flagged`
  (prompt-injection stays flagged — the human approve/deny IS the demo, plan §0.5 / §1.8);
- no categories → `clean`.

Match on the bare category name (categories carry the `heuristic:` prefix from
`detect.ts`; substring/`.includes("data_exfiltration")` is sufficient and prefix-safe).
Signature and all call sites (`gate.ts:53,60,65,69`) stay unchanged — only the mapping
body changes, so `worse()` now correctly escalates an HL `flagged`+heuristic-exfil to
`blocked`, which is the intended PR-#19 workaround folded in permanently.

**Owner:** Sky. **Cross-ref:** plan §0.5, §1.8; `hiddenlayer-gate.spec.md` §5–6;
`poisoned-doc-demo.spec.md` §5.

**Done-when (offline, no live sandbox):**
- `npm run adversarial -- --mode scan` — the `exfil` suite asserts `blocked` on the
  heuristic floor (no HL creds set), `clean` stays `clean`, `inject` stays `flagged`.
- unit: `heuristicVerdict(["heuristic:data_exfiltration"]) === "blocked"`;
  `heuristicVerdict(["heuristic:prompt_injection"]) === "flagged"`;
  `heuristicVerdict([]) === "clean"`.
- regenerate the stale `test/adversarial/last-run.json` from this pass (plan §2.1 note).

---

## R2 — `apify` tool overclaimed on the research role; drop it (P1, plan §1.7 / C15)

**Location:** `src/roles/library.ts:93` (`tools: ["apify", "web-fetch"]`) **and**
`src/security/spawn-authority.ts:40` (research `allowedTools: ["apify", "web-fetch"]`).

**Defect:** C15 already dropped `APIFY_TOKEN` from the research **credentials** (both are
`[]`), but the `apify` **tool** string was left behind in both the library template and
the authority-table row. The real Apify scrape is **harness-brokered** — `worker.ts:40-60`
reads `APIFY_TOKEN`/`APIFY_ACTOR` straight from env and fetches host-side; the sandboxed
agent never holds the token and never makes an `apify` tool call. So the `apify` tool in
the emitted `AgentSpec` (the store-launch playbook's research role, `library.ts:113`)
advertises a sandbox capability the agent does not and must not have — the exact overclaim
C15/§1.7 exist to remove. Removing it is behavior-neutral: nothing in `src/` dispatches an
`apify` tool (grep confirms only env-brokered use in `worker.ts` + doctor/env probes).

**Fix:**
- `library.ts:93` → `tools: ["web-fetch"]`.
- `spawn-authority.ts:40` → `allowedTools: ["web-fetch"]`; update the trailing comment
  (drop "apify is harness-brokered…") and the §31-35 header note so the table reads as
  fully tightened, not "temporarily whitelisted."
- Change **both files in the same commit** so `scripts/verify-spawn-wiring.ts`
  (library↔table consistency) never sees a drift.
- *(Optional, cosmetic)* `src/ceo/CEO_PROMPT.md:27` still names `tools: apify;
  credentials: APIFY_TOKEN` in its example line. It's the un-loaded intent doc (C17), so
  it can't leak into a spec, but align it to `tools: web-fetch` for a clean read.

**Owner:** Sky. **Cross-ref:** plan §1.7 (tighten the temporarily-whitelisted row back),
§2.4 C15; `worker-capability.spec.md` §5; `ceo-brain-and-spawn-authority.spec.md` Part A.

**Done-when (offline):**
- `scripts/verify-spawn-wiring.ts` passes (library and authority table still consistent).
- a store-launch goal emits a research `AgentSpec` whose `tools` is `["web-fetch"]` and
  `credentials` is `[]`; the broker `validateSpawn` still allows it.
- a spec requesting `tools: ["apify"]` on `research` is now **rejected** by the broker
  (`requested tool 'apify' exceeds role authority`) — the tighten is real, not cosmetic.
- research still returns products offline (sample catalog path in `worker.ts` unaffected).

---

## Deliberately left out of this spec (test-only, need a live sandbox / HL console)

Per the ask — leave rows whose only remainder is a test that requires the full
NemoClaw/OpenShell sandbox or live HiddenLayer transport. None are code changes:

- **§1.2(b), §1.3 §5, §1.5, §1.8 Layer-2 / dual-block / cred-hygiene** — in-sandbox BLOCK
  tests + `openshell policy validate`; need a live Docker sandbox. Code is wired.
- **§1.2(a) inline in-sandbox egress scan (`network_middlewares`)** — deferred stretch
  (plan §3.3), not required for tiers 0–2; boundary is policy-enforced meanwhile.
- **§2.1 `token` + `dual-block` adversarial suites** — `token` needs a live-HL forced-stale
  transport seam (gate §7.4); `dual-block` needs the full sandboxed poisoned-doc flow.
  Both are HL/sandbox-gated, not offline product code.
- **§1.9 go-live flips, §2.5 runbook rehearsal** — external tokens / manual rehearsal.
- **§0.1** — `specs/security/README.md` §Open-items referenced by the plan is missing on
  disk; that's a doc-accuracy gap, not code. Flag to restore/rename, out of code scope.
