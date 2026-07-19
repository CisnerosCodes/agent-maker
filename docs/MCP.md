# Connect your own agent (MCP)

Claw Colony ships an MCP server so you don't have to learn our product — **your AI does**.
Point Claude (or any MCP-capable agent) at it and say *"set me up"*: it will onboard your
company, hand you your dashboard link, launch goals, watch the org live, explain every
security escalation in plain language, and guide business setup step by step.

The dashboard at http://localhost:4000 and your agent see the **same live company** —
chat wherever you prefer, switch any time.

## Connect

**Prerequisite:** the dashboard is running (`npm run dev` in this repo).

### Claude Code (one command, from the repo root)

```bash
claude mcp add agent-maker -- npx tsx src/mcp/server.ts
```

Then just ask: *"Set up my agent company."*

### Claude Desktop (`claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "agent-maker": {
      "command": "npx",
      "args": ["tsx", "C:/path/to/agent-maker/src/mcp/server.ts"],
      "env": { "DASHBOARD_URL": "http://localhost:4000" }
    }
  }
}
```

`DASHBOARD_URL` is optional — it defaults to `http://localhost:4000`
(or `http://localhost:$DASHBOARD_PORT`). Set it if the dashboard runs elsewhere.

## What your agent can do

| Tool | What it does |
|---|---|
| `get_started` | Your dashboard link, onboarding state, setup checklist, live summary, next steps |
| `onboard_company` | The intake wizard, conversationally — installs your starter agent pack |
| `setup_status` | Priority-ordered integrations checklist (booleans only — see below) |
| `company_status` | Live snapshot: agents, goals, task progress, messages, run memory |
| `launch_goal` | Give the CEO a business goal |
| `message_agent` | Talk to the CEO or any worker on the company bus |
| `pending_approvals` / `resolve_approval` | See and (on **your** explicit say-so) resolve escalations and org-plan approvals |
| `set_autonomy` | Assisted (plans wait for you) vs autonomous |
| `run_security_demo` | Fire the poisoned-document red-team demo and watch the gate catch it |
| `latest_eval_report` | Which models cleared the Instruction-Following Ladder |
| `explain` | Product tour topics: overview, security, setup-chain, whats-real-vs-sim, architecture |

## Secret hygiene (why your agent never asks for keys)

The MCP surface **cannot read or accept credential values**. Setup status is booleans
only; API keys are pasted into the dashboard's BUSINESS SETUP card, which stores them
server-side without echoing them anywhere a model can see. If any agent asks you to
paste a secret into chat — don't. That's the design working.

## How it works

`src/mcp/server.ts` is a zero-dependency stdio MCP server (newline-delimited JSON-RPC,
pure Node stdlib — same rule as the rest of the repo). It's a thin client over the
dashboard's HTTP API, so there is exactly one source of truth: whatever the dashboard
shows, your agent sees, including the new `GET /api/snapshot` endpoint.
