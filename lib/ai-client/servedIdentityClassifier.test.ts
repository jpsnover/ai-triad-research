// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// @vitest-environment node
// t/3731 Phase 3: the served-identity classifier. The fixture table is the design's own (t/3731#11, TL
// e/257#10, SO e/257#12); each row is a sent -> served pair and the verdict the design requires.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import type { FetchFn } from './types.js';
import type { ModelEntry, ModelRegistry } from './registry.js';
import { buildModelEntryMap } from './registry.js';
import { callProvider } from './client.js';
import {
  classifyServedIdentity, splitDateSuffix, getServedIdentitySummary, _resetServedIdentityStateForTests,
  OBSERVED_IDENTITY_ADAPTERS, UNOBSERVED_IDENTITY_ADAPTERS,
} from './servedIdentity.js';
import { FlightRecorder } from '../flight-recorder/flightRecorder.js';
import { setGlobalRecorder, clearGlobalRecorder } from '../flight-recorder/index.js';

const entry = (backend: string, apiModelId: string, id = apiModelId): ModelEntry => ({ id, apiModelId, label: id, backend });
const REGISTRY: ModelRegistry = {
  backends: [],
  models: [
    entry('gemini', 'gemini-3.5-flash'), entry('gemini', 'gemini-3.5-flash-lite'), entry('gemini', 'gemini-3.1-flash'),
    entry('gemini', 'gemini-2.5-flash'), entry('gemini', 'gemini-3.1-pro-preview'),
    entry('claude', 'claude-sonnet-5-5'), entry('claude', 'claude-haiku-4-5-20251001'),
    entry('openai', 'gpt-4o', 'openai-gpt-4o'), entry('openai', 'gpt-4o-mini', 'openai-gpt-4o-mini'),
    entry('openai', 'gpt-4o-search-preview'), entry('openai', 'gpt-4o-search-preview-2025-03-11'),
    entry('openai', 'gpt-4o-mini-search-preview'), entry('openai', 'gpt-4o-mini-search-preview-2025-03-11'),
    entry('openai', 'gpt-5.1-chat-latest'), entry('openai', 'gpt-5.2-chat-latest'),
    entry('openai', 'gpt-4'), entry('openai', 'gpt-4-0613'),
    entry('openai', 'gpt-3.5-turbo-0125'), entry('openai', 'gpt-3.5-turbo-1106'),
    entry('groq', 'llama-3.3-70b-versatile', 'groq-llama-3.3-70b-versatile'),
    entry('zai', 'glm-5.3'),
  ],
};
// null = no registry (an explicit undefined would take the default).
const classify = (backend: string, sent: string, served: string | undefined, registry: ModelRegistry | null = REGISTRY) =>
  classifyServedIdentity({ registry: registry ?? undefined, backend, sent, served });

describe('t/3731 classifier: the design fixture table (t/3731#11)', () => {
  const FLASH_LATEST = buildModelEntryMap(REGISTRY)['gemini-flash-latest'].apiModelId;
  const rows: [string, string, string, string][] = [
    ['openai', 'gpt-4o-search-preview', 'gpt-4o-search-preview-2025-03-11', 'agree/snapshot'],
    ['openai', 'gpt-4o-search-preview-2025-03-11', 'gpt-4o-search-preview', 'unknown/pin-unverified'],
    ['openai', 'gpt-4o-mini-search-preview', 'gpt-4o-mini-search-preview-2025-03-11', 'agree/snapshot'],
    ['openai', 'gpt-4o-mini-search-preview-2025-03-11', 'gpt-4o-mini-search-preview', 'unknown/pin-unverified'],
    ['openai', 'gpt-5.2-chat-latest', 'gpt-5.2-chat-2025-08-07', 'agree/snapshot'],
    ['gemini', 'gemini-flash-latest', FLASH_LATEST, 'agree/alias-resolved'],
    ['openai', 'gpt-4', 'gpt-4-0613', 'agree/snapshot'],
    ['openai', 'gpt-4-0613', 'gpt-4', 'unknown/pin-unverified'],
    ['openai', 'gpt-3.5-turbo-0125', 'gpt-3.5-turbo-1106', 'divergent/snapshot-mismatch'],
    ['openai', 'gpt-4o', 'gpt-4o-mini', 'divergent/registry-distinct'],
    ['gemini', 'gemini-3.5-flash', 'gemini-3.1-flash', 'divergent/registry-distinct'],
    // LOAD-BEARING (t/3664): a variant swap between two registry entries warns.
    ['gemini', 'gemini-3.5-flash', 'gemini-3.5-flash-lite', 'divergent/registry-distinct'],
    ['openai', 'gpt-5.1-chat-latest', 'gpt-5.2-chat-latest', 'divergent/registry-distinct'],
  ];
  it.each(rows)('%s: %s -> %s is %s', (backend, sent, served, expected) => {
    const v = classify(backend, sent, served);
    expect(`${v.state}/${v.reason}`).toBe(expected);
  });

  it('the synthesized alias resolves to the highest-versioned concrete id, and comparison continues from it', () => {
    expect(FLASH_LATEST).toBe('gemini-3.5-flash');
    expect(classify('gemini', 'gemini-flash-latest', 'gemini-3.5-flash-lite')).toEqual(
      { state: 'divergent', reason: 'registry-distinct', resolvedSent: 'gemini-3.5-flash' });
  });
});

