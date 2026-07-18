#!/usr/bin/env bash
#
# setup-linux.sh — provision a Linux host to run the NemoClaw + OpenShell worker
# runtime. STATIC across every Linux target: prod server, teammate's box, Sky's
# WSL2 Ubuntu. The only host-specific bits (wsl.conf, repo clone location) live in
# docs/RUNTIME_SETUP.md, not here.
#
# It is a thin, SAFE wrapper around NVIDIA's official NemoClaw installer — it does
# not reimplement Node/OpenShell install (the official installer owns that: Node
# 22.19+ via nvm, `npm link` -> ~/.local/bin, OpenShell bootstrap).
#
# Design contract — safe to run on an ALREADY-configured box:
#   * user-scope only: ~/.local/bin, ~/.bashrc (+ whatever the official installer
#     manages under ~/.nvm, ~/.nemoclaw). No sudo from this script.
#   * no symlinks into /usr/local/bin — the spawn code prepends ~/.local/bin to
#     PATH itself (src/worker/nemoclaw.ts), so a system OpenShell is never clobbered.
#   * detect -> skip-if-satisfied -> never overwrite. Idempotent; re-runnable.
#   * reports what it did vs skipped; exits non-zero only if the box is not ready.
set -u

# Pin the installed NemoClaw ref. Default "lkg" = NVIDIA's last-known-good. Override
# with a tag for a reproducible prod/demo build:  NEMOCLAW_INSTALL_TAG=vX.Y.Z ...
NEMOCLAW_INSTALL_TAG="${NEMOCLAW_INSTALL_TAG:-lkg}"
NEMOCLAW_INSTALLER_URL="https://www.nvidia.com/nemoclaw.sh"

ready=true
say()  { printf '  %s\n' "$*"; }
head() { printf '\n== %s ==\n' "$*"; }
warn() { printf '  WARN: %s\n' "$*" >&2; ready=false; }

# ---------------------------------------------------------------------------
head "Base tools (curl, git)"
for t in curl git; do
  if command -v "$t" >/dev/null 2>&1; then say "$t present"; else warn "$t missing — install it (the NemoClaw installer needs it)"; fi
done

# ---------------------------------------------------------------------------
head "Docker (OpenShell sandbox backend — REQUIRED on every host)"
# OpenShell runs each sandbox as a Docker image + gateway (confirmed in the NemoClaw
# installer). No Docker => no sandboxes, on prod Linux as much as on Windows/WSL2.
if command -v docker >/dev/null 2>&1; then
  if docker info >/dev/null 2>&1; then
    say "docker daemon reachable"
  else
    warn "docker installed but daemon not reachable — start it (Docker Desktop on Windows/WSL2, or 'systemctl start docker' on Linux)"
  fi
else
  warn "docker not found — install Docker Engine (Linux) / Docker Desktop (Windows+WSL2). OpenShell cannot create sandboxes without it."
fi

# ---------------------------------------------------------------------------
head "~/.local/bin on PATH"
# The installer's `npm link` drops `nemoclaw` here when the global npm prefix is not
# writable (NemoClaw troubleshooting docs). Ensure it exists and is on PATH first.
mkdir -p "$HOME/.local/bin"
say "ensured $HOME/.local/bin exists"
path_line='export PATH="$HOME/.local/bin:$PATH"'
# Write to ~/.bashrc (interactive) AND ~/.profile (login/non-interactive shells, e.g.
# CI and `bash -lc`) so `openshell` on ~/.local/bin resolves without an interactive shell.
for rc in "$HOME/.bashrc" "$HOME/.profile"; do
  if grep -qF "$path_line" "$rc" 2>/dev/null; then
    say "$(basename "$rc") already exports ~/.local/bin — skip"
  else
    printf '\n# added by scripts/setup-linux.sh\n%s\n' "$path_line" >> "$rc"
    say "appended ~/.local/bin export to $(basename "$rc")"
  fi
done
export PATH="$HOME/.local/bin:$PATH"

