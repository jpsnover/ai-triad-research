// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import path from 'path';
import { readFileWithMtime } from './fsCache.js';
import { getDataRoot } from '../config.js';
import { log } from '../logger.js';
import { getGlobalRecorder } from '../../../../lib/flight-recorder/index.js';
import { getConfig as getRuntimeConfig } from '../runtimeConfig.js';

// ── Types ──

export type TierLevel = 'platform' | 'byok' | 'anonymous' | 'free';

export interface TierLimits {
  requestsPerMinute: number;
  tokensPerDay: number;
}

export interface ResolvedTier {
  level: TierLevel;
  limits: TierLimits;
  allowedBackends: string[];
  /**
   * Free tier (t/793): the server injects FREE_TIER_GEMINI_KEY and the model is
   * pinned. Absent/undefined for all other tiers. Cost is bounded by
   * tokensPerDay + per-IP rate limits (no char cap — removed in t/812).
   */
  serverProvidedKey?: boolean;
  pinnedModel?: string;
}

interface TierDefaults {
  platform: TierLimits & { allowedBackends: string[] };
  byok: TierLimits & { allowedBackends: string[] };
  anonymous: TierLimits & { allowedBackends: string[] };
}

interface TierUserEntry {
  name: string;
  emails?: string[];
  github?: string;
  tier: 'platform' | 'byok';
  overrides?: Partial<TierLimits>;
}

interface TierConfig {
  defaults: TierDefaults;
  users: TierUserEntry[];
}

// t/929: default tier limits now come from runtime-config (getConfig().tiers).
// proxy-tiers.json still supplies per-user entries + an optional `defaults` override.
function tierDefaults(): TierDefaults {
  const t = getRuntimeConfig().tiers;
  return {
    platform:  { requestsPerMinute: t.platform.requestsPerMinute,  tokensPerDay: t.platform.tokensPerDay,  allowedBackends: [...t.platform.allowedBackends] },
    byok:      { requestsPerMinute: t.byok.requestsPerMinute,      tokensPerDay: t.byok.tokensPerDay,      allowedBackends: [...t.byok.allowedBackends] },
    anonymous: { requestsPerMinute: t.anonymous.requestsPerMinute, tokensPerDay: t.anonymous.tokensPerDay, allowedBackends: [...t.anonymous.allowedBackends] },
  };
}

function defaultTierConfig(): TierConfig {
  return { defaults: tierDefaults(), users: [] };
}

// ── Config loading with cache ──

let _cache: TierConfig | null = null;
let _cacheMtime = 0;

function loadTierConfig(): TierConfig {
  const candidates = [
    path.join(getDataRoot(), 'proxy-tiers.json'),
  ];
  for (const p of candidates) {
    try {
      const { content, mtimeMs } = readFileWithMtime(p, _cache ? _cacheMtime : undefined);
      if (content === null) return _cache ?? defaultTierConfig();
      const data = JSON.parse(content) as Partial<TierConfig>;
      _cache = {
        defaults: { ...tierDefaults(), ...data.defaults },
        users: data.users ?? [],
      };
      _cacheMtime = mtimeMs;
      log.server.debug({ count: _cache.users.length, path: p }, 'Loaded tier entries');
      return _cache;
    } catch (err) {
      // ENOENT is expected (no override file → built-in defaults). A malformed
      // proxy-tiers.json, however, silently demotes EVERY user to anonymous
      // limits, so surface that loudly.
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        log.server.warn(
          { component: 'proxy-tiers', path: p, err: (err as Error).message },
          'Tier config unreadable — falling back to DEFAULT_CONFIG (all users get anonymous limits)',
        );
        getGlobalRecorder()?.record({
          type: 'system.error', component: 'proxy-tiers', level: 'warn',
          message: 'Tier config load failed — using DEFAULT_CONFIG',
          data: { path: p },
          error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
        });
      }
    }
  }
  return defaultTierConfig();
}

let _lastLoadTime = 0;

function getConfig(): TierConfig {
  const now = Date.now();
  if (now - _lastLoadTime > getRuntimeConfig().cache.defaultTtlMs) {
    _lastLoadTime = now;
    return loadTierConfig();
  }
  return _cache ?? loadTierConfig();
}

// ── Tier resolution ──

function findUser(config: TierConfig, principalName: string, idp: string): TierUserEntry | undefined {
  const name = principalName.toLowerCase();
  for (const user of config.users) {
    if (idp === 'github' && user.github && user.github.toLowerCase() === name) return user;
    if (user.emails?.some(e => e.toLowerCase() === name)) return user;
    if (user.name.toLowerCase() === name) return user;
  }
  return undefined;
}

