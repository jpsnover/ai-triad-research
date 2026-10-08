// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/4105 (PI decision; PowerShell half t/4102 and t/4087): AI_API_KEY is a fallback for the gemini backend ONLY,
// and a key may only reach the backend it's named for.
// The backends come from the real ai-models.json, so a new backend is covered without editing this file.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ActionableError } from '../debate/errors.js';
import {
  resolveGenericFallbackKey,
  listingNotConfiguredHint,
  isKeyRoutingRefusal,
  LISTING_WARN,
  foreignKeyOwner,
  assertKeyForBackend,
  keyHint,
  BACKEND_KEY_ENV_VARS,
  GENERIC_FALLBACK_BACKEND,
  KEYLESS_BACKENDS,
} from './apiKeyFallback.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../');
const registry = JSON.parse(readFileSync(path.join(REPO_ROOT, 'ai-models.json'), 'utf-8')) as { models: { backend: string }[] };
const BACKENDS = [...new Set(registry.models.map((m) => m.backend))].sort();
const KEYED = BACKENDS.filter((b) => !KEYLESS_BACKENDS.includes(b));
const NON_GEMINI = KEYED.filter((b) => b !== GENERIC_FALLBACK_BACKEND);
const NAMES_AI_API_KEY = /(^|[^A-Z_])AI_API_KEY/; // whole name, so OPENAI_API_KEY does not match

function catchError(fn: () => unknown): { returned: unknown; thrown: unknown } {
  let returned: unknown = 'not-called';
  let thrown: unknown;
  try { returned = fn(); } catch (e) { thrown = e; }
  return { returned, thrown };
}

describe('resolveGenericFallbackKey: AI_API_KEY is gemini-only at call time (t/4105)', () => {
  it('the registry really has gemini plus other backends (a vacuous enumeration would pass anything)', () => {
    expect(BACKENDS).toContain('gemini');
    expect(NON_GEMINI.length).toBeGreaterThanOrEqual(5);
  });

  it('every registry backend has an entry in the key map (parity with PowerShell $script:AIApiKeyEnvVarMap)', () => {
    for (const b of KEYED) expect(BACKEND_KEY_ENV_VARS[b], b).toBeDefined();
  });

  it('gemini: returns AI_API_KEY when it is set', () => {
    expect(resolveGenericFallbackKey('gemini', { AI_API_KEY: 'google-key' })).toBe('google-key');
  });

  it.each(NON_GEMINI)('%s: a set AI_API_KEY is REFUSED, naming the backend and its own variable; the key is never returned', (backend) => {
    const { returned, thrown } = catchError(() => resolveGenericFallbackKey(backend, { AI_API_KEY: 'google-key' }));
    expect(returned).toBe('not-called');
    expect(thrown).toBeInstanceOf(ActionableError);
    const err = thrown as ActionableError;
    expect(err.problem).toContain(`'${backend}'`);
    expect(err.problem).toContain('fallback for the gemini backend only');
    expect(err.problem).not.toContain('google-key'); // the key value itself never appears in the error
    expect(err.nextSteps.join(' ')).toContain(BACKEND_KEY_ENV_VARS[backend][0]);
    expect(err.nextSteps.join(' ')).not.toMatch(NAMES_AI_API_KEY);
  });

  it.each(BACKENDS)('%s: with AI_API_KEY unset, returns undefined so the caller reports its own "no key" error', (backend) => {
    expect(resolveGenericFallbackKey(backend, {})).toBeUndefined();
    expect(resolveGenericFallbackKey(backend, { AI_API_KEY: '' })).toBeUndefined();
  });

  it.each(KEYLESS_BACKENDS)('%s (keyless): a set AI_API_KEY is neither returned nor refused', (backend) => {
    expect(BACKENDS).toContain(backend);
    expect(resolveGenericFallbackKey(backend, { AI_API_KEY: 'google-key' })).toBeUndefined();
  });

  it('keyHint offers AI_API_KEY for gemini only', () => {
    expect(keyHint('gemini')).toBe('GEMINI_API_KEY or AI_API_KEY');
    expect(keyHint('claude')).toBe('ANTHROPIC_API_KEY or CLAUDE_API_KEY');
  });
});

