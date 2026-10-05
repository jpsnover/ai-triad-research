// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi } from 'vitest';
import { fuzzyCorrectNodeId, sanitizeNodeIds } from './nodeIdUtils.js';

describe('fuzzyCorrectNodeId', () => {
  const known = new Set(['acc-beliefs-001', 'saf-goals-002', 'sit-001', 'cc-040']);

  it('returns the id unchanged when it is already known', () => {
    expect(fuzzyCorrectNodeId('acc-beliefs-001', known)).toBe('acc-beliefs-001');
  });

  it('strips sit- prefix from cross-cutting id', () => {
    expect(fuzzyCorrectNodeId('sit-cc-040', known)).toBe('cc-040');
  });

  it('returns null when no correction is possible', () => {
    expect(fuzzyCorrectNodeId('completely-wrong-999', known)).toBeNull();
  });
});

describe('sanitizeNodeIds', () => {
  const known = new Set(['acc-beliefs-001', 'saf-goals-002']);

  it('passes known ids through unchanged', () => {
    const { sanitized, corrections, removed } = sanitizeNodeIds(['acc-beliefs-001'], known);
    expect(sanitized).toEqual(['acc-beliefs-001']);
    expect(corrections).toHaveLength(0);
    expect(removed).toHaveLength(0);
  });

  it('removes unknown ids', () => {
    const { sanitized, removed } = sanitizeNodeIds(['totally-bogus-999'], known);
    expect(sanitized).toHaveLength(0);
    expect(removed).toContain('totally-bogus-999');
  });

  it('does not crash and drops undefined node_id (t/3927)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Simulate a model response where node_id is missing (undefined cast through string[])
    const ids = [undefined as unknown as string, 'acc-beliefs-001'];
    const { sanitized, removed } = sanitizeNodeIds(ids, known);
    expect(sanitized).toEqual(['acc-beliefs-001']);
    expect(removed).toHaveLength(1);
    expect(removed[0]).toContain('non-string');
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy.mock.calls[0][0]).toContain('node_id');
    warnSpy.mockRestore();
  });

  it('does not crash and drops null node_id (t/3927)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ids = [null as unknown as string];
    const { sanitized, removed } = sanitizeNodeIds(ids, known);
    expect(sanitized).toHaveLength(0);
    expect(removed[0]).toContain('null');
    expect(warnSpy).toHaveBeenCalledOnce();
    warnSpy.mockRestore();
  });
});
