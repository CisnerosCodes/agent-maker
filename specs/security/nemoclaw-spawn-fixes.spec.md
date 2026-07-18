# Spec — Tier 1.2 Fix: NemoClaw Spawn/Dispatch Containment & Test Seam

Status: **fix spec — implementation exists, these are the gaps that block go-live.**
Owner: Sky (security lane). Reviewer: parallel (in-flight).
Target file: `src/worker/nemoclaw.ts`. Base spec: `nemoclaw-spawn.spec.md` (design intent).
Scope: only the delta needed to (a) make the sandbox actually contained and (b) let the
adversarial harness drive the dispatch boundary without a live NemoClaw install.

> Why now: `nemoclaw.ts` implements spawn/dispatch/status, but three of them ship a
> **silent containment hole** or **can't be tested offline**. The harness rows `egress`,
> `cred-hygiene`, `dispatch-seam` are `pending` precisely because of F3 below. F1/F2 are
> exploitable today — a worker can run uncontained or exfiltrate the NVIDIA key past the gate.

---

## Findings (severity order)

### F1 — CRITICAL: Phase-B policy application is fire-and-forget → uncontained sandbox

`nemoclaw.ts:192`
```ts
await runCli("openshell", ["policy", "set", opts.role, "--file", opts.policyPath], STATUS_TIMEOUT_MS);
```
Result is discarded. If `openshell policy set` fails (bad file, gateway not up, alpha
CLI exits 0-on-failure per base spec §5.2), the sandbox proceeds to `ready` with **no
network policy applied**. The entire "egress is blocked / fail_closed allowlist" story
silently voids, and `spawnWorker` still returns `status: "ready"`.

A worker with no egress policy is strictly worse than no worker: it looks healthy on the
dashboard while being able to reach `169.254.169.254` and every exfil host.

**Fix:** treat policy application as a hard gate, fail-CLOSED (mirror gate.ts posture):
1. Capture the result; do **not** trust exit code (base spec §5.2).
2. Re-read applied policy via `openshell policy get <role> --json` (or `sandbox status
   --json` if it echoes policy hash) and assert the network section is present and
   `fail_closed`.
3. On any failure → `handle.status = "failed"`, `handle.error = "policy not applied
   (uncontained)"`, emit `failed`. Never reach smoke test with an unpoliced sandbox.

**Test:** simulate `policy set` failure (F3 seam) → `spawnWorker` returns `failed`, not
`ready`. Assert dashboard event carries the containment reason.

---

### F2 — CRITICAL: redact-before-scan blinds the outbound exfil gate

`runCli` redacts stdout at `nemoclaw.ts:119,123`. `dispatch()` then pulls the completion
from that already-redacted stdout (`:255`) and scans it (`:269`):
```ts
const completion = extractCompletion(parseJson(run.stdout)); // run.stdout is redacted
...
const responseScan = await scan(completion, "model_response", role);
```
So if a worker completion exfiltrates the `nvapi-` key, `redact()` (`:76-77`,
`/\bnvapi-[A-Za-z0-9_-]{8,}/g`) has already masked it **before** the gate sees it. The
outbound scan never observes the leak → no `blocked` verdict, no CEO notify, no incident.
The `cred-hygiene` demo wants a **visible block**, not a silent scrub.

**Fix:** split the two concerns — detection reads raw, surfaces read redacted.
- `runCli` returns raw stdout/stderr for the detection path (or a `{raw, redacted}` pair).
- `dispatch()` scans the **raw** completion; the gate decides `flagged`/`blocked`.
- Only fields that get logged, stored in the registry, or returned in `AgentResult` /
  `handle.error` are redacted. Keep the "no `nvapi-` in logs" guarantee (base spec §5.6)
  on the surfacing path, not the detection path.

**Test:** `dispatch` a task whose canned completion contains a live-shaped `nvapi-` token
→ outbound scan returns non-clean, `AgentResult` is blocked/flagged, and the logged/
returned copy is redacted. Both properties hold at once.

---

### F3 — ENABLER: no offline seam → dispatch/spawn untestable, 3 harness rows stuck pending

