// Doctor — the system self-check. One list of checks, run two ways:
//   - `npm run doctor` (scripts/doctor.ts) before you even start the server
//   - GET /api/doctor from the dashboard's /setup page, live in front of the user
//
// Every check returns plain English: what was tested, whether it works, and the
// exact next step when it does not. Checks marked live=true actually CALL the
// provider with the saved key — "key is pasted" and "key works" are different
// facts, and the second one is the one that matters (a valid-looking key with
// no credit, a typo'd secret, or an expired token all pass the boolean check
// and then break mid-demo).
//
// SECRET HYGIENE: results carry booleans + human text only. Never key values.

import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";

export type CheckStatus = "pass" | "warn" | "fail" | "skip";

export interface CheckResult {
  id: string;
  label: string;          // plain-English name of the thing checked
  status: CheckStatus;
  detail: string;         // what we found, in one sentence
  fix?: string;           // exact next step when not passing
  group: "core" | "keys" | "data";
  live?: boolean;         // true = this check made a real network call
}

const TIMEOUT = 9000;
const t = () => AbortSignal.timeout(TIMEOUT);

function result(partial: Omit<CheckResult, "status"> & { status: CheckStatus }): CheckResult {
  return partial;
}

// ---------------------------------------------------------------------------
// Core checks — environment, network, data files
// ---------------------------------------------------------------------------

export function checkNode(): CheckResult {
  const major = Number(process.versions.node.split(".")[0]);
  return result({
    id: "node", group: "core", label: "Node.js version",
    status: major >= 20 ? "pass" : "fail",
    detail: `Node ${process.versions.node} detected (need 20 or newer).`,
    fix: major >= 20 ? undefined : "Install Node 22 LTS from https://nodejs.org, then reopen your terminal and run `npm install` again.",
  });
}

export async function checkNetwork(): Promise<CheckResult> {
  try {
    const res = await fetch("https://dummyjson.com/products?limit=1", { signal: t() });
    return result({
      id: "network", group: "core", label: "Internet access (research data source)", live: true,
      status: res.ok ? "pass" : "warn",
      detail: res.ok ? "Outbound requests work — the research agent can fetch real product data."
        : `The sample-catalog source answered HTTP ${res.status}.`,
      fix: res.ok ? undefined : "Check your internet connection / firewall. Without it, launch goals with SIM_MODE=1 in .env so everything runs as labeled simulation.",
    });
  } catch (err: any) {
    return result({
      id: "network", group: "core", label: "Internet access (research data source)", live: true,
      status: "fail",
      detail: `Could not reach the internet (${err.name === "TimeoutError" ? "timed out" : err.message}).`,
      fix: "Check your connection or firewall. To demo fully offline, set SIM_MODE=1 in .env — the whole flow still runs, honestly labeled SIMULATION.",
    });
  }
}

export function checkDataDir(): CheckResult {
  const dir = process.env.REGISTRY_DIR ?? "./data";
  try {
    mkdirSync(dir, { recursive: true });
    const probe = `${dir}/.doctor-probe`;
    writeFileSync(probe, "ok");
    rmSync(probe);
    return result({ id: "data-dir", group: "core", label: "Data folder is writable", status: "pass", detail: `Agents, messages and run memory persist to ${dir}/.` });
  } catch (err: any) {
    return result({
      id: "data-dir", group: "core", label: "Data folder is writable", status: "fail",
      detail: `Cannot write to ${dir}/ (${err.message}).`,
      fix: "Run the app from the repo folder (not a read-only location), or set REGISTRY_DIR in .env to a folder you can write to.",
    });
  }
}

export function checkEnvFile(): CheckResult {
  const exists = existsSync(process.env.ENV_FILE ?? "./.env");
  return result({
    id: "env-file", group: "core", label: ".env file",
    status: exists ? "pass" : "warn",
    detail: exists ? "Found — keys you save in Connections persist across restarts."
      : "No .env file yet. Everything still runs (labeled SIMULATION); keys you paste in Connections will create it.",
    fix: exists ? undefined : "Optional: copy .env.example to .env, or just paste keys in the Connections panel — it writes the file for you.",
  });
}

export function checkEvalData(): CheckResult {
  const dir = process.env.EVALS_DIR ?? "./data/evals";
  const runs = existsSync(dir) ? readdirSync(dir).filter((f) => f.startsWith("run-") && f.endsWith(".json")) : [];
  return result({
    id: "evals", group: "data", label: "Model eval results (the /evals page)",
    status: runs.length ? "pass" : "warn",
    detail: runs.length ? `${runs.length} eval run(s) found — /evals renders immediately.`
      : "No eval runs found — the /evals page will be empty.",
    fix: runs.length ? undefined : "Run `npm run eval -- --backend cli --models haiku --trials 1` (uses your Claude login, no API key), or pull the committed run from git.",
  });
}

