// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import fs from 'fs';
import path from 'path';
import { getDataRoot } from './config.js';
import { log } from './logger.js';
import { getStorageUserId } from './userContext.js';

export interface QuotaLimits {
  maxChats: number;
  maxDebates: number;
}

interface ElevatedEntry {
  userId: string;
  maxChats?: number;
  maxDebates?: number;
}

interface QuotaConfig {
  defaults: QuotaLimits;
  elevated: ElevatedEntry[];
}

const DEFAULT_CONFIG: QuotaConfig = {
  defaults: { maxChats: 50, maxDebates: 20 },
  elevated: [],
};

// ── Config loading with mtime cache (follows proxyTiers.ts pattern) ──

let _cache: QuotaConfig | null = null;
let _cacheMtime = 0;
const CACHE_TTL = 30_000;
let _lastLoadTime = 0;

function loadQuotaConfig(): QuotaConfig {
  const configPath = path.join(getDataRoot(), 'admin', 'quotas.json');
  try {
    const stat = fs.statSync(configPath);
    if (_cache && stat.mtimeMs === _cacheMtime) return _cache;
    const data = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as Partial<QuotaConfig>;
    _cache = {
      defaults: { ...DEFAULT_CONFIG.defaults, ...data.defaults },
      elevated: data.elevated ?? [],
    };
    _cacheMtime = stat.mtimeMs;
    log.server.debug({ path: configPath }, 'Loaded quota config');
    return _cache;
  } catch {
    return DEFAULT_CONFIG;
  }
}

function getConfig(): QuotaConfig {
  const now = Date.now();
  if (now - _lastLoadTime > CACHE_TTL) {
    _lastLoadTime = now;
    return loadQuotaConfig();
  }
  return _cache ?? loadQuotaConfig();
}

export function getQuotaLimits(userId?: string): QuotaLimits {
  const config = getConfig();
  const uid = userId ?? getStorageUserId();
  const entry = config.elevated.find(e => e.userId === uid);
  return {
    maxChats: entry?.maxChats ?? config.defaults.maxChats,
    maxDebates: entry?.maxDebates ?? config.defaults.maxDebates,
  };
}

export interface QuotaCheckResult {
  allowed: boolean;
  resource: 'chats' | 'debates';
  current: number;
  limit: number;
}

export function checkQuota(resource: 'chats' | 'debates', currentCount: number, userId?: string): QuotaCheckResult {
  const limits = getQuotaLimits(userId);
  const limit = resource === 'chats' ? limits.maxChats : limits.maxDebates;
  return {
    allowed: currentCount < limit,
    resource,
    current: currentCount,
    limit,
  };
}
