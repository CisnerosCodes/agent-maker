// Translate raw provider/tooling errors into founder-English before they hit
// the dashboard. The raw text is preserved (in parentheses) for debugging, but
// the first sentence must tell a non-technical operator what happened and the
// second what to do about it — with a URL when the fix lives somewhere.

const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL ?? "adrianbencisneros@gmail.com";

const PROVIDER_CONSOLE: Record<string, string> = {
  featherless: "https://featherless.ai",
  nvidia: "https://build.nvidia.com",
  api: "https://console.anthropic.com/settings/billing",
};

function providerOf(raw: string): { id: string; label: string; console: string } {
  const id = /^(featherless|nvidia|api)\b/i.exec(raw)?.[1]?.toLowerCase() ?? "";
  const label = id === "api" ? "Claude" : id === "nvidia" ? "NVIDIA" : id === "featherless" ? "Featherless" : "AI brain";
  return { id, label, console: PROVIDER_CONSOLE[id] ?? "" };
}

export function friendlyError(raw: string): string {
  const p = providerOf(raw);
  if (/insufficient[_ ]credits|402/i.test(raw))
    return `The ${p.label} account this key belongs to is out of credit, so the AI brain can't think. Fix: add credits${p.console ? ` at ${p.console}` : ""}, or remove that key in Connections and the demo runs in simulation instead. (${raw.slice(0, 160)})`;
  if (/\b(401|403)\b|unauthorized|invalid[_ ]api[_ ]key/i.test(raw))
    return `The ${p.label} key was rejected — it's invalid, revoked, or pasted with a typo. Fix: re-copy the key${p.console ? ` from ${p.console}` : ""} and paste it again in Connections, then check /setup goes green. (${raw.slice(0, 160)})`;
  if (/\b429\b|rate.?limit/i.test(raw))
    return `The ${p.label} service is rate-limiting us — too many requests too fast. Fix: wait a minute and relaunch the goal; nothing is broken on your side. (${raw.slice(0, 160)})`;
  if (/timed? ?out|aborted/i.test(raw))
    return `The ${p.label} model took too long to answer (over the 3-minute limit) and we gave up. Fix: relaunch the goal, or switch to a faster model via WORKER_MODEL. (${raw.slice(0, 160)})`;
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|network/i.test(raw))
    return `We couldn't reach the internet (or the provider's servers). Fix: check your connection, then open /setup — the internet check will confirm. (${raw.slice(0, 160)})`;
  // Unknown = probably our bug, not theirs. Give them a human to contact.
  return `Something unexpected went wrong on our side. This is not something you did — email ${SUPPORT_EMAIL} with a screenshot and we'll fix it. (${raw.slice(0, 200)})`;
}
