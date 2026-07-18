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
export function dispatch(role: string, taskId: string, prompt: string): Promise<AgentResult>;

// Wraps `nemoclaw sandbox status <role> --json`.
export function workerStatus(role: string): Promise<WorkerHandle>;
```

`spawnWorker` emits registry events (`provisioning` → `ready`/`failed`) so the dashboard SSE + spawn-time metric work. Raw secrets never enter the handle, registry, or logs.

---

## 7. Test plan

1. **Cold spawn:** `spawnWorker({role:"research", policyPath:...})` on a clean box → sandbox created, healthy, `dispatch` returns a real Nemotron completion.
2. **ENOENT guard:** run the spawn from a bare non-interactive shell (no `~/.bashrc`) → must NOT fail with ENOENT (symlink/PATH fix in place).
3. **False-success guard:** simulate a failed onboard → `spawnWorker` returns `status: "failed"`, NOT `ready` (does not trust exit 0).
4. **Silent-inference guard:** onboard without gateway registration → smoke test catches it → auto-runs `openshell inference set` → recovers or reports failed.
5. **Idempotent re-spawn:** call `spawnWorker` twice for same role → second is a fast no-op (status check), no duplicate sandbox.
6. **Secret hygiene:** grep logs + registry dump for `nvapi-` → zero hits.

---

## 8. Open items to confirm during Friday-night onboarding

- [ ] Exact `NEMOCLAW_PROVIDER` value for NVIDIA Endpoints non-routed vs `routed` — docs clearest for `routed`; confirm which the hosted endpoint needs.
- [ ] `nemoclaw <name> agent` JSON payload shape (fields for completion text, session, tokens) — for `AgentResult` type + dashboard.
- [ ] Whether policy must be passed at `onboard` time for static (fs/process) sections vs `openshell policy set` for dynamic — affects Phase A/B ordering.
- [ ] Confirm `openshell inference set` provider name (`nvidia-nim`) matches this NemoClaw version.
- [ ] Deliver the verified exact invocation to Adrian so `factory.ts` spawn TODO (line ~36) unblocks.
