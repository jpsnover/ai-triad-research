// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import fs from 'fs';
import path from 'path';
import { getDataRoot } from '../config.js';
import { log } from '../logger.js';
import { getStorageUserId } from './userContext.js';
import { getConfig as getRuntimeConfig } from '../runtimeConfig.js';
import { getGlobalRecorder } from '../../../../lib/flight-recorder/index.js';
import { isAdmin } from '../community/community.js';

export interface QuotaLimits {
  maxChats: number;
  maxDebates: number;
  maxOpEds: number;
}

interface ElevatedEntry {
  userId: string;
  maxChats?: number;
  maxDebates?: number;
  maxOpEds?: number;
}

interface QuotaConfig {
  defaults: QuotaLimits;
  elevated: ElevatedEntry[];
}

// t/929: quota defaults now come from runtime-config (getConfig().quotas).
// quotas.json still supplies per-user `elevated` overrides + an optional
// `defaults` override layered on top.
function runtimeQuotaDefaults(): QuotaLimits {
  const q = getRuntimeConfig().quotas;
  return { maxChats: q.defaultMaxChats, maxDebates: q.defaultMaxDebates, maxOpEds: q.defaultMaxOpEds };
}

// ── Config loading with mtime cache (follows proxyTiers.ts pattern) ──

let _cache: QuotaConfig | null = null;
let _cacheMtime = 0;
let _lastLoadTime = 0;

function loadQuotaConfig(): QuotaConfig {
  const configPath = path.join(getDataRoot(), 'admin', 'quotas.json');
  // t/2023 (CodeQL js/file-system-race): stat the path then read the path
  // re-resolves it between check and use (TOCTOU). Open ONE descriptor and do
  // both fstat (for the mtime cache) and read on that same fd — the fd is bound
  // to a single inode, so there is no path re-resolution to race. closeSync in
  // finally so the cache-hit early-return can't leak the descriptor.
  let fd: number | undefined;
  try {
    fd = fs.openSync(configPath, 'r');
    const stat = fs.fstatSync(fd);
    if (_cache && stat.mtimeMs === _cacheMtime) return _cache;
    const data = JSON.parse(fs.readFileSync(fd, 'utf-8')) as Partial<QuotaConfig>;
    _cache = {
      defaults: { ...runtimeQuotaDefaults(), ...data.defaults },
      elevated: data.elevated ?? [],
    };
    _cacheMtime = stat.mtimeMs;
    log.server.debug({ path: configPath }, 'Loaded quota config');
    return _cache;
  } catch (err) {
    getGlobalRecorder()?.record({
      type: 'system.error',
      component: 'quotas',
      level: 'warn',
      message: 'Failed to load quota config — using defaults',
      error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
    });
    return { defaults: runtimeQuotaDefaults(), elevated: [] };
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function getConfig(): QuotaConfig {
  const now = Date.now();
  if (now - _lastLoadTime > getRuntimeConfig().cache.defaultTtlMs) {
    _lastLoadTime = now;
    return loadQuotaConfig();
  }
  return _cache ?? loadQuotaConfig();
}

export function getQuotaLimits(userId?: string): QuotaLimits {
  const uid = userId ?? getStorageUserId();
  if (isAdmin(uid)) return { maxChats: Infinity, maxDebates: Infinity, maxOpEds: Infinity };
  const config = getConfig();
  const entry = config.elevated.find(e => e.userId === uid);
  return {
    maxChats: entry?.maxChats ?? config.defaults.maxChats,
    maxDebates: entry?.maxDebates ?? config.defaults.maxDebates,
    maxOpEds: entry?.maxOpEds ?? config.defaults.maxOpEds,
  };
}

export interface QuotaCheckResult {
  allowed: boolean;
  resource: 'chats' | 'debates' | 'opeds';
  current: number;
  limit: number;
}

export function checkQuota(resource: 'chats' | 'debates' | 'opeds', currentCount: number, userId?: string): QuotaCheckResult {
  const limits = getQuotaLimits(userId);
  const limit = resource === 'chats' ? limits.maxChats : resource === 'debates' ? limits.maxDebates : limits.maxOpEds;
  return {
    allowed: currentCount < limit,
    resource,
    current: currentCount,
    limit,
  };
}
