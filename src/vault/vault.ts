// Vault — pre-provisioned identities and scoped credentials.
//
// Philosophy: agents do not "sign up" for accounts (CAPTCHA/ToS demo-killers).
// Identities are ISSUED, SCOPED, and REVOCABLE — like a real company's IAM.
//
// Email: one domain on Resend (verify once) lets us send as any address on it.
// Inbound: Cloudflare Email Routing catch-all -> webhook. No mailbox signups ever.

import type { AgentIdentity, AgentSpec } from "../types.js";

const DOMAIN = process.env.AGENT_EMAIL_DOMAIN ?? "agentcorp.dev";

// Map credential names -> env var refs. Raw secrets NEVER enter the registry;
// workers get them injected into their sandbox env by the Factory only.
const CREDENTIAL_STORE: Record<string, string> = {
  APIFY_TOKEN: "env:APIFY_TOKEN",
  SHOPIFY_ADMIN_TOKEN: "env:SHOPIFY_ADMIN_TOKEN",
  RESEND_API_KEY: "env:RESEND_API_KEY",
};

export async function issueIdentity(spec: AgentSpec): Promise<AgentIdentity> {
  const issued: Record<string, string> = {};
  for (const cred of spec.credentials) {
    if (!(cred in CREDENTIAL_STORE)) throw new Error(`Vault has no credential named ${cred}`);
    issued[cred] = CREDENTIAL_STORE[cred]; // ref only; Factory resolves at spawn time
  }
  return {
    name: spec.name,
    email: `${spec.name}@${DOMAIN}`,
    issuedCredentials: issued,
    issuedAt: new Date().toISOString(),
  };
}

export async function sendAsAgent(from: string, to: string, subject: string, text: string) {
  // Resend: https://resend.com/docs — POST /emails with a verified domain.
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY not set");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ from, to, subject, text }),
  });
  if (!res.ok) throw new Error(`Resend error ${res.status}: ${await res.text()}`);
  return res.json();
}
