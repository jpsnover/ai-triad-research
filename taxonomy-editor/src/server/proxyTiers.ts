// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import fs from 'fs';
import path from 'path';
import { getDataRoot } from './config.js';
import { log } from './logger.js';

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

const DEFAULT_CONFIG: TierConfig = {
  defaults: {
    platform:  { requestsPerMinute: 60,  tokensPerDay: 2_000_000, allowedBackends: ['gemini', 'claude', 'groq'] },
    byok:      { requestsPerMinute: 30,  tokensPerDay: 500_000,   allowedBackends: ['gemini', 'claude', 'groq'] },
    anonymous: { requestsPerMinute: 10,  tokensPerDay: 100_000,   allowedBackends: ['gemini', 'claude', 'groq'] },
  },
  users: [],
};

// ── Config loading with cache ──

let _cache: TierConfig | null = null;
let _cacheMtime = 0;
const CACHE_TTL = 30_000;

function loadTierConfig(): TierConfig {
  const candidates = [
    path.join(getDataRoot(), 'proxy-tiers.json'),
  ];
  for (const p of candidates) {
    try {
      const stat = fs.statSync(p);
      if (_cache && stat.mtimeMs === _cacheMtime) return _cache;
      const data = JSON.parse(fs.readFileSync(p, 'utf-8')) as Partial<TierConfig>;
      _cache = {
        defaults: { ...DEFAULT_CONFIG.defaults, ...data.defaults },
        users: data.users ?? [],
      };
      _cacheMtime = stat.mtimeMs;
      log.server.debug({ count: _cache.users.length, path: p }, 'Loaded tier entries');
      return _cache;
    } catch { /* telemetry — silent by design;  try next */ }
  }
  return DEFAULT_CONFIG;
}

let _lastLoadTime = 0;

function getConfig(): TierConfig {
  const now = Date.now();
  if (now - _lastLoadTime > CACHE_TTL) {
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
const FREE_TIER: ResolvedTier = {
  level: 'free',
  limits: { requestsPerMinute: 6, tokensPerDay: 50_000 },
  allowedBackends: ['gemini'],
  serverProvidedKey: true,
  pinnedModel: 'gemini-flash-lite-latest',
};

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

export function resolveTier(principalName: string, idp: string): ResolvedTier {
  const config = getConfig();

  if (!principalName || principalName === '_local') {
    // Keyless web users (no principal) get the free tier when it's configured;
    // local single-user (_local) and the no-key fallback stay 'anonymous'.
    if (!principalName && freeTierEnabled()) return { ...FREE_TIER };
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
