# Paid Gemini Key Fallback

**Status:** Draft — awaiting review
**Author:** Technical Lead
**Date:** 2026-06-25

## Problem

Free-tier Gemini keys hit upstream rate limits (429 / `RESOURCE_EXHAUSTED`) during concurrent usage — especially during debates where 3 opening statements fire simultaneously. When all free keys are in cooldown, requests fail with a 429 returned to the client. The debate engine retries, but if the cooldown outlasts the retry budget, the debate stalls.

Jeffrey has a paid Gemini API key with a higher quota. The goal is:
1. Store that key server-side with a self-service registration mechanism
2. Use it **only** when the free pool is exhausted
3. **Automatically revert** to free keys once their cooldowns expire

## Current Architecture

```
Request → server.ts (rate limit check) → key injection → aiBackends.generateText()
                                              │
                                    ┌─────────┴──────────┐
                                    │ Free tier?          │
                                    │ → parseFreeTierKeys │
                                    │ → [key1, key2, …]   │
                                    └─────────┬──────────┘
                                              │
                                    callWithKeyRotation()
                                    ┌─────────┴──────────┐
                                    │ Round-robin cursor  │
                                    │ key[cursor % N] ──► │──── 429? → cooldown, try next
                                    │ All exhausted?      │
                                    │ → THROW (→ 429)     │
                                    └─────────────────────┘
```

**Critical detail:** `keyRotator.ts` uses a **round-robin cursor** (`counters.get(backend) % N`) that advances on every call. All keys in the array are treated equally — there is no concept of priority. Appending the paid key to the free pool would cause it to be used every Nth request during normal operation, defeating the fallback-only intent.

**Key files:**
- `server.ts:1165-1176` — key injection block
- `server.ts:1236-1253` — upstream 429 catch block
- `aiBackends.ts:295-337` — `callWithKeyRotation()` with per-key cooldown
- `keyRotator.ts` — round-robin state + cooldown tracking
- `proxyTiers.ts:158-160` — `parseFreeTierKeys()` (comma-separated pool)
- `config.ts:219-221` — `storeApiKey()` with per-user key store partitioning
- `keyStore.ts` — AES-256-GCM encrypted storage (local file or Azure Key Vault)
- `deploy/azure/main.bicep:121,410` — `FREE_TIER_GEMINI_KEY` env var + secret

## Design

### Core Idea: Two-Stage Call

Keep the free key pool and paid key **completely separate**. The free pool round-robins as designed. The paid key is only tried in a catch-and-retry wrapper when the free pool is fully exhausted.

```
┌─────────────────────────────────────────────────┐
│ server.ts /api/ai/generate handler              │
│                                                 │
│  1. Inject free keys → [key1, key2, key3]       │
│  2. Call ai.generateText(prompt, model, keys)    │
│     └─ callWithKeyRotation: round-robin free keys│
│        ✓ → respond to client                    │
│        ✗ → all free keys exhausted (429 thrown)  │
│                                                 │
│  3. Catch 429 → is paid fallback configured?     │
│     No  → return 429 to client (existing behavior)│
│     Yes → retry with paid key ONLY               │
│        ✓ → respond to client                    │
│        ✗ → return 429 to client                  │
└─────────────────────────────────────────────────┘
```

### Why This Preserves Round-Robin

The paid key never enters the `callWithKeyRotation` key array. Free keys rotate among themselves as they do today. The paid key is a single retry after the rotation has been fully exhausted. No changes to `keyRotator.ts` or `callWithKeyRotation()`.

### Why Recovery Is Automatic

1. Every request starts by trying the free pool (step 2)
2. `keyRotator.isRateLimited()` checks `cooldown <= Date.now()` — expired cooldowns are cleared lazily
3. When a free key's cooldown expires (typically 30-60s from Gemini's `Retry-After`), the rotator selects it and succeeds at step 2
4. The catch block (step 3) is never reached → paid key not used
5. No timers, no "switch back" logic — the try-free-first ordering handles it

### Detailed Flow