describe('refusal kinds: listing paths soften by kind, never by catching everything (SO e/284#10, #12)', () => {
  it('the two refusals carry distinct kinds, and are still ActionableErrors', () => {
    const fallback = catchError(() => resolveGenericFallbackKey('groq', { AI_API_KEY: 'google-key' })).thrown;
    const foreign = catchError(() => assertKeyForBackend('k', 'claude', 'provided', { GROQ_API_KEY: 'k' })).thrown;
    expect(fallback).toBeInstanceOf(ActionableError);
    expect(isKeyRoutingRefusal(fallback, 'AIApiKeyGeminiOnlyRefused')).toBe(true);
    expect(isKeyRoutingRefusal(fallback, 'AIApiKeyForeignCredentialRefused')).toBe(false);
    expect(isKeyRoutingRefusal(foreign, 'AIApiKeyForeignCredentialRefused')).toBe(true);
    expect(isKeyRoutingRefusal(foreign, 'AIApiKeyGeminiOnlyRefused')).toBe(false);
  });

  it('an ordinary error is not a refusal of any kind', () => {
    expect(isKeyRoutingRefusal(new Error('HTTP 503 unavailable'))).toBe(false);
    expect(isKeyRoutingRefusal(new ActionableError({ goal: 'g', problem: 'p', location: 'l', nextSteps: [] }))).toBe(false);
    expect(isKeyRoutingRefusal(undefined)).toBe(false);
  });

  it('the WARN phrase matches the PowerShell half word for word (e/284#8)', () => {
    expect(LISTING_WARN).toBe('AI_API_KEY applies to gemini only');
  });

  it('listingNotConfiguredHint explains why a non-gemini backend shows "not configured", without the key', () => {
    const hint = listingNotConfiguredHint('groq', { AI_API_KEY: 'google-key' });
    expect(hint).toContain(LISTING_WARN);
    expect(hint).toContain('GROQ_API_KEY');
    expect(hint).not.toContain('google-key');
    expect(listingNotConfiguredHint('gemini', { AI_API_KEY: 'google-key' })).toBeUndefined();
    expect(listingNotConfiguredHint('groq', {})).toBeUndefined();
  });
});

describe('foreign-key guard (port of Assert-AIApiKeyBackend, t/4087)', () => {
  const env = { GROQ_API_KEY: 'groq-secret', ANTHROPIC_API_KEY: 'claude-secret', CLAUDE_API_KEY: 'claude-secret-2' };

  it("a key equal to another backend's variable is foreign, named by variable", () => {
    expect(foreignKeyOwner('groq-secret', 'claude', env)).toBe('GROQ_API_KEY');
  });

  it("a key equal to the backend's own variable is never foreign, even if another variable holds it too", () => {
    expect(foreignKeyOwner('claude-secret-2', 'claude', env)).toBeUndefined();
    expect(foreignKeyOwner('same', 'groq', { GROQ_API_KEY: 'same', OPENAI_API_KEY: 'same' })).toBeUndefined();
  });

  it('an unknown key, or an empty key, is not foreign', () => {
    expect(foreignKeyOwner('someone-else', 'claude', env)).toBeUndefined();
    expect(foreignKeyOwner('', 'claude', { GROQ_API_KEY: '' })).toBeUndefined();
  });

  it('assertKeyForBackend refuses a foreign key, naming the variable and route, never the key', () => {
    const { thrown } = catchError(() => assertKeyForBackend('groq-secret', 'claude', 'provided', env));
    expect(thrown).toBeInstanceOf(ActionableError);
    const err = thrown as ActionableError;
    expect(err.problem).toContain('the provided key is the value of GROQ_API_KEY');
    expect(err.problem).toContain("it will not be sent to 'claude'");
    expect(err.message).not.toContain('groq-secret');
    expect(JSON.stringify(err)).not.toContain('groq-secret');
  });

  it("assertKeyForBackend passes the backend's own key", () => {
    expect(() => assertKeyForBackend('claude-secret', 'claude', 'provided', env)).not.toThrow();
  });
});
