# Fix Spec — Windows/WSL2 Compatibility (from live E2E test 2026-07-18)

Status: **spec only — findings from an actual clean-clone run on Sky's Windows box via WSL2.**
Owner: Sky. Scope: gaps found running the *documented* setup flow end-to-end on WSL2
Ubuntu against `origin/Sky-windows-compatibility` (b7d9150).

Test performed: fresh `git clone` on the WSL2 **Linux** filesystem (`~/hackathon`),
`bash scripts/setup-linux.sh`, then `npm install`, `npm run typecheck`,
`scripts/verify-tier1.ts`, and a dashboard boot smoke.

Priority key: **P0** = blocks a full demo. **P1** = friction / partial-run. **P2** = polish.

**Resolution (2026-07-18):** W2, W3, W4, W5 fixed on this branch and re-verified on WSL2
(`bash -n` clean; setup now detects WSL + warns/enforces `appendWindowsPath`, writes
`~/.local/bin` to `~/.profile`; server handles `EADDRINUSE`; docs branch corrected).
**W1 remains** — a Docker Desktop GUI toggle that cannot be scripted; it is a pre-demo
host step, tracked as a readiness/runbook checklist row.

---

## What already works (verified, no fix needed)

- `scripts/setup-linux.sh` runs to **exit 0**, idempotent. Installs **Node v22.23.1**
  via nvm, **openshell 0.0.72** to `~/.local/bin`, `npm link`s `nemoclaw` +
  `nemohermes` + `nemo-deepagents` into the nvm bin.
- **Landlock ABI=3, errno=0** on WSL2 kernel → fs-enforcement floor available.
- `npm install` exit 0; `npm run typecheck` (`tsc --noEmit`) **0 errors**.
- `scripts/verify-tier1.ts` → **ALL PASS** (spawn-authority broker, poisoned-doc
  Layer-1 detection, NemoClaw seam key-redaction).
- Dashboard boots (`tsx dashboard/server.ts`) → served **HTTP 200** on
  `DASHBOARD_PORT=4055`.

**Conclusion: the app code runs on WSL2.** Every blocker below is host/config or
docs — not application code.

---

## W1 — Docker Desktop WSL integration not reachable → NemoClaw onboard aborts (P0, BLOCKER)