```
freeKeys = ["free1", "free2", "free3"]   (round-robin pool, unchanged)
paidKey  = "paid1"                        (separate, from key store)

── Normal load ──
Request 1: cursor=0 → free1 ✓                    (paid key not involved)
Request 2: cursor=1 → free2 ✓                    (paid key not involved)
Request 3: cursor=2 → free3 ✓                    (paid key not involved)
Request 4: cursor=0 → free1 ✓                    (round-robin wraps)

── Burst (3 concurrent debate openings) ──
Request 5: cursor=1 → free2 → 429! → cooldown[1] → free3 ✓
Request 6: cursor=0 → free1 → 429! → cooldown[0] → free2 in cooldown → free3 in cooldown
           → all exhausted → CATCH → retry with paid1 ✓
Request 7: cursor=2 → free3 in cooldown → free1 in cooldown → free2 in cooldown
           → all exhausted → CATCH → retry with paid1 ✓

── 30s later (cooldowns expire) ──
Request 8: cursor=0 → free1 ✓                    (recovered — paid key not tried)
```

### Changes

#### 1. Key Registration — Admin Endpoint + Key Store

The existing key store (`keyStore.ts`) supports per-user partitioning via `userId`. The paid fallback key uses a reserved `_system` partition, stored with the same AES-256-GCM encryption as BYOK keys.

**New admin endpoints in `server.ts`:**

```typescript
// GET — check if a paid fallback key is configured (admin only)
get('/api/admin/paid-fallback-key', async (_req, res) => {
  if (!requireAdmin(res)) return;
  const keys = await getKeyStore(getDataRoot).getKeys('gemini', '_system');
  json(res, { configured: keys.length > 0, masked: keys.length > 0 ? maskApiKey(keys[0]) : null });
});

// POST — set the paid fallback key (admin only)
post('/api/admin/paid-fallback-key', async (_req, res, body) => {
  if (!requireAdmin(res)) return;
  const { key } = body as { key?: string };
  if (!key?.trim()) { error(res, 'key is required', 400); return; }
  await getKeyStore(getDataRoot).set('gemini', '_system', key.trim());
  json(res, { ok: true, masked: maskApiKey(key.trim()) });
});

// DELETE — remove the paid fallback key (admin only)
del('/api/admin/paid-fallback-key', async (_req, res) => {
  if (!requireAdmin(res)) return;
  await getKeyStore(getDataRoot).delete('gemini', '_system');
  json(res, { ok: true });
});
```

**Admin panel UI addition** (`AdminReviewPanel.tsx`):
A small section at the bottom of the existing admin panel — a masked key display, an input to set/replace, and a remove button. Same pattern as the user-facing Settings key management, but restricted to admins.

**Alternative: `GEMINI_PAID_KEY` env var.** For initial deployment or if the admin panel isn't built yet, the key injection block can also check `process.env.GEMINI_PAID_KEY`. The key store takes precedence (it's more flexible — no redeploy to rotate). Both paths are shown below.

#### 2. Key Resolution Helper

New function in `config.ts`:

```typescript
/**
 * Resolve the paid Gemini fallback key (admin-registered via key store,
 * or GEMINI_PAID_KEY env var). Returns null if neither is configured.
 * This key is NOT in the free-tier rotation pool — it's only used when
 * the entire free pool is rate-limited.
 */
export async function getPaidGeminiFallbackKey(): Promise<string | null> {
  try {
    const stored = await getKeyStore(getDataRoot).getKeys('gemini', '_system');
    if (stored.length > 0) return stored[0];
  } catch { /* fall through to env var */ }
  return process.env.GEMINI_PAID_KEY?.trim() || null;
}
```

#### 3. `server.ts` — Catch-and-Retry with Paid Key

The existing catch block at line 1236 already handles upstream 429s. The change: before returning 429 to the client, check for a paid fallback key and retry once.

