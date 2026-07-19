// Role library — the "growing library of roles" the CEO hires from.
//
// Honesty (per Sky's critique): the Factory INSTANTIATES roles from this
// library; it does not invent arbitrary agents. Adding a role = adding an entry
// here (+ a policy YAML). A playbook is an ordered set of roles matched to a
// goal by keyword. New playbooks/roles slot in without touching orchestrator
// logic — that's what makes "hires from a growing library" true rather than a
// hardcoded if/else.
//
// Swap point: replace matchPlaybook() with a ModelBackend classifier (same
// interface as src/evals/backends.ts) to select/compose roles for off-script
// goals instead of keyword matching.
//
// Borrowed patterns (full source map + licenses: docs/BORROWED_PATTERNS.md):
//  - handoff artifact contracts + the ANYTHING_UNCLEAR channel — MetaGPT (MIT)
//  - bounded review cycles, "ONE highest-priority issue or Finished" — ChatDev (Apache-2.0)
//  - playbook decompositions (marketing pipeline, brand-search-optimization,
//    llm-auditor critic→reviser, customer-service thresholds) — google/adk-samples (Apache-2.0)
//  - role voice ("vibe") lines — msitarzewski/agency-agents (MIT, © 2025 AgentLand Contributors)

import { companyProfile } from "../config/company.js";

// Execution class (worker-capability §1). EVERY role belongs to exactly one.
// A role with no execution class does not ship in a playbook — this is what
// kills the ghost `strategist`/`analyst` (they are the cheapest class, pure-LLM).
//   broker-ingest  — harness fetches + scan()s external data, model summarizes (research)
//   tool-workflow  — sandbox agent drives allowlisted API calls (store-builder)
//   pure-LLM       — single dispatch: prompt in, completion out (copywriter/strategist/analyst)
export type ExecutionClass = "broker-ingest" | "tool-workflow" | "pure-LLM";

// Handoff-contract tag (worker-capability §4). One validator per tag, harness-side.
//   products — non-empty array of { title: string, price: number, image? }
//   text     — non-empty trimmed string
//   url      — parseable https URL
export type OutputSchema = "products" | "text" | "url";

export interface RoleTemplate {
  role: string;
  titleFor: (ctx: PlanContext) => string;
  objectiveFor: (ctx: PlanContext) => string;
  tools: string[];
  credentials: string[];
  policyTemplate: string;
  estimateSec: number;
  dependsOn: number[]; // indices into the playbook's roles array
  reasoning: "low" | "medium" | "high"; // Nemotron thinking budget per role (Sky spec §6.2)
  // Optional enrichments (additive — engine ignores them except milestoneFor()):
  handoff?: string; // named artifact this role delivers downstream (MetaGPT SOP-style contract)
  vibe?: string;    // one-line personality for the agent card (agency-agents)
  milestones?: (ctx: { niche: string }) => { mid: string; done: string }; // sim-mode chatter for roles without bespoke orchestrator copy
  // Worker-capability enrichments (§1/§2/§4), present on the core commerce roles.
  // Optional: the live generic path (runGenericRole) builds its prompt from the
  // spec's objective + handoff, so a role runs real without any of these.
  executionClass?: ExecutionClass; // §1 — how this role becomes executable work
  outputSchema?: OutputSchema; // §4 — handoff-contract tag validated at every edge
  promptFor?: (ctx: PlanContext, upstream: unknown) => string; // §2 — bespoke task prompt
}

// Render upstream output into a compact prompt fragment. Products become
// "title ($price); ..."; strings pass through; anything else is JSON-clipped.
export function renderUpstream(upstream: unknown): string {
  if (upstream == null) return "(no upstream output)";
  if (typeof upstream === "string") return upstream;
  if (Array.isArray(upstream)) {
    return upstream
      .map((p: any) =>
        p && typeof p === "object" && "title" in p
          ? `${p.title}${p.price != null ? ` ($${p.price})` : ""}`
          : String(p),
      )
      .join("; ");
  }
  return JSON.stringify(upstream).slice(0, 800);
}

export interface Playbook {
  id: string;
  match: RegExp;
  description: string;
  roles: RoleTemplate[];
}

export interface PlanContext {
  goalText: string;
  niche: string;
  idSuffix: string;
}

