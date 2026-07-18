# Note — WORKER_MODE containment (`nemoclaw` vs `local`)

Status: **spec only, planning mode — no code until flag lifted.**
Owner: Sky (security lane). Threat-model note for `docs/ORCHESTRATION.md` §2.

---

## 1. The two modes

Factory step 3 (ORCHESTRATION §2) runs a worker in one of two modes:

| Mode | Where the worker runs | Containment |
|---|---|---|
| `WORKER_MODE=nemoclaw` | OpenShell sandbox, one per role | full — filesystem / process / network egress policy locked |
| `WORKER_MODE=local` | in-process on the host | **none** — SecurityGate (`guarded()`) only |

`local` mode exists as a **break-glass fallback**: NemoClaw is alpha
(`nemoclaw-spawn.spec.md` §warning), so if sandbox spawn breaks on demo day the
in-process loop keeps the demo alive — same registry events, same dashboard, same
gate.

---

## 2. Ruling: local mode is dev/test only, NOT production

`local` mode is fit for local development and testing. It is **not fit for
production / any security-sensitive run**, because it removes the OpenShell
containment boundary and leaves only the detector.

Concretely, in `local` mode:

- No OpenShell **egress policy**. The money-demo #2 defense-in-depth claim —
  HiddenLayer *flags* the injection AND OpenShell *blocks* the exfil host —
  loses its second, independent layer. Only SecurityGate remains; if the gate
  misses, nothing else stops exfil.
- No filesystem / process isolation. A compromised worker runs with the host's
  reach.

So the poisoned-doc red-team demo is only fully honest in `nemoclaw` mode.

---

## 3. Required guardrails before it ships

1. **Refuse silently-insecure runs.** `local` mode must be gated, e.g. allowed
   only when an explicit `DEMO_MODE !== "secure"` (or equivalent). A
   security-mode run that falls back to `local` should **fail loudly**, not
   silently drop containment.
2. **Make it visible.** When any worker is running in `local` mode, the dashboard
   shows a red **UNCONTAINED** badge on that agent. Never let uncontained be the
   silent default.
3. **Minimal egress guard (nice-to-have).** Give the `local` worker loop a
   tool-table-level egress denylist for the known exfil host, so the poisoned-doc
   demo still shows *a* block even in fallback. Not a substitute for OpenShell —
   a courtesy so the demo degrades gracefully.

---

## 4. One-line summary for the plan / dashboard

> `local` mode = break-glass for dev/test and demo-survival only. It runs the
> worker uncontained (gate-only). Production and any security demo run
> `nemoclaw` mode; a `local` fallback during a secure run is a loud failure and a
> red UNCONTAINED badge, never a silent downgrade.
