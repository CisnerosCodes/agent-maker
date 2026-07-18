# Spec — Factory Provisioning (reconcile `createAgent` with per-role sandboxes)

Status: **spec only, planning mode — no code until flag lifted.**
Owner: Sky (security lane — the provisioning pipeline is the identity/containment seam). Consumers: `src/factory/factory.ts` (Adrian's), orchestrator, dashboard.
Depends on: `nemoclaw-spawn.spec.md` §3 (Phase A/B/C), `ceo-sandbox.spec.md` §2 (spawn broker), `openshell-policy.spec.md` §2 (schema).

> Why this exists (deep review 2026-07-18): `nemoclaw-spawn.spec.md` says **one
> sandbox per ROLE**, pre-baked Friday, reused across goals. `factory.ts` mints a
> **fresh agent record + identity + rendered policy per HIRE**. These two models
> were never reconciled, and the gap has three concrete failure modes below. The
> spawn spec defines the CLI; this spec defines what `createAgent()` becomes.

---

## 1. The model collision

| Dimension | `factory.ts` (now) | `nemoclaw-spawn` (planned) | Reconciled model (this spec) |
|---|---|---|---|
| Sandbox lifetime | per hire (`sandbox-${id}`) | per role, pre-baked | **per role**, pre-baked; hires reuse it |
| Identity | per hire (email + creds) | not addressed | per hire (agent record) — **decoupled from sandbox** |
| Policy render | per hire (`{{AGENT_ID}}` template) | authored per role, `policy set` | **per role**, authored (no per-agent render) |
| Session | none | `--session-id <taskId>` (dispatch) | per **task** (the real per-hire unit) |

**Resolution:** the durable unit is the **role sandbox** (one per role). The
per-hire unit is an **agent record + a task session** inside that sandbox. The
Factory does NOT create a sandbox per hire; it health-checks the role's sandbox
and mints a session.

---

## 2. What `createAgent(spec, parentId)` becomes

```
1. issueIdentity(spec)              // unchanged — record-level identity + cred refs
2. assertRoleSandboxHealthy(role)   // nemoclaw sandbox status <role> --json (spawn §4)
                                    //   NOT trust exit code — parse JSON (spawn §5.2)
                                    //   unhealthy → status:"failed", one log line, return
3. session = mintSession(role, taskId)  // per-task; maps agent record → sandbox session
4. registry.upsert(record, "session <id> in sandbox <role>")
```

Retired by this model (need code-fixes rows to remove, not just leave dead):
- **`renderPolicy()` entirely.** It templates `{{AGENT_ID}}`/`{{SANDBOX_NAME}}`
  into a schema that **has no such fields** (openshell-policy §2 — real top-level
  keys are `filesystem_policy`/`process`/`landlock`/`network_policies`). Per-role
  policies are authored files applied once at Phase B; there is no per-agent
  render. (code-fixes C13.)
- **`sandbox = sandbox-${id}`** string assignment (per-hire naming). Sandbox name
  is the role. (code-fixes C13.)

Preserved: identity issuance, registry events, the dashboard provisioning
animation (now: "session minting" instead of "sandbox starting").

---

## 3. Workspace isolation between goals (cross-goal contamination — SECURITY)

A per-role sandbox reused across goals shares `/workspace/**`. Without a wipe,
**goal 1's poisoned document sits in the workspace goal 2's research agent reads**
— a data-poisoning persistence bug the poisoned-doc demo itself would create.

Rule: **each task session gets a clean per-session workdir**, not the shared
`/workspace` root. Two options, confirm at onboarding (open item):
- (a) Session-scoped subdir `/workspace/<sessionId>/`, wiped on session end.
- (b) OpenShell session isolation primitive if one exists.

Prefer (a) — no dependency on an unconfirmed primitive. The executor
(worker-capability §2) reads/writes only its session subdir; the policy's
`read_write: /workspace/**` still bounds it, and cleanup is `rm -rf` the subdir
on task completion/failure/terminate.

---

## 4. Failure states (no more `identity: null as any`, no CEO crash)

- `createAgent` never leaves a record with `identity: null` (code-fixes C12).
  Two-phase: build record with `status:"provisioning"`, set identity, then health
  gate. Any throw (vault miss, unhealthy sandbox, missing secret) → record
  `status:"failed"` + log line; **return the failed record**, do not throw into
  the CEO/plan loop.
- A bad `AgentSpec` must fail this one agent, not halt goal planning before other
  agents are even created — the goal-halt path (orchestrator) handles a failed
  worker; it cannot handle an exception in the hire loop.

---

## 5. Terminate / revoke path (delivers the vault's "REVOCABLE" claim)

Vault philosophy says identities are "ISSUED, SCOPED, **REVOCABLE**." Nothing
revokes anything today or in any other spec; `terminated` status (types.ts) is
unreachable. Minimum viable:

- **On escalation `denied` or explicit CEO terminate:** end the task session,
  wipe its workdir (§3), set record `status:"terminated"`, one registry line.
  Heartbeat reconcile gains a row for this (ceo-heartbeat §3 edit).
- Sandbox itself (role-level) is NOT torn down per terminate — it is shared and
  pre-baked. Revocation is at the **session + record** grain, which is the grain
  that carries the goal's data and the agent's authority to continue.
- Post-hackathon: real credential rotation + sandbox teardown. For the demo,
  session-kill + status is the honest, demonstrable version of "revocable."

---

## 6. Concurrency (two goals, one role sandbox)

A judge typing a second goal mid-demo produces two agent records of the same role
→ one sandbox, one `/workspace`, run-memory keyed by niche. §3 session subdirs
make concurrent sessions safe on disk, but the demo is not rehearsed for it.

**Decision for v1:** the orchestrator **refuses a second concurrent active goal**
with an honest CEO line ("finishing the current goal first — one company, one
job at a time for this demo"). Cheaper and more honest than racing shared state
on stage. Concurrent goals are a post-hackathon capability. (code-fixes C16.)

---

## 7. Test plan

1. **Sandbox reuse:** two sequential goals of the same role → one sandbox created,
   two sessions; `nemoclaw sandbox status` shows no duplicate. (spawn §7.5 idempotency.)
2. **Cross-goal isolation:** goal 1 writes a file to its session workdir → goal 2's
   session cannot read it (separate subdir; wiped).
3. **Vault-miss no-crash:** hire a spec with an unknown credential → that record
   `failed`, CEO loop survives, other agents still hire.
4. **Unhealthy sandbox:** kill the role sandbox before a hire → `createAgent`
   returns `failed` (parsed from `status --json`, not exit code), dashboard shows it.
5. **Terminate:** deny an escalation → session ends, workdir gone, record
   `terminated`, one registry line, heartbeat posts once.
6. **Concurrency refusal:** submit goal 2 while goal 1 runs → CEO declines, no
   second plan starts.

---

## 8. Open items

- [ ] Confirm per-session workdir approach (§3 (a) vs an OpenShell primitive) at
      Friday onboarding.
- [ ] Confirm session lifecycle in NemoClaw: does `--session-id` create-or-reuse,
      and is there a session-end/cleanup call? (spawn §8 open item — JSON payload
      shape includes session fields.)
- [ ] Reconcile the dashboard provisioning copy with the new steps (no more
      "sandbox starting" per hire — it's "session minting").
- [ ] Boot reconcile: a stale non-terminal agent record loaded from
      `registry.json` at start must be swept (see `ceo-heartbeat.spec.md` §3 boot
      row + code-fixes C14) — the Factory's health gate is where a stale record
      with a dead sandbox gets caught.
