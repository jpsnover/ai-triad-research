// @vitest-environment node

/**
 * t/1426 — keyRotator is now a deprecated stub (rotation removed).
 * These tests verify the stub contract that aiBackends.ts relies on until
 * t/1432 removes the consumer.
 */

import { describe, it, expect } from 'vitest';
import {
  getNextKey, markRateLimited, isRateLimited, clearExpiredLimits, _resetRotatorState,
} from '../security/keyRotator.js';

describe('keyRotator stub (t/1426)', () => {
  it('getNextKey returns the first key (no rotation)', () => {
    expect(getNextKey('gemini', ['k0', 'k1', 'k2'])).toEqual({ key: 'k0', index: 0 });
    expect(getNextKey('gemini', ['k0', 'k1', 'k2'])).toEqual({ key: 'k0', index: 0 });
  });

  it('getNextKey returns null for an empty list', () => {
    expect(getNextKey('gemini', [])).toBeNull();
  });

  it('isRateLimited always returns false', () => {
    markRateLimited('gemini', 0, 10_000);
    expect(isRateLimited('gemini', 0)).toBe(false);
  });

  it('no-op functions do not throw', () => {
    expect(() => markRateLimited('gemini', 0, 1000)).not.toThrow();
    expect(() => clearExpiredLimits()).not.toThrow();
    expect(() => _resetRotatorState()).not.toThrow();
  });
});
