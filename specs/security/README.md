# Security Lane — Spec Index (Sky)

Status: **planning mode — specs only, no code until flag lifted.**
Scope: the security-lane deliverables + the cross-cutting open items and Friday-night ordering. Adrian's plumbing (Slack card, dashboard, Factory) consumes these via stable interfaces — none of his code depends on internals here.

---

## The specs

Core four (Adrian-facing dependencies):

| # | Spec | Delivers | Adrian's dependency |
|---|---|---|---|
| 1 | [`hiddenlayer-gate.spec.md`](./hiddenlayer-gate.spec.md) | Real HiddenLayer Runtime Security in `SecurityGate` — OAuth flow, `/detection/v1/interactions`, verdict routing | `scan()`/`guarded()` signatures unchanged — his harness untouched |
| 2 | [`nemoclaw-spawn.spec.md`](./nemoclaw-spawn.spec.md) | Non-interactive NemoClaw worker spawn behind one function (`spawnWorker`/`dispatch`/`workerStatus`); **`dispatch` scans across the sandbox boundary** (§6.1) | Unblocks his `factory.ts` spawn TODO (~line 36) |
| 3 | [`openshell-policy.spec.md`](./openshell-policy.spec.md) | Real OpenShell policy schema; `worker-research.yaml` (harness-brokered ingest, inference-only egress) + `worker-storebuilder.yaml` (path-level `deny_rules`) | Factory passes `policyPath` into `spawnWorker` |
| 4 | [`poisoned-doc-demo.spec.md`](./poisoned-doc-demo.spec.md) | The attack money demo — dual block (HiddenLayer + OpenShell), scores both bounties | His `onFlagged` callback renders the Slack card |

Supporting (threat-model + track coverage):

| # | Spec | Delivers | Note |
|---|---|---|---|
| 5 | [`ceo-sandbox.spec.md`](./ceo-sandbox.spec.md) | CEO runs contained too (`role: ceo`), spawn-broker decision, Slack Socket Mode websocket egress | closes threat-model gap #2 (uncontained boss) |
| 6 | [`worker-mode-containment.spec.md`](./worker-mode-containment.spec.md) | `nemoclaw` vs `local` mode ruling — `local` is break-glass, loud UNCONTAINED badge, never silent | dashboard shows the badge |
| 7 | [`learning-loop.spec.md`](./learning-loop.spec.md) | Recursive Intelligence entry — metric delta + capture→compound→retrieve mechanism; agent learns its own containment boundaries | co-focus track per PLAN; reuses security audit logs |
| 8 | [`adversarial-harness.spec.md`](./adversarial-harness.spec.md) | Automated adversarial test harness — one runner + assertions over the per-spec §Test-plans; reliability insurance + demo artifact generator + injection-phrasing selection | consolidates gate §7, poisoned-doc §5, learning-loop §5; drives `scan()`/sandbox directly, not his plumbing |
| 9 | [`policy-tightening-loop.spec.md`](./policy-tightening-loop.spec.md) | Self-improvement that moves a flag from agent goodwill into the hard boundary — run N+1 policy is stricter; tighten-auto / loosen-manual | Recursive Intelligence × NemoClaw crossover; generated `deny` fragment, dashboard shows the YAML diff |
| 10 | [`ceo-heartbeat.spec.md`](./ceo-heartbeat.spec.md) | The autonomous reconcile loop — a real heartbeat clock (separate from the task ticker) that reacts to `blocked`/`failed`/`done` with no human prompt; the claw-agent eligibility beat | **Adrian implements** (CEO harness); Sky owns the security-event rows |
| 11 | [`worker-capability.spec.md`](./worker-capability.spec.md) | **The agent-creation gap** — role→executable work: execution classes, one generic executor, the unspecced `worker-minimal.yaml`, the handoff/output contract, and vault→policy→gateway credential wiring. Kills the ghost-worker problem (strategist/analyst) | **Adrian implements** the executor; Sky owns capability=security surface |
| 12 | [`factory-provisioning.spec.md`](./factory-provisioning.spec.md) | Reconciles `createAgent` (per-hire) with per-role sandboxes (spawn spec): sandbox-per-role + session-per-task, cross-goal workspace isolation, terminate/revoke path (delivers vault "REVOCABLE"), concurrency refusal | Retires `renderPolicy` (C13); Factory health-gates + mints sessions |
| 13 | [`ceo-brain-and-spawn-authority.spec.md`](./ceo-brain-and-spawn-authority.spec.md) | The injected-goal defense: (A) the spawn-authority table that makes `ceo-sandbox` §5.1 real (role × allowed creds × policy), (B) the scripted-vs-model CEO decision. Part A is the boundary; the CEO's goodwill is not | Part A ships regardless (deterministic broker); Part B ladder-gated |