/** Whether `backend` is authorized for the resolved tier (canonical check, t/772). */
export function isBackendAllowed(tier: ResolvedTier, backend: string): boolean {
  return tier.allowedBackends.includes(backend);
}

// Free tier (t/793): keyless web users get limited Gemini access via a
// server-provided key — but only when FREE_TIER_GEMINI_KEY is configured (set by
// the deployment, t/795). Without it, keyless users stay 'anonymous' (no AI), so
// this is inert until deliberately deployed. Pinned to a cheap model with tight
// per-IP limits to bound cost/abuse.
function freeTierBase(): ResolvedTier {
  const f = getRuntimeConfig().tiers.free;
  return {
    level: 'free',
    limits: { requestsPerMinute: f.requestsPerMinute, tokensPerDay: f.tokensPerDay },
    allowedBackends: [...f.allowedBackends],
    serverProvidedKey: true,
    pinnedModel: f.pinnedModel,
  };
}

/**
 * Parse FREE_TIER_GEMINI_KEY into a key list (t/846). Accepts a single key or a
 * comma-separated list (`key1,key2,key3`) to round-robin across server-provided
 * keys. Trims blanks; an unset/blank value yields [].
 */
export function parseFreeTierKeys(raw: string | undefined): string[] {
  return (raw ?? '').split(',').map(k => k.trim()).filter(Boolean);
}

/** Whether the server-provided free tier is configured (≥1 FREE_TIER_GEMINI_KEY). */
export function freeTierEnabled(): boolean {
  return parseFreeTierKeys(process.env.FREE_TIER_GEMINI_KEY).length > 0;
}

/**
 * t/945: a BYOK user with no key for the requested backend falls back to the
 * free-tier Gemini pool — so a Claude-only user isn't 422'd on the Gemini-pinned
 * helper stages (BRIEF/CITE). Returns the fallback key(s), or undefined when no
 * fallback applies (already has a key, not BYOK, not Gemini, or pool unset).
 * Per-user rate limiting still bounds usage (the caller keys on the principal).
 */
export function byokGeminiFallbackKey(
  tierLevel: TierLevel,
  backend: string,
  currentKey: string | string[] | undefined,
): string | string[] | undefined {
  const haveKey = (typeof currentKey === 'string' && currentKey.length > 0)
    || (Array.isArray(currentKey) && currentKey.length > 0);
  if (haveKey || tierLevel !== 'byok' || backend !== 'gemini') return undefined;
  const freeKeys = parseFreeTierKeys(process.env.FREE_TIER_GEMINI_KEY);
  if (freeKeys.length === 0) return undefined;
  return freeKeys.length === 1 ? freeKeys[0] : freeKeys;
}

/**
 * Free-tier per-minute request budget scaled by the key-pool size (t/906): each
 * Gemini key carries its own 6 RPM and the rotator spreads load across them, so
 * the server limit is 6 × keyCount, capped at 30 to bound abuse.
 */
export function scaledFreeTierRpm(keyCount: number): number {
  return Math.min(6 * Math.max(0, keyCount), 30);
}

export function resolveTier(principalName: string, idp: string): ResolvedTier {
  const config = getConfig();

  if (!principalName || principalName === '_local') {
    // Keyless web users (no principal) get the free tier when it's configured;
    // local single-user (_local) and the no-key fallback stay 'anonymous'.
    if (!principalName && freeTierEnabled()) {
      // t/906: each free-tier Gemini key carries its own 6 RPM at Gemini and the
      // rotator (t/846) spreads load across the pool — so scale the server-side
      // limit with the key count instead of the hardcoded 6 (capped to bound abuse).
      const rpm = scaledFreeTierRpm(parseFreeTierKeys(process.env.FREE_TIER_GEMINI_KEY).length);
      const base = freeTierBase();
      return { ...base, limits: { ...base.limits, requestsPerMinute: rpm } };
    }
    const d = config.defaults.anonymous;
    return { level: 'anonymous', limits: { requestsPerMinute: d.requestsPerMinute, tokensPerDay: d.tokensPerDay }, allowedBackends: d.allowedBackends };
  }

  const user = findUser(config, principalName, idp);
  const level: TierLevel = user?.tier ?? 'byok';
  const d = config.defaults[level];
  return {
    level,
    limits: {
      requestsPerMinute: user?.overrides?.requestsPerMinute ?? d.requestsPerMinute,
      tokensPerDay: user?.overrides?.tokensPerDay ?? d.tokensPerDay,
    },
    allowedBackends: d.allowedBackends,
  };
}
