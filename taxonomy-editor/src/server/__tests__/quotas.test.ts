// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config.js', () => ({
  getDataRoot: vi.fn().mockReturnValue('/mock-data'),
}));

vi.mock('../logger.js', () => ({
  log: { server: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() } },
}));

vi.mock('../userContext.js', () => ({
  getStorageUserId: vi.fn().mockReturnValue('testuser'),
}));

// Mock fs — no config file on disk
vi.mock('fs', () => ({
  default: {
    statSync: vi.fn().mockImplementation(() => { throw new Error('ENOENT'); }),
    readFileSync: vi.fn().mockImplementation(() => { throw new Error('ENOENT'); }),
  },
}));

import { getQuotaLimits, checkQuota } from '../quotas.js';

describe('quotas', () => {
  describe('getQuotaLimits', () => {
    it('returns defaults when no config file exists', () => {
      const limits = getQuotaLimits('someuser');
      expect(limits.maxChats).toBe(50);
      expect(limits.maxDebates).toBe(20);
    });

    it('uses current user from ALS when no userId provided', () => {
      const limits = getQuotaLimits();
      expect(limits.maxChats).toBe(50);
      expect(limits.maxDebates).toBe(20);
    });
  });

  describe('checkQuota', () => {
    it('allows when under limit', () => {
      const result = checkQuota('chats', 10, 'testuser');
      expect(result.allowed).toBe(true);
      expect(result.current).toBe(10);
      expect(result.limit).toBe(50);
      expect(result.resource).toBe('chats');
    });

    it('blocks when at limit', () => {
      const result = checkQuota('chats', 50, 'testuser');
      expect(result.allowed).toBe(false);
      expect(result.current).toBe(50);
      expect(result.limit).toBe(50);
    });

    it('blocks when over limit', () => {
      const result = checkQuota('debates', 25, 'testuser');
      expect(result.allowed).toBe(false);
      expect(result.current).toBe(25);
      expect(result.limit).toBe(20);
    });

    it('allows debates under limit', () => {
      const result = checkQuota('debates', 5, 'testuser');
      expect(result.allowed).toBe(true);
      expect(result.current).toBe(5);
      expect(result.limit).toBe(20);
    });
  });
});