describe('t/3731 classifier: date suffix forms', () => {
  it('-YYYY-MM-DD and -YYYYMMDD on any backend; invalid calendar dates are not dates', () => {
    expect(splitDateSuffix('claude-haiku-4-5-20251001', 'claude')).toEqual({ base: 'claude-haiku-4-5', date: '20251001' });
    expect(splitDateSuffix('x-2025-03-11', 'zai')).toEqual({ base: 'x', date: '20250311' });
    expect(splitDateSuffix('x-2025-02-30', 'openai')).toBeNull();
    expect(splitDateSuffix('x-20251301', 'claude')).toBeNull();
  });

  it('legacy -MMDD only on openai, valid month and day only', () => {
    expect(splitDateSuffix('gpt-4-0613', 'openai')).toEqual({ base: 'gpt-4', date: '0613' });
    expect(splitDateSuffix('gpt-4-0613', 'gemini')).toBeNull();
    expect(splitDateSuffix('davinci-0002', 'openai')).toBeNull();
    expect(splitDateSuffix('gpt-4-1106-preview', 'openai')).toBeNull();
    expect(classify('zai', 'glm-5.3', 'glm-5.3-0613')).toEqual({ state: 'unknown', reason: 'unregistered-served' });
  });

  it('a -latest literal swapped for a different base is not a snapshot', () => {
    expect(classify('openai', 'gpt-5.1-chat-latest', 'gpt-5.2-chat-2025-08-07').state).not.toBe('agree');
  });
});

describe('t/3731 classifier: the remaining states', () => {
  it('exact match agrees; unreported and no-registry are unknown with their reasons', () => {
    expect(classify('zai', 'glm-5.3', 'glm-5.3')).toEqual({ state: 'agree', reason: 'exact' });
    expect(classify('gemini', 'gemini-3.5-flash', undefined)).toEqual({ state: 'unknown', reason: 'unreported' });
    expect(classify('gemini', 'gemini-3.5-flash', 'gemini-3.5-flash-lite', null)).toEqual({ state: 'unknown', reason: 'no-registry' });
  });

  it('cross-check keys on (backend, apiModelId): groq\'s registry id differs from the provider id, and still agrees', () => {
    expect(classify('groq', 'llama-3.3-70b-versatile', 'llama-3.3-70b-versatile')).toEqual({ state: 'agree', reason: 'exact' });
    // The same id registered on another backend is not a divergence on this one.
    expect(classify('zai', 'glm-5.3', 'gpt-4o').reason).not.toBe('registry-distinct');
  });

  it('suffix tolerance applies to observed adapters only; unobserved fail safe to unknown', () => {
    expect(classify('gemini', 'gemini-3.5-flash-lite', 'gemini-3.5-flash-lite-001')).toEqual({ state: 'agree', reason: 'provider-suffix' });
    expect(classify('gemini', 'gemini-3.1-pro-preview', 'gemini-3.1-pro-preview-03-2026')).toEqual({ state: 'agree', reason: 'provider-suffix' });
    expect(classify('groq', 'llama-3.3-70b-versatile', 'llama-3.3-70b-versatile-001')).toEqual({ state: 'unknown', reason: 'uncalibrated-adapter' });
    expect(classify('gemini', 'gemini-3.5-flash', 'gemini-9-ultra')).toEqual({ state: 'unknown', reason: 'unregistered-served' });
  });

  it('the calibration lists name all ten adapters, disjointly', () => {
    expect([...OBSERVED_IDENTITY_ADAPTERS, ...UNOBSERVED_IDENTITY_ADAPTERS].sort()).toEqual(
      ['azure', 'claude', 'deepseek', 'gemini', 'groq', 'moonshot', 'ollama', 'openai', 'xai', 'zai']);
  });
});

