// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * GitHub App installation-token minting for Phase-2 sync.
 *
 * Three credential modes, tried in order:
 *
 *   1. GITHUB_APP_ID + GITHUB_APP_INSTALLATION_ID + (GITHUB_APP_PRIVATE_KEY
 *      inline, or GITHUB_APP_PRIVATE_KEY_SECRET_NAME fetched from Key Vault).
 *      Produces a short-lived installation token (~1 h). Preferred for prod —
 *      commits are attributed to the app bot, web-user email is in the
 *      `author` trailer.
 *
 *   2. GITHUB_TOKEN (personal access token or fine-grained token). Dev/test
 *      convenience. Commits are attributed to the token owner.
 *
 *   3. No credentials set → `getCredentials()` returns null. Callers render
 *      a disabled UI state; endpoints 503 with a clear message.
 *
 * JWT signing uses Node's built-in crypto — no `jsonwebtoken` dependency.
 * HTTP uses the built-in `fetch` (Node 20+).
 */

import crypto from 'crypto';

const GITHUB_API = 'https://api.github.com';
const USER_AGENT = 'ai-triad-taxonomy-editor';

// Refresh installation tokens 5 min before they expire so in-flight
// operations never race the expiry clock.
const EXPIRY_SAFETY_MARGIN_MS = 5 * 60 * 1000;

export interface SyncCredentials {
  /** "owner/repo" e.g. "jpsnover/ai-triad-data" */
  repo: string;
  /** Bearer token for `https://x-access-token:<token>@github.com/...` git pushes */
  token: string;
  /** "app" = installation token; "pat" = user PAT. Purely informational. */
  mode: 'app' | 'pat';
}

// ── Private-key sourcing ──

let cachedPrivateKey: string | null = null;

async function loadPrivateKey(): Promise<string | null> {
  if (cachedPrivateKey) return cachedPrivateKey;

  const inline = process.env.GITHUB_APP_PRIVATE_KEY;
  if (inline && inline.trim()) {
    cachedPrivateKey = normalisePem(inline);
    return cachedPrivateKey;
  }

  const vaultUrl = process.env.AZURE_KEYVAULT_URL;
  const secretName = process.env.GITHUB_APP_PRIVATE_KEY_SECRET_NAME;
  if (vaultUrl && secretName) {
    try {
      /* eslint-disable @typescript-eslint/no-var-requires */
      const { SecretClient } = require('@azure/keyvault-secrets');
      const identity = require('@azure/identity');
      /* eslint-enable @typescript-eslint/no-var-requires */
      const credential = process.env.NODE_ENV === 'production'
        ? new identity.ManagedIdentityCredential()
        : new identity.DefaultAzureCredential();
      const client = new SecretClient(vaultUrl, credential);
      const resp = await client.getSecret(secretName);
      if (resp?.value) {
        cachedPrivateKey = normalisePem(resp.value);
        return cachedPrivateKey;
      }
    } catch (err) {
      console.warn('[githubAppAuth] failed to load private key from Key Vault:', err);
    }
  }

  return null;
}

/** Strip surrounding quotes, unescape `\n` from env-style single-line PEMs. */
function normalisePem(raw: string): string {
  let s = raw.trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1);
  }
  if (s.includes('\\n') && !s.includes('\n')) s = s.replace(/\\n/g, '\n');
  return s;
}

// ── JWT (RS256) ──

function b64urlEncode(input: Buffer | string): string {
  return (Buffer.isBuffer(input) ? input : Buffer.from(input))
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function mintJwt(appId: string, privateKey: string): string {
  const now = Math.floor(Date.now() / 1000);
  // GitHub requires iat ≤ now and exp ≤ iat + 600. We give ourselves a 60s
  // skew on iat and a 9-minute window on exp.
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = { iat: now - 60, exp: now + 9 * 60, iss: appId };

  const unsigned = `${b64urlEncode(JSON.stringify(header))}.${b64urlEncode(JSON.stringify(payload))}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(unsigned);
  const sig = signer.sign(privateKey);
  return `${unsigned}.${b64urlEncode(sig)}`;
}

// ── Installation-token minting ──

interface CachedInstallToken {
  token: string;
  expiresAt: number; // epoch ms
}

let cachedInstallToken: CachedInstallToken | null = null;

async function getInstallationToken(): Promise<string | null> {
  const appId = process.env.GITHUB_APP_ID;
  const installationId = process.env.GITHUB_APP_INSTALLATION_ID;
  if (!appId || !installationId) return null;

  if (cachedInstallToken && cachedInstallToken.expiresAt > Date.now() + EXPIRY_SAFETY_MARGIN_MS) {
    return cachedInstallToken.token;
  }

  const privateKey = await loadPrivateKey();
  if (!privateKey) {
    console.warn('[githubAppAuth] GITHUB_APP_ID set but no private key available');
    return null;
  }

  const jwt = mintJwt(appId, privateKey);
  const res = await fetch(`${GITHUB_API}/app/installations/${installationId}/access_tokens`, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${jwt}`,
      'User-Agent': USER_AGENT,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.warn(`[githubAppAuth] installation token mint failed: ${res.status} ${body}`);
    return null;
  }

  const data = (await res.json()) as { token: string; expires_at: string };
  cachedInstallToken = {
    token: data.token,
    expiresAt: new Date(data.expires_at).getTime(),
  };
  return data.token;
}

// ── Public API ──

/** Repo in "owner/repo" form, or null when unset. */
export function getRepoSlug(): string | null {
  const repo = process.env.GITHUB_REPO;
  return repo && repo.includes('/') ? repo : null;
}

/**
 * Returns a usable credential bundle, or null when no credentials are
 * configured. Callers should 503 (or render a disabled UI) on null.
 */
export async function getCredentials(): Promise<SyncCredentials | null> {
  const repo = getRepoSlug();
  if (!repo) return null;

  const installToken = await getInstallationToken();
  if (installToken) return { repo, token: installToken, mode: 'app' };

  const pat = process.env.GITHUB_TOKEN;
  if (pat && pat.trim()) return { repo, token: pat.trim(), mode: 'pat' };

  return null;
}

/**
 * Thin authenticated fetch against api.github.com with the given path
 * (e.g. "/repos/owner/repo/pulls").
 */
export async function githubFetch(
  creds: SyncCredentials,
  pathAndQuery: string,
  init: { method?: string; body?: unknown } = {},
): Promise<{ ok: boolean; status: number; data: unknown; error?: string }> {
  const url = `${GITHUB_API}${pathAndQuery}`;
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${creds.token}`,
    'User-Agent': USER_AGENT,
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await fetch(url, {
    method: init.method ?? 'GET',
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });

  const text = await res.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }

  if (!res.ok) {
    const message = (data && typeof data === 'object' && 'message' in data)
      ? String((data as { message: unknown }).message)
      : text || `HTTP ${res.status}`;
    return { ok: false, status: res.status, data, error: message };
  }
  return { ok: true, status: res.status, data };
}