**Where:** host (Docker Desktop) + `setup-linux.sh` preflight + NemoClaw installer preflight.
**Observed:** `docker` resolved but `docker info` fails → installer prints
`Host preflight found issues that will prevent onboarding right now … Enable Docker
Desktop WSL integration` and `[ERROR] Skipping onboarding`. Box ends **NOT READY**.
OpenShell uses Docker as its sandbox backend, so with no daemon there is **no worker
runtime** — spawn/dispatch cannot be exercised, only the static checks above.
**Fix (host, one-time — cannot be scripted, it's a GUI toggle):**
Docker Desktop → Settings → Resources → WSL integration → enable for the `Ubuntu`
distro → Apply → `wsl --shutdown` (PowerShell) → reopen Ubuntu → confirm `docker info`
→ re-run `bash scripts/setup-linux.sh` (safe to repeat) so NemoClaw onboarding runs.
**Spec follow-up:** add this exact toggle sequence as a **pre-demo checklist row** in
`specs/integration/readiness-and-cut-gates.spec.md` and `specs/demo/demo-recovery-runbook.spec.md`
— it is the single gate between "installs clean" and "worker actually spawns."
**Owner:** Sky.

---

## W2 — `appendWindowsPath=false` never applied → Windows PATH bleed breaks plain shells (P0, HIGH FRICTION)

**Where:** `/etc/wsl.conf` (missing `[interop]` block); `docs/RUNTIME_SETUP.md` §3
documents it as a manual step but `scripts/setup-linux.sh` neither applies nor checks it.
**Observed:** current `/etc/wsl.conf` has only `[boot] systemd=true` + `[user]`. With
interop PATH bleed on, a normal WSL shell resolves `node`→ **Windows Node v24.16.0**,
`npm`→ **Windows npm 11.13.0**, `docker`→ `/mnt/c/.../DockerDesktop`. Running the
Windows `npm` against a `\\wsl.localhost\…` repo path throws
`UNC paths are not supported. Defaulting to Windows directory.` — every "just run the
documented commands" attempt fails until nvm is *manually* sourced. This wasted the
most time in testing and will bite any teammate/CI following the README verbatim.
**Fix:** make `setup-linux.sh` WSL-aware. When `/proc/sys/fs/binfmt_misc/WSLInterop`
exists (i.e. running under WSL):
  1. detect `[interop] appendWindowsPath` in `/etc/wsl.conf`;
  2. if absent/true → **hard WARN** with the exact remediation (append
     `[interop]\nappendWindowsPath=false`, then `wsl --shutdown`), and mark the box
     NOT READY for the "plain shell" workflow;
  3. optionally offer to write it (needs sudo) behind an explicit
     `SETUP_WRITE_WSL_CONF=1` opt-in — never silently sudo-edit host config.
Also: the installer already puts nvm's source line in `~/.bashrc`, which
non-login/non-interactive shells skip → `node` unresolved there. Document that
verify/CI must use a login shell or source nvm explicitly (`. ~/.nvm/nvm.sh`).
**Owner:** Sky. **Cross-ref:** RUNTIME_SETUP §3 (§ already right — script drifted).

---

## W3 — `openshell` / `~/.local/bin` off PATH in non-login shells (P1)

**Where:** installer writes `~/.local/bin` to `~/.bashrc`; `setup-linux.sh` §PATH does same.
**Observed:** in an nvm-sourced non-login shell, `command -v openshell` is **empty**
(binary present at `~/.local/bin/openshell`, just not on PATH). `nemoclaw` resolves
only because it was `npm link`ed into the nvm bin dir. **Mitigated for the actual
worker:** `src/worker/nemoclaw.ts:~97-103` prepends `~/.local/bin` to the spawn env,
so spawning still finds OpenShell. Impact is limited to humans/scripts invoking
`openshell` directly from a bare shell.
**Fix:** low priority. Either drop the `~/.local/bin` line into `~/.profile` too (login
shells) or note in RUNTIME_SETUP that direct `openshell` use needs a login shell. No
code change required for the spawn path.
**Owner:** Sky. **Cross-ref:** `src/worker/nemoclaw.ts` (spawn-time PATH prepend).

---

## W4 — RUNTIME_SETUP §3 clones then `git checkout Sky-Security-Work` (P2, DOCS)

**Where:** `docs/RUNTIME_SETUP.md:96`.
**Observed:** the WSL walkthrough hard-codes `git checkout Sky-Security-Work` — a stale
lane branch. A teammate following §3 lands on the wrong branch (not the integration/
demo branch).
**Fix:** point at the current integration branch (or the default once merged), or drop
the checkout so it stays on the cloned default. Keep §2 (native Linux) and §3 (WSL) in
sync on branch name.
**Owner:** Sky.

---

## W5 — Dashboard `EADDRINUSE :4000` when port busy (P2)

**Where:** `dashboard/server.ts:17,168`.
**Observed:** first boot smoke threw `EADDRINUSE :::4000` — port held by another
(Windows-side) process, localhost-forwarded into WSL. Server **honors
`DASHBOARD_PORT`** (rebooted clean on 4055 → HTTP 200), so this is not a code defect.
**Fix:** docs only — note in README/runbook that on Windows a stray listener (or a
prior `npm run dev`) can hold 4000; set `DASHBOARD_PORT` or free the port. Optionally
have the server log a clear "port in use — set DASHBOARD_PORT" line on `EADDRINUSE`
instead of an unhandled `error` throw.
**Owner:** Sky. **Cross-ref:** README:33 (already documents `DASHBOARD_PORT`).

---

## Ready-state summary

| Layer | State on WSL2 |
|---|---|
| Clone on Linux fs | ✅ |
| `setup-linux.sh` (Node/nvm, openshell, landlock) | ✅ exit 0 |
| `npm install` / `typecheck` | ✅ 0 errors |
| `verify-tier1.ts` | ✅ ALL PASS |
| Dashboard HTTP | ✅ 200 (alt port) |
| **NemoClaw onboard / OpenShell worker** | ❌ blocked by **W1** (Docker daemon) |
| **Plain-shell "just run the docs" flow** | ⚠️ blocked by **W2** (PATH bleed) until wsl.conf fixed |

**Gate to a full live demo = W1 (Docker Desktop WSL integration) + W2 (wsl.conf).**
Both host-config, both one-time, neither a code change.
