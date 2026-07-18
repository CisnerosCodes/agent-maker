# Spec — Policy-Tightening Loop (flag → boundary, self-improvement)

Status: **spec only, planning mode — no code/files until flag lifted.**
Owner: Sky (security lane). Track crossover: **Recursive Intelligence × NemoClaw/OpenShell bounty.**
Depends on: `hiddenlayer-gate.spec.md` §5 (verdict + raw findings), `openshell-policy.spec.md` §2/§4/§5 (allowlist + deny_rules schema), `learning-loop.spec.md` §3 (capture→compound→retrieve), `poisoned-doc-demo.spec.md` §2 (the attack that generates the first signal).

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

---

## 3. What signal drives it (why HiddenLayer, not just OpenShell)

OpenShell already emits `policy_denied` for a blocked egress — that alone tells you *a* host was hit. HiddenLayer adds the part worth compounding: **the pattern.**

| Source | Signal | Compiles into |
|---|---|---|
| OpenShell audit log | distinct hosts that hit default-deny | `deny_hosts` fragment (egress allowlist stays default-deny; this is belt-and-suspenders + makes the block *named* in the policy, not just implicit) |
| HiddenLayer `raw` findings (gate §5) | detector name + the injection **phrasing** that scored | candidate input-scan rule / `network_middleware` pattern, and a new `injections.jsonl` corpus row (feeds `adversarial-harness.spec.md` §4) |
| OpenShell audit log | path a role tried and was denied (StoreBuilder → `/orders`) | tighter `deny_rules` path glob (policy §4) |

So the loop's inputs are exactly the two kill points of the poisoned-doc demo (poisoned-doc §2) — the attack that proves the boundary is also the attack that *teaches* it. That symmetry is the pitch.

---

## 4. Mechanism (capture → compile → apply)

> **Confirmed against OpenShell docs (2026-07-18) — the merge is native, do NOT hand-splice YAML.** `openshell policy update` performs **additive merges** into the live `network_policies` (dynamic section): *"merge network policy changes into the current live policy instead of replacing the whole YAML document… only updates the dynamic `network_policies` section."* `--add-deny` appends a deny rule to an existing endpoint; `--add-endpoint` creates-or-merges a rule for a host/port. All flags in one invocation run as *"one merge batch"* and persist *"at most one new policy revision."* So the tightening loop emits **`policy update --add-deny …` calls**, not a merged file. (Sources §10.)

Per-run, out of band from the timed task (see §6):

1. **Capture** — after run N, read the security audit log (same log the learning loop already consumes, README spec-7 note) for: denied egress hosts, `flagged`/`blocked` HL findings + phrasings, denied paths. Dedupe.
2. **Compile** — translate each distinct signal into a `policy update` batch: `--add-deny` for a learned host/path, `--add-endpoint` if a new named entry is needed. Because a CLI merge won't preserve inline YAML comments, record **provenance in a sidecar** — `policies/generated/tightening-log.jsonl`, one row per applied rule (`{run, detector, host/path, revision}`). Git-track the sidecar; it is the audit trail and the demo narration source.
3. **Apply + validate (open item RESOLVED)** — run the batch with `--wait`. The CLI validates argument shapes locally, then *"the gateway validates the merged policy against the current live policy"* before it loads. Exit codes are the gate: **`0 = loaded, 1 = validation failed, 124 = timeout`** (`policy set` codes; `policy update --wait` blocks until the sandbox reports `loaded`/`failed`, confirm via `openshell policy list <name>`). Never proceed to N+1 on a non-zero exit. Invalid disk YAML falls back to a restrictive default (fail-closed) — a broken fragment tightens, never loosens.
4. **Prove** — `openshell policy update --dry-run` *"shows the merged policy locally and does not call the gateway"* → capture that as the before/after **on-screen diff artifact**. Then re-fire the same attack under N+1's policy and show it now dies at the *named learned deny*, not the implicit default-deny. (`--wait` and `--dry-run` cannot be combined — dry-run for the visual, real run with `--wait` to apply.)

**Global-policy caveat (confirmed):** the tightening loop is **per-sandbox** — do NOT use `policy set --global`. A global policy *"is applied in full for all sandboxes"* and *"sandbox-level policy updates are rejected until the global policy is removed."* A `--global` baseline would silently block every `policy update` the loop issues. (Sources §10.)

---

## 5. Conflict / safety check before apply

A generated `deny` is applied only if all hold:

- **Direction:** it is a `deny`/narrowing, never a widen (§2). A computed widen → route to Slack approve/deny instead.
- **No legitimate-work collision:** the denied host/path is not in any role's *required* allowlist (cross-check `worker-*.yaml`). If it collides, the detection is a false-positive candidate → surface for human review, don't auto-apply (prevents the loop from strangling its own workers).
- **Validates:** merged policy passes `openshell policy validate` (README open item §8 sub-shape).
- **Provenance recorded:** every entry carries the run + detector that produced it, so a human can audit *why* the boundary tightened.

