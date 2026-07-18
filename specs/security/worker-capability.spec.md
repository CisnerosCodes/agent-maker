# Spec — Worker Capability & Execution (role → executable work)

Status: **spec only, planning mode — no code until flag lifted.**
Owner: Sky drafts (capability = security surface); **Adrian implements** the executor (worker loop owner). Consumers: Factory, orchestrator, dashboard, both money demos.
Depends on: `nemoclaw-spawn.spec.md` §6 (`dispatch` transport), `openshell-policy.spec.md` §2 (schema), `factory-provisioning.spec.md` (sibling spec — provisioning side of the same pipeline).

> Why this exists (deep review 2026-07-18, agent-creation axis): `dispatch(role,
> taskId, prompt)` is **transport**, not capability. Nothing defines how a role
> becomes executable work: no role→prompt construction, no in-sandbox toolset
> contract, no structured-output/handoff contract, and no policy for the three
> roles on `worker-minimal.yaml`. Concretely: `strategist` and `analyst` have no
> real path planned anywhere — **2 of 3 playbooks (including the fallback that
> catches every off-script goal) stay ghost even in the planned end-state.** The
> containment lane is thoroughly specced; the thing being contained is not.

---

## 1. Role execution classes (every role must belong to exactly one)

| Class | Roles | Real path | Sandbox needs |
|---|---|---|---|
| **broker-ingest** | research | harness fetches + `scan()`s external data (nemoclaw-spawn §6.1), passes text in; sandbox model summarizes | inference egress only (openshell-policy §3) |
| **tool-workflow** | store-builder | sandbox agent drives allowlisted API calls (Shopify) from a task prompt | tool egress + inference (openshell-policy §4) |
| **pure-LLM** | copywriter, strategist, analyst | single `dispatch`: prompt in (objective + upstream output), completion out | inference egress only — `worker-minimal.yaml`, §3 below |

Rule: **a role with no execution class does not ship in a playbook.** Adding a
role to `src/roles/library.ts` = adding its class + policy here first. This makes
`strategist`/`analyst` real for the price of a prompt each (they are pure-LLM —
the cheapest class), and kills the ghost-worker problem in the fallback playbook.

---

## 2. Generic executor (replaces the per-role `runReal` branches)

One path for every role, harness-side:

```
buildPrompt(role, objective, upstreamOutput)   // from RoleTemplate, see below
  → scan(prompt, "user_prompt")                // gate, existing
  → dispatch(role, taskId, prompt)             // nemoclaw-spawn §6 (or local-mode brain)
  → scan(completion, "model_response")         // gate, existing
  → parseOutput(role, completion)              // §4 handoff contract
  → task.outputData                            // consumed by dependents
```

`RoleTemplate` (src/roles/library.ts) gains two fields:

```ts
promptFor: (ctx: PlanContext, upstream: unknown) => string;  // role's task prompt
outputSchema: "products" | "text" | "url";                   // §4 contract tag
```

- `research` and `store-builder` keep their specialized pre/post steps (broker
  ingest; Shopify calls) but route model I/O through the same executor.
- Pure-LLM roles need **only** these two fields to become real — no new branch in
  the orchestrator. That is the acceptance test for "generic": adding `analyst`'s
  real path touches `library.ts` only.

---

## 3. `policies/worker-minimal.yaml` (new — the unspecced third policy)

Pure-LLM roles. Strictest worker policy: inference egress or nothing.

```yaml
version: 1

filesystem_policy:
  include_workdir: true
  read_only:
    - /usr/lib/**
    - /usr/local/lib/**
  read_write:
    - /workspace/**
    - /tmp

process:
  run_as_user: sandbox
  run_as_group: sandbox

landlock:
  compatibility: best_effort

network_policies:
  # If routed inference exits via the localhost gateway (open item, openshell-policy
  # §6), DELETE this entry — the pure-LLM sandbox then has ZERO direct egress,
  # which is the strongest containment statement in the whole fleet: "the
  # copywriter cannot reach the network at all."
  nvidia_inference:
    name: nvidia-inference
    endpoints:
      - host: integrate.api.nvidia.com
        port: 443
        protocol: rest
        enforcement: enforce
        access: read-write
        request_body_credential_rewrite: true
    binaries:
      - path: /usr/local/bin/openclaw
      - path: /usr/bin/node
```

Everything else default-deny. No tool endpoints, no credentials issued
(`spec.credentials: []` is now *true by construction*, not by accident).

---

## 4. Handoff contract (dependency edges carry data, not just timing)

Today `task.outputData` is written but never read by dependents; upstream output
flows through orchestrator-private maps. Contract:

1. **Schema per edge.** Each `outputSchema` tag has one validator, harness-side:
   - `products`: non-empty array of `{ title: string, price: number, image? }`
   - `text`: non-empty trimmed string
   - `url`: parseable https URL
