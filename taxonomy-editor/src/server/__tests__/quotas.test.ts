// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// @vitest-environment node

// t/2023 — quotas.ts config load is now fd-based (CodeQL js/file-system-race):
// openSync → fstatSync(fd) → readFileSync(fd) → closeSync(fd) in finally, so the
// mtime check and the read operate on the same inode (no path-re-resolution race).
// These tests exercise that fd path: successful load, no-fd-leak (closeSync), and
// the missing-file fallback. vi.resetModules() per test isolates the module-level
// config cache.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const fsMock = vi.hoisted(() => ({
  openSync: vi.fn(),
  fstatSync: vi.fn(),
  readFileSync: vi.fn(),
  closeSync: vi.fn(),
  statSync: vi.fn(),
}));

vi.mock('fs', () => ({ default: fsMock }));
vi.mock('../config.js', () => ({ getDataRoot: vi.fn().mockReturnValue('/mock-data') }));
vi.mock('../logger.js', () => ({
  log: { server: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() } },
}));
vi.mock('../security/userContext.js', () => ({ getStorageUserId: vi.fn().mockReturnValue('testuser') }));
vi.mock('../community/community.js', () => ({ isAdmin: vi.fn().mockReturnValue(false) }));
vi.mock('../runtimeConfig.js', () => ({
  getConfig: vi.fn().mockReturnValue({
    quotas: { defaultMaxChats: 25, defaultMaxDebates: 15 },
    cache: { defaultTtlMs: 5000 },
  }),
}));

async function loadModule() {
  vi.resetModules();
  return import('../security/quotas.js');
}

beforeEach(() => {
  for (const fn of Object.values(fsMock)) fn.mockReset();
  // Default: no config file on disk — openSync fails like a real ENOENT.
  fsMock.openSync.mockImplementation(() => { const e = new Error('ENOENT') as NodeJS.ErrnoException; e.code = 'ENOENT'; throw e; });
});

describe('quotas config load — fd path (t/2023)', () => {
  it('loads elevated overrides through the fd (openSync/fstatSync/readFileSync(fd))', async () => {
    fsMock.openSync.mockReturnValue(42);
    fsMock.fstatSync.mockReturnValue({ mtimeMs: 1000 });
    fsMock.readFileSync.mockReturnValue(JSON.stringify({ elevated: [{ userId: 'vip', maxChats: 999, maxDebates: 500 }] }));

    const { getQuotaLimits } = await loadModule();
    const limits = getQuotaLimits('vip');

    expect(limits.maxChats).toBe(999);
    expect(limits.maxDebates).toBe(500);
    // read was via the fd, not the path — the TOCTOU fix.
    expect(fsMock.fstatSync).toHaveBeenCalledWith(42);
    expect(fsMock.readFileSync).toHaveBeenCalledWith(42, 'utf-8');
  });

  it('closes the fd after a successful load (no descriptor leak — finally ran)', async () => {
    fsMock.openSync.mockReturnValue(77);
    fsMock.fstatSync.mockReturnValue({ mtimeMs: 1 });
    fsMock.readFileSync.mockReturnValue(JSON.stringify({ elevated: [] }));

    const { getQuotaLimits } = await loadModule();
    getQuotaLimits('u');

    expect(fsMock.closeSync).toHaveBeenCalledWith(77);
  });

  it('never resolves the path for a stat separate from the read (statSync unused)', async () => {
    fsMock.openSync.mockReturnValue(5);
    fsMock.fstatSync.mockReturnValue({ mtimeMs: 1 });
    fsMock.readFileSync.mockReturnValue(JSON.stringify({ elevated: [] }));

    const { getQuotaLimits } = await loadModule();
    getQuotaLimits('u');

    // The whole point of the fix: no path-based statSync check-then-use.
    expect(fsMock.statSync).not.toHaveBeenCalled();
  });

  it('falls back to defaults when the config file is missing (openSync throws)', async () => {
    const { getQuotaLimits } = await loadModule();
    const limits = getQuotaLimits('someuser');

    expect(limits.maxChats).toBe(25);
    expect(limits.maxDebates).toBe(15);
    // fd was never opened → finally must not attempt to close it.
    expect(fsMock.closeSync).not.toHaveBeenCalled();
  });

  it('uses the current user from ALS when no userId is provided', async () => {
    const { getQuotaLimits } = await loadModule();
    const limits = getQuotaLimits();
    expect(limits.maxChats).toBe(25);
    expect(limits.maxDebates).toBe(15);
  });
});

describe('checkQuota', () => {
  beforeEach(() => {
    // No config → default limits (25 chats / 15 debates).
    fsMock.openSync.mockImplementation(() => { const e = new Error('ENOENT') as NodeJS.ErrnoException; e.code = 'ENOENT'; throw e; });
  });

  it('allows when under the chats limit', async () => {
    const { checkQuota } = await loadModule();
    const result = checkQuota('chats', 10, 'testuser');
    expect(result).toMatchObject({ allowed: true, current: 10, limit: 25, resource: 'chats' });
  });

  it('blocks when at the chats limit', async () => {
    const { checkQuota } = await loadModule();
    const result = checkQuota('chats', 25, 'testuser');
    expect(result).toMatchObject({ allowed: false, current: 25, limit: 25 });
  });

  it('blocks when over the debates limit', async () => {
    const { checkQuota } = await loadModule();
    const result = checkQuota('debates', 20, 'testuser');
    expect(result).toMatchObject({ allowed: false, current: 20, limit: 15 });
  });

  it('allows debates under the limit', async () => {
    const { checkQuota } = await loadModule();
    const result = checkQuota('debates', 5, 'testuser');
    expect(result).toMatchObject({ allowed: true, current: 5, limit: 15 });
  });
});
