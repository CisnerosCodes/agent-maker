# Borrowed Patterns — external resources applied to Claw Colony

Written July 18 after a research pass over ten agent-ecosystem resources.
What was lifted, from where, under what license, and what was deliberately
deferred. Applied changes are **additive only** (new playbooks + optional
role fields) — no demo-critical path was modified.

## Applied (shipped in `src/roles/library.ts`)

### 1. Four new playbooks (the "growing library" is now visibly growing)

| Playbook | Trigger keywords | Roles | Ported from |
|---|---|---|---|
| `software-shipping` | app, website, mvp, saas, api… | product-manager → architect → builder → qa-reviewer | MetaGPT software-company SOP (PM→Architect→Engineer→QA); ChatDev bounded review; agency-agents Rapid Prototyper voice |
| `seo-optimization` | seo, keywords, rankings, listings | keyword-miner → search-scout → listing-optimizer | google/adk-samples `brand-search-optimization` (keyword_finding → search_results → comparison) |
| `customer-support` | support, helpdesk, faq, tickets | kb-curator → support-writer → qa-auditor | adk-samples `customer-service` (approve-within-threshold / escalate-above-threshold pattern — mirrors our SecurityGate escalation story) |
| `fact-check` | fact-check, verify, audit | critic → reviser | adk-samples `llm-auditor` (critic → reviser SequentialAgent); hello-agents ch4 Reflection paradigm |

Existing playbooks (store-launch, marketing-agency, market-research fallback)
are untouched; new playbooks sit before the fallback so old goals route
exactly as before. New roles run in **labeled sim mode** (workerMode() knows
only research / store-builder / copywriter as real) — same honest-labeling
rule as everything else.

### 2. Handoff artifact contracts (MetaGPT, MIT)

MetaGPT's core trick: roles exchange **named, schema'd artifacts** (PRD →
system design → task list), not chat. Every artifact schema ends with an
`ANYTHING_UNCLEAR` field so uncertainty travels downstream instead of being
silently dropped. Applied as:

- `RoleTemplate.handoff?: string` — the named artifact each role delivers.
- Objectives in the new playbooks are written as artifact contracts
  ("up to 3 orthogonal product goals, 3-5 scenario-based user stories,
  top-5 requirements ranked P0-P2… end with ANYTHING_UNCLEAR").

### 3. Bounded review cycles (ChatDev, Apache-2.0)

ChatDev's CodeReview/Test phases loop with a hard cycle cap and a terminator
("report the ONE highest-priority issue, or `<INFO> Finished`"). The
qa-reviewer / qa-auditor / critic roles carry that exact instruction shape —
review is bounded and conclusive, never an unbounded chat.

### 4. Role voice (`vibe`) + sim milestone copy (agency-agents, MIT)

msitarzewski/agency-agents (230+ agent definitions, MIT, © 2025 AgentLand
Contributors) tags each agent with a one-line `vibe`. Applied as
`RoleTemplate.vibe?` (card flair, free for the dashboard to render) and
`RoleTemplate.milestones?` + `milestoneFor()` so new library roles emit
role-specific bus chatter in sim mode instead of the generic
"Halfway — interim notes posted."

## Ready to build (researched + verified, not yet coded)

### MCP tool discovery for the Factory (official registry + Smithery)

Both registries are **read-open, zero-auth, one stdlib `fetch()`** —
verified live with curl on July 18:

- **Official MCP Registry** (canonical, API frozen at v0.1):
  `GET https://registry.modelcontextprotocol.io/v0.1/servers?search=shopify&version=latest&limit=5`
  → `{ servers: [{ server: { name, description, packages[], remotes[] } }] }`.
  `search` is substring-only. Always pass `version=latest` (else one entry
  per published version). `packages[].environmentVariables[]` and
  `remotes[].headers[]` carry `isSecret` flags.
- **Smithery** (`GET https://registry.smithery.ai/servers?q=…`): semantic
  search, and `GET /servers/{qualifiedName}` returns the server's **full tool
  list with inputSchemas without connecting** — good for dashboard cards.

The build (one evening, hypertool-mcp's "toolset" framing): a role's
Factory step queries the registry with role keywords → candidate cards on
the dashboard (title, description, transport, install id, **required
secrets**, namespace provenance) → operator approves → the Factory drafts
the OpenShell egress-YAML entry from `remotes[].url` hostname + secret
names, and the tool joins that worker's scoped tool table. The approval is
the SecurityGate story; the scoped toolset is the hypertool story.
Optional: expose `discover_tools` / `equip_toolset` on our own MCP server
(`src/mcp/server.ts`) so an outside agent can drive discovery too.

## Deferred (good ideas, wrong week)

- **`causeBy` + watch/subscribe on the bus** (MetaGPT `_watch`): roles wake
  on upstream artifact types instead of Factory-side sequencing. Touches
  bus + worker + dashboard — post-hackathon.
- **Terminator tokens + loop-as-playbook-data** (ChatDev `<INFO>` /
  `break_cycle`): `{ cycle: ["review","revise"], maxCycles: 3 }` in the
  playbook once the real worker loop runs multi-turn.
- **Trajectory eval cases** (ADK `.evalset.json`): per-playbook
  `expected_tool_use` assertions — becomes applicable when the worker loop
  produces tool-call transcripts (same precondition as the Meltdown Onset
  metric in ORCHESTRATION.md).
- **Instructor/assistant phases + communicative dehallucination** (ChatDev):
  a worker may answer an instruction with ONE clarifying question before
  delivering. Our CEO already clarifies at intake; extending it to
  worker-to-worker handoffs is a prompt-policy change on the real loop.
- **codeforge-mcp**: kindred philosophy (network-layer credential injection,
  domain egress allowlists — same idea as our OpenShell policy + Vault),
  nothing to import.

## Sources

- [FoundationAgents/MetaGPT](https://github.com/FoundationAgents/MetaGPT) — MIT
- [OpenBMB/ChatDev](https://github.com/OpenBMB/ChatDev) — Apache-2.0
- [google/adk-samples](https://github.com/google/adk-samples) — Apache-2.0
- [datawhalechina/hello-agents](https://github.com/datawhalechina/hello-agents) — tutorial book (paradigm vocabulary: ReAct / Plan-and-Solve / Reflection)
- [msitarzewski/agency-agents](https://github.com/msitarzewski/agency-agents) — MIT, © 2025 AgentLand Contributors
- [toolprint/hypertool-mcp](https://github.com/toolprint/hypertool-mcp) — toolset/persona framing
- [max-rousseau/codeforge-mcp](https://github.com/max-rousseau/codeforge-mcp) — BSD-3
- [Official MCP Registry](https://registry.modelcontextprotocol.io/docs) / [modelcontextprotocol/registry](https://github.com/modelcontextprotocol/registry)
- [Smithery](https://smithery.ai)