// ---------------------------------------------------------------------------
// Key checks — presence AND a real call per provider
// ---------------------------------------------------------------------------

type KeyCheck = { id: string; label: string; envKeys: string[]; probe: () => Promise<{ status: CheckStatus; detail: string; fix?: string }> };

const missing = (label: string, keys: string[]) => ({
  status: "skip" as CheckStatus,
  detail: `Not connected — ${keys.filter((k) => !process.env[k]).join(" and ")} not set. The features it unlocks run as labeled simulation.`,
  fix: `Optional: paste it in the Connections panel (or /setup). ${label} stays simulated until then, which is fine for a demo.`,
});

async function probeAnthropic(): Promise<{ status: CheckStatus; detail: string; fix?: string }> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY!, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: process.env.WORKER_MODEL ?? "claude-haiku-4-5-20251001", max_tokens: 1, messages: [{ role: "user", content: "ping" }] }),
    signal: t(),
  });
  if (res.ok) return { status: "pass", detail: "Claude answered a 1-token test call — copywriter/strategist/analyst will produce real AI output." };
  const body = (await res.text()).slice(0, 300);
  if (res.status === 401) return { status: "fail", detail: "The key was rejected (401 — invalid or revoked).", fix: "Re-copy the key from https://console.anthropic.com/settings/keys and paste it again in Connections." };
  if (res.status === 400 && /credit|billing/i.test(body)) return { status: "fail", detail: "The key is valid but the account is out of credit.", fix: "Add credit at https://console.anthropic.com/settings/billing — or connect the NVIDIA brain instead; either brain works." };
  if (res.status === 429) return { status: "warn", detail: "The key works but is currently rate-limited (429).", fix: "Fine for the demo — worker calls are small. If it persists, check your plan limits." };
  if (res.status === 404) return { status: "warn", detail: `The key works but the model name was not found (404). Body: ${body.slice(0, 120)}`, fix: "Set WORKER_MODEL in .env to a model your account can use." };
  return { status: "fail", detail: `Claude API answered HTTP ${res.status}: ${body.slice(0, 120)}`, fix: "Check the key and account status at https://console.anthropic.com." };
}

async function probeNvidia(): Promise<{ status: CheckStatus; detail: string; fix?: string }> {
  const base = (process.env.NVIDIA_API_BASE ?? "https://integrate.api.nvidia.com/v1").replace(/\/$/, "");
  const key = process.env.NVIDIA_INFERENCE_API_KEY!;
  const shape = key.startsWith("nvapi-") ? "" : " (note: NVIDIA keys normally start with nvapi- — double-check you pasted the right one)";
  const res = await fetch(`${base}/models`, { headers: { Authorization: `Bearer ${key}` }, signal: t() });
  if (res.ok) return { status: "pass", detail: `Nemotron endpoint answered — worker inference on NVIDIA is live${shape}.` };
  if (res.status === 401 || res.status === 403) return { status: "fail", detail: `The key was rejected (${res.status})${shape}.`, fix: "Generate a fresh key at https://build.nvidia.com and paste it again in Connections." };
  return { status: "fail", detail: `${base}/models answered HTTP ${res.status}.`, fix: "If you pointed NVIDIA_API_BASE at a self-hosted vLLM, make sure it is running and reachable." };
}