---

## Related (cross-cutting specs, outside the security lane)

Written 2026-07-18 from the code + plan quality review. Not security-lane-owned, but
they govern how these specs reach the demo:

- [`../demo/demo-recovery-runbook.spec.md`](../demo/demo-recovery-runbook.spec.md) — on-stage failure recovery for both money demos (graceful degradation before the backup tape).
- [`../integration/readiness-and-cut-gates.spec.md`](../integration/readiness-and-cut-gates.spec.md) — integration ownership, the timed end-to-end dry-run gate, and bounty cut-decision gates.
- [`../fixes/code-fixes.spec.md`](../fixes/code-fixes.spec.md) — corrections to shipped code (fail-open gate, escalation timeout, HL-per-message quota, recall collision, containment badge, …).
- [`../fixes/plan-fixes.spec.md`](../fixes/plan-fixes.spec.md) — corrections to the planning docs (Apify load-bearing decision, fail-closed on the timeline, HL call budget, integration owner).

---

## Corrections these specs make to PLAN / stubs / kickoff

- **`NEMOCLAW_PROVIDER=build` → `routed`**; `NEMOCLAW_YES=1` is not real; NVIDIA key is `nvapi-` prefix, model `nvidia/nemotron-3-super-120b-a12b`. (spec 2 §1)
- **HiddenLayer is OAuth2 client-credentials, not a bearer API key**; endpoint is `/detection/v1/interactions`, not `/v1/scan`; needs `hl-project-id` header. (spec 1 §1)
- **No `inference` section exists in the OpenShell policy YAML** — inference routes via `openshell inference set`, out-of-band. Plan's "policy C = inference" is wrong. (spec 3 §1)
- **Credentials are handled per-endpoint** (`request_body_credential_rewrite` + `openshell:resolve:env:KEY`), so workers never hold raw secrets — this is both the vault boundary and why the poisoned-doc demo's exfil has nothing to steal. (spec 3 §1, spec 4 §2)
- **Worker model I/O bypasses the gate in `nemoclaw` mode** — sandbox inference never hits harness `guarded()`. Fix: `dispatch()` scans the sandbox boundary (prompt in, completion out) and **document ingest is harness-brokered**, not a sandbox egress, so every ingested doc hits `scan()`. Without this the demo mode that maxes the NemoClaw bounty mins HiddenLayer depth. (spec 2 §6.1, spec 3 §3, spec 4 §1)
- **Blunt `access: read-write` is the "global block" judges warn against** — StoreBuilder uses path-level `rules`/`deny_rules` (allow products/collections, **deny customers/orders/price**) = allow-with-boundary inside an allowed host. This is the "non-trivial policy" criterion. (spec 3 §4)
- **CEO Slack Socket Mode is an outbound websocket**, not REST — CEO sandbox needs a `protocol: websocket` egress + `websocket_credential_rewrite`, or it can't talk to Slack the moment it runs contained. (spec 5 §3, §6)
- **Canonical credential name is `SHOPIFY_ADMIN_TOKEN`, not `SHOPIFY_TOKEN`** — specs 3/4 wrote the short form; shipped code + `.env.example` use the long form. A placeholder that doesn't match the host env var fails resolution silently (401 mid-demo). One name table in spec 11 §5. (spec 3 §1, spec 11 §5, code-fixes C-naming)
- **`spec.credentials`/`spec.tools` are decorative until wired** — nothing derives sandbox capability from them; policies are hand-authored and workers read env directly. Spec 11 §5 defines the vault→policy→gateway wiring so `credentials: []` becomes true by construction and a listed credential is one the agent actually holds. Research must DROP `APIFY_TOKEN` (broker ingest moved it host-side). (spec 11 §5, code-fixes C15)
- **The old `actions: {spend, destructive}` policy control has no real-schema home** — re-expressed as `deny_rules` on cost-bearing paths + the `policy.local` human-approved loosen; there is no per-action spend flag. Any PLAN/README line promising an `actions: spend` gate points here. (spec 3 §1.3, spec 9 §2)
- **Ghost workers in 2 of 3 playbooks** — `strategist`/`analyst` had no real execution path anywhere, and the fallback playbook (every off-script goal) is exactly where they land. Spec 11 §1 gives every role an execution class; pure-LLM roles become real with one prompt each. (spec 11 §1)

