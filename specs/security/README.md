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

---

## Corrections these specs make to PLAN / stubs / kickoff

- **`NEMOCLAW_PROVIDER=build` → `routed`**; `NEMOCLAW_YES=1` is not real; NVIDIA key is `nvapi-` prefix, model `nvidia/nemotron-3-super-120b-a12b`. (spec 2 §1)
- **HiddenLayer is OAuth2 client-credentials, not a bearer API key**; endpoint is `/detection/v1/interactions`, not `/v1/scan`; needs `hl-project-id` header. (spec 1 §1)
- **No `inference` section exists in the OpenShell policy YAML** — inference routes via `openshell inference set`, out-of-band. Plan's "policy C = inference" is wrong. (spec 3 §1)
- **Credentials are handled per-endpoint** (`request_body_credential_rewrite` + `openshell:resolve:env:KEY`), so workers never hold raw secrets — this is both the vault boundary and why the poisoned-doc demo's exfil has nothing to steal. (spec 3 §1, spec 4 §2)
- **Worker model I/O bypasses the gate in `nemoclaw` mode** — sandbox inference never hits harness `guarded()`. Fix: `dispatch()` scans the sandbox boundary (prompt in, completion out) and **document ingest is harness-brokered**, not a sandbox egress, so every ingested doc hits `scan()`. Without this the demo mode that maxes the NemoClaw bounty mins HiddenLayer depth. (spec 2 §6.1, spec 3 §3, spec 4 §1)
- **Blunt `access: read-write` is the "global block" judges warn against** — StoreBuilder uses path-level `rules`/`deny_rules` (allow products/collections, **deny customers/orders/price**) = allow-with-boundary inside an allowed host. This is the "non-trivial policy" criterion. (spec 3 §4)
- **CEO Slack Socket Mode is an outbound websocket**, not REST — CEO sandbox needs a `protocol: websocket` egress + `websocket_credential_rewrite`, or it can't talk to Slack the moment it runs contained. (spec 5 §3, §6)

---

## Design decisions locked across specs

- **Prompt-injection → `flagged` (Slack approve/deny), NOT auto-`blocked`.** Reserve hard `blocked` for exfil/critical. This is what makes the poisoned-doc demo show BOTH tiers (human escalation AND independent policy block). (spec 1 §5, spec 4 §3)
- **Default-deny egress** is the independent second kill point — an allowlist per role, nothing else reachable. (spec 3 §2)
- **Never trust CLI exit codes** (NemoClaw exits 0 on failure) — assert health via `status --json` + inference smoke test. (spec 2 §5)
- **One choke point, one spawn function** — maximize instrumentation depth + keep Adrian's interface stable. (spec 1, spec 2 §6)
- **No agent runs uncontained — the boss too.** CEO sits in its own OpenShell sandbox; spawn goes through a host broker (schema-validated `AgentSpec`), not the CEO reaching the gateway directly. (spec 5 §1, §2a)
- **`local` mode is break-glass only** — dev/test + demo-survival. A `local` fallback during a secure run fails loud + shows a red UNCONTAINED badge, never a silent downgrade. (spec 6)
- **Heartbeat must be visible on screen** for claw-agent eligibility — after the poisoned-doc block, the CEO's next heartbeat tick reacts autonomously (no human prompt). (spec 4 §3, Hackathon_Docs §What is a Claw Agent)

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
4. **Poisoned-doc demo** assembled, run 3× for reliability.

Everything above is boring-and-working by design. Judges give 15 pts for "completes core workflow without crashing."
