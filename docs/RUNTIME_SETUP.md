# Runtime setup — NemoClaw + OpenShell worker

The app code is **host-static**: nothing in `src/` detects the OS (the one platform
branch, `nemoclaw.ts` PATH-separator, resolves correctly on any Linux). Provisioning
a host is done by one shared script; only WSL adds a couple of one-time host steps.

**End goal:** runs on a Linux server/host. Windows is dev/test only.

## Hard prerequisites (every host that runs OpenShell)

| Requirement | Notes |
|---|---|
| **Linux** (or WSL2 on Windows) | OpenShell is Linux-only; Windows uses WSL2. |
| **Docker** | OpenShell runs each sandbox as a Docker image + gateway. **Required on prod too** — not Windows-only. Docker Engine (Linux) / Docker Desktop (Windows+WSL2). Daemon must be running. |
| **Node.js 22.19+** | `MIN_NODE_VERSION=22.19.0`. The NemoClaw installer installs it via nvm if absent. |
| **Landlock** (kernel) | OpenShell's filesystem-enforcement floor. Kernel feature — a container/VM can't add it if the host kernel lacks it. |

Verify landlock before trusting any `filesystem_policy`:

```bash
# ABI >= 1 with errno 0 = landlock usable (syscall 444 = x86_64 & arm64)
python3 -c 'import ctypes;l=ctypes.CDLL(None,use_errno=True);print("abi",l.syscall(444,0,0,1),"errno",ctypes.get_errno())'
```

Set `landlock: compatibility: hard_requirement` in `policies/*.yaml` so a host that
*can't* enforce fails loud instead of silently degrading.

---

## 1. The shared, static bootstrap (all Linux: prod, teammate, WSL)

```bash
bash scripts/setup-linux.sh
```

A thin, safe wrapper around **NVIDIA's official NemoClaw installer**
(`curl -fsSL https://www.nvidia.com/nemoclaw.sh | bash`), which installs Node 22.19+
via nvm, `npm link`s `nemoclaw` into `~/.local/bin`, and bootstraps OpenShell.

The script does not reimplement any of that — it just makes the box safe/idempotent:

- checks base tools + **Docker daemon** (hard prereq), verifies **landlock**.
- ensures `~/.local/bin` is on PATH (where `npm link` drops `nemoclaw`).
- runs the installer **only if `nemoclaw` is absent** — a pinned prod version is left
  as-is. Pin the ref for reproducible builds: `NEMOCLAW_INSTALL_TAG=vX.Y.Z bash scripts/setup-linux.sh`.
- user-scope, **no sudo, no `/usr/local/bin` symlinks** (the spawn code prepends
  `~/.local/bin` to PATH itself — see `src/worker/nemoclaw.ts` — so a system-wide
  OpenShell on prod is never clobbered).
- idempotent: re-running a ready box is a no-op that verifies state.

Then follow the onboard/policy/dispatch flow in
`specs/security/nemoclaw-spawn.spec.md` (§2 env, §3 lifecycle).

> The public npm package named `nemoclaw` is an unrelated empty squatter — do **not**
> `npm install -g nemoclaw`. Install only via the official installer above.

---

## 2. Prod Linux server / teammate's Linux box

Native. Ensure Docker is installed + running, then:

```bash
git clone https://github.com/CisnerosCodes/agent-maker.git
cd agent-maker
bash scripts/setup-linux.sh
```

If the box already has Node/Docker/OpenShell, the script detects and skips them.

---

## 3. Sky's Windows box via WSL2 (dev/test) — the only host-specific steps

WSL2 Ubuntu **is** Linux (shares a landlock-capable kernel, ABI v3 verified), and
Docker Desktop exposes its daemon into WSL2. So after these one-time steps you run
the exact same commands as prod — no containerizing the app.

**One-time WSL config** — make WSL a clean Linux box (native Node wins, no Windows
PATH bleed). Append to `/etc/wsl.conf`:

```ini
[interop]
appendWindowsPath=false
```

Then from PowerShell: `wsl.exe --shutdown`, reopen Ubuntu. Ensure Docker Desktop is
running with WSL2 integration enabled for the Ubuntu distro.

**Run on the Linux filesystem, NOT `/mnt/c`** (9p there gives Windows perms + breaks
`process.run_as_user` and landlock path semantics):

```bash
mkdir -p ~/hackathon && cd ~/hackathon
git clone https://github.com/CisnerosCodes/agent-maker.git
cd agent-maker && git checkout Sky-Security-Work
bash scripts/setup-linux.sh
```

Dev workflow: edit on the `C:\` copy → commit/push → the WSL clone `git pull`s and
is fully tested before the demo. Never *run* from `/mnt/c`.

---

## Why there's no OpenShell dev container

OpenShell itself uses Docker as its sandbox backend, so running OpenShell *inside*
another container would be docker-in-docker (requires mounting the host docker
socket / elevated privileges) — fragile and not worth it. On Windows, run OpenShell
in **WSL2 directly** against Docker Desktop's daemon (section 3). The existing
`./Dockerfile` (alpine, :4000) is only the dashboard web app — unrelated to the
OpenShell worker runtime.
