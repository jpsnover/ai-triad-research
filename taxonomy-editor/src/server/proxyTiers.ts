// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import fs from 'fs';
import path from 'path';
import { getDataRoot } from './config';

// ── Types ──

export type TierLevel = 'platform' | 'byok' | 'anonymous';

export interface TierLimits {
  requestsPerMinute: number;
  tokensPerDay: number;
}

export interface ResolvedTier {
  level: TierLevel;
  limits: TierLimits;
  allowedBackends: string[];
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
      console.log(`[proxy] Loaded ${_cache.users.length} tier entries from ${p}`);
      return _cache;
    } catch { /* try next */ }
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

export function resolveTier(principalName: string, idp: string): ResolvedTier {
  const config = getConfig();

  if (!principalName || principalName === '_local') {
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