---

## Design decisions locked across specs

- **Prompt-injection → `flagged` (Slack approve/deny), NOT auto-`blocked`.** Reserve hard `blocked` for exfil/critical. This is what makes the poisoned-doc demo show BOTH tiers (human escalation AND independent policy block). (spec 1 §5, spec 4 §3)
- **Default-deny egress** is the independent second kill point — an allowlist per role, nothing else reachable. (spec 3 §2)
- **Never trust CLI exit codes** (NemoClaw exits 0 on failure) — assert health via `status --json` + inference smoke test. (spec 2 §5)
- **One choke point, one spawn function** — maximize instrumentation depth + keep Adrian's interface stable. (spec 1, spec 2 §6)
- **No agent runs uncontained — the boss too.** CEO sits in its own OpenShell sandbox; spawn goes through a host broker (schema-validated `AgentSpec`), not the CEO reaching the gateway directly. (spec 5 §1, §2a)
- **`local` mode is break-glass only** — dev/test + demo-survival. A `local` fallback during a secure run fails loud + shows a red UNCONTAINED badge, never a silent downgrade. (spec 6)
- **Heartbeat must be visible on screen** for claw-agent eligibility — after the poisoned-doc block, the CEO's next heartbeat tick reacts autonomously (no human prompt). (spec 4 §3, Hackathon_Docs §What is a Claw Agent)
- **Two kinds of self-improvement, kept separate.** Behavioral learning (lesson in the agent prompt/`MEMORY.md`, makes it *faster*) vs boundary learning (lesson in a generated OpenShell `deny`, makes it *safer* — survives a compromised agent). Spec 7 is the first; spec 9 adds the second. (spec 9 §1)
- **Tighten auto, loosen manual.** Policy self-tightening automates only the safe direction (adding a `deny` via `openshell policy update --add-deny`, native additive merge — confirmed); any computed widen goes through OpenShell **Policy Advisor / `policy.local`** (agent proposes, developer approves from outside the sandbox — native human-in-the-loop). (spec 9 §2, §4; openshell-policy §2)
- **The test harness must never mutate what it tests.** Adversarial harness is read-only against the boundary and deterministic; policy tightening is the separate spec-9 loop. A test that changes state can't be re-run for reliability. (spec 8 §6, spec 9 §6)
- **The spawn-authority table is the trust boundary, not the CEO's goodwill.** Even a fully prompt-injected CEO can only emit `AgentSpec`s; a deterministic, non-LLM host broker validates every one against a fixed role×credentials×policy table and creates no out-of-authority agent. This is what makes the "inject the boss" defense real regardless of whether the CEO brain is scripted or model-driven. (spec 13 Part A, spec 5 §5.1)
- **A role that has no execution class does not ship in a playbook.** Every worker role maps to broker-ingest / tool-workflow / pure-LLM (spec 11 §1); pure-LLM roles become real for the price of a prompt, so no playbook ships a ghost worker. Capability is provisioned as deliberately as containment. (spec 11 §1-2)
- **Durable unit = role sandbox; per-hire unit = agent record + task session.** The Factory does not create a sandbox per hire — it health-checks the pre-baked role sandbox and mints a per-task session with an isolated workdir (spec 12). This reconciles `createAgent` with the per-role spawn model and prevents cross-goal workspace contamination. (spec 12 §1-3)
- **Captured injection phrasings never re-enter a prompt.** Behavioral learning stores detector-name + hash for `injection-seen` lessons (never the raw string) and `scan()`s retrieved memories before use; a phrasing legitimately becomes a *rule* only via the boundary-learning path (enforced outside the agent), never fed back as prompt context. (spec 7 retrieval-hazard note, spec 9)

