// @vitest-environment node

/**
 * t/2108 — buildGenerateOptions must thread fixedTemperature from the model
 * registry into GenerateOptions on a per-attempt basis so that:
 *   - a directly-requested model with fixedTemperature sends it
 *   - a fallback model with fixedTemperature sends it (primary did not)
 *   - a fallback model WITHOUT fixedTemperature does NOT inherit the primary's value
 *   - a -latest alias resolves to the correct fixedTemperature via buildModelEntryMap
 *
 * withRetry is stubbed to pass-through (no delays) so fallback tests run fast.
 * parseVersionedModelId only handles gemini-XX-* and claude-* patterns, so the
 * alias test uses a gemini-pattern model id with fixedTemperature set.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Fake registry entries ─────────────────────────────────────────────────────

// moonshot-kimi-k3: has fixedTemperature
const FIXED_ENTRY = {
  id: 'moonshot-kimi-k3', apiModelId: 'kimi-k3',
  label: 'Kimi K3', backend: 'moonshot', fixedTemperature: 1,
};
// gemini-flash: no fixedTemperature
const FREE_ENTRY = {
  id: 'gemini-flash', apiModelId: 'gemini-2.0-flash',
  label: 'Gemini Flash', backend: 'gemini',
};
// gemini-2.0-fixed: versioned gemini-pattern id (parseVersionedModelId matches
// /^gemini-(\d+\.\d+)-(.+?)/ so the version MUST use X.Y dot notation).
// buildModelEntryMap synthesises alias "gemini-fixed-latest" carrying fixedTemperature.
// Included in the base registry so no per-test mock override is needed.
const ALIAS_SOURCE = {
  id: 'gemini-2.0-fixed', apiModelId: 'gemini-2.0-fixed',
  label: 'Gemini Fixed', backend: 'gemini', fixedTemperature: 1,
};

const REGISTRY_JSON = JSON.stringify({
  backends: [
    { id: 'gemini', label: 'Gemini' },
    { id: 'moonshot', label: 'Moonshot' },
  ],
  models: [FREE_ENTRY, FIXED_ENTRY, ALIAS_SOURCE],
  fallbackChains: {
    'moonshot-kimi-k3': ['gemini-flash'],
    'gemini-flash': ['moonshot-kimi-k3'],
  },
  defaults: { gemini: 'gemini-flash', moonshot: 'moonshot-kimi-k3' },
});

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('../ai/fsCache.js', () => ({
  readFileWithMtime: vi.fn(() => ({ content: REGISTRY_JSON, mtimeMs: 1 })),
}));

vi.mock('../config.js', async (importActual) => {
  const actual = await importActual<typeof import('../config.js')>();
  return {
    ...actual,
    getProjectRoot: vi.fn(() => '/fake-root'),
    getApiKeys: vi.fn(async () => ['fake-api-key']),
    getApiKey: vi.fn(async () => 'fake-api-key'),
  };
});

vi.mock('../../../../lib/ai-client/index.js', async (importActual) => {
  const actual = await importActual<typeof import('../../../../lib/ai-client/index.js')>();
  return {
    ...actual,
    // No retries — call fn() once and propagate; makes fallback tests fast.
    withRetry: vi.fn(async (fn: () => Promise<unknown>) => fn()),
    callProvider: vi.fn(),
  };
});

// ── Imports after mocks ───────────────────────────────────────────────────────

import { generateText } from '../ai/aiBackends.js';
import * as aiClient from '../../../../lib/ai-client/index.js';
import { readFileWithMtime } from '../ai/fsCache.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

const OK_RESULT = { text: 'ok', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } };
const callProviderMock = () => vi.mocked(aiClient.callProvider);

beforeEach(() => {
  vi.mocked(aiClient.callProvider).mockResolvedValue(OK_RESULT);
  vi.mocked(readFileWithMtime).mockReturnValue({ content: REGISTRY_JSON, mtimeMs: Date.now() });
});

afterEach(() => {
  vi.clearAllMocks();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('buildGenerateOptions fixedTemperature threading (t/2108)', () => {
  it('passes fixedTemperature:1 to the provider when moonshot-kimi-k3 is the direct request', async () => {
    await generateText('hello', 'moonshot-kimi-k3', undefined, undefined, 'fake-key');
    const opts = callProviderMock().mock.calls[0][5];
    expect(opts.fixedTemperature).toBe(1);
  });

  it('passes fixedTemperature:1 on the fallback attempt when the fallback model has it', async () => {
    // No explicitApiKey — t/829 guard would filter cross-provider fallbacks when
    // an explicit key is set. Without one, getApiKeys resolves per-backend (mocked).
    // Primary (gemini-flash, no fixedTemperature) fails → fallback (moonshot-kimi-k3).
    callProviderMock()
      .mockRejectedValueOnce(new Error('gemini 503'))
      .mockResolvedValueOnce(OK_RESULT);

    await generateText('hello', 'gemini-flash');

    expect(callProviderMock()).toHaveBeenCalledTimes(2);
    expect(callProviderMock().mock.calls[0][5].fixedTemperature).toBeUndefined();
    expect(callProviderMock().mock.calls[1][5].fixedTemperature).toBe(1);
  });

  it('does NOT carry the primary fixedTemperature onto a fallback that lacks it', async () => {
    // Primary (moonshot-kimi-k3, fixedTemperature:1) fails → fallback (gemini-flash, none).
    callProviderMock()
      .mockRejectedValueOnce(new Error('moonshot 500'))
      .mockResolvedValueOnce(OK_RESULT);

    await generateText('hello', 'moonshot-kimi-k3');

    expect(callProviderMock()).toHaveBeenCalledTimes(2);
    expect(callProviderMock().mock.calls[0][5].fixedTemperature).toBe(1);
    expect(callProviderMock().mock.calls[1][5].fixedTemperature).toBeUndefined();
  });

  it('resolves fixedTemperature via a -latest alias synthesised by buildModelEntryMap', async () => {
    // gemini-2.0-fixed matches parseVersionedModelId (/gemini-\d+\.\d+-.../) →
    // buildModelEntryMap synthesises alias "gemini-fixed-latest" carrying fixedTemperature:1.
    // ALIAS_SOURCE is in REGISTRY_JSON so no per-test mock override is needed.
    await generateText('hello', 'gemini-fixed-latest', undefined, undefined, 'fake-key');

    const opts = callProviderMock().mock.calls[0][5];
    expect(opts.fixedTemperature).toBe(1);
  });
});