# ---------------------------------------------------------------------------
# WSL2-only: with Windows interop PATH on, a plain WSL shell resolves node/npm/docker
# to the Windows binaries under /mnt/c; running Windows npm against a \\wsl.localhost
# repo path fails ("UNC paths are not supported"). RUNTIME_SETUP.md §3 documents the
# fix — verify/enforce it here so the box is usable without hand-sourcing nvm.
if [ -f /proc/sys/fs/binfmt_misc/WSLInterop ] || grep -qi microsoft /proc/version 2>/dev/null; then
  head "WSL2 interop (Windows dev/test host)"
  wsl_conf=/etc/wsl.conf
  if grep -Eq '^[[:space:]]*appendWindowsPath[[:space:]]*=[[:space:]]*false' "$wsl_conf" 2>/dev/null; then
    say "appendWindowsPath=false in $wsl_conf — Windows PATH bleed disabled"
  else
    for t in node npm docker; do
      case "$(command -v "$t" 2>/dev/null)" in
        /mnt/*) say "note: '$t' resolves to a Windows binary ($(command -v "$t")) — PATH bleed active" ;;
      esac
    done
    if [ "${SETUP_WRITE_WSL_CONF:-0}" = 1 ] && command -v sudo >/dev/null 2>&1; then
      if printf '\n[interop]\nappendWindowsPath=false\n' | sudo tee -a "$wsl_conf" >/dev/null 2>&1; then
        warn "wrote [interop] appendWindowsPath=false to $wsl_conf — run 'wsl.exe --shutdown' (Windows PowerShell), reopen Ubuntu, then re-run this script"
      else
        warn "could not write $wsl_conf via sudo — add it manually (see below)"
      fi
    else
      warn "Windows PATH bleed not disabled — plain shells will use Windows node/npm/docker"
      say "  fix: append to $wsl_conf (needs sudo):"
      say "         [interop]"
      say "         appendWindowsPath=false"
      say "       then 'wsl.exe --shutdown' in Windows PowerShell, reopen Ubuntu."
      say "  auto: SETUP_WRITE_WSL_CONF=1 bash scripts/setup-linux.sh"
    fi
  fi
fi

# ---------------------------------------------------------------------------
head "NemoClaw + OpenShell (via NVIDIA's official installer)"
if command -v nemoclaw >/dev/null 2>&1; then
  say "nemoclaw present: $(command -v nemoclaw) — skip (a pinned version is left as-is; re-run the official installer to upgrade)"
elif command -v curl >/dev/null 2>&1; then
  say "installing NemoClaw ref '$NEMOCLAW_INSTALL_TAG' (installs Node 22.19+ via nvm + bootstraps OpenShell; user-scope, no sudo)"
  # NEMOCLAW_NO_EXPRESS=1 -> install the CLI + OpenShell only; per-role sandbox
  # onboarding is the app's job (nemoclaw-spawn.spec.md Phase A), not this bootstrap.
  if curl -fsSL "$NEMOCLAW_INSTALLER_URL" \
      | NEMOCLAW_INSTALL_TAG="$NEMOCLAW_INSTALL_TAG" \
        NEMOCLAW_NO_EXPRESS=1 \
        NEMOCLAW_ACCEPT_THIRD_PARTY_SOFTWARE=1 \
        bash -s -- --non-interactive --yes-i-accept-third-party-software; then
    say "NemoClaw installer completed"
  else
    warn "NemoClaw installer failed — see output above; re-run is safe"
  fi
else
  warn "curl missing — cannot fetch the installer"
fi

# openshell resolves via the installer's ~/.local/bin drop (issue #4224).
command -v openshell >/dev/null 2>&1 && say "openshell resolves: $(command -v openshell)" \
  || say "openshell not on PATH yet (open a new shell / source ~/.bashrc, or installer above failed)"

# ---------------------------------------------------------------------------
head "Landlock (kernel — the OpenShell fs-enforcement floor)"
if command -v python3 >/dev/null 2>&1; then
  # landlock_create_ruleset is syscall 444 on x86_64 & arm64 (asm-generic).
  # (NULL attr, 0 size, flag=1) returns the supported ABI version; >=1 & errno 0 = usable.
  python3 - <<'PY'
import ctypes
libc = ctypes.CDLL(None, use_errno=True)
abi = libc.syscall(444, 0, 0, 1)
err = ctypes.get_errno()
ok = abi >= 1 and err == 0
print(f"  landlock ABI={abi} errno={err} -> {'OK (enforcement available)' if ok else 'UNAVAILABLE — OpenShell fs policy will NOT enforce'}")
raise SystemExit(0 if ok else 1)
PY
  [ $? -eq 0 ] || warn "landlock unavailable on this kernel — set compatibility: hard_requirement to fail loud, or move to a landlock-capable host"
else
  say "python3 absent — skipping landlock probe (install python3 to verify)"
fi

# ---------------------------------------------------------------------------
head "Summary"
if [ "$ready" = true ]; then
  say "READY. Open a new shell (or 'source ~/.bashrc') so PATH takes effect,"
  say "then onboard per specs/security/nemoclaw-spawn.spec.md (Phase A)."
  exit 0
else
  say "NOT READY — resolve the WARN lines above, then re-run (safe to repeat)."
  exit 1
fi
