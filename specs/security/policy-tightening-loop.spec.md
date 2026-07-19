# Spec — Policy-Tightening Loop (flag → boundary, self-improvement)

Status: **implementation-ready** (planning-mode flag lifted 2026-07-18). Tier-3 stretch
(IMPLEMENTATION_PLAN §3.1) — build only if both money demos run 3× clean at the Sat 7 PM
ladder gate. The core submission stands without it. This spec is fully buildable as written:
module layout §11, data contracts §12, interfaces §13, algorithm §14, CLI contract §15, test
plan §16, demo wiring §17, build order §18, acceptance §19.

Owner: Sky (security lane). Track crossover: **Recursive Intelligence × NemoClaw/OpenShell bounty.**
Depends on: `hiddenlayer-gate.spec.md` §5 (verdict + raw findings), `openshell-policy.spec.md` §2/§4/§5 (allowlist + deny_rules schema), `learning-loop.spec.md` §3 (capture→compound→retrieve), `poisoned-doc-demo.spec.md` §2 (the attack that generates the first signal).

Grounds against real code (2026-07-19): `src/worker/nemoclaw.ts` (`dispatch` → `AgentResult.deniedEgress`; `nemoclawEvents.emit("incident", …)`; injectable `cli`/`__setCli`), `src/security/gate.ts` (`scan` → `ScanResult{verdict,categories,raw}`), `src/memory/runs.ts` (the singleton-class + JSON-file persistence idiom this loop mirrors), `test/adversarial/run.ts` (where the loop's test suite replaces the `policy-tightening` PENDING gap).

Goal: promote a HiddenLayer/OpenShell detection from **agent goodwill into the hard boundary.** After run N flags an attack, run N+1's OpenShell policy is *measurably stricter* — a generated `deny` fragment the agent cannot forget or be argued out of. This is the one artifact that makes "the sandbox got tighter because it learned" literal and on-screen.

---

## 1. The gap this closes

The learning loop today (learning-loop §3) writes lessons to `MEMORY.md` and feeds them into the **agent's prompt**: "policy: storebuilder cannot POST /orders — don't attempt." That is advisory. A prompt-poisoned or compromised agent forgets it — and the whole NemoClaw thesis is that **"the boundary lives in the OpenShell policy, not the agent's goodwill"** (Hackathon_Docs §NemoClaw).

So there are two kinds of self-improvement, and only one is currently specced:

| Kind | Where the lesson lives | Survives a compromised agent? | Specced? |
|---|---|---|---|
| Behavioral (current) | agent prompt / `MEMORY.md` | no — it's goodwill | learning-loop §3 |
| **Boundary (this spec)** | generated OpenShell `deny` fragment | **yes — enforced outside the agent** | here |

This spec adds the second. It does not replace the first — behavioral learning still makes the agent *faster* (skip forbidden attempts); boundary learning makes the system *safer* (can't cross even if it tries). Both compound; they answer different judges.

---

## 2. Direction rule — the load-bearing constraint

**Tighten automatically. Loosen only with a human.** This asymmetry is the entire safety argument:

- **Auto-tighten (add a `deny`)** — worst case is over-restriction. It fails loud (agent gets `policy_denied`, visible in audit log), is trivially reviewable, and is never a security regression. Safe to automate.
- **Auto-loosen (widen an allowlist, drop a `deny`)** — worst case is a self-widened hole an adversary steered the agent into triggering. **Never automate.** A loosen requires a human to sign the diff.

> **Native home for the human-approved loosen (confirmed 2026-07-18): OpenShell Policy Advisor / `policy.local`.** Docs: *"the sandboxed agent submits a narrow proposal through `policy.local` while a developer approves or rejects the structured rule from outside the sandbox."* This is a stronger, native mechanism than routing to Slack — the agent itself can *request* a widen through `policy.local`, but the structured rule only takes effect on **out-of-sandbox developer approval**. It also directly satisfies the NemoClaw bounty's "operator approval / human-in-the-loop for edge cases" non-trivial-policy criterion (Hackathon_Docs §NemoClaw). Design call: **auto-tighten via `policy update --add-deny`; loosen only via a `policy.local` proposal a human approves.** (Sources §10.)

A tightening that would strand the agent's *legitimate* work (e.g. denying a host a role genuinely needs) is itself surfaced for approval, not silently applied — see §5 conflict check. Default action is the safe direction; the dangerous direction is gated. This mirrors the locked design decision "prompt-injection → flagged, not auto-blocked" (README §Design decisions): automate the safe verdict, escalate the consequential one.

**Enforced in code by the `direction` invariant (§13):** `TighteningRule.direction` is the literal `"deny"` — the compiler in §14 emits no other value, and `applyRule` (§13) asserts it before shelling out. A widen never has a code path in v1.

---

## 3. What signal drives it (why HiddenLayer, not just OpenShell)

OpenShell already emits `policy_denied` for a blocked egress — that alone tells you *a* host was hit. HiddenLayer adds the part worth compounding: **the pattern.**

| Source (real code) | Signal | Compiles into |
|---|---|---|
| `AgentResult.deniedEgress` + `nemoclawEvents` `incident{kind:"egress_denied",host}` (`nemoclaw.ts:358-367`) | distinct hosts that hit default-deny | `--add-deny` host fragment (egress stays default-deny; this makes the block *named* in the policy, not just implicit) |
| `ScanResult.raw` HL findings + `ScanResult.categories` (`gate.ts:181-208`) | detector name + the injection **phrasing** that scored | a new `injections.jsonl` corpus row (feeds `adversarial-harness.spec.md` §4); optional `network_middleware` pattern (§9, stretch) |
| `AgentResult.error` / audit path a role tried and was denied (StoreBuilder → `/orders`) | denied path | tighter `--add-deny` path glob (policy §4) |

So the loop's inputs are exactly the two kill points of the poisoned-doc demo (poisoned-doc §2) — the attack that proves the boundary is also the attack that *teaches* it. That symmetry is the pitch.

---

## 4. Mechanism (capture → compile → apply)

> **Confirmed against OpenShell docs (2026-07-18) — the merge is native, do NOT hand-splice YAML.** `openshell policy update` performs **additive merges** into the live `network_policies` (dynamic section): *"merge network policy changes into the current live policy instead of replacing the whole YAML document… only updates the dynamic `network_policies` section."* `--add-deny` appends a deny rule to an existing endpoint; `--add-endpoint` creates-or-merges a rule for a host/port. All flags in one invocation run as *"one merge batch"* and persist *"at most one new policy revision."* So the tightening loop emits **`policy update --add-deny …` calls**, not a merged file. (Sources §10.)

Per-run, out of band from the timed task (see §6). Concrete step-by-step is §14; summary:

1. **Capture** — after run N, read denied egress hosts (from `AgentResult.deniedEgress` / the `incident` bus), flagged/blocked HL findings + phrasings (`ScanResult`), denied paths. Dedupe by `(host|path, detector)`.
2. **Compile** — translate each distinct signal into one `policy update` batch: `--add-deny` for a learned host/path, `--add-endpoint` if a new named entry is needed. Because a CLI merge won't preserve inline YAML comments, record **provenance in a sidecar** — `policies/generated/tightening-log.jsonl`, one row per applied rule (`{ts, run, detector, target, kind, revision, sourceCaseId}`; schema §12). Git-track the sidecar; it is the audit trail and the demo narration source.
3. **Conflict check (§5)** — reject any non-`deny`; reject a target that collides with a role's *required* allowlist (surface for human review instead).
4. **Apply + validate** — run the batch with `--wait`. The gateway validates the merged policy against the live policy before it loads. Exit codes are the gate: **`0 = loaded, 1 = validation failed, 124 = timeout`**. Never proceed to N+1 on a non-zero exit. Invalid disk YAML falls back to a restrictive default (fail-closed) — a broken fragment tightens, never loosens.
5. **Prove** — `openshell policy update --dry-run` *"shows the merged policy locally and does not call the gateway"* → capture that as the before/after **on-screen diff artifact**. Then re-fire the same attack under N+1's policy and show it now dies at the *named learned deny*, not the implicit default-deny. (`--wait` and `--dry-run` cannot be combined — dry-run for the visual, real run with `--wait` to apply.)

**Global-policy caveat (confirmed):** the tightening loop is **per-sandbox** — do NOT use `policy set --global`. A global policy *"is applied in full for all sandboxes"* and *"sandbox-level policy updates are rejected until the global policy is removed."* A `--global` baseline would silently block every `policy update` the loop issues. (Sources §10.)

---

## 5. Conflict / safety check before apply

A generated rule is applied only if all hold (implemented as `conflictCheck(rule): "apply" | "escalate" | "reject"`, §13):

- **Direction:** it is a `deny`/narrowing, never a widen (§2). `rule.direction !== "deny"` → **reject** (never happens in v1; asserted defensively).
- **No legitimate-work collision:** the denied host/path is not in any role's *required* allowlist. Cross-checked against the loaded `policies/worker-*.yaml` `network_policies.*.endpoints[].host` set. Collision → **escalate** (false-positive candidate, human review), not auto-apply — prevents the loop from strangling its own workers.
- **Validates:** the batch's `--dry-run` merge parses and the real `--wait` apply returns exit `0`. Non-zero → **reject**, keep the prior revision (fail-closed).
- **Provenance recorded:** every applied entry writes a `tightening-log.jsonl` row with the run + detector that produced it, so a human can audit *why* the boundary tightened.

---

## 6. Determinism firewall (do not break the learning demo)

The learning-loop entry is judged on a **speed delta across runs with the task held constant** (learning-loop §5.2 "vary nothing between runs"). A policy that mutates mid-series would confound that measurement and could make the poisoned-doc demo non-reproducible.

Rule: **policy-tightening is a separately narrated capability, run on its own attack sequence — not folded into the timed store-launch runs.** The store-launch series that produces the speed delta runs under a *frozen* policy. The tightening loop runs as its own 2-run beat: run 1 = attack lands + is flagged; run 2 = attack dies at the learned rule. Two demos, two claims, no cross-contamination.

**Enforced by a switch:** the loop only runs when `POLICY_TIGHTENING=1` (env) or the CLI entrypoint (§11 `scripts/policy-tighten.ts`) is invoked explicitly. It is NEVER called from the store-launch orchestrator path. Default off.

---

## 7. Demo beat (~45s, ladder-gated)

1. Run 1: poisoned doc → HiddenLayer flags → (approve, to let it reach egress) → OpenShell default-deny blocks `evil.example`. Same as poisoned-doc §3.
2. Show the loop capturing it: `policies/generated/tightening-log.jsonl` gains a row `{detector:"…", target:"evil.example", kind:"deny_host", revision:N}`; the dashboard renders the `--dry-run` YAML diff — `evil.example` now a *named* deny.
3. Run 2: same attack → dies at the **named learned rule** (`deniedEgress` still lists it, but the policy names it), and the dashboard shows the policy is stricter than it was 60 seconds ago. Narrate: *"It didn't just remember — it moved the lesson into the boundary. A compromised agent can't un-learn a deny_rule."*
4. Land the crossover: *"That's Recursive Intelligence where it matters for security — the containment compounds, not just the capability."*

---

## 8. Scope discipline

- **Stretch, not critical path.** Flag at the Sat 7 PM ladder check (PLAN §The Ladder). Build only if both money demos run 3× clean. Core submission stands without it.
- **Tightening only for v1.** Auto-loosening is explicitly out of scope for the hackathon — the human-approved loosen path is described (§2) but need not be built; "we only automate the safe direction" is itself a defensible design statement to judges.
- **One generated fragment, one role, for the demo.** Prove the mechanism on the Research→`evil.example` case. Generalizing across all roles is post-hackathon.
- **The offline seam is the deliverable.** The whole loop MUST run green through the injectable `cli` seam (§15) with no live NemoClaw/OpenShell — same discipline as `nemoclaw.ts` (`__setCli`). A live box only upgrades the demo from "proven mechanism" to "proven on real gateway."

---

## 9. Open items

- [x] **RESOLVED (2026-07-18):** OpenShell supports layered/merged policies natively — `policy update` additive-merges into live `network_policies`; no hand-spliced file. Provenance moves to a sidecar log (§4.2, schema §12). (Sources §10.)
- [x] **RESOLVED (2026-07-18):** the merged policy IS validated pre-load — gateway validates the merge against the live policy; `--wait` + exit codes `0/1/124` gate it (§4.4). (Sources §10.)
- [x] **RESOLVED (2026-07-19):** capture source of truth = `AgentResult.deniedEgress` + the `incident` bus event (`nemoclaw.ts`), NOT a separate audit-log parser — the seam already exists and is test-covered by the harness `egress` suite. The live security audit log is a post-hackathon upgrade for capturing signals *outside* a dispatch.
- [ ] Confirm the **NemoClaw version floor** for live `network_policies` updates — GitHub NemoClaw issues #1010 / #2039 report older builds duplicating the `network_policies` block / emitting invalid YAML on live add, with a `policy-add` workaround. Verify the box's `nemoclaw --version` supports clean `policy update` before relying on the loop on real hardware. (Offline seam is unaffected.) (Sources §10.)
- [ ] Confirm `--dry-run` output is diff-friendly enough to show on screen (full merged doc vs a delta) — if it prints the whole policy, `renderDiff` (§13) pre/post-processes for the demo (§4.5).
- [ ] `network_middleware` inline-HL pattern rules (README open item §9) — if reachable, a learned *input* pattern (not just a host deny) closes the loop on injection *phrasing*, not only exfil *destination*. Stronger, but nice-to-have; out of v1 scope (§8).
- [ ] Confirm multi-entry (Recursive Intelligence + bounty on one build) before investing — same gate as learning-loop §6 / README §Cross-cutting #10.

---

## 10. Sources (researched 2026-07-18)

- NVIDIA OpenShell — Customize Sandbox Policies: `docs.nvidia.com/openshell/sandboxes/policies` — `policy update` additive/incremental merge vs `policy set` full replace; `--add-deny`, `--add-endpoint`, `--dry-run`, `--wait`; gateway validates merged policy against live; exit codes `0=loaded / 1=validation failed / 124=timeout`; invalid disk YAML → restrictive-default fallback; **Policy Advisor / `policy.local`** agent-proposes / developer-approves-from-outside; `--global` applies to all sandboxes and rejects sandbox-level updates until removed.
- NVIDIA OpenShell — Policy Schema reference: `docs.nvidia.com/openshell/reference/policy-schema` — static (`filesystem_policy`, `landlock`, `process`) vs dynamic (`network_policies`, `network_middlewares`) sections; `network_policies` map-of-named-entries; incremental-merge by key.
- NemoClaw version caveat: GitHub `NVIDIA/NemoClaw` issues #1010, #2039 — live `network_policies` add bugs on older builds; `policy-add` workaround. **Verify version on the box.**

---

# Implementation

## 11. Module layout & files

New code lives in one module + one CLI entry + one sidecar dir. Mirrors the repo's existing shape (`src/<lane>/<thing>.ts`, singleton export, `scripts/<verb>-<thing>.ts` runner, `data/`-style git-tracked artifact).

| Path | Kind | Responsibility |
|---|---|---|
| `src/security/tightening.ts` | new module | The loop: `capture`, `compile`, `conflictCheck`, `applyRule`, `renderDiff`, and the `PolicyTightener` singleton (mirrors `runMemory` in `src/memory/runs.ts`). Pure logic + the OpenShell CLI shell-out; imports the injectable `cli` runner from `nemoclaw.ts`. |
| `src/security/tightening-log.ts` | new module | Append-only sidecar writer/reader for `policies/generated/tightening-log.jsonl` (schema §12). Same fs idiom as `runs.ts` (`readFileSync`/`writeFileSync`, `mkdirSync recursive`). |
| `scripts/policy-tighten.ts` | new CLI | The §6 explicit entrypoint. `tsx scripts/policy-tighten.ts <role>` runs one capture→apply cycle from the latest run's captured signals; `--dry-run` prints the diff only. Added to `package.json` as `"tighten"`. |
| `policies/generated/` | new dir | Holds `tightening-log.jsonl` (git-tracked) + `.gitkeep`. The learned rules themselves live in the live OpenShell policy revision, NOT a file (native merge, §4). |
| `test/adversarial/run.ts` | edit | Replace the `policy-tightening` PENDING row with a live `suitePolicyTightening()` driven through the `cli` seam (§16). |

**Reuse, do not re-import a subprocess runner.** `nemoclaw.ts` already owns the only `child_process.spawn` in the security lane, plus `__setCli`/`__resetCli` and PATH hardening. Export its `cli`-invocation as a small helper (`runOpenshell(args, timeoutMs): Promise<CliResult>`) so `tightening.ts` shells out through the SAME injectable seam the tests fake. Do not add a second spawn site.

---

## 12. Data contracts

### `policies/generated/tightening-log.jsonl` — one JSON object per line, append-only

```jsonc
{
  "ts": "2026-07-19T21:04:11.000Z",  // ISO, when the rule was applied
  "run": "run-a1b2c3",                // the run whose signal produced it (RunRecord.runId when available, else "adhoc")
  "role": "research",                 // sandbox the rule tightened (== nemoclaw sandbox name)
  "detector": "hl:prompt_injection",  // ScanResult category / "openshell:egress_denied" for a pure egress block
  "target": "evil.example",           // host or path glob that got denied
  "kind": "deny_host",                // "deny_host" | "deny_path"
  "direction": "deny",                // ALWAYS "deny" in v1 (§2 invariant)
  "revision": 7,                      // OpenShell policy revision the merge produced (from `policy update --wait` / `policy list`); null if seam/offline
  "sourceCaseId": "poisoned-doc:evil-exfil", // adversarial-corpus id when the signal came from a known attack, else null
  "applied": true                     // false when conflictCheck routed to escalate/reject (row still logged for audit)
}
```

Rationale: JSONL append-only matches `runs.json`'s "single source of truth the dashboard reads" idiom while being cheap to append per-rule. Git-tracked so a judge can `cat` the audit trail.

### In-memory types (see §13 for signatures)

- `CapturedSignal` — the deduped raw material from a run (host/path + detector + source case).
- `TighteningRule` — a compiled, conflict-checked rule ready to apply (the `tightening-log` row minus `revision`/`applied`).
- `ApplyResult` — `{ ok: boolean; revision: number | null; exitCode: number | null; error?: string }`.

---

## 13. Interfaces (TypeScript signatures)

```ts
// src/security/tightening.ts

export type RuleKind = "deny_host" | "deny_path";

export interface CapturedSignal {
  role: string;
  detector: string;      // ScanResult category, or "openshell:egress_denied"
  target: string;        // host or path glob
  kind: RuleKind;
  run?: string;          // RunRecord.runId if the signal is tied to a recorded run
  sourceCaseId?: string; // adversarial corpus id when known
}

export interface TighteningRule extends CapturedSignal {
  direction: "deny";     // §2 invariant — the ONLY legal value in v1
}

export interface ApplyResult {
  ok: boolean;
  revision: number | null;
  exitCode: number | null;
  error?: string;
}

// (1) CAPTURE — turn a dispatch result + its scans into deduped signals.
//     Pulls hosts from AgentResult.deniedEgress and detectors from the
//     prompt/response ScanResult.categories. Pure; no I/O.
export function capture(input: {
  role: string;
  run?: string;
  deniedEgress?: string[];
  scans?: Array<{ categories: string[]; sourceCaseId?: string }>;
  deniedPaths?: string[];
}): CapturedSignal[];

// (2) COMPILE — CapturedSignal[] → TighteningRule[]. Stamps direction:"deny",
//     drops exact duplicates already present in the tightening-log for this role.
export function compile(signals: CapturedSignal[], role: string): TighteningRule[];

// (3) CONFLICT CHECK — §5. Loads the role's required allowlist from the on-disk
//     worker-<role>.yaml and classifies each rule. Never mutates policy.
export function conflictCheck(rule: TighteningRule): "apply" | "escalate" | "reject";

// (4) APPLY — shell out via nemoclaw's injectable cli seam:
//     openshell policy update <role> --add-deny <target> --wait
//     Asserts rule.direction === "deny" first. Reads the resulting revision
//     from `openshell policy list <role> --json`. Fail-closed on non-zero exit.
export function applyRule(rule: TighteningRule): Promise<ApplyResult>;

// (5) DIFF — openshell policy update <role> --add-deny <target> --dry-run,
//     post-processed to a compact before/after string for the dashboard (§4.5).
export function renderDiff(rule: TighteningRule): Promise<string>;

// Orchestrates capture→compile→check→apply→log for one role, honoring §6
// (only runs when explicitly invoked). Returns the applied+escalated rows.
export interface PolicyTightener {
  run(input: Parameters<typeof capture>[0]): Promise<{
    applied: TighteningRule[];
    escalated: TighteningRule[];
    rejected: TighteningRule[];
  }>;
}
export const policyTightener: PolicyTightener;
```

```ts
// src/security/tightening-log.ts
export interface TighteningLogRow { /* the §12 JSONL shape */ }
export function appendRow(row: TighteningLogRow): void;   // mkdir -p + append one line
export function readLog(role?: string): TighteningLogRow[]; // filter by role for dedupe + dashboard
```

```ts
// src/worker/nemoclaw.ts — small addition, reuses the existing injectable `cli`
/** Shell out to OpenShell through the SAME injectable seam dispatch uses (§11). */
export function runOpenshell(args: string[], timeoutMs?: number): Promise<CliResult>;
```

---

## 14. Algorithm (capture → compile → check → apply → prove)

`policyTightener.run()` for one role:

1. **Capture.** `capture()` collects:
   - each host in `AgentResult.deniedEgress` → `{kind:"deny_host", detector:"openshell:egress_denied", target:host}`;
   - each denied path → `{kind:"deny_path", ...}`;
   - for each scan with a non-clean verdict, its `categories` become the `detector` label on the co-located host/path signal (so a `deny_host` carries *why* — `hl:prompt_injection` vs a bare egress denial). No host without a target is emitted.
   Dedupe by `(role, kind, target)`.
2. **Compile.** Stamp `direction:"deny"`. Drop any `(role, kind, target)` already `applied:true` in `readLog(role)` — idempotent; re-running the loop on the same run is a no-op.
3. **Conflict check.** For each rule, `conflictCheck`:
   - `direction !== "deny"` → `reject` (defensive; unreachable in v1).
   - `target` ∈ the role's required allowlist (union of `network_policies.*.endpoints[].host` across `worker-<role>.yaml`) → `escalate` (log `applied:false`, emit an `incident`-style escalation, do NOT apply).
   - else → `apply`.
4. **Apply.** For each `apply` rule: assert `direction==="deny"`, then `runOpenshell(["policy","update",role,"--add-deny",target,"--wait"])`. Map exit code: `0`→loaded, `1`→validation failed (reject, keep prior revision), `124`→timeout (reject). On success read `revision` via `policy list <role> --json`. Fail-closed: any non-zero exit or unparseable output ⇒ `ok:false`, no `applied:true` row.
5. **Log.** `appendRow` for every rule (applied, escalated, rejected) with its outcome — the full audit trail, not just successes.
6. **Prove (demo path, `--dry-run`).** `renderDiff` runs the `--add-deny … --dry-run` merge and returns a compact before/after the dashboard renders. Then the caller re-fires the same attack; the second dispatch's `deniedEgress` still lists the host, but `readLog` now names it — that pairing is the "stricter than 60s ago" claim.

**Never combine `--wait` and `--dry-run`** (§4.5): diff uses `--dry-run` (no gateway), apply uses `--wait` (real merge).

---

## 15. OpenShell CLI contract + injectable seam

Every OpenShell call goes through `runOpenshell(args)` → the injectable `cli` in `nemoclaw.ts`. The exact invocations:

| Purpose | argv | Success signal | Failure posture |
|---|---|---|---|
| Apply one learned deny | `openshell policy update <role> --add-deny <target> --wait` | exit `0` | `1`/`124`/null → reject, keep prior revision |
| Read resulting revision | `openshell policy list <role> --json` | JSON `{revision:N}` | unparseable → `revision:null`, still `ok` if apply was `0` |
| Demo diff (no gateway) | `openshell policy update <role> --add-deny <target> --dry-run` | merged-policy text on stdout | unparseable → show raw text |

**Test seam parity.** The adversarial harness swaps in a fake `cli` via `__setCli(makeSimCli(...))`. Extend `nemoclaw-sim.ts` (`SimScenario`) with:

```ts
policyUpdateExit?: 0 | 1 | 124;   // what `policy update --wait` returns (default 0)
policyRevision?: number;          // what `policy list --json` reports (default prior+1)
dryRunText?: string;              // canned `--dry-run` stdout for renderDiff
```

and handle `openshell policy update` / `openshell policy list` in the sim's `openshell` branch (today it only fakes `policy set`/`policy get`/`inference`). This keeps the whole loop testable with no live gateway — the §8 discipline.

---

## 16. Test plan — wire into the adversarial harness

Replace the `{ name: "policy-tightening", … }` PENDING entry in `test/adversarial/run.ts` (currently absent — it's covered by the spec §3 pending list; add it) with a live `suitePolicyTightening()` that runs entirely through the sim seam, mirroring `suiteDispatchSeam`/`suiteEgress`. Cases:

1. **capture-from-egress** — feed `deniedEgress:["evil.example"]`; assert `capture` yields one `deny_host` signal targeting `evil.example`.
2. **direction-invariant** — assert every compiled `TighteningRule.direction === "deny"`; there is no code path that produces a widen.
3. **apply-success** — sim `policyUpdateExit:0, policyRevision:7`; assert `applyRule` returns `{ok:true, revision:7}` and a `tightening-log` row with `applied:true` is appended.
4. **apply-fail-closed** — sim `policyUpdateExit:1`; assert `{ok:false}`, NO `applied:true` row, prior revision unchanged (validation-failed never loosens).
5. **timeout-fail-closed** — sim `policyUpdateExit:124`; same fail-closed assertion.
6. **conflict-escalates** — target a host that IS in `worker-research.yaml`'s allowlist (`integrate.api.nvidia.com`); assert `conflictCheck → "escalate"`, `applied:false`, worker not stranded.
7. **idempotent** — run the loop twice on the same signal; assert the second run applies nothing (dedupe against `readLog`).
8. **diff-renders** — sim `dryRunText`; assert `renderDiff` returns non-empty before/after text (the demo artifact).

Add to `--mode scan` (offline-safe: no live HL, no live gateway — all via the sim). Exit non-zero on any failure, same as the rest of the harness. This closes the `policy-tightening` gap the harness explicitly tracks (`run.ts` PENDING list / spec §3 open items).

---

## 17. Demo & dashboard wiring

- **Signal source:** the dashboard already subscribes to `nemoclawEvents` (`incident`/`progress`). Add a `tightening` event emitted by `policyTightener.run()` carrying `{role, applied, escalated}` so the panel updates live without polling.
- **Audit panel:** render `readLog(role)` as a table — `ts · detector · target · revision`. This is the "the boundary tightened, here's why" artifact.
- **Diff card:** render `renderDiff` output before/after for the one demo rule (`evil.example`). Highlight that `evil.example` moved from *implicit default-deny* to a *named learned deny*.
- **The 60-second claim:** show the log row's `ts` next to the current wall clock — "stricter than it was 60 seconds ago" is literally the delta.

---

## 18. Build order (each step independently green)

1. **`tightening-log.ts`** + `policies/generated/.gitkeep` — pure fs, unit-testable alone. (§12)
2. **`runOpenshell` export** in `nemoclaw.ts` — one small wrapper over the existing `cli`. (§11)
3. **Sim extension** — `policyUpdateExit`/`policyRevision`/`dryRunText` + `policy update`/`policy list` branches in `nemoclaw-sim.ts`. (§15)
4. **`tightening.ts`** — `capture`→`compile`→`conflictCheck`→`applyRule`→`renderDiff`→`policyTightener`. (§13-14)
5. **`suitePolicyTightening()`** in the harness — the 8 cases. (§16) — this is the acceptance gate.
6. **`scripts/policy-tighten.ts`** + `package.json` `"tighten"` script — the §6 explicit entrypoint.
7. **Dashboard panel** — only if the ladder gate passes and there's time. (§17)

Steps 1-5 are the mechanism and are all offline. Step 7 is the only piece that benefits from a live box, and even it can demo against the sim-produced log.

---

## 19. Acceptance (done-when)

- [ ] A flag in run N produces a `deny` fragment enforced in run N+1 (proven offline via the harness: `capture`→`applyRule`→`readLog` shows the named deny; the second dispatch dies at it). — **the IMPLEMENTATION_PLAN §3.1 done-when.**
- [ ] The widen path requires out-of-sandbox human approval — i.e. no auto-loosen code path exists; `direction` is provably always `"deny"` (harness case 2). — **plan §3.1 done-when.**
- [ ] `npm run adversarial -- --mode scan` includes `policy-tightening` as a **run** (not pending) suite, all cases pass, offline, in <90s.
- [ ] `policies/generated/tightening-log.jsonl` is git-tracked and carries provenance (`detector` + `run`) for every applied rule.
- [ ] Fail-closed proven: `policyUpdateExit` `1` and `124` both leave the prior revision intact and write no `applied:true` row (harness cases 4-5).
- [ ] Conflict check prevents self-strangling: a rule colliding with a role's required allowlist escalates, never applies (harness case 6).
- [ ] The loop is off by default and never runs inside the timed store-launch series (§6) — verified: no orchestrator call site; only `scripts/policy-tighten.ts` / `POLICY_TIGHTENING=1` invoke it.
