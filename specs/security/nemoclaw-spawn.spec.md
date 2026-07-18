# Spec — NemoClaw Worker Spawn (Factory ↔ OpenShell)

Status: **spec only, planning mode — no code until flag lifted.**
Owner: Sky (security lane). Primary consumer: **Adrian's `src/factory/factory.ts`** — this is his blocking dependency. Keep the whole thing behind ONE stable function so his interface never churns.
Runtime: NemoClaw (Apache-2.0 TS CLI) + NVIDIA OpenShell sandboxes, NVIDIA hosted (routed) inference.

> ⚠️ NemoClaw is **alpha**. Behavior changes without notice. Every command below is pinned to what the docs/issue tracker say as of research date — re-verify with `nemoclaw onboard --help` during Friday-night onboarding.

---

## 1. Corrections to current guesses

`factory.ts` and `KICKOFF_PROMPT.md` guessed the env vars. Real values:

| Guessed | Real |
|---|---|
| `NEMOCLAW_PROVIDER=build` | **`NEMOCLAW_PROVIDER=routed`** (hosted NVIDIA router path) |
| `NEMOCLAW_AGENT=openclaw` | OpenClaw is the **default agent** — flag optional; agent selection is `--agent` on onboard |
| `NEMOCLAW_YES=1` | Not a thing. Use `--yes-i-accept-third-party-software` or `NEMOCLAW_ACCEPT_THIRD_PARTY_SOFTWARE=1` + `--non-interactive` |

NVIDIA key: from `build.nvidia.com`, must start with **`nvapi-`** (NemoClaw validates the prefix). Default model: **`nvidia/nemotron-3-super-120b-a12b`** (validated against `https://integrate.api.nvidia.com/v1/models`).

---

## 2. Non-interactive env block (`.env`, gitignored)

```
NEMOCLAW_PROVIDER=routed
NVIDIA_API_KEY=nvapi-...
NEMOCLAW_MODEL=nvidia/nemotron-3-super-120b-a12b
NEMOCLAW_ACCEPT_THIRD_PARTY_SOFTWARE=1
```

