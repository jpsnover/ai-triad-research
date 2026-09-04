// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/3258 (T3, TL t/3258#14) — ADR-001 graceful-empty GUARD for the endpoint flip. #1922 makes
// getRelevantTaxonomyContext a HARD client-swap onto api.fetchRelevantNodes; the deployed endpoint
// reads via github-api where ADR-001 can 200-with-empty on a data-read gap. A real debate never
// legitimately selects 0 nodes, so an empty-200 must be treated as a FAILURE: WARN (make it
// observable) + degrade to the unfiltered fallback — never silently ship empty grounding. This locks
// that behavior (the make-degradation-observable rule): worst case = observable-unfiltered.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks (the empty-guard path returns BEFORE the success-path diagnostics, so the surface is small) ──
const recordSpy = vi.fn();
vi.mock('@lib/flight-recorder/index', () => ({ getGlobalRecorder: () => ({ record: recordSpy }) }));

const fetchRelevantNodes = vi.fn();
vi.mock('@bridge', () => ({
  api: {
    fetchRelevantNodes: (...a: unknown[]) => fetchRelevantNodes(...a),
    computeEmbeddings: vi.fn(), computeQueryEmbedding: vi.fn(), loadSyntheticEmbeddings: vi.fn(async () => null),
  },
}));
vi.mock('../../../data/lineageCategories', () => ({
  isLineageDataLoaded: () => false, getLineageMapping: () => ({}), getL2Categories: () => [],
}));
vi.mock('./getGreatestHits', () => ({ getGreatestHits: vi.fn(async () => []) }));

// 25 POV + 12 situation candidates so the unfiltered fallback's 21/10 slices are observable.
const POV_NODES = Array.from({ length: 25 }, (_, i) => ({ id: `acc-beliefs-${i}`, category: 'Beliefs', label: `L${i}`, description: `D${i}` }));
const SIT_NODES = Array.from({ length: 12 }, (_, i) => ({ id: `cc-${i}`, label: `S${i}`, description: `sd${i}` }));
const taxState = {
  accelerationist: { nodes: POV_NODES }, safetyist: { nodes: [] }, skeptic: { nodes: [] },
  situations: { nodes: SIT_NODES }, policyRegistry: [{ id: 'pol-1', action: 'act', source_povs: ['accelerationist'] }],
};
vi.mock('../../useTaxonomyStore', () => ({ useTaxonomyStore: { getState: () => taxState } }));

const debateState = {
  activeDebate: {
    id: 'd1', source_type: 'topic',
    argument_network: { nodes: [{ id: 'AN-1', embedding: [0.1, 0.2, 0.3], computed_strength: 0.5, text: 'claim' }] },
    topic: { critique: { lineage_frame: undefined } }, exclude_greatest_hits: false,
  },
  debateWarnings: [] as string[],
};
vi.mock('../store', () => ({
  useDebateStore: {
    getState: () => debateState,
    setState: (patch: Partial<typeof debateState>) => { Object.assign(debateState, patch); },
  },
}));

import { getRelevantTaxonomyContext } from '../shared/taxonomyContext';

describe('getRelevantTaxonomyContext — ADR-001 empty-result guard (t/3258 T3)', () => {
  beforeEach(() => { recordSpy.mockClear(); fetchRelevantNodes.mockReset(); debateState.debateWarnings = []; });

  it('endpoint returns 0 selected → WARN + unfiltered fallback (never silent-empty)', async () => {
    fetchRelevantNodes.mockResolvedValue({
      povNodes: [], situationNodes: [], policyRegistry: [], nodeSourceMap: {}, injectionManifest: {}, anchoring: [],
    });

    const ctx = await getRelevantTaxonomyContext('accelerationist', 'topic', 'transcript');

    // Degraded to the unfiltered fallback: first 21 POV + first 10 CC (buildUnfilteredFallback), not empty.
    expect(ctx.povNodes.length).toBe(21);
    expect(ctx.situationNodes.length).toBe(10);
    // The degradation is OBSERVABLE: a WARN naming the suspected ADR-001 data-read cause.
    const warn = recordSpy.mock.calls.find(c => /returned 0 selected/i.test(String((c[0] as { message?: string })?.message)));
    expect(warn, 'expected a WARN naming the empty-endpoint data-read cause').toBeTruthy();
    expect((warn![0] as { level?: string }).level).toBe('warn');
  });

  it('endpoint returns nodes → passes through (guard does NOT fire)', async () => {
    fetchRelevantNodes.mockResolvedValue({
      povNodes: [{ nodeId: 'acc-beliefs-0', score: 0.9 }], situationNodes: [{ nodeId: 'cc-0', score: 0.8 }],
      policyRegistry: [], nodeSourceMap: {}, injectionManifest: {}, anchoring: [],
    });

    const ctx = await getRelevantTaxonomyContext('accelerationist', 'topic', 'transcript');

    // Mapped result (1 POV + 1 CC), NOT the 21/10 fallback.
    expect(ctx.povNodes.map(n => n.id)).toEqual(['acc-beliefs-0']);
    expect(ctx.situationNodes.map(n => n.id)).toEqual(['cc-0']);
    const warn = recordSpy.mock.calls.find(c => /returned 0 selected/i.test(String((c[0] as { message?: string })?.message)));
    expect(warn, 'guard must NOT fire on a non-empty result').toBeFalsy();
  });
});