2. **Validate before feeding downstream.** A dependent task reads its upstream's
   `task.outputData` (not a side map); the executor validates against the tag
   **before** building the dependent's prompt. Validation failure = upstream task
   marked failed → existing goal-halt path. This kills the current silent-empty
   bug (copywriter "succeeds" on zero products).
3. **Empty-input guard.** `[]` / `""` never crosses an edge silently.
4. **Scanned like any ingest.** Upstream output entering a downstream prompt is
   already `scan()`ed as `model_response` at production time; no second scan
   needed — but it must not bypass the prompt scan when embedded (§2 order).

---

## 5. Credential wiring (vault → policy → gateway; closes the dead end)

`spec.credentials` is decorative in code today AND in the planned end-state:
vault issues `env:KEY` refs nothing consumes; policies hand-name placeholders;
nobody owns gateway env registration. Three fixes, one table:

1. **Canonical name table (single source of truth).** One name per credential
   across vault, policy YAML, `.env`, and docs. Current mismatch is a live bug:
   openshell-policy §4 + poisoned-doc §1 say `SHOPIFY_TOKEN`; `vault.ts` +
   `worker.ts` say `SHOPIFY_ADMIN_TOKEN`. **Decision: `SHOPIFY_ADMIN_TOKEN`
   everywhere** (matches shipped code + `.env.example`; edit the two specs).

   | Canonical env name | Held by | Placeholder in policy | Roles |
   |---|---|---|---|
   | `SHOPIFY_ADMIN_TOKEN` | gateway env (host) | `openshell:resolve:env:SHOPIFY_ADMIN_TOKEN` | store-builder |
   | `APIFY_TOKEN` | **harness only** (broker ingest — never issued to a sandbox; see cross-ref below) | — none — | none |
   | `NVIDIA_API_KEY` | gateway env (host) | `openshell:resolve:env:NVIDIA_API_KEY` | all (inference) |
   | `SLACK_APP_TOKEN` / `SLACK_BOT_TOKEN` | gateway env (host) | `openshell:resolve:env:SLACK_*` | ceo |

2. **Gateway registration step** (Friday night, after `nemoclaw onboard`): export
   the table's host-held vars in the gateway's environment so `openshell:resolve:env:*`
   resolves. Owner: Sky. Verify: `cred-hygiene` suite (adversarial-harness §3) —
   placeholder visible in-sandbox, raw secret absent, **and the rewritten request
   actually authenticates** (one 200 from Shopify via the sandbox).
3. **Spawn-time assertion.** `spawnWorker` fails loud (`status: "failed"`) if a
   policy placeholder references an env var the host does not have. A missing
   secret must fail at provision, not as a silent 401 mid-demo.

**Cross-ref / consequence:** harness-brokered ingest (nemoclaw-spawn §6.1) moved
the Apify fetch host-side, so **`APIFY_TOKEN` must be removed from the research
role's `credentials` list** in `library.ts` and from its dashboard "identity
issued" line — otherwise `spec.credentials` overclaims and a judge poking the
cred-hygiene story finds a listed credential the agent never holds. (Also
code-fixes C15.)

---

## 6. Test plan

1. **Ghost-role kill:** run the fallback playbook (`"research the drone market"`)
   with a brain available → `analyst` produces a real model-written brief (not
   `milestoneMsg` canned text); bus `finding` contains model output.
2. **Generic executor proof:** add a scratch role with only `promptFor` +
   `outputSchema` → it runs real with zero orchestrator changes.
3. **Handoff validation:** force research to return `[]` → dependent tasks do NOT
   start; upstream marked failed; goal halts honestly.
4. **Minimal-policy containment:** from inside a `worker-minimal` sandbox, attempt
   any egress except inference → `policy_denied`.
5. **Credential resolution:** store-builder POST via sandbox → 200 from Shopify,
   raw token absent in sandbox (cred-hygiene), placeholder present.
6. **Missing-secret fail-loud:** unset `SHOPIFY_ADMIN_TOKEN` on host →
   `spawnWorker(store-builder)` returns `failed` at provision time with a named
   reason; dashboard shows it; no silent mid-demo 401.

---

## 7. Open items

- [ ] `promptFor` templates per role — draft the five prompts (research summary,
      store-build instruction, copywriter, strategist, analyst) and pin them; they
      are demo-visible artifacts.
- [ ] Confirm the in-sandbox agent (OpenClaw) can drive a multi-call tool workflow
      from a single dispatch prompt reliably with Nemotron — the store-builder
      class depends on it. **This is the readiness §3 NemoClaw verify action**
      (raised bar: one real in-sandbox tool call, not just a completion).
- [ ] Decide `strategist`/`analyst` output rendering on the dashboard (brief text
      block vs file artifact) — Adrian.
- [ ] Local-mode parity: the generic executor must run identically with a local
      brain (`resolveBrain()`) so `worker-mode-containment` fallback keeps all
      roles real-capable, just uncontained.
