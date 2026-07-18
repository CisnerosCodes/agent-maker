// HiddenLayer OAuth2 client-credentials token manager.
// Spec: hiddenlayer-gate.spec.md §3.
//
// The gate authenticates with a short-lived bearer token obtained from a
// client-credentials grant (NOT a static API key). We cache the token in module
// memory with a 60s safety margin and refresh on demand. gate.ts calls
// getToken() before each scan and invalidateToken() on a 401 to force one retry.

// Read env at call time (not module load) so credentials pasted into the
// dashboard's BUSINESS SETUP card take effect without a restart.
const authUrl = () => process.env.HIDDENLAYER_AUTH_URL ?? "https://auth.hiddenlayer.ai";
const clientId = () => process.env.HIDDENLAYER_CLIENT_ID;
const clientSecret = () => process.env.HIDDENLAYER_CLIENT_SECRET;

// True when the OAuth client credentials are present. That is all a real call
// needs — the project auto-resolves to the account's default-project server-side
// (verified live 2026-07-18; no hl-project-id header required). When false,
// gate.ts stays on the heuristic floor (dev fail-open, loud).
export function hlConfigured(): boolean {
  return Boolean(clientId() && clientSecret());
}

interface CachedToken {
  token: string;
  expiresAt: number; // epoch ms, already includes the safety margin
}

let cached: CachedToken | null = null;
let inflight: Promise<string> | null = null;

// Drop the cached token so the next getToken() re-fetches. Called after a 401.
export function invalidateToken(): void {
  cached = null;
}

// Returns a valid bearer token, fetching (and caching) a new one if needed.
// Concurrent callers share a single in-flight fetch.
export async function getToken(): Promise<string> {
  if (cached && Date.now() < cached.expiresAt) return cached.token;
  if (inflight) return inflight;
  inflight = fetchToken().finally(() => {
    inflight = null;
  });
  return inflight;
}

async function fetchToken(): Promise<string> {
  const id = clientId(), secret = clientSecret();
  if (!id || !secret) throw new Error("HiddenLayer credentials not configured");
  const basic = Buffer.from(`${id}:${secret}`).toString("base64");
  const res = await fetch(`${authUrl()}/oauth2/token?grant_type=client_credentials`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`token exchange HTTP ${res.status}`);
  const data: any = await res.json();
  const token = data.access_token;
  if (!token) throw new Error("token exchange returned no access_token");
  const ttlSec = Number(data.expires_in ?? 300);
  // 60s safety margin so we never present a token that expires mid-call.
  cached = { token, expiresAt: Date.now() + Math.max(ttlSec - 60, 30) * 1000 };
  return token;
}