```typescript
// BEFORE (line 1236-1253):
catch (err) {
  if (ai.is429Error(err)) {
    const retry = ai.retryAfterMs(err);
    // ... log + flight recorder ...
    res.writeHead(429);
    res.end(JSON.stringify({ error: '...', retryable: true }));
    return;
  }
  // ... non-429 error handling ...
}

// AFTER:
catch (err) {
  if (ai.is429Error(err) && isFree) {
    // All free keys exhausted — try the paid fallback before giving up
    const paidKey = await getPaidGeminiFallbackKey();
    if (paidKey) {
      try {
        getGlobalRecorder()?.record({
          type: 'ai.fallback', component: 'ai-generate', level: 'info',
          message: 'Free-tier keys exhausted — trying paid fallback',
          data: { model: requestModel, backend, freeKeyCount: freeKeys.length },
        });
        const result = await ai.generateText(prompt, effectiveModel, undefined, timeout, paidKey);
        getGlobalRecorder()?.record({
          type: 'ai.response', component: 'ai-generate', level: 'info',
          duration_ms: Date.now() - t0,
          message: `Paid fallback succeeded for ${backend}/${requestModel}`,
          data: { model: requestModel, backend, fallback: 'paid', responseLength: result.text?.length ?? 0 },
        });
        if (result.tokenUsage) {
          rateLimiter.recordTokenUsage(limitKey, result.tokenUsage.inputTokens, result.tokenUsage.outputTokens);
        }
        json(res, { text: result.text, tokenUsage: result.tokenUsage });
        return;
      } catch (fallbackErr) {
        getGlobalRecorder()?.record({
          type: 'ai.error', component: 'ai-generate', level: 'warn',
          message: 'Paid fallback also failed',
          data: { model: requestModel, backend, error: String(fallbackErr) },
          error: { name: (fallbackErr as Error).name ?? 'Error', message: String(fallbackErr), stack: (fallbackErr as Error).stack },
        });
        // Fall through to the existing 429 response below
      }
    }

    // Original 429 handling (no paid key, or paid key also failed)
    const retry = ai.retryAfterMs(err);
    // ... existing log + flight recorder + 429 response ...
  }
  // ... existing non-429 error handling ...
}
```

**Note:** The `isFree` guard ensures the paid fallback only applies to free-tier requests. BYOK/platform users who hit 429 get the existing behavior (client retries with their own key).

#### 4. `deploy/azure/main.bicep` (Optional — env var path)

If using the env var as the initial deployment path (before admin panel is built):

```bicep
@description('Paid Gemini API key — last-resort fallback when free-tier keys are rate-limited. Omit to disable.')
param geminiPaidKey string = ''

var paidKeyEnabled = !empty(geminiPaidKey)
var paidKeySecretName = 'gemini-paid-key'

// Add to ACA secrets array:
var oauthSecrets = concat(
  // ... existing secrets ...
  paidKeyEnabled ? [ { name: paidKeySecretName, value: geminiPaidKey } ] : []
)

// Add to container env vars:
var envWithPaidKey = paidKeyEnabled
  ? concat(containerEnv, [ { name: 'GEMINI_PAID_KEY', secretRef: paidKeySecretName } ])
  : containerEnv
```

**GitHub Actions variable:** `GEMINI_PAID_KEY` passed to the Bicep deployment (same pattern as `FREE_TIER_GEMINI_KEY`).

#### 5. Observability

The flight recorder entries make paid-key usage visible without new dashboards:

| Event | Type | When |
|-------|------|------|
| `Free-tier keys exhausted — trying paid fallback` | `ai.fallback` | Free pool exhausted, paid key about to be tried |
| `Paid fallback succeeded` | `ai.response` | Paid key saved the request |
| `Paid fallback also failed` | `ai.error` | Paid key also rate-limited — 429 to client |

Monitoring: grep flight recorder dumps for `fallback: 'paid'` to see how often the paid key fires. If it's more than occasional, the free key pool needs more keys.

### What Doesn't Change

| Component | Why unchanged |
|-----------|--------------|
| `keyRotator.ts` | Paid key is never in the rotation pool |
| `callWithKeyRotation()` | Only receives free keys; round-robin is unaffected |
| `rateLimiter.ts` | Server-side RPM/token limits are per-user (per-IP for free), not per-key |
| `proxyTiers.ts` | Tier resolution unchanged; `serverProvidedKey` still means free tier |
| Client code | No client awareness of the fallback — it's transparent |

### Recovery Behavior Summary

