# Harness & Governance — Who Decides the Agents We Make

The design answer to: *"what harness do the agents get, and who decides — the AI
or the human — and can it be toggled?"* Written after the two research passes
(agent-harness landscape + CEO→Factory→worker playbook) and Sky's security specs.

## The question was three questions

"Harness" conflated three axes with different correct owners. Separating them is
how we avoid a security hole (a prompt-injected CEO widening its own powers):

| Axis | What it is | Who decides | Toggleable? |
|---|---|---|---|
| **A. Runtime / containment** | Where the worker executes: OpenShell sandbox vs local | **Human / operator** (env + platform) | Yes — but only as `nemoclaw` (contained) vs `local` (break-glass). NEVER AI-set. |
| **B. Agent framework** | The loop inside the sandbox: OpenClaw vs pi vs Hermes | **Fixed platform decision** (OpenClaw-in-OpenShell) | No — one vetted runtime, not a per-agent choice |
| **C. Agent shape** | Role, model, reasoning, tools, policy | **AI (CEO) from a library, within an envelope** | The AI picks; the human sets the envelope |

**One-line answer:** the harness is a fixed, human-set platform. The AI *designs
each agent's role/model/reasoning/tools from a vetted library, within an
envelope*. The human *toggles the envelope* (autonomy + containment). **The AI
never toggles its own cage.**

This is a stronger pitch than "the AI builds any agent it wants": *the AI designs
the workforce, the human sets the employment terms, the platform guarantees
containment* — the `docs/PITCH.md` employment-contract framing made into a control.

## The Autonomy Dial (SHIPPED — live-toggleable on the dashboard)

An operator-set control, three positions, flippable live (built for the recorded
demo). It governs **approval friction, not containment.** Default: **supervised**
(`AUTONOMY_MODE` env override; dashboard buttons flip it live and broadcast over SSE).

| Mode | Plan gate (before spawn) | Flagged (non-critical) detection | Critical exfil |
|---|---|---|---|
| **assisted** | CEO org plan pauses for human approve/deny before ANY spawn | pauses for approve/deny | always hard-blocks |
| **supervised** (default) | none — spawns from the vetted library | pauses for approve/deny | always hard-blocks |
| **autonomous** | none | logged + auto-approved (run doesn't stop) | always hard-blocks |

**Hard invariant (the cage is not on the dial):**
- Containment (OpenShell sandbox) is always on for any non-dev run. It is set by
  `WORKER_MODE` (operator), never by the CEO. See `specs/security/worker-mode-containment.spec.md`.
- Critical (`blocked`) verdicts — data exfiltration — hard-stop in *every* mode.
- The autonomy mode is host-side state the agents cannot write, so injection into
  the CEO cannot widen autonomy. (`src/governance/governance.ts`.)

**The recorded-demo sequence this enables:**
1. **Autonomous** → launch a store goal → it rips through, no interruptions.
2. Flip to **Supervised** → inject the poisoned doc → escalation banner, you
   approve/deny. Human in the loop, on screen.
3. Flip to **Assisted** → launch a goal → it *pauses for your approval* before
   hiring. Human sets the terms, on screen.

Where it lives in code: `governance.planGate()` gates spawning in
`orchestrator.plan()`; `governance.autoApprovesFlagged()` gates the escalation in
`worker.gateOrEscalate()`; dashboard `/autonomy` sets the mode and the dial
renders the active position. Plan approvals resolve via `/approve-plan/:goalId`.

## The 5-module spec schema (the improvement beyond the research)

The research (AgentSquare, ADAS) says: define a worker by a modular spec. We
adopt AgentSquare's four cognitive modules **and add a fifth** the academic
meta-agent literature ignores — which is exactly our differentiator:

| Module | Fields | Who fills it |
|---|---|---|
| **Planning** | role, objective, dependencies | CEO (from role library) |
| **Reasoning** | `reasoning: low\|medium\|high` (Nemotron thinking budget) | CEO-authored, Factory default per role |
| **Tool Use** | `tools[]` | CEO (from role library) |
| **Memory** | run-memory retrieval seed (niche findings, learned boundaries) | Factory (learning loop) |
| **Containment / Identity** ← *our 5th* | `policyTemplate`, credential scope, autonomy envelope | **Operator + Factory — never the CEO alone** |

The 5th module is a first-class spec field, not an afterthought. AgentSquare and
every meta-agent paper treats security as out of scope; making it a spec module
is the novel synthesis and the whole pitch.

`reasoning` is now on `AgentSpec` (verified real: Nemotron 3 controls it via
`chat_template_kwargs.enable_thinking`/`low_effort` on the hosted endpoint, and
`nemoclaw <role> agent` forwards `--thinking`/`--model` per dispatch). Defaults
per Sky's §6.2 table live in `src/roles/library.ts`: ceo=high, research=medium,
store-builder=low, copywriter=low, strategist=high, analyst=medium.

**Security note (Sky):** reasoning level is NOT a trust boundary. A higher budget
never relaxes a policy or a scan. Every dispatch I/O is scanned identically
regardless of model or reasoning choice.

## What stays fixed (and why)

- **One agent framework** (OpenClaw-in-OpenShell), not a per-agent harness zoo.
  NemoClaw is built to run it inside the sandbox; OpenClaw gives us the
  `before_tool_call` security hooks for free. A heterogeneous harness the CEO
  picks from buys nothing and multiplies the attack + reliability surface.
- **Containment always on**, operator-set, off the autonomy dial.
- **The CEO chooses roles from a library**, it does not invent runtimes — this is
  why "hires from a growing library of roles" is honest (see `src/roles/library.ts`).