const research: RoleTemplate = {
  role: "research",
  titleFor: (c) => `Research: best-selling ${c.niche} products & competitors`,
  objectiveFor: (c) => `Find 10 trending ${c.niche} products with prices, images and competitor positioning`,
  tools: ["web-fetch"],
  credentials: [],
  policyTemplate: "worker-research.yaml",
  estimateSec: 28,
  dependsOn: [],
  reasoning: "medium", // summarize/extract over ingested docs
  executionClass: "broker-ingest",
  outputSchema: "products",
  // `upstream` here is the harness-fetched product list (broker-ingest): the
  // model summarizes the opportunity from it.
  promptFor: (c, upstream) =>
    `You are a retail research analyst. In 3 sentences, summarize the opportunity for a "${c.niche}" store given these products (title/price): ${renderUpstream(upstream)}. Be concrete about price band and which 3 products to lead with.`,
};

export const PLAYBOOKS: Playbook[] = [
  {
    id: "store-launch",
    match: /store|shop|shopify|e-?commerce|sell/i,
    description: "Launch an online store: research → build → copy",
    roles: [
      research,
      {
        role: "store-builder",
        titleFor: () => {
          const p = companyProfile();
          return p?.hasStore ? "Build: add products & collections to YOUR store" : "Build: products & collections in the dev store";
        },
        objectiveFor: () => {
          const p = companyProfile();
          return p?.hasStore
            ? `Add products, collections and theme settings to the existing store${p.storeUrl ? ` at ${p.storeUrl}` : ""} from research output`
            : "Create products, collections and theme settings in the Shopify dev store from research output";
        },
        tools: ["shopify-admin"], credentials: ["SHOPIFY_ADMIN_TOKEN"], policyTemplate: "worker-storebuilder.yaml",
        estimateSec: 40, dependsOn: [0], reasoning: "low", // mostly templated tool calls
        executionClass: "tool-workflow", outputSchema: "url",
        promptFor: (_c, upstream) =>
          `Create up to 3 products in the store from this research shortlist, using the given titles, prices and images: ${renderUpstream(upstream)}.`,
      },
      {
        role: "copywriter",
        titleFor: (c) => `Copy: descriptions & brand voice for ${c.niche}`,
        objectiveFor: (c) => `Write product descriptions and store copy for ${c.niche}`,
        tools: [], credentials: [], policyTemplate: "worker-minimal.yaml",
        estimateSec: 22, dependsOn: [0], reasoning: "low", // short-form generation
        executionClass: "pure-LLM", outputSchema: "text",
        promptFor: (c, upstream) =>
          `Write a punchy one-line product description for each of these ${c.niche} products (format "Title — description"): ${renderUpstream(upstream)}`,
      },
    ],
  },
  {
    id: "marketing-agency",
    match: /marketing|campaign|ads?|growth|brand|social/i,
    description: "Marketing campaign: research → strategy → copy",
    roles: [
      { ...research, titleFor: (c) => `Research: ${c.niche} audience & channels`, objectiveFor: (c) => `Research the ${c.niche} audience, competitors and best-performing channels` },
      {
        role: "strategist",
        titleFor: (c) => `Strategy: campaign plan for ${c.niche}`,
        objectiveFor: (c) => `Design a channel-by-channel campaign plan for ${c.niche} from research`,
        tools: [], credentials: [], policyTemplate: "worker-minimal.yaml",
        estimateSec: 26, dependsOn: [0], reasoning: "high", // planning needs headroom
        executionClass: "pure-LLM", outputSchema: "text",
        promptFor: (c, upstream) =>
          `You are a marketing strategist. Design a concise channel-by-channel campaign plan for a "${c.niche}" brand, grounded in this research: ${renderUpstream(upstream)}. Cover audience, the top 3 channels, and a 2-line budget split.`,
      },
      {
        role: "copywriter",
        titleFor: (c) => `Copy: ad & social creative for ${c.niche}`,
        objectiveFor: (c) => `Write ad headlines and social posts for ${c.niche} per the strategy`,
        tools: [], credentials: [], policyTemplate: "worker-minimal.yaml",
        estimateSec: 22, dependsOn: [1], reasoning: "low",
        executionClass: "pure-LLM", outputSchema: "text",
        promptFor: (c, upstream) =>
          `Write 3 ad headlines and 2 social posts for a "${c.niche}" brand, following this campaign strategy: ${renderUpstream(upstream)}`,
      },
    ],
  },
  {
    // ADK brand-search-optimization shape: keywords → live SERP recon → rewrites.
    id: "seo-optimization",
    match: /\b(seo|keywords?|search rank(?:ing)?s?|listings?)\b/i,
    description: "SEO: mine keywords → scout search results → rewrite listings",
    roles: [
      {
        role: "keyword-miner",
        titleFor: (c) => `Keywords: mine ${c.niche} search terms`,
        objectiveFor: (c) => `Mine ${c.niche} brand and product keywords from the catalog and competitors; deliver a ranked keyword set labeled by intent.`,
        tools: ["web-fetch"], credentials: [], policyTemplate: "worker-research.yaml",
        estimateSec: 22, dependsOn: [], reasoning: "medium",
        handoff: "ranked keyword set", vibe: "Knows what your customers type before they do.",
        milestones: (c) => ({
          mid: `Catalog and competitor terms collected for ${c.niche}; ranking by intent now.`,
          done: "Keyword set delivered — ranked and intent-labeled for the search scout.",
        }),
      },
      {
        role: "search-scout",
        titleFor: () => "SERP recon: what top results do differently",
        objectiveFor: (c) => `Run the keyword set against live search results for ${c.niche}; capture what top-ranking competitor titles and pages do differently from ours.`,
        tools: ["web-fetch"], credentials: [], policyTemplate: "worker-research.yaml",
        estimateSec: 24, dependsOn: [0], reasoning: "medium",
        handoff: "SERP findings", vibe: "Reads page one of the results so you can own it.",
        milestones: () => ({
          mid: "Top-ranking pages captured for the head keywords; diffing against our listings.",
          done: "SERP findings posted — the gap between our listings and page-one competitors is documented.",
        }),
      },
      {
        role: "listing-optimizer",
        titleFor: (c) => `Rewrite: close the search gap for ${c.niche}`,
        objectiveFor: () => `Rewrite product titles and descriptions to close the gap: compare ours against the top results and propose each rewrite with its reasoning.`,
        tools: [], credentials: [], policyTemplate: "worker-minimal.yaml",
        estimateSec: 20, dependsOn: [1], reasoning: "low",
        handoff: "rewritten listings", vibe: "Every title earns its place on page one.",
        milestones: () => ({
          mid: "First rewrites drafted with per-change reasoning; working down the keyword set.",
          done: "Rewritten listings delivered — each change justified against the SERP findings.",
        }),
      },
    ],
  },
  {
    // ADK customer-service pattern: knowledge base → macros with approval
    // thresholds (self-approve routine, escalate exceptions) → audit pass.
    id: "customer-support",
    match: /\b(support|customer service|helpdesk|help desk|faq|tickets?)\b/i,
    description: "Customer support: knowledge base → macros with escalation thresholds → audit",
    roles: [
      {
        role: "kb-curator",
        titleFor: (c) => `Knowledge base: ${c.niche} facts & policies`,
        objectiveFor: (c) => `Assemble the support knowledge base for ${c.niche}: top customer questions, product facts, refund and shipping policies — with a source for every answer.`,
        tools: ["web-fetch"], credentials: [], policyTemplate: "worker-research.yaml",
        estimateSec: 24, dependsOn: [], reasoning: "medium",
        handoff: "knowledge base", vibe: "Every answer has a receipt.",
        milestones: () => ({
          mid: "Top questions and policy facts collected; attaching a source to every answer.",
          done: "Knowledge base assembled — every answer sourced, ready for the macro writer.",
        }),
      },
      {
        role: "support-writer",
        titleFor: () => "Macros & FAQ: replies within policy thresholds",
        objectiveFor: () => `Write reply macros and the FAQ from the knowledge base. Routine answers within policy thresholds are self-approved; anything above threshold (discounts, exceptions, refunds beyond policy) escalates to the CEO for approval — never self-approved.`,
        tools: [], credentials: [], policyTemplate: "worker-minimal.yaml",
        estimateSec: 22, dependsOn: [0], reasoning: "low",
        handoff: "FAQ + reply macros", vibe: "Kind on the surface, policy-exact underneath.",
        milestones: () => ({
          mid: "Routine macros drafted within thresholds; flagging above-threshold cases for escalation.",
          done: "FAQ and macros delivered — above-threshold exceptions routed to the CEO, not self-approved.",
        }),
      },
      {
        role: "qa-auditor",
        titleFor: () => "Audit: verify every macro against the knowledge base",
        objectiveFor: () => `Verify each macro claim against the knowledge base: report the ONE highest-priority mismatch per pass and hand it back — or conclude Finished.`,
        tools: [], credentials: [], policyTemplate: "worker-minimal.yaml",
        estimateSec: 18, dependsOn: [1], reasoning: "medium",
        handoff: "audit verdict", vibe: "Trusts nothing it hasn't checked twice.",
        milestones: () => ({
          mid: "Cross-checking macros against sourced answers; one mismatch flagged so far.",
          done: "Audit concluded Finished — every macro claim traced back to the knowledge base.",
        }),
      },
    ],
  },
  {
    // ADK llm-auditor shape (critic → reviser) + hello-agents Reflection paradigm:
    // a staffable quality team the CEO can point at any material.
    id: "fact-check",
    match: /\b(fact-?check|verify|audit)\b/i,
    description: "Fact-check: extract & verify claims → revise only what failed",
    roles: [
      {
        role: "critic",
        titleFor: (c) => `Critic: verify claims in ${c.goalText.slice(0, 40)}`,
        objectiveFor: (c) => `Extract every verifiable claim in the source material for "${c.goalText}", check each against independent sources, and deliver a per-claim verdict (accurate / inaccurate / unverifiable) with citations.`,
        tools: ["web-fetch"], credentials: [], policyTemplate: "worker-research.yaml",
        estimateSec: 26, dependsOn: [], reasoning: "high",
        handoff: "per-claim audit verdicts", vibe: "Splits prose into claims and makes each one prove itself.",
        milestones: () => ({
          mid: "Claims extracted; checking each against independent sources.",
          done: "Audit verdicts delivered — every claim marked accurate, inaccurate, or unverifiable, with citations.",
        }),
      },
      {
        role: "reviser",
        titleFor: () => "Reviser: fix only what the critic flagged",
        objectiveFor: () => `Rewrite the material fixing ONLY the claims the critic flagged — keep everything verified intact, and note each change made.`,
        tools: [], credentials: [], policyTemplate: "worker-minimal.yaml",
        estimateSec: 18, dependsOn: [0], reasoning: "medium",
        handoff: "revised draft", vibe: "Surgical edits, no collateral rewrites.",
        milestones: () => ({
          mid: "Correcting flagged claims one by one; verified text untouched.",
          done: "Revised draft delivered — flagged claims fixed, every change noted, verified content intact.",
        }),
      },
    ],
  },
  {
    // MetaGPT's software-company SOP (PM → Architect → Engineer → QA), each role
    // handing a named artifact downstream; review bounded ChatDev-style.
    // NOTE: broad keyword net (app/saas/tool…) — must stay BELOW the narrow
    // intent playbooks (seo, support, fact-check) so specific goals win.
    id: "software-shipping",
    match: /\b(app|web ?app|website|landing page|mvp|saas|prototype|software|api|dashboard|tool)\b/i,
    description: "Ship software: PRD → design → build → bounded review",
    roles: [
      {
        role: "product-manager",
        titleFor: (c) => `PRD: requirements for ${c.niche}`,
        objectiveFor: (c) => `Write the PRD for "${c.goalText}": up to 3 orthogonal product goals, 3-5 scenario-based user stories, and the top-5 requirements ranked P0-P2. End with ANYTHING_UNCLEAR — open questions travel with the artifact instead of being dropped.`,
        tools: [], credentials: [], policyTemplate: "worker-minimal.yaml",
        estimateSec: 24, dependsOn: [], reasoning: "high",
        handoff: "PRD", vibe: "Turns a one-line idea into a spec a team can build.",
        milestones: () => ({
          mid: "Product goals and user stories drafted; ranking the requirement pool P0-P2 now.",
          done: "PRD delivered — 3 goals, user stories, top-5 requirements (P0-P2). ANYTHING_UNCLEAR items routed to the CEO.",
        }),
      },
      {
        role: "architect",
        titleFor: (c) => `Design: system architecture for ${c.niche}`,
        objectiveFor: () => `Turn the PRD into a system design: implementation approach, file list, data structures & interfaces, and program call flow. Mark interfaces clearly — downstream implements exactly this, no improvising. End with ANYTHING_UNCLEAR.`,
        tools: [], credentials: [], policyTemplate: "worker-minimal.yaml",
        estimateSec: 26, dependsOn: [0], reasoning: "high",
        handoff: "system design", vibe: "Draws the boundaries everyone else builds inside.",
        milestones: () => ({
          mid: "Implementation approach picked; locking the interface and call-flow contracts.",
          done: "System design handed off — file list, interfaces and call flow locked for the builder.",
        }),
      },
      {
        role: "builder",
        titleFor: (c) => `Build: working prototype for ${c.niche}`,
        objectiveFor: (c) => `Implement the design for "${c.goalText}": follow the design document exactly (never alter interfaces), core user flow first, pre-built components where possible, no TODO placeholders.`,
        tools: [], credentials: [], policyTemplate: "worker-minimal.yaml",
        estimateSec: 40, dependsOn: [1], reasoning: "medium",
        handoff: "working build", vibe: "Turns an idea into a working prototype before the meeting's over.",
        milestones: () => ({
          mid: "Core flow implemented against the locked interfaces; wiring secondary states.",
          done: "Build complete — core flow working, implemented to the design document, no TODO placeholders.",
        }),
      },
      {
        role: "qa-reviewer",
        titleFor: () => "Review: bounded QA passes against the PRD",
        objectiveFor: () => `Review the build in at most 3 passes: each pass, report the ONE highest-priority issue and hand it back for a fix — or conclude Finished. Verify the PRD's P0 requirements are met.`,
        tools: [], credentials: [], policyTemplate: "worker-minimal.yaml",
        estimateSec: 20, dependsOn: [2], reasoning: "medium",
        handoff: "review verdict", vibe: "Finds the one bug that matters before anyone else does.",
        milestones: () => ({
          mid: "Pass 1: highest-priority issue reported and handed back for a fix.",
          done: "Review concluded Finished — P0 requirements verified within bounded passes.",
        }),
      },
    ],
  },
  {
    id: "market-research",
    match: /.*/, // fallback playbook
    description: "General research: gather → synthesize",
    roles: [
      { ...research, tools: ["web-fetch"], credentials: [], titleFor: (c) => `Research: ${c.goalText.slice(0, 50)}`, objectiveFor: (c) => `Research and gather sources for: ${c.goalText}` },
      {
        role: "analyst",
        titleFor: () => "Synthesize findings into a brief",
        objectiveFor: (c) => `Turn research findings into an actionable brief for: ${c.goalText}`,
        tools: [], credentials: [], policyTemplate: "worker-minimal.yaml",
        estimateSec: 20, dependsOn: [0], reasoning: "medium",
        executionClass: "pure-LLM", outputSchema: "text",
        promptFor: (c, upstream) =>
          `You are a research analyst. Turn these findings into an actionable brief for: ${c.goalText}. Findings: ${renderUpstream(upstream)}. Give 3 key takeaways and 2 recommended next actions.`,
      },
    ],
  },
];