describe('t/3731 classifier against the real ai-models.json', () => {
  const real = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'ai-models.json'), 'utf-8')) as ModelRegistry;

  it('every Phase-2 observed pair agrees (t/3731#4-#6)', () => {
    const observed: [string, string][] = [
      ['gemini', 'gemini-3.5-flash-lite'], ['gemini', 'gemini-3.1-flash-lite'], ['zai', 'glm-5.3'],
      ['claude', 'claude-sonnet-5-5'], ['claude', 'claude-sonnet-4-6'], ['moonshot', 'kimi-k3'],
    ];
    for (const [backend, id] of observed) expect(classifyServedIdentity({ registry: real, backend, sent: id, served: id }).state).toBe('agree');
  });

  it('the load-bearing pair is two distinct real entries, so it warns on the real registry too', () => {
    expect(classifyServedIdentity({ registry: real, backend: 'gemini', sent: 'gemini-3.5-flash', served: 'gemini-3.5-flash-lite' }))
      .toEqual({ state: 'divergent', reason: 'registry-distinct' });
  });
});

describe('t/3731 callProvider: warn once per divergent triple, counted; first_seen; per-reason summary', () => {
  let recorder: FlightRecorder;
  const geminiServing = (served: string): FetchFn => async () => ({
    ok: true, status: 200, body: null,
    text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ text: 'hi' }] }, finishReason: 'STOP' }], modelVersion: served }),
  } as unknown as Response);
  // null = no registry passed (undefined would take the default).
  const call = (served: string, registry: ModelRegistry | null = REGISTRY) =>
    callProvider(geminiServing(served), 'gemini', 'p', 'gemini-3.5-flash', 'k', { timeoutMs: 30_000, identityRegistry: registry ?? undefined });
  const identityEvents = () => recorder.buffer.drain().filter((e) => e.type === 'ai.model_identity');

  beforeEach(() => { _resetServedIdentityStateForTests(); recorder = new FlightRecorder({ capacity: 64 }); setGlobalRecorder(recorder); });
  afterEach(() => { clearGlobalRecorder(); _resetServedIdentityStateForTests(); });

  it('the first divergent call warns; repeats of the same triple stay info with a running count', async () => {
    await call('gemini-3.5-flash-lite');
    await call('gemini-3.5-flash-lite');
    await call('gemini-3.5-flash-lite');
    const ev = identityEvents();
    expect(ev.map((e) => e.level)).toEqual(['warn', 'info', 'info']);
    expect(ev.map((e) => (e.data as { divergentCount?: number }).divergentCount)).toEqual([1, 2, 3]);
    expect(ev[0].data).toMatchObject({ state: 'divergent', reason: 'registry-distinct', apiModelIdSent: 'gemini-3.5-flash', providerReported: 'gemini-3.5-flash-lite' });
  });

  it('a different divergent triple warns on its own first occurrence', async () => {
    await call('gemini-3.5-flash-lite');
    await call('gemini-3.1-flash');
    expect(identityEvents().map((e) => e.level)).toEqual(['warn', 'warn']);
  });

  it('agree and unknown never warn', async () => {
    await call('gemini-3.5-flash');
    await call('gemini-3.5-flash-lite', null);
    await call('gemini-9-ultra');
    expect(identityEvents().every((e) => e.level === 'info')).toBe(true);
  });

  it('first_seen fires once per backend, with registryPresent', async () => {
    await call('gemini-3.5-flash', null);
    await call('gemini-3.5-flash');
    const ev = identityEvents();
    expect(ev[0].data).toMatchObject({ firstSeen: true, registryPresent: false });
    expect((ev[1].data as { firstSeen?: boolean }).firstSeen).toBeUndefined();
  });

  it('the summary counts each state by reason', async () => {
    await call('gemini-3.5-flash');
    await call('gemini-3.5-flash-lite', null);
    await call('gemini-3.5-flash-lite', null);
    await call('gemini-3.5-flash-lite');
    expect(getServedIdentitySummary()).toEqual({ 'agree/exact': 1, 'divergent/registry-distinct': 1, 'unknown/no-registry': 2 });
  });
});