async function probeFeatherless(): Promise<{ status: CheckStatus; detail: string; fix?: string }> {
  const base = (process.env.FEATHERLESS_API_BASE ?? "https://api.featherless.ai/v1").replace(/\/$/, "");
  // A real 1-token completion, not /models: listing models is free and passes
  // even on an account with ZERO credit, which then 402s on every actual task.
  const model = process.env.WORKER_MODEL ?? "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B-BF16";
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.FEATHERLESS_API_KEY}` },
    body: JSON.stringify({ model, max_tokens: 1, messages: [{ role: "user", content: "ping" }] }),
    signal: t(),
  });
  if (res.ok) return { status: "pass", detail: "Featherless answered a 1-token test call — worker inference is live (this brain wins auto-detect when no WORKER_BACKEND is set)." };
  const bodyText = (await res.text()).slice(0, 300);
  if (res.status === 402 || /insufficient[_ ]credits/i.test(bodyText))
    return { status: "fail", detail: "The key is valid but the Featherless account has NO credit — every agent task will fail until this is fixed.", fix: "Add credits at https://featherless.ai (hackathon usage tokens apply there), or remove FEATHERLESS_API_KEY in Connections to fall back to another brain / simulation." };
  if (res.status === 401 || res.status === 403) return { status: "fail", detail: `The key was rejected (${res.status}).`, fix: "Create a fresh key at https://featherless.ai and paste it again in Connections." };
  if (res.status === 404) return { status: "warn", detail: `The key works but model "${model}" was not found (404).`, fix: "Set WORKER_MODEL in .env to a model listed at https://featherless.ai/models." };
  if (res.status === 429) return { status: "warn", detail: "The key works but is currently rate-limited (429).", fix: "Fine for the demo — worker calls are small. If it persists, wait a minute." };
  return { status: "fail", detail: `${base}/chat/completions answered HTTP ${res.status}: ${bodyText.slice(0, 120)}`, fix: "If you overrode FEATHERLESS_API_BASE, make sure the endpoint is reachable; otherwise check https://featherless.ai status." };
}

async function probeHiddenLayer(): Promise<{ status: CheckStatus; detail: string; fix?: string }> {
  // Token exchange is the real test — bad creds fail here. IMPORTANT: with
  // broken HL creds the gate fails CLOSED, i.e. EVERY worker message becomes a
  // human escalation. That looks like "the whole app is stuck on approvals".
  const { getToken, invalidateToken } = await import("../security/hl-auth.js");
  try {
    invalidateToken();
    await getToken();
    return { status: "pass", detail: "OAuth token exchange succeeded — HiddenLayer scanning is live on top of the heuristic floor." };
  } catch (err: any) {
    return {
      status: "fail",
      detail: `Could not get a HiddenLayer token (${err.message}). While these credentials are set but broken, the gate fails CLOSED — every agent message pauses for approval, which reads as \"everything is blocked\".`,
      fix: "Fix or clear HIDDENLAYER_CLIENT_ID / HIDDENLAYER_CLIENT_SECRET (event code AITX-2026). To demo without HiddenLayer, delete both lines from .env and restart — the built-in heuristic floor still catches the demo injection.",
    };
  }
}

async function probeApify(): Promise<{ status: CheckStatus; detail: string; fix?: string }> {
  const res = await fetch(`https://api.apify.com/v2/users/me?token=${process.env.APIFY_TOKEN}`, { signal: t() });
  if (res.ok) {
    const actor = process.env.APIFY_ACTOR;
    return actor
      ? { status: "pass", detail: `Apify token valid; research will run a live scrape with actor ${actor}.` }
      : { status: "warn", detail: "Apify token valid, but APIFY_ACTOR is not set — research stays on the labeled sample catalog.", fix: "Set APIFY_ACTOR in Connections (e.g. junglee/amazon-crawler) to flip research to a live scrape." };
  }
  if (res.status === 401) return { status: "fail", detail: "The Apify token was rejected (401).", fix: "Copy your token from https://console.apify.com/settings/integrations and paste it again." };
  return { status: "fail", detail: `Apify answered HTTP ${res.status}.`, fix: "Check https://status.apify.com or re-paste the token." };
}

async function probeShopify(): Promise<{ status: CheckStatus; detail: string; fix?: string }> {
  const store = (process.env.SHOPIFY_STORE_URL ?? "").replace(/\/$/, "");
  if (!/^https:\/\/.+\.myshopify\.com$/.test(store))
    return { status: "fail", detail: `SHOPIFY_STORE_URL looks wrong: "${store || "(empty)"}".`, fix: "It must look like https://your-store.myshopify.com (no trailing slash, no /admin)." };
  const res = await fetch(`${store}/admin/api/2024-01/shop.json`, { headers: { "X-Shopify-Access-Token": process.env.SHOPIFY_ADMIN_TOKEN! }, signal: t() });
  if (res.ok) return { status: "pass", detail: "Shopify Admin API answered — the store-builder will create real products in your store." };
  if (res.status === 401 || res.status === 403) return { status: "fail", detail: `Shopify rejected the token (${res.status}).`, fix: "In your store: Settings → Apps → Develop apps → your app → Admin API access token. Make sure write_products scope is enabled." };
  if (res.status === 404) return { status: "fail", detail: "Store URL answered 404 — the store address is wrong.", fix: "Double-check SHOPIFY_STORE_URL — it must be the .myshopify.com address, not your custom domain." };
  return { status: "fail", detail: `Shopify answered HTTP ${res.status}.`, fix: "Check the token and store URL in Connections." };
}