---

## Cross-cutting open items (confirm Friday night, in the portal/on the box)

1. **HiddenLayer:** exact auth host + token path; V1 interactions request/response field names. (spec 1 §8) — needs portal, event code `AITX-2026`.
2. **NemoClaw:** verified exact non-interactive onboard invocation → hand to Adrian. (spec 2 §8)
3. **Inference egress:** does routed NVIDIA inference exit via the gateway (no policy entry) or must the sandbox allowlist `integrate.api.nvidia.com:443`? Blocks finalizing both policies. (spec 2 §8, spec 3 §6)
4. **Credential placeholder syntax** for header creds (Shopify `X-Shopify-Access-Token`, Apify bearer). (spec 3 §6)
5. **Static-policy wiring:** does `nemoclaw onboard` take `--policy <file>` for fs/process sections, or author separately? Affects spawn Phase A order. (spec 2 §8, spec 3 §6)
6. **Sibling-spawn from a sandbox:** can the CEO sandbox create workers via the gateway, or must spawn stay on the host broker? Decides CEO policy shape. (spec 5 §6)
7. **Slack websocket egress:** does OpenShell support `protocol: websocket` for Socket Mode's persistent `wss://`? If not, fall back to Events API HTTP or a host Slack-broker. (spec 5 §6)
8. **`rules`/`deny_rules` sub-shape** (`methods` + `path` glob?) — validate against `openshell policy validate` for the Shopify PII boundary. (spec 3 §4, §6)
9. **HiddenLayer-in-egress stretch:** can `network_middlewares` (`fail_closed`, max 10) call HiddenLayer inline to scan in-sandbox tool I/O? Closes the last instrumentation gap; NOT on the critical path. (spec 2 §6.1, spec 3 §6)
10. **Multi-entry:** confirm a single build may enter Recursive Intelligence track AND HiddenLayer track/bounties — decides learning-loop investment. (spec 7 §6)

---

## Friday-night execution order (when flag lifts)

Highest-risk-first, per plan §Risks:

1. **NemoClaw ONE worker alive** (hosted, non-interactive) + symlink `openshell` into PATH (#4224). → unblocks Adrian immediately.
2. **HiddenLayer key + gate wired**, verify a known injection string flags.
3. **Policies to real schema**, tested adversarially from inside the sandbox.
4. **Poisoned-doc demo** assembled, run 3× for reliability — mechanize the "run 3×" as the adversarial harness (spec 8) once the pieces exist; it emits the demo capture artifacts too.

Everything above is boring-and-working by design. Judges give 15 pts for "completes core workflow without crashing."

**Ladder-gated (build only if core is green — Sat 7 PM check):** spec 8 red-team-agent stretch (§7), spec 9 policy-tightening loop. Neither is on the critical path; the submission stands without them. Spec 9 is the highest-value ladder rung — it's the Recursive-Intelligence × NemoClaw crossover no other team is likely to show.
