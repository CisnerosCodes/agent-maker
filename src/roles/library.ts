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
  executionClass: ExecutionClass; // §1 — how this role becomes executable work
  outputSchema: OutputSchema; // §4 — handoff-contract tag validated at every edge
  // §2 — the role's task prompt, built from plan context + validated upstream output.
  // Pure-LLM roles become REAL for the price of this field + outputSchema alone;
  // adding a role's real path touches library.ts only (the "generic" acceptance test).
  promptFor: (ctx: PlanContext, upstream: unknown) => string;
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
  tools: ["apify", "web-fetch"],
  credentials: ["APIFY_TOKEN"],
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

export function matchPlaybook(goalText: string): Playbook {
  return PLAYBOOKS.find((p) => p.id !== "market-research" && p.match.test(goalText))
    ?? PLAYBOOKS.find((p) => p.id === "market-research")!;
}

export function roleNames(): string[] {
  return [...new Set(PLAYBOOKS.flatMap((p) => p.roles.map((r) => r.role)))];
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
// is not in any playbook, i.e. it has no execution path and must not ship.
export function executionClassOf(role: string): ExecutionClass | undefined {
  return roleTemplateFor(role)?.executionClass;
}