// Run-3 learning (Sage): first-match routing sent an SEO goal ("…webshop —
// search rankings, keyword set, listings") to store-launch because "webshop"
// contains "shop". Score every playbook by how many of its keywords actually
// hit and pick the strongest signal; ties keep array order. market-research
// stays the fallback when nothing matches at all.
export function matchPlaybook(goalText: string): Playbook {
  let best: Playbook | undefined;
  let bestScore = 0;
  for (const p of PLAYBOOKS) {
    if (p.id === "market-research") continue;
    const hits = goalText.match(new RegExp(p.match.source, "gi"))?.length ?? 0;
    if (hits > bestScore) {
      best = p;
      bestScore = hits;
    }
  }
  return best ?? PLAYBOOKS.find((p) => p.id === "market-research")!;
}

export function roleNames(): string[] {
  return [...new Set(PLAYBOOKS.flatMap((p) => p.roles.map((r) => r.role)))];
}

// Sim-mode milestone copy for roles the orchestrator has no bespoke case for.
// First template that declares milestones for the role wins.
export function milestoneFor(role: string, niche: string): { mid: string; done: string } | undefined {
  for (const p of PLAYBOOKS) {
    const r = p.roles.find((t) => t.role === role && t.milestones);
    if (r?.milestones) return r.milestones({ niche });
  }
  return undefined;
}

// First RoleTemplate matching a role name, across all playbooks. Roles are
// identical enough in execution class/output schema across playbooks that the
// first match is authoritative for capability lookups.
export function roleTemplateFor(role: string): RoleTemplate | undefined {
  for (const pb of PLAYBOOKS) {
    const r = pb.roles.find((x) => x.role === role);
    if (r) return r;
  }
  return undefined;
}

// Execution class for a role name (worker-capability §1). Undefined = the role
// declares no bespoke execution class and runs via the generic path.
export function executionClassOf(role: string): ExecutionClass | undefined {
  return roleTemplateFor(role)?.executionClass;
}
