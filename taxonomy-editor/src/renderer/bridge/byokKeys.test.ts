// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@lib/flight-recorder/index', () => ({ getGlobalRecorder: () => null }));
const { readByokKeys, maskByokKey } = await import('./byokKeys');

describe('readByokKeys', () => {
  beforeEach(() => sessionStorage.clear());

  it('reads a JSON array, dropping non-strings and empties; nothing stored is []', () => {
    expect(readByokKeys('gemini')).toEqual([]);
    sessionStorage.setItem('byok-gemini', JSON.stringify(['k1', '', 7, 'k2']));
    expect(readByokKeys('gemini')).toEqual(['k1', 'k2']);
  });

  it('a legacy single-key string is read as one key', () => {
    sessionStorage.setItem('byok-claude', 'plain-legacy-value');
    expect(readByokKeys('claude')).toEqual(['plain-legacy-value']);
  });
});

describe('maskByokKey', () => {
  it('keeps the first and last four characters', () => {
    expect(maskByokKey('abcdefghij')).toBe('abcd...ghij');
    expect(maskByokKey('abc')).toBe('ab***');
  });

  it('masks only the key half of an endpoint|key pair', () => {
    expect(maskByokKey('https://host|abcdefghij')).toBe('https://host | abcd...ghij');
  });
});
