// Env loading + guided business setup.
//
// Two jobs:
//  1. loadEnv(): parse ./.env at boot (no dotenv dependency) so keys pasted by
//     the operator persist across restarts. Never overrides already-set vars.
//  2. The INTEGRATIONS table: what each credential unlocks, where a
//     non-technical operator gets it, and which env vars it needs. The
//     dashboard's BUSINESS SETUP card renders from this.
//
// SECRET HYGIENE (hard rule): values flow one way — dashboard form -> POST
// /api/setup -> process.env + .env file. The status API returns BOOLEANS only.
// Values are never echoed back, never logged, never posted to the bus, and the
// bus is the only thing agent prompts are built from — so no model ever sees a
// raw secret.

import { readFileSync, writeFileSync, existsSync } from "node:fs";

const ENV_FILE = process.env.ENV_FILE ?? "./.env";

export function loadEnv(): void {
  if (!existsSync(ENV_FILE)) return;
  try {
    for (const line of readFileSync(ENV_FILE, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      const [, key, rawValue] = m;
      const value = rawValue.replace(/^["']|["']$/g, "").replace(/\s+#.*$/, "").trim();
      if (value && process.env[key] === undefined) process.env[key] = value;
    }
  } catch (err: any) {
    console.warn(`[env] could not parse ${ENV_FILE}: ${err.message}`);
  }
}

export interface Integration {
  id: string;
  label: string;              // plain-English name for the setup card
  unlocks: string;            // what turns REAL when this is connected
  link: string;               // where the operator gets the credential
  hint?: string;              // one-line non-technical instruction
  keys: string[];             // env vars required (ALL must be set to count)
  roles: string[];            // pipeline roles this integration makes real
}

export const INTEGRATIONS: Integration[] = [
  {
    id: "shopify",
    label: "Shopify store",
    unlocks: "The store-builder creates real products in YOUR store — the store link at the end becomes real.",
    link: "https://www.shopify.com/partners", // free dev store; admin token under Apps > Develop apps
    hint: "Create a free dev store, then Settings > Apps > Develop apps > create app > Admin API token.",
    keys: ["SHOPIFY_ADMIN_TOKEN", "SHOPIFY_STORE_URL"],
    roles: ["store-builder"],
  },
  {
    id: "brain-anthropic",
    label: "AI brain (Claude)",
    unlocks: "Copywriter, strategist and analyst produce real AI output instead of canned text.",
    link: "https://console.anthropic.com/settings/keys",
    hint: "Create an API key and paste it here.",
    keys: ["ANTHROPIC_API_KEY"],
    roles: ["copywriter", "strategist", "analyst"],
  },
  {
    id: "brain-nvidia",
    label: "AI brain (NVIDIA Nemotron)",
    unlocks: "Same as the Claude brain, on the sponsor's Nemotron models (bounty track). Either brain works.",
    link: "https://build.nvidia.com",
    hint: "Sign in, generate an API key (starts with nvapi-).",
    keys: ["NVIDIA_INFERENCE_API_KEY"],
    roles: ["copywriter", "strategist", "analyst"],
  },
  {
    id: "apify",
    label: "Live product research (Apify)",
    unlocks: "Research scrapes real live products for your niche instead of a labeled sample catalog.",
    link: "https://console.apify.com/sign-up", // hackathon coupon: AITX_NVIDIA_CLAW_HACK
    hint: "Sign up (coupon AITX_NVIDIA_CLAW_HACK gives $50), copy your API token; actor e.g. junglee/amazon-crawler.",
    keys: ["APIFY_TOKEN", "APIFY_ACTOR"],
    roles: ["research"],
  },
  {
    id: "hiddenlayer",
    label: "AI security scanning (HiddenLayer)",
    unlocks: "Authoritative threat scanning on everything agents read and write (on top of the built-in floor).",
    link: "https://hiddenlayer.com", // event code AITX-2026
    hint: "Use event code AITX-2026, create OAuth client credentials.",
    keys: ["HIDDENLAYER_CLIENT_ID", "HIDDENLAYER_CLIENT_SECRET"],
    roles: [],
  },
  {
    id: "resend",
    label: "Agent email identities (Resend)",
    unlocks: "Each hired agent gets a working company email address.",
    link: "https://resend.com/api-keys",
    keys: ["RESEND_API_KEY"],
    roles: [],
  },
];

// Env vars the setup endpoint may write. Anything else is refused.
const WRITABLE = new Set(INTEGRATIONS.flatMap((i) => i.keys));

export function integrationConnected(i: Integration): boolean {
  return i.keys.every((k) => Boolean(process.env[k]));
}

// Booleans ONLY — this shape goes to the browser.
export function setupStatus() {
  return INTEGRATIONS.map((i) => ({
    id: i.id,
    label: i.label,
    unlocks: i.unlocks,
    link: i.link,
    hint: i.hint,
    roles: i.roles,
    keys: i.keys.map((k) => ({ name: k, set: Boolean(process.env[k]) })),
    connected: integrationConnected(i),
  }));
}

// Missing integrations that would make the given roles more real. A single
// connected brain (Claude OR Nemotron) satisfies both brain rows.
export function missingFor(roles: string[]): Integration[] {
  const brainConnected = INTEGRATIONS.filter((i) => i.id.startsWith("brain-")).some(integrationConnected);
  return INTEGRATIONS.filter((i) => {
    if (!i.roles.some((r) => roles.includes(r))) return false;
    if (i.id.startsWith("brain-")) return !brainConnected;
    return !integrationConnected(i);
  }).filter((i, idx, arr) => !i.id.startsWith("brain-") || arr.findIndex((x) => x.id.startsWith("brain-")) === idx);
}

// Persist a credential: process.env now (live pickup) + .env for next boot.
// Returns nothing about the value; throws on unknown keys. NEVER log the value.
export function saveEnvVar(key: string, value: string): void {
  if (!WRITABLE.has(key)) throw new Error(`"${key}" is not a configurable credential`);
  const trimmed = value.trim();
  if (!trimmed) throw new Error("empty value");
  process.env[key] = trimmed;
  const lines = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, "utf8").split(/\r?\n/) : [];
  const idx = lines.findIndex((l) => l.match(new RegExp(`^\\s*${key}\\s*=`)));
  const entry = `${key}=${trimmed}`;
  if (idx >= 0) lines[idx] = entry;
  else lines.push(entry);
  writeFileSync(ENV_FILE, lines.join("\n").replace(/\n*$/, "\n"));
  console.log(`[env] ${key} saved (value not logged)`);
}
