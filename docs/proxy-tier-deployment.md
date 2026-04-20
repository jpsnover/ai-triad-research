# AI API Proxy — Tier-Based Key Management & Rate Limiting

## Overview

The Taxonomy Editor routes all AI API requests through a server-side proxy that:

1. **Authenticates users** via Azure EasyAuth (Google, Entra ID, GitHub) or allows anonymous access
2. **Resolves a tier** (platform, BYOK, or anonymous) that determines key sourcing and rate limits
3. **Injects API keys** server-side for platform-tier users (keys never reach the client)
4. **Rate-limits** per user: requests/minute (sliding window) and tokens/day (accumulated from provider responses)

## Architecture

```
  Browser                Azure EasyAuth              Express Server
  ┌──────┐              ┌─────────────┐            ┌──────────────────┐
  │Client│──HTTPS──────>│ OAuth flow  │──headers──>│ Tier resolution  │
  │      │              │ (Google,    │            │ Rate limiter     │
  │      │              │  Entra,     │            │ Key injection    │──> Gemini / Claude / Groq
  │      │              │  GitHub)    │            │                  │
  └──────┘              └─────────────┘            └──────────────────┘
```

All AI requests go through `POST /api/ai/generate`. The proxy inspects EasyAuth headers (`X-MS-CLIENT-PRINCIPAL-NAME`, `X-MS-CLIENT-PRINCIPAL-IDP`), resolves the user's tier from `proxy-tiers.json`, enforces rate limits, and either injects platform keys or forwards the user's BYOK key.

## Tiers

| Tier | Key Source | Who |
|------|-----------|-----|
| **platform** | Server-side env vars / Azure secrets | Named users in `proxy-tiers.json` |
| **byok** | User provides their own key | Authenticated users not in the platform list |
| **anonymous** | User provides their own key | Unauthenticated users (when `AUTH_DISABLED=1`) |

## Configuration

### proxy-tiers.json

Place this file on the data volume (same location as `authorized-users.json`). The server looks for it at the path returned by `getDataRoot()` — typically the Azure Files share mount or `../ai-triad-data` locally.

```json
{
  "defaults": {
    "platform": {
      "requestsPerMinute": 60,
      "tokensPerDay": 2000000,
      "allowedBackends": ["gemini", "claude", "groq"]
    },
    "byok": {
      "requestsPerMinute": 30,
      "tokensPerDay": 500000,
      "allowedBackends": ["gemini", "claude", "groq"]
    },
    "anonymous": {
      "requestsPerMinute": 10,
      "tokensPerDay": 100000,
      "allowedBackends": ["gemini", "groq"]
    }
  },
  "users": [
    {
      "name": "Jeffrey Snover",
      "emails": ["jsnover13@gmail.com"],
      "github": "jpsnover",
      "tier": "platform"
    },
    {
      "name": "Another Researcher",
      "emails": ["researcher@university.edu"],
      "tier": "platform",
      "overrides": {
        "requestsPerMinute": 120,
        "tokensPerDay": 5000000
      }
    }
  ]
}
```

**Fields:**

- `defaults` — Rate limits and allowed backends per tier. All three tiers must be present.
- `users` — Array of user entries. Each user is matched by email, GitHub username, or display name (same matching logic as `authorized-users.json`).
- `users[].tier` — Must be `"platform"` or `"byok"`. Anonymous is not assignable — it applies automatically to unauthenticated requests.
- `users[].overrides` — Optional per-user overrides for `requestsPerMinute` and/or `tokensPerDay`. Other fields inherit from the tier defaults.
- `defaults.*.allowedBackends` — Controls which AI providers the tier can use. A request to a disallowed backend returns 403.

An example file is provided at `proxy-tiers.example.json` in the repository root.

If `proxy-tiers.json` is absent, built-in defaults apply (same values as the example above, with an empty users list — everyone is BYOK or anonymous).

The file is re-read every 30 seconds (by modification time), so changes take effect without restarting the server.

### Platform API Keys

Platform-tier users get API keys injected server-side. These keys are resolved through the existing key resolution chain in `config.ts`:

1. Environment variables: `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, `GROQ_API_KEY`
2. Azure Key Vault (when `AZURE_KEYVAULT_URL` is set)
3. Local key store file
4. `AI_API_KEY` fallback

In production, store them as Azure Container App secrets.

### BYOK Key Forwarding

BYOK and anonymous users provide their own API key. The client stores the key in `sessionStorage` under the key `byok-api-key`, and the web bridge automatically includes it in AI generation requests. The server forwards it to the provider without storing it.

Users can also store keys via the existing Settings > API Key flow (which persists them in the key store). The proxy uses the BYOK key from the request body first, then falls back to the key store.

## Deployment Steps

### 1. Create the Tier Config

```bash
# Copy the example
cp proxy-tiers.example.json ../ai-triad-data/proxy-tiers.json