| Scenario | Behavior |
|----------|----------|
| All free keys healthy | Free keys round-robin as normal; paid key never involved |
| Some free keys in cooldown | Healthy free keys handle load; paid key not reached |
| All free keys in cooldown | 429 caught → paid key retried → success or 429 to client |
| Free key cooldown expires | Next request succeeds at step 2 (free pool) → catch block not reached |
| Paid key also rate-limited | Both pools exhausted → 429 returned to client |
| No paid key configured | Identical to current behavior (immediate 429 to client) |

### Latency Impact

When the paid fallback triggers, there's latency overhead from the failed free-key attempts:

- **Free keys already in cooldown from prior requests:** `callWithKeyRotation` tries the soonest-to-recover key (one network call, fast 429 response ~100-200ms), then the other keys that are also in cooldown. Each attempt is a fast 429.
- **Paid key retry:** One additional call (~200-500ms for a successful Gemini request).
- **Total worst case:** ~500-700ms overhead vs. an immediate 429 to the client.

This is far better than the client receiving a 429 and retrying the entire request with backoff (seconds).

### Cost Guardrails

The paid key is only used when all free keys are rate-limited — typically during concurrent bursts within a 60-second window. Gemini free-tier cooldowns are 30-60 seconds.

- **Normal load (1-2 users):** Paid key almost never used.
- **Burst (debate openings, 3 concurrent):** Paid key may handle 1-2 overflow requests. Cost at flash-lite pricing: fractions of a cent.
- **Sustained high load:** Paid key used more. The per-IP `tokensPerDay` limit (50K for free tier) caps total cost.
- **Monitoring:** Flight recorder `ai.fallback` events with `fallback: 'paid'` track usage frequency.

### Security

- The paid key is stored with the same AES-256-GCM encryption as all BYOK keys (`keyStore.ts`), in the `_system` user partition.
- Admin-only endpoints — `requireAdmin(res)` gates access.
- The paid key is only injected for free-tier requests (`isFree` guard). BYOK/platform users never see or use it.
- Flight recorder entries log the fallback event, never the key value.
- The env var path (`GEMINI_PAID_KEY`) follows the same Key Vault → Bicep secret pattern as `FREE_TIER_GEMINI_KEY`.

## Implementation

**Effort:** ~1-2 hours. Four files touched, ~60 lines added.

| File | Change | Owner |
|------|--------|-------|
| `config.ts` | Add `getPaidGeminiFallbackKey()` | ServerAPI |
| `server.ts:1236-1253` | Catch-and-retry with paid key | ServerAPI |
| `server.ts` (new endpoints) | Admin CRUD for paid fallback key | ServerAPI |
| `AdminReviewPanel.tsx` | Paid key management section | Taxonomy Editor |
| `deploy/azure/main.bicep` | New param + secret + env var (optional) | DevOps |

**Sequencing:** 
1. `config.ts` + `server.ts` changes (server reads key store or env var)
2. Admin panel UI (self-service registration)
3. Bicep changes (optional — only if deploying via env var instead of admin panel)

Steps 1-2 can ship together. Step 3 is independent.

## Alternatives Considered

### A. Append paid key to the free key array
Mix the paid key into the pool passed to `callWithKeyRotation`. **Rejected:** the rotator is round-robin, not priority-ordered. The paid key would be used every Nth request during normal operation — not "only on rate-limit exhaustion."

### B. Modify `keyRotator` to support key priorities
Add a priority tier concept so some keys are "last resort." **Rejected:** over-engineered for a single fallback key. The two-stage approach is simpler and requires no rotator changes.

### C. Background health-check to probe free key recovery
Periodic lightweight request to test if a free key is back. **Rejected:** unnecessary. The `keyRotator` clears expired cooldowns lazily on the next real request. Recovery is automatic.

### D. Use `GEMINI_API_KEY` (existing env var name)
Reuse the name in `config.ts`'s `ENV_KEY_NAMES`. **Rejected:** that name is in the general key resolution chain — `getApiKey('gemini')` would resolve it for BYOK/platform tiers, not just as a free-tier fallback. A distinct name avoids cross-tier leakage.

### E. Store in `runtime-config.json`
Put the key in the hot-reloadable runtime config. **Rejected:** secrets shouldn't live in a JSON data file, even on encrypted storage. The key store with AES-256-GCM encryption is the right abstraction.
