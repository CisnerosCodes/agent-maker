// Company profile — the onboarding intake. The system integrates with a real
// company at startup instead of assuming a blank one: what they want out of it,
// what they already have (store? socials? email domain?), which starter agents
// to install, and any context they can hand the agents.
//
// Persisted to data/company.json; the CEO reads it at plan time to tailor
// objectives (e.g. "add products to YOUR store" vs "create a dev store"),
// and the dashboard uses it to order BUSINESS SETUP by what matters to THEM.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";

const DATA_DIR = process.env.REGISTRY_DIR ?? "./data";
const FILE = `${DATA_DIR}/company.json`;
const CONTEXT_FILE = `${DATA_DIR}/company-context.md`;

export type Objective = "store" | "marketing" | "research" | "email-automation" | "everything";

export interface CompanyProfile {
  name: string;                 // company / idea name
  niche: string;                // what they sell / who they serve
  objective: Objective;         // what they want OUT of this
  objectiveNote?: string;       // their own words
  hasStore: boolean;
  storeUrl?: string;            // existing store, if any
  wantsStoreSetup: boolean;     // no store yet but wants one
  assets: string[];             // what they already have: "email-domain" | "socials" | "product-list" | "brand"
  starterAgents: string[];      // roles installed at onboarding
  hasContext: boolean;          // true when company-context.md has content
  createdAt: string;
}

// Starter agent packs — barebones, ready-to-integrate role bundles (the "Pi
// but for agents" idea). Objective -> recommended roles + a suggested first goal.
export const STARTER_PACKS: Record<Objective, { label: string; roles: string[]; firstGoal: (p: { niche: string }) => string }> = {
  store: {
    label: "Store launch pack",
    roles: ["research", "store-builder", "copywriter"],
    firstGoal: (p) => `Launch a Shopify store for ${p.niche}`,
  },
  marketing: {
    label: "Marketing pack",
    roles: ["research", "strategist", "copywriter"],
    firstGoal: (p) => `Run a social media marketing campaign for ${p.niche}`,
  },
  research: {
    label: "Research pack",
    roles: ["research", "analyst"],
    firstGoal: (p) => `Research the market for ${p.niche}`,
  },
  "email-automation": {
    label: "Email pack",
    roles: ["research", "copywriter"],
    firstGoal: (p) => `Write an email welcome sequence for ${p.niche} customers`,
  },
  everything: {
    label: "Solo-founder pack (everything)",
    roles: ["research", "store-builder", "copywriter", "strategist"],
    firstGoal: (p) => `Launch a Shopify store for ${p.niche}`,
  },
};

let cached: CompanyProfile | null | undefined; // undefined = not loaded yet

export function companyProfile(): CompanyProfile | null {
  if (cached === undefined) {
    if (existsSync(FILE)) {
      try { cached = JSON.parse(readFileSync(FILE, "utf8")); }
      catch { console.warn(`[company] corrupt ${FILE} — onboarding will re-run`); cached = null; }
    } else cached = null;
  }
  return cached ?? null;
}

export function saveCompanyProfile(input: Partial<CompanyProfile> & { context?: string }): CompanyProfile {
  const { context, ...rest } = input;
  const objective = (Object.keys(STARTER_PACKS) as Objective[]).includes(rest.objective as Objective)
    ? (rest.objective as Objective) : "everything";
  const profile: CompanyProfile = {
    name: String(rest.name ?? "").slice(0, 120) || "My company",
    niche: String(rest.niche ?? "").slice(0, 200) || "the target market",
    objective,
    objectiveNote: rest.objectiveNote ? String(rest.objectiveNote).slice(0, 1000) : undefined,
    hasStore: Boolean(rest.hasStore),
    storeUrl: rest.storeUrl ? String(rest.storeUrl).slice(0, 300) : undefined,
    wantsStoreSetup: Boolean(rest.wantsStoreSetup),
    assets: Array.isArray(rest.assets) ? rest.assets.map(String).slice(0, 20) : [],
    starterAgents: Array.isArray(rest.starterAgents) && rest.starterAgents.length
      ? rest.starterAgents.map(String).slice(0, 10)
      : STARTER_PACKS[objective].roles,
    hasContext: Boolean(context?.trim()),
    createdAt: companyProfile()?.createdAt ?? new Date().toISOString(),
  };
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(FILE, JSON.stringify(profile, null, 2));
  // Freeform context (docs, product lists, notes) — agents read this as an
  // ingested document, which means it passes the SecurityGate like any input.
  if (context?.trim()) writeFileSync(CONTEXT_FILE, context.trim() + "\n");
  cached = profile;
  return profile;
}

export function companyContext(): string {
  if (!existsSync(CONTEXT_FILE)) return "";
  try { return readFileSync(CONTEXT_FILE, "utf8"); } catch { return ""; }
}

export function suggestedFirstGoal(): string | null {
  const p = companyProfile();
  if (!p) return null;
  return STARTER_PACKS[p.objective].firstGoal({ niche: p.niche });
}
