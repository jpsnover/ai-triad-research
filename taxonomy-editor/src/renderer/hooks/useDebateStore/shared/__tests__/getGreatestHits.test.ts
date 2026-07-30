// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RelevanceOptions } from '../../../../utils/taxonomyRelevance';

// ── Hoisted mocks ────────────────────────────────────────────────────
const mockLoadGreatestHits = vi.hoisted(() => vi.fn());
const mockRecord = vi.hoisted(() => vi.fn());

vi.mock('@bridge', () => ({ api: { loadGreatestHits: mockLoadGreatestHits } }));
vi.mock('@lib/flight-recorder/index', () => ({
  getGlobalRecorder: () => ({ record: mockRecord }),
}));

import { getGreatestHits, applyGreatestHitsExclusion, resetGreatestHitsCache } from '../getGreatestHits';

beforeEach(() => {
  resetGreatestHitsCache();
  mockLoadGreatestHits.mockReset();
  mockRecord.mockReset();
});

describe('getGreatestHits', () => {
  it('returns node_ids when the bridge yields a list', async () => {
    mockLoadGreatestHits.mockResolvedValue({ node_ids: ['acc-b-001', 'saf-d-004'] });
    expect(await getGreatestHits()).toEqual(['acc-b-001', 'saf-d-004']);
  });

  it('caches the result — the bridge is called once across repeated reads', async () => {
    mockLoadGreatestHits.mockResolvedValue({ node_ids: ['acc-b-001'] });
    await getGreatestHits();
    await getGreatestHits();
    expect(mockLoadGreatestHits).toHaveBeenCalledTimes(1);
  });

  it('returns undefined (and caches) when the file is absent (bridge returns null)', async () => {
    mockLoadGreatestHits.mockResolvedValue(null);
    expect(await getGreatestHits()).toBeUndefined();
    await getGreatestHits();
    expect(mockLoadGreatestHits).toHaveBeenCalledTimes(1); // null is cached, no retry
  });

  it('returns undefined and records a warning when the bridge throws', async () => {
    mockLoadGreatestHits.mockRejectedValue(new Error('network down'));
    expect(await getGreatestHits()).toBeUndefined();
    expect(mockRecord).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'system.error', level: 'warn' }),
    );
  });
});

describe('applyGreatestHitsExclusion', () => {
  const opts = (): RelevanceOptions => ({ threshold: 0.45, minPerCategory: 3, maxTotal: 35 });

  it('is a no-op when the flag is off/undefined', async () => {
    const relevanceOpts = opts();
    const outcome = await applyGreatestHitsExclusion(relevanceOpts, false);
    expect(outcome).toEqual({ requested: false, applied: false, listSize: 0 });
    expect(relevanceOpts.greatestHitsExclude).toBeUndefined();
    expect(mockLoadGreatestHits).not.toHaveBeenCalled();
  });

  it('sets greatestHitsExclude and reports applied when the flag is on and a list loads', async () => {
    mockLoadGreatestHits.mockResolvedValue({ node_ids: ['acc-b-001', 'saf-d-004', 'skp-i-002'] });
    const relevanceOpts = opts();
    const outcome = await applyGreatestHitsExclusion(relevanceOpts, true);
    expect(outcome).toEqual({ requested: true, applied: true, listSize: 3 });
    expect(relevanceOpts.greatestHitsExclude).toEqual(new Set(['acc-b-001', 'saf-d-004', 'skp-i-002']));
    expect(mockRecord).toHaveBeenCalledWith(
      expect.objectContaining({ level: 'info', data: { exclusion_list_size: 3 } }),
    );
  });

  it('degrades loudly (no exclusion, warn recorded) when on but the list is unavailable', async () => {
    mockLoadGreatestHits.mockResolvedValue(null);
    const relevanceOpts = opts();
    const outcome = await applyGreatestHitsExclusion(relevanceOpts, true);
    expect(outcome).toEqual({ requested: true, applied: false, listSize: 0 });
    expect(relevanceOpts.greatestHitsExclude).toBeUndefined();
    expect(mockRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'warn',
        message: expect.stringContaining('exclusion list is unavailable'),
        data: { reason: 'list_unavailable' },
      }),
    );
  });

  it('degrades loudly with reason=empty_list when the list loads but is empty', async () => {
    mockLoadGreatestHits.mockResolvedValue({ node_ids: [] });
    const relevanceOpts = opts();
    const outcome = await applyGreatestHitsExclusion(relevanceOpts, true);
    expect(outcome).toEqual({ requested: true, applied: false, listSize: 0 });
    expect(relevanceOpts.greatestHitsExclude).toBeUndefined();
    expect(mockRecord).toHaveBeenCalledWith(
      expect.objectContaining({ level: 'warn', data: { reason: 'empty_list' } }),
    );
  });
});