`spawnWorker`/`dispatch`/`workerStatus` shell straight to `nemoclaw`/`openshell` binaries.
On any box without NemoClaw installed (CI, the harness, a reviewer's laptop), `runCli`
returns `code: null` → everything fails. The harness rows `egress`, `cred-hygiene`,
`dispatch-seam` (`test/adversarial/run.ts`) cannot run and are marked `pending`.

**Fix:** inject the runner. Add a seam so the harness supplies canned CLI behavior:
- Introduce a module-level `let cli = runCli` and export `__setCli(fn)` for tests, **or**
  an `NEMOCLAW_SIM=1` env path that routes `runCli` to a fixture table keyed by
  `(cmd, subcommand, role)`.
- Fixtures cover: healthy status, unhealthy status (F6), `policy set` failure (F1),
  a clean completion, an injection-bearing prompt echo, an exfil/`nvapi-` completion (F2),
  and an in-sandbox egress attempt to a blocked host (F4).
- Sim path must exercise the **real** gate.scan calls and the **real** verdict routing —
  only the CLI subprocess is faked, never the security logic.

This is the change that flips `egress` / `cred-hygiene` / `dispatch-seam` from `pending`
to live. Keep the sim strictly test-only; production still spawns real binaries.

---

### F4 — HIGH: in-sandbox tool egress is never scanned; containment must be asserted

`dispatch()` scans `prompt` in and `completion` out only. Tool calls the worker makes
**inside** the sandbox (a `curl` to an exfil host or the cloud metadata IP) never reach
the gate — base spec §6.1 / §8 flags this as open. Right now nothing enforces or tests it.

**Fix (define the contract, don't over-build):**
- Enforcement is the **OpenShell network policy** (`fail_closed` allowlist), not the
  gate. F1 makes that policy trustworthy; this finding makes it asserted.
- Harness `egress` row: drive a dispatch whose sim tool step attempts
  `http://169.254.169.254/...` and an exfil host from `corpus/exfil-hosts.txt` → assert
  the policy denies it (sim returns a policy-blocked tool result) and the attempt is
  logged as an incident.
- Stretch (confirm Friday, do **not** block on it): OpenShell `network_middlewares`
  dynamic `fail_closed` hook calling HiddenLayer inline, so in-sandbox egress is scanned
  without a harness round-trip (base spec §6.1 stretch, §8). If unavailable, egress
  scanning stays policy-enforced at the boundary — document that limit honestly.

---

### F5 — MEDIUM: `extractCompletion` false-negatives on array content

`nemoclaw.ts:303-313` accepts a completion only when the candidate is a `string`:
```ts
payload.choices?.[0]?.message?.content ...
if (typeof candidate !== "string") return null;
```
OpenAI-shaped payloads (and some routed NVIDIA responses) put `message.content` as an
**array of typed parts**. A real completion then reads as `null` → false "no completion"
failure, which F2's exfil path and the smoke test both depend on.

**Fix:** if `content` is an array, join `part.text` over `{type:"text"}` parts before the
string check. Keep the null guard for genuinely empty completions.

---

### F6 — LOW: unhealthy sandbox accepted at pre-smoke gate

`nemoclaw.ts:205` lets `status === "provisioning"` pass the gate before the smoke test.
`workerStatus` returns `provisioning` for the present-but-not-healthy bucket, so a broken
sandbox proceeds. The inference smoke test catches it downstream, so this is not
exploitable — but the failure reason ends up as "smoke failed" instead of the truer
"sandbox never became healthy." Tighten the gate copy / event reason once F1 lands.

---

## Integration note (not a code fix — a wiring blocker)

`src/factory/*` does **not** call `spawnWorker`/`dispatch` yet (factory uses its own
`worker.ts` api/nvidia path). Tier 1.2 is implemented but unwired. Out of scope for this
fix spec, but the reviewer should know: closing F1–F5 makes `nemoclaw.ts` correct and
testable; a separate factory-integration task actually routes workers through it.

---

## Priority for review

| Fix | Severity | Blocks | Effort |
|-----|----------|--------|--------|
| F1 policy fail-closed | CRITICAL (containment hole) | honest "contained" claim | S |
| F2 redact/scan ordering | CRITICAL (gate blind to leak) | `cred-hygiene` demo | S |
| F3 offline runner seam | ENABLER | `egress`,`cred-hygiene`,`dispatch-seam` rows | M |
| F4 egress containment assert | HIGH | `egress` row | M (with F3) |
| F5 array content | MEDIUM | smoke + F2 reliability | S |
| F6 gate copy | LOW | accuracy only | XS |

Recommended land order: **F3 first** (unblocks testing everything else), then F1 + F2
(the two exploitable bugs, now testable), then F4, then F5/F6.

## Acceptance
- `npm run adversarial`: `egress`, `cred-hygiene`, `dispatch-seam` rows go live and pass.
- F1: forced `policy set` failure → `spawnWorker` returns `failed`, never `ready`.
- F2: `nvapi-`-bearing completion → outbound scan non-clean **and** surfaced copy redacted.
- No `nvapi-` in logs/registry (base spec §5.6 unchanged).
- Zero new prod dependency on the sim seam (test-only).