---

## 6. Determinism firewall (do not break the learning demo)

The learning-loop entry is judged on a **speed delta across runs with the task held constant** (learning-loop §5.2 "vary nothing between runs"). A policy that mutates mid-series would confound that measurement and could make the poisoned-doc demo non-reproducible.

Rule: **policy-tightening is a separately narrated capability, run on its own attack sequence — not folded into the timed store-launch runs.** The store-launch series that produces the speed delta runs under a *frozen* policy. The tightening loop runs as its own 2-run beat: run 1 = attack lands + is flagged; run 2 = attack dies at the learned rule. Two demos, two claims, no cross-contamination.

---

## 7. Demo beat (~45s, ladder-gated)

1. Run 1: poisoned doc → HiddenLayer flags → (approve, to let it reach egress) → OpenShell default-deny blocks `evil.example`. Same as poisoned-doc §3.
2. Show the loop capturing it: `deny-learned.yaml` now has `# run 1 · learned` → `evil.example` as a *named* deny.
3. Run 2: same attack → dies at the **named learned rule**, and the dashboard shows the policy is stricter than it was 60 seconds ago. Narrate: *"It didn't just remember — it moved the lesson into the boundary. A compromised agent can't un-learn a deny_rule."*
4. Land the crossover: *"That's Recursive Intelligence where it matters for security — the containment compounds, not just the capability."*

---

## 8. Scope discipline

- **Stretch, not critical path.** Flag at the Sat 7 PM ladder check (PLAN §The Ladder). Build only if both money demos run 3× clean. Core submission stands without it.
- **Tightening only for v1.** Auto-loosening is explicitly out of scope for the hackathon — the human-approved loosen path is described (§2) but need not be built; "we only automate the safe direction" is itself a defensible design statement to judges.
- **One generated fragment, one role, for the demo.** Prove the mechanism on the Research→`evil.example` case. Generalizing across all roles is post-hackathon.

---

## 9. Open items

- [x] **RESOLVED (2026-07-18):** OpenShell supports layered/merged policies natively — `policy update` additive-merges into live `network_policies`; no hand-spliced file. Provenance moves to a sidecar log (§4.2). (Sources §10.)
- [x] **RESOLVED (2026-07-18):** the merged policy IS validated pre-load — gateway validates the merge against the live policy; `--wait` + exit codes `0/1/124` gate it (§4.3). (Sources §10.)
- [ ] Confirm the **NemoClaw version floor** for live `network_policies` updates — GitHub NemoClaw issues #1010 / #2039 report older builds duplicating the `network_policies` block / emitting invalid YAML on live add, with a `policy-add` workaround. Verify the box's `nemoclaw --version` supports clean `policy update` before relying on the loop. (Sources §10.)
- [ ] Confirm `--dry-run` output is diff-friendly enough to show on screen (full merged doc vs a delta) — if it prints the whole policy, pre/post-process for the demo (§4.4).
- [ ] Decide the capture source of truth: the harness `report/` artifacts (`adversarial-harness.spec.md` §5) vs the live security audit log — prefer the audit log so the loop works outside a test run.
- [ ] `network_middleware` inline-HL pattern rules (README open item §9) — if reachable, a learned *input* pattern (not just a host deny) closes the loop on injection *phrasing*, not only exfil *destination*. Stronger, but nice-to-have.
- [ ] Confirm multi-entry (Recursive Intelligence + bounty on one build) before investing — same gate as learning-loop §6 / README §Cross-cutting #10.

---

## 10. Sources (researched 2026-07-18)

- NVIDIA OpenShell — Customize Sandbox Policies: `docs.nvidia.com/openshell/sandboxes/policies` — `policy update` additive/incremental merge vs `policy set` full replace; `--add-deny`, `--add-endpoint`, `--dry-run`, `--wait`; gateway validates merged policy against live; exit codes `0=loaded / 1=validation failed / 124=timeout`; invalid disk YAML → restrictive-default fallback; **Policy Advisor / `policy.local`** agent-proposes / developer-approves-from-outside; `--global` applies to all sandboxes and rejects sandbox-level updates until removed.
- NVIDIA OpenShell — Policy Schema reference: `docs.nvidia.com/openshell/reference/policy-schema` — static (`filesystem_policy`, `landlock`, `process`) vs dynamic (`network_policies`, `network_middlewares`) sections; `network_policies` map-of-named-entries; incremental-merge by key.
- NemoClaw version caveat: GitHub `NVIDIA/NemoClaw` issues #1010, #2039 — live `network_policies` add bugs on older builds; `policy-add` workaround. **Verify version on the box.**
