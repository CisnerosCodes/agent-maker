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

export interface RoleTemplate {
  role: string;
  titleFor: (ctx: PlanContext) => string;
  objectiveFor: (ctx: PlanContext) => string;
  tools: string[];
  credentials: string[];
  policyTemplate: string;
  estimateSec: number;
  dependsOn: number[]; // indices into the playbook's roles array
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
        titleFor: () => "Build: products & collections in the dev store",
        objectiveFor: () => "Create products, collections and theme settings in the Shopify dev store from research output",
        tools: ["shopify-admin"], credentials: ["SHOPIFY_ADMIN_TOKEN"], policyTemplate: "worker-storebuilder.yaml",
        estimateSec: 40, dependsOn: [0],
      },
      {
        role: "copywriter",
        titleFor: (c) => `Copy: descriptions & brand voice for ${c.niche}`,
        objectiveFor: (c) => `Write product descriptions and store copy for ${c.niche}`,
        tools: [], credentials: [], policyTemplate: "worker-minimal.yaml",
        estimateSec: 22, dependsOn: [0],
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
        estimateSec: 26, dependsOn: [0],
      },
      {
        role: "copywriter",
        titleFor: (c) => `Copy: ad & social creative for ${c.niche}`,
        objectiveFor: (c) => `Write ad headlines and social posts for ${c.niche} per the strategy`,
        tools: [], credentials: [], policyTemplate: "worker-minimal.yaml",
        estimateSec: 22, dependsOn: [1],
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
        estimateSec: 20, dependsOn: [0],
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