# Edit to add your platform users
# (use the same emails/GitHub usernames as in authorized-users.json)
```

### 2. Set Platform API Keys in Azure

**Option A: Azure Portal**

1. Go to Container Apps > your app > Settings > Secrets
2. Add secrets:
   - `platform-gemini-key` → your Gemini API key
   - `platform-anthropic-key` → your Anthropic API key
   - `platform-groq-key` → your Groq API key
3. Go to Environment Variables and map:
   - `GEMINI_API_KEY` → secret ref: `platform-gemini-key`
   - `ANTHROPIC_API_KEY` → secret ref: `platform-anthropic-key`
   - `GROQ_API_KEY` → secret ref: `platform-groq-key`

**Option B: Azure CLI**

```bash
# Set secrets
az containerapp secret set \
  -n taxonomy-editor \
  -g <resource-group> \
  --secrets \
    platform-gemini-key=<your-gemini-key> \
    platform-anthropic-key=<your-anthropic-key> \
    platform-groq-key=<your-groq-key>

# Map to environment variables
az containerapp update \
  -n taxonomy-editor \
  -g <resource-group> \
  --set-env-vars \
    GEMINI_API_KEY=secretref:platform-gemini-key \
    ANTHROPIC_API_KEY=secretref:platform-anthropic-key \
    GROQ_API_KEY=secretref:platform-groq-key
```

### 3. Upload Tier Config to Azure Files

```bash
az storage file upload \
  --share-name <share-name> \
  --source proxy-tiers.json \
  --path proxy-tiers.json \
  --account-name <storage-account-name>
```

The share name and storage account are the ones configured in your Container App's volume mount (the same share that hosts `authorized-users.json`).

### 4. Enable Authentication

Ensure `AUTH_DISABLED` is unset or empty (not `'1'`). With auth disabled, all users are treated as anonymous tier — the proxy still works but no one gets platform keys.

EasyAuth must be configured on the Azure Container App:
1. Go to Container Apps > your app > Authentication
2. Add identity providers (Google, Microsoft, GitHub)
3. Set "Unauthenticated access" to "Allow" if you want anonymous BYOK users, or "Require authentication" if everyone must sign in

## API Endpoints

### GET /api/proxy/tier

Returns the calling user's resolved tier information.

```json
{
  "level": "platform",
  "limits": {
    "requestsPerMinute": 60,
    "tokensPerDay": 2000000
  },
  "allowedBackends": ["gemini", "claude", "groq"],
  "principalName": "jsnover13@gmail.com"
}
```

### GET /api/proxy/usage

Returns the calling user's current rate limit counters.

```json
{
  "tier": "platform",
  "limits": {
    "requestsPerMinute": 60,
    "tokensPerDay": 2000000
  },
  "usage": {
    "requestsInWindow": 12,
    "tokensToday": 145320
  }
}
```

### POST /api/ai/generate (updated)

Now returns token usage alongside the generated text:

```json
{
  "text": "...",
  "tokenUsage": {
    "inputTokens": 1234,
    "outputTokens": 567,
    "totalTokens": 1801
  }
}
```

Rate limit errors return HTTP 429:

```json
{
  "error": "Rate limit exceeded",
  "limitType": "requests_per_minute",
  "retryAfterMs": 12345,
  "limit": 60,
  "current": 60
}
```

## Rate Limiting Details

**Requests per minute** — Sliding window. Each request timestamp is stored in memory. Requests older than 60 seconds are evicted. If the count reaches the limit, the request is rejected with a `retryAfterMs` hint.

**Tokens per day** — Accumulated from provider responses. Token counts come from:
- Gemini: `usageMetadata.promptTokenCount` + `candidatesTokenCount`
- Claude: `usage.input_tokens` + `usage.output_tokens`
- Groq: `usage.prompt_tokens` + `usage.completion_tokens`

The daily bucket resets at midnight (server time). Counters are in-memory and reset on server restart.

**Anonymous bucket** — All anonymous users share a single rate-limit bucket keyed as `_anonymous`. This is intentional to incentivize sign-in.

## Local Development

Locally (`AUTH_DISABLED=1`), everyone is anonymous tier. To test tier resolution locally:

1. Create `proxy-tiers.json` in your data root
2. Set `AUTH_DISABLED=` (empty) and provide an `authorized-users.json`
3. Requests without EasyAuth headers will be treated as anonymous

To simulate an authenticated user locally, you can set the headers manually via a tool like curl:

```bash
curl -X POST http://localhost:7862/api/ai/generate \
  -H "Content-Type: application/json" \
  -H "X-MS-CLIENT-PRINCIPAL-NAME: jsnover13@gmail.com" \
  -H "X-MS-CLIENT-PRINCIPAL-IDP: google" \
  -d '{"prompt": "Hello", "model": "gemini-2.5-flash"}'
```

**Security note:** In production, Azure EasyAuth strips these headers from external requests so they cannot be spoofed. Locally there is no such protection — this is acceptable for development only.

## Files

| File | Purpose |
|------|---------|
| `taxonomy-editor/src/server/proxyTiers.ts` | Tier config loading and user-to-tier resolution |
| `taxonomy-editor/src/server/rateLimiter.ts` | In-memory RPM sliding window and daily token counter |
| `taxonomy-editor/src/server/aiBackends.ts` | AI generation with explicit key injection and token usage tracking |
| `taxonomy-editor/src/server/server.ts` | Proxy middleware on `/api/ai/generate`, tier/usage endpoints |
| `taxonomy-editor/src/renderer/bridge/web-bridge.ts` | Client-side BYOK key forwarding and 429 handling |
| `taxonomy-editor/src/renderer/bridge/types.ts` | TypeScript types for proxy API |
| `proxy-tiers.example.json` | Template config file |
| `proxy-tiers.json` (data volume) | Production tier config (not in repo) |
