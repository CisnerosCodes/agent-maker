# Positioning & the Rehearsed "Why"

The line to say on stage, and the honest framing behind it. Written in response
to the judge critique: capability is a commodity; trust is the product.

## The one line

> **Everyone sells agents. We sell the employment contract — identity,
> permissions, supervision, and an audit trail.**

## Why this, not "an ecosystem that makes agents"

"A platform that makes agents" describes CrewAI, AutoGen, Lindy, Relevance, and
thirty YC companies. The maker is a commodity for-loop. Do not lead with it.

What this architecture actually contains that is *buyable*:
- **Identity** — every worker is issued a scoped identity from the Vault
  (`research-01@agentcorp.dev`), not a shared god-key.
- **Least-privilege permissions** — a worker holds only the credentials its role
  needs; the OpenShell policy caps what it can even reach on the network.
- **Supervision** — every risky action stops at the SecurityGate for human
  approve/deny before it happens (the escalation loop).
- **Audit trail** — every agent action, message, and detection is on one
  persisted bus you can replay.

That is **"hire AI employees you can actually trust and audit."** Trust — not
capability — is the reason companies have not deployed autonomous agents. The
customer is not "any company"; it is an **ops or ecommerce team of 5–50** that
wants agent labor but cannot pass it through security review.

## Claims discipline (say the true version)

| Don't say | Say instead | Why |
|---|---|---|
| "Makes any agent you need" | "Hires from a growing library of roles" | The Factory instantiates roles from `src/roles/library.ts`; it doesn't invent arbitrary agents. This is now literally true — add a role = add a library entry. |
| "Learns and recursively gets better" (as aspiration) | "Remembers every run and gets faster on repeat work" | Backed by `src/memory/runs.ts`: run 2 in a niche reuses run 1's research and finishes measurably faster. Show the delta on the dashboard. |
| "Live product data" (when it's mock) | Source label is shown honestly | Research names its source: `live Apify scrape` / `operator feed` / `sample catalog`. No mock URL is ever presented as live. |

## The two money demos, mapped to the pitch

1. **The build** — goal in → CEO interrogates → workforce hired from the role
   library, each with issued identity + rendered policy → real research fetch →
   (Shopify when keyed) real products → deliverable URL. Proves *capability
   under governance*.
2. **The attack** — "inject poisoned doc" → SecurityGate flags injection +
   exfiltration → worker blocks → operator denies → defense-in-depth note (the
   OpenShell egress policy blocks `evil.example` independently). Proves *the
   product*: supervision + audit + least privilege, on screen.

## Recursive-intelligence entry (now real)

`data/runs.json` records each goal's niche, findings, and timing. A second run
in the same niche recalls the first, skips re-research, and the CEO reports the
speedup ("finished 41s vs 90s, 0s re-research"). The dashboard's Run Memory
strip shows the run-over-run delta. That is a real learning mechanism with
near-zero extra code — and it makes the "gets better over time" claim true
instead of vaporware.