async function probeResend(): Promise<{ status: CheckStatus; detail: string; fix?: string }> {
  const res = await fetch("https://api.resend.com/domains", { headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` }, signal: t() });
  if (res.ok) return { status: "pass", detail: "Resend key valid — agent email identities can send real mail." };
  if (res.status === 401) return { status: "fail", detail: "The Resend key was rejected (401).", fix: "Copy a fresh key from https://resend.com/api-keys and paste it again." };
  return { status: "fail", detail: `Resend answered HTTP ${res.status}.`, fix: "Re-paste the key in Connections." };
}

const KEY_CHECKS: KeyCheck[] = [
  { id: "key-anthropic", label: "AI brain — Claude key", envKeys: ["ANTHROPIC_API_KEY"], probe: probeAnthropic },
  { id: "key-nvidia", label: "AI brain — NVIDIA Nemotron key", envKeys: ["NVIDIA_INFERENCE_API_KEY"], probe: probeNvidia },
  { id: "key-featherless", label: "AI brain — Featherless AI key", envKeys: ["FEATHERLESS_API_KEY"], probe: probeFeatherless },
  { id: "key-hiddenlayer", label: "HiddenLayer security scanning", envKeys: ["HIDDENLAYER_CLIENT_ID", "HIDDENLAYER_CLIENT_SECRET"], probe: probeHiddenLayer },
  { id: "key-apify", label: "Apify live research", envKeys: ["APIFY_TOKEN"], probe: probeApify },
  { id: "key-shopify", label: "Shopify store", envKeys: ["SHOPIFY_ADMIN_TOKEN", "SHOPIFY_STORE_URL"], probe: probeShopify },
  { id: "key-resend", label: "Resend agent email", envKeys: ["RESEND_API_KEY"], probe: probeResend },
];

async function runKeyCheck(kc: KeyCheck): Promise<CheckResult> {
  if (!kc.envKeys.every((k) => process.env[k])) {
    const m = missing(kc.label, kc.envKeys);
    return result({ id: kc.id, group: "keys", label: kc.label, ...m });
  }
  try {
    const r = await kc.probe();
    return result({ id: kc.id, group: "keys", label: kc.label, live: true, ...r });
  } catch (err: any) {
    const timedOut = err.name === "TimeoutError";
    return result({
      id: kc.id, group: "keys", label: kc.label, live: true, status: "fail",
      detail: timedOut ? "The provider did not answer within 9 seconds." : `Test call failed: ${err.message}`,
      fix: "Check your internet connection, then re-run the checks. If it keeps failing, re-paste the key.",
    });
  }
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

export interface DoctorReport {
  ranAt: string;
  live: boolean;              // whether key probes made real calls
  checks: CheckResult[];
  summary: { pass: number; warn: number; fail: number; skip: number; verdict: string };
}

export async function runDoctor(opts: { live?: boolean; only?: string[] } = {}): Promise<DoctorReport> {
  const live = opts.live !== false; // default: really test the keys
  const core: CheckResult[] = [checkNode(), checkEnvFile(), checkDataDir(), checkEvalData()];
  const netP = checkNetwork();
  const keyP = live
    ? Promise.all(KEY_CHECKS.filter((k) => !opts.only || opts.only.includes(k.id)).map(runKeyCheck))
    : Promise.resolve(
        KEY_CHECKS.map((kc) => {
          const set = kc.envKeys.every((k) => process.env[k]);
          return result({
            id: kc.id, group: "keys" as const, label: kc.label,
            status: set ? ("warn" as CheckStatus) : ("skip" as CheckStatus),
            detail: set ? "Key is saved, but not live-tested in this run." : missing(kc.label, kc.envKeys).detail,
          });
        }),
      );
  const [net, keys] = await Promise.all([netP, keyP]);
  const checks = [...core.slice(0, 2), net, ...core.slice(2), ...keys].filter((c) => !opts.only || opts.only.includes(c.id));

  const count = (s: CheckStatus) => checks.filter((c) => c.status === s).length;
  const fails = count("fail");
  const verdict = fails === 0
    ? count("warn") === 0
      ? "Everything checked out — you are good to demo."
      : "Ready to run — a few optional things are not connected (see the amber rows)."
    : `${fails} thing(s) need attention before the demo — each row tells you the exact fix.`;
  return {
    ranAt: new Date().toISOString(),
    live,
    checks,
    summary: { pass: count("pass"), warn: count("warn"), fail: fails, skip: count("skip"), verdict },
  };
}