**Never pass `NVIDIA_API_KEY` as a CLI arg** — pass via process env only (issue #579: key leaks into process args / terminal output on shared systems). Never log it; keep it out of the registry (Sky ↔ Adrian vault boundary).

---

## 3. Lifecycle — three phases

### Phase A — Provision (once per role, ideally pre-baked Friday night)
Heavy step (creates the OpenShell sandbox). Do NOT run per-task.

```bash
# env from §2 already exported
nemoclaw onboard \
  --non-interactive \
  --yes-i-accept-third-party-software \
  --name <role>            # e.g. research, storebuilder
# OpenClaw is default agent; --agent only if overriding
```

Idempotency: before onboarding, check `nemoclaw sandbox status <role> --json` → if `found: true` and healthy, skip provision.

### Phase B — Apply policy (per role; hot-reloadable)
Network + inference policy sections hot-reload on a running sandbox:
```bash
openshell policy set <role> --file policies/worker-<role>.yaml
```
(Static sections — filesystem, process — lock at creation, so the policy file must be correct BEFORE Phase A for those. See `openshell-policy.spec.md`, to write.)

### Phase C — Dispatch task (per task, the hot path)
```bash
nemoclaw <role> agent --agent main --json --session-id <taskId> -m "<task prompt>"
```
- `--json` → **stdout stays parseable JSON**; the registration banner goes to **stderr**. Parse stdout only.
- A target selector is REQUIRED (`--agent` / `--session-id` / `--session-key` / `--to`). Missing → **exit code 2**, `No target session selected`.

---

## 4. Health / readiness (Factory must gate on these)

```bash
nemoclaw sandbox status <role> --json     # canonical form; emits {found:false} instead of text error; exits non-zero on failure
nemoclaw <role> doctor --json             # readiness gate; exits non-zero on failed checks
```

Factory should call `sandbox status --json` after provision and BEFORE first dispatch. Spawn-to-working-agent time (status → first healthy) is a **dashboard metric** (plan §Frontier: performance = spawn-to-working time).

---

## 5. Three known bugs the Factory MUST handle (bounty is adversarial; demo can't crash)

1. **`spawnSync openshell ENOENT` in non-interactive shells (issue #4224).** Installer puts `openshell` at `~/.local/bin`, which a non-interactive shell doesn't have on PATH. The Factory spawns non-interactively → will hit this.
   - **Fix (Friday-night, once):** symlink into a standard path:
     ```bash
     sudo ln -s ~/.local/bin/openshell /usr/local/bin/openshell
     sudo ln -s ~/.local/bin/openshell-gateway /usr/local/bin/openshell-gateway
     sudo ln -s ~/.local/bin/openshell-sandbox /usr/local/bin/openshell-sandbox
     ```
   - Or set `PATH` explicitly in the Factory's spawn env.

2. **CLI exits 0 despite failure (same #4224).** Exit code alone is NOT trustworthy.
   - **Fix:** Factory must not trust exit code — parse `status --json` / the `--json` payload and assert success, not just `code === 0`.

3. **NVIDIA key saved but not registered with OpenShell gateway → inference silently fails (issue #447).** Key lands in `~/.nemoclaw/credentials.json` but not in the gateway inference config.
   - **Fix / fallback after onboard:**
     ```bash
     openshell inference set --provider nvidia-nim --model nvidia/nemotron-3-super-120b-a12b
     ```
   - Add a smoke test in `doctor` gate: one throwaway `agent -m "reply OK"` and assert a non-empty completion before declaring the worker ready.

---

## 6. Stable interface for the Factory (the ONE function)

So Adrian's `factory.ts` never depends on CLI details. Proposed signature (names to reconcile with his `WorkerSpec`/registry types — coordinate):

```ts
// src/worker/nemoclaw.ts  (Sky owns; Adrian imports)

export interface SpawnOptions {
  role: string;              // "research" | "storebuilder" | ...
  policyPath: string;        // policies/worker-<role>.yaml
  model?: string;            // default nemotron
}

export interface WorkerHandle {
  role: string;
  sandbox: string;           // nemoclaw sandbox name
  status: "provisioning" | "ready" | "failed";
}

// Phase A + B + C-gate. Idempotent. Never throws on CLI exit code alone —
// asserts health via status --json + inference smoke test (§5.2, §5.3).
export function spawnWorker(opts: SpawnOptions): Promise<WorkerHandle>;

// Phase C hot path. Returns parsed JSON stdout (banner stripped from stderr).
// MUST scan across the sandbox boundary (see §6.1): scan(prompt) in, scan(completion) out.
export function dispatch(role: string, taskId: string, prompt: string): Promise<AgentResult>;

// Wraps `nemoclaw sandbox status <role> --json`.
export function workerStatus(role: string): Promise<WorkerHandle>;
```

`spawnWorker` emits registry events (`provisioning` → `ready`/`failed`) so the dashboard SSE + spawn-time metric work. Raw secrets never enter the handle, registry, or logs.

---

## 6.1 Instrumentation seam — HiddenLayer depth in `nemoclaw` mode (do NOT skip)

The HiddenLayer track scores *depth of instrumentation*. In `nemoclaw` mode the
worker's model calls happen **inside the sandbox** (OpenClaw → routed NVIDIA
inference), so the harness's `guarded()` never sees them. Without action, the mode
that maximizes the NemoClaw bounty *minimizes* HiddenLayer depth. `dispatch()` is
the only harness-side choke point around a sandbox worker, so it MUST close the seam:

```ts
// inside dispatch(role, taskId, prompt):
await gate.scan(prompt, "user_prompt", role);         // in-bound task text
const result = await runAgentInSandbox(...);          // nemoclaw <role> agent --json
await gate.scan(result.completion, "model_response", role);   // out-bound completion
// tool_call / tool_result scanning stays in-sandbox reach for now (open item §8)
```

This restores an honest "every worker task I/O is gated" claim without touching
Adrian's interface. Two hard constraints this creates:

1. **Document ingest MUST be harness-side, not in-sandbox.** The poisoned-doc demo's
   Layer-1 kill point is `scan(doc, "ingested_document", "research-1")`. If the
   Research worker fetches Apify results *inside* the sandbox, the gate never sees
   the document and Layer 1 silently never fires. So the Factory/dispatcher fetches
   ingest content, `scan()`s it, and passes the (clean-or-flagged) text into the
   sandbox — the sandbox worker never does its own external document fetch.
   Cross-ref `poisoned-doc-demo.spec.md` §2, `openshell-policy.spec.md` §3.
2. **`local` mode already gates everything** (`guarded()` on every I/O). The seam is
   `nemoclaw`-mode-only; `dispatch()` scanning makes the two modes claim the same
   depth. See `worker-mode-containment.spec.md`.

Stretch (confirm Friday, don't bet on it): route sandbox egress through an OpenShell
`network_middlewares` entry (dynamic, `fail_closed`, max 10) that calls HiddenLayer
inline — in-sandbox tool I/O scanned without a harness round-trip. See
`openshell-policy.spec.md` §6 open items.

---

## 6.2 Model + reasoning selection (per-role, spec only)

Today nothing picks a model or reasoning level per agent. `AgentSpec.model?`
exists (`src/types.ts:22`) but `createAgent` never reads it, and there is no
reasoning field anywhere. This section defines the intended behavior so the
spawn path can wire it later without interface churn.

**Where selection lives:** the spec (CEO-authored), NOT hardcoded in the Factory.
The CEO already emits an `AgentSpec` per worker; model/reasoning are two more
optional fields on it. Factory applies defaults when omitted.

Add to `AgentSpec`:

```ts
model?: string;      // Nemotron slug; default below if omitted
reasoning?: "low" | "medium" | "high";  // maps to Nemotron thinking budget; default per role
```

**Default table (Factory fills when spec omits):**

| Role | Model | Reasoning | Why |
|---|---|---|---|
| ceo | `nvidia/nemotron-3-super-120b-a12b` | high | planning/decomposition needs headroom |
| research | `nvidia/nemotron-3-super-120b-a12b` | medium | summarize/extract over ingested docs |
| store-builder | `nvidia/nemotron-3-super-120b-a12b` | low | mostly templated tool calls |
| copywriter | `nvidia/nemotron-3-super-120b-a12b` | low | short-form generation |

Single model family for the demo (one validated `nvapi-` slug, §1). Reasoning is
the real per-role dial; model slug stays a field so a heavier/lighter Nemotron can
be swapped per role later without a code change.

**How it maps to NemoClaw:**
- Model → `NEMOCLAW_MODEL` at provision (Phase A) is the *sandbox default*. A
  per-task override, if NemoClaw supports it, rides on the `dispatch` call
  (confirm flag — open item §8). If no per-dispatch model flag exists, model is
  fixed at sandbox creation and a different model = a different sandbox.
- Reasoning → Nemotron thinking budget. Confirm the exact knob during onboarding
  (system-prompt directive vs a request param exposed by the routed provider) —
  **open item §8**. Until confirmed, treat `reasoning` as a spec field the
  dispatcher translates; do not assume a CLI flag exists.

**Interface impact:** `SpawnOptions.model?` already present (§6). Add
`reasoning?` there and a per-task override slot on `dispatch` only if §8 confirms
NemoClaw honors it. Defaults resolve in the Factory, never in the CEO prompt, so
an under-specified spec still spawns a working agent.

**Security note:** reasoning level is NOT a trust boundary. A higher budget does
not relax any OpenShell policy or SecurityGate scan. Model/reasoning choice must
never gate `scan()` — every dispatch I/O is scanned identically regardless (§6.1).

---

## 7. Test plan

1. **Cold spawn:** `spawnWorker({role:"research", policyPath:...})` on a clean box → sandbox created, healthy, `dispatch` returns a real Nemotron completion.
2. **ENOENT guard:** run the spawn from a bare non-interactive shell (no `~/.bashrc`) → must NOT fail with ENOENT (symlink/PATH fix in place).
3. **False-success guard:** simulate a failed onboard → `spawnWorker` returns `status: "failed"`, NOT `ready` (does not trust exit 0).
4. **Silent-inference guard:** onboard without gateway registration → smoke test catches it → auto-runs `openshell inference set` → recovers or reports failed.
5. **Idempotent re-spawn:** call `spawnWorker` twice for same role → second is a fast no-op (status check), no duplicate sandbox.
6. **Secret hygiene:** grep logs + registry dump for `nvapi-` → zero hits.
7. **Dispatch seam (§6.1):** dispatch a task whose prompt carries a known injection → `dispatch` surfaces a `flagged` verdict from the in-bound `scan()` (HiddenLayer saw it) BEFORE the sandbox model ran. Dispatch a task whose completion contains a leak pattern → out-bound `scan()` flags the `model_response`.

---

## 8. Open items to confirm during Friday-night onboarding

- [ ] Exact `NEMOCLAW_PROVIDER` value for NVIDIA Endpoints non-routed vs `routed` — docs clearest for `routed`; confirm which the hosted endpoint needs.
- [ ] `nemoclaw <name> agent` JSON payload shape (fields for completion text, session, tokens) — for `AgentResult` type + dashboard.
- [ ] Whether policy must be passed at `onboard` time for static (fs/process) sections vs `openshell policy set` for dynamic — affects Phase A/B ordering.
- [ ] Confirm `openshell inference set` provider name (`nvidia-nim`) matches this NemoClaw version.
- [ ] Deliver the verified exact invocation to Adrian so `factory.ts` spawn TODO (line ~36) unblocks.
- [ ] Reasoning knob (§6.2): does routed NVIDIA/Nemotron expose a thinking-budget param, or is it system-prompt only? Determines whether `reasoning` maps to a request field or an injected directive.
- [ ] Per-dispatch model override (§6.2): does `nemoclaw <role> agent` accept a model flag, or is model fixed at sandbox creation (one model = one sandbox)?
- [ ] Whether in-sandbox tool_call / tool_result can be scanned without a harness round-trip — i.e. does OpenShell `network_middlewares` (§6.1 stretch) let an egress hook call HiddenLayer inline? If not, tool I/O scanning stays at the `dispatch` boundary only (prompt in, completion out) for the demo.
