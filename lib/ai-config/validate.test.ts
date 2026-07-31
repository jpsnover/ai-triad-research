// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// @vitest-environment node

import { describe, it, expect } from 'vitest';
import {
  findDanglingRefs,
  findChainlessDefaults,
  KNOWN_VERBATIM,
  CHAIN_EXEMPT_BACKENDS,
  type ValidatableRegistry,
} from './validate.js';

// A referentially-clean baseline: every referenced id resolves to a models[] entry
// (or is KNOWN_VERBATIM), and every non-exempt default has a non-empty chain.
function cleanRegistry(): ValidatableRegistry {
  return {
    models: [
      { id: 'gemini-flash', backend: 'gemini' },
      { id: 'gemini-pro', backend: 'gemini' },
      { id: 'claude-opus', backend: 'claude' },
      { id: 'llama-local', backend: 'ollama' },
    ],
    defaults: { gemini: 'gemini-flash', claude: 'claude-opus', ollama: 'llama-local' },
    debateTiers: {
      _comment: 'basic = cheap tier; advanced = strong tier',
      basic: { gemini: 'gemini-flash' },
      advanced: { gemini: 'gemini-pro', claude: 'claude-opus' },
    },
    fallbackChains: {
      'gemini-flash': ['gemini-pro'],
      'claude-opus': ['gemini-pro'],
      'gemini-pro': ['gemini-flash'],
    },
  };
}

describe('findDanglingRefs', () => {
  it('returns [] for a referentially-clean registry', () => {
    expect(findDanglingRefs(cleanRegistry())).toEqual([]);
  });

  it('flags a dangling defaults value', () => {
    const r = cleanRegistry();
    r.defaults.claude = 'claude-ghost';
    expect(findDanglingRefs(r)).toContain('claude-ghost');
  });

  it('flags a dangling debateTiers value', () => {
    const r = cleanRegistry();
    (r.debateTiers!.advanced as Record<string, string>).gemini = 'gemini-ghost';
    expect(findDanglingRefs(r)).toContain('gemini-ghost');
  });

  it('flags a dangling fallbackChains VALUE (failover target)', () => {
    const r = cleanRegistry();
    r.fallbackChains!['gemini-flash'] = ['gemini-ghost'];
    expect(findDanglingRefs(r)).toContain('gemini-ghost');
  });

  it('does NOT flag an orphan fallbackChains KEY (inert — never a selection value)', () => {
    const r = cleanRegistry();
    // key resolves to no model, but its VALUES all resolve → not dangling.
    r.fallbackChains!['claude-retired'] = ['gemini-pro'];
    expect(findDanglingRefs(r)).toEqual([]);
  });

  it('does NOT flag a KNOWN_VERBATIM id even with no models[] entry', () => {
    const r = cleanRegistry();
    r.defaults.deepseek = 'deepseek-chat'; // KNOWN_VERBATIM, no models[] entry
    expect(KNOWN_VERBATIM.has('deepseek-chat')).toBe(true);
    expect(findDanglingRefs(r)).toEqual([]);
  });

  it('skips the "_comment" key without crashing and returns sorted unique ids', () => {
    const r = cleanRegistry();
    r.defaults.claude = 'zeta-ghost';
    r.fallbackChains!['gemini-flash'] = ['alpha-ghost', 'alpha-ghost'];
    expect(findDanglingRefs(r)).toEqual(['alpha-ghost', 'zeta-ghost']); // sorted + de-duped
  });

  it('tolerates absent optional surfaces', () => {
    expect(findDanglingRefs({ models: [], defaults: {} })).toEqual([]);
  });
});

describe('findChainlessDefaults', () => {
  it('returns [] when every non-exempt default has a non-empty chain', () => {
    expect(findChainlessDefaults(cleanRegistry())).toEqual([]);
  });

  it('flags a non-exempt default whose chain is missing', () => {
    const r = cleanRegistry();
    delete r.fallbackChains!['claude-opus'];
    expect(findChainlessDefaults(r)).toEqual(['claude default "claude-opus" has no fallbackChain']);
  });

  it('flags a non-exempt default whose chain is empty', () => {
    const r = cleanRegistry();
    r.fallbackChains!['claude-opus'] = [];
    expect(findChainlessDefaults(r)).toEqual(['claude default "claude-opus" has no fallbackChain']);
  });

  it('does NOT flag a CHAIN_EXEMPT (ollama) default with no chain', () => {
    const r = cleanRegistry();
    expect(CHAIN_EXEMPT_BACKENDS.has('ollama')).toBe(true);
    // llama-local (ollama default) has no fallbackChains entry — exempt.
    expect(findChainlessDefaults(r)).toEqual([]);
  });

  it('returns offenders sorted', () => {
    const r = cleanRegistry();
    r.models.push({ id: 'gpt', backend: 'openai' });
    r.defaults.openai = 'gpt'; // no chain → offender
    delete r.fallbackChains!['claude-opus']; // offender
    expect(findChainlessDefaults(r)).toEqual([
      'claude default "claude-opus" has no fallbackChain',
      'openai default "gpt" has no fallbackChain',
    ]);
  });
});
