import { describe, it, expect, beforeAll } from 'vitest';
import {
  computeTierAndSortKey,
  harvestDebateTested,
  setDescriptionHasher,
  DEBATE_TESTED_DEFAULTS,
  VERDICT_WEIGHTS,
} from './debateTested.js';
import { computeDescriptionHash } from './debateTestedHash.js';

// harvestDebateTested computes description hashes via an injected hasher so that
// debateTested.ts stays crypto-free (renderer-reachable). Configure it once. (t/1591)
beforeAll(() => {
  setDescriptionHasher(computeDescriptionHash);
});
import type {
  DebateTestedEntry,
  DebateTestedRevision,
  PovNode,
  ConcessionRecord,
} from './taxonomyTypes.js';
import type { ArgumentNetworkNode, ArgumentNetworkEdge } from './types.js';

// ── Helpers ────────────────────────────────────────────────────────────────

function entry(overrides: Partial<DebateTestedEntry> = {}): DebateTestedEntry {
  return {
    debate_id: 'debate-001',
    date: '2026-07-01',
    pipeline_version: '2026-07-abc123',
    verdict: 'held',
    strongest_attack_encountered: { claim_id: 'c1', strength: 0.7, scheme: 'rebut', challenger_camp: 'accelerationist' },
    claim_outcomes: { thrived: 2, survived: 1, died: 0 },
    concession: null,
    ...overrides,
  };
}

function revision(overrides: Partial<DebateTestedRevision> = {}): DebateTestedRevision {
  return { date: '2026-06-01', debate_id: 'debate-r1', held_since: null, ...overrides };
}

function anNode(id: string, speaker: string, taxonomyRefs: string[], strength = 0.5): ArgumentNetworkNode {
  return {
    id, text: `claim ${id}`, speaker, taxonomy_refs: taxonomyRefs,
    turn_number: 1, computed_strength: strength,
  } as ArgumentNetworkNode;
}

function anEdge(source: string, target: string, type: 'attacks' | 'supports' = 'attacks'): ArgumentNetworkEdge {
  return {
    id: `e-${source}-${target}`, source, target, type,
    attack_type: type === 'attacks' ? 'rebut' : undefined,
  } as ArgumentNetworkEdge;
}

function makePovNode(id: string, overrides: Partial<PovNode> = {}): PovNode {
  return {
    id, category: 'Beliefs', label: `Node ${id}`, description: `Description of ${id}`,
    parent_id: null, children: [], situation_refs: [],
    graph_attributes: { falsifiability: 'high' },
    ...overrides,
  } as PovNode;
}

// ── computeTierAndSortKey ──────────────────────────────────────────────────

describe('computeTierAndSortKey', () => {
  it('returns untested for empty record', () => {
    const r = computeTierAndSortKey([], []);
    expect(r).toEqual({ tier: 'untested', sort_key: 0 });
  });

  it('returns cited when all entries are cited', () => {
    const r = computeTierAndSortKey([
      entry({ verdict: 'cited', strongest_attack_encountered: null }),
      entry({ verdict: 'cited', debate_id: 'debate-002', strongest_attack_encountered: null }),
    ], []);
    expect(r.tier).toBe('cited');
    expect(r.sort_key).toBeGreaterThanOrEqual(1);
    expect(r.sort_key).toBeLessThan(2);
  });

  it('returns contested when challenged but below well-tested threshold', () => {
    const r = computeTierAndSortKey([
      entry({ verdict: 'held' }),
    ], []);
    expect(r.tier).toBe('contested');
    expect(r.sort_key).toBeGreaterThanOrEqual(2);
    expect(r.sort_key).toBeLessThan(3);
  });

  it('returns well_tested with >=2 challenges across >=2 debates, most recent held', () => {
    const r = computeTierAndSortKey([
      entry({ debate_id: 'debate-001', verdict: 'held', strongest_attack_encountered: { claim_id: 'c1', strength: 0.7, scheme: 'rebut', challenger_camp: 'acc' } }),
      entry({ debate_id: 'debate-002', verdict: 'held', strongest_attack_encountered: { claim_id: 'c2', strength: 0.6, scheme: 'undercut', challenger_camp: 'saf' } }),
    ], []);
    expect(r.tier).toBe('well_tested');
    expect(r.sort_key).toBeGreaterThanOrEqual(3);
    expect(r.sort_key).toBeLessThan(4);
  });

  it('does not grant well_tested if challenges are from same debate', () => {
    const r = computeTierAndSortKey([
      entry({ debate_id: 'debate-001', verdict: 'held' }),
      entry({ debate_id: 'debate-001', verdict: 'held' }),
    ], []);
    expect(r.tier).toBe('contested');
  });

  it('demotes to contested when most recent verdict is weakened after held', () => {
    const r = computeTierAndSortKey([
      entry({ debate_id: 'debate-001', verdict: 'held' }),
      entry({ debate_id: 'debate-002', verdict: 'held' }),
      entry({ debate_id: 'debate-003', verdict: 'weakened' }),
    ], []);
    expect(r.tier).toBe('contested');
  });

  it('grants well_tested via refined with held_since: true', () => {
    const r = computeTierAndSortKey([
      entry({ debate_id: 'debate-001', verdict: 'held' }),
      entry({ debate_id: 'debate-002', verdict: 'refined' }),
    ], [revision({ held_since: true })]);
    expect(r.tier).toBe('well_tested');
  });

  it('sort_key increases with stronger attacks survived', () => {
    const weak = computeTierAndSortKey([
      entry({ debate_id: 'd1', verdict: 'held', strongest_attack_encountered: { claim_id: 'c1', strength: 0.5, scheme: 'rebut', challenger_camp: 'a' } }),
      entry({ debate_id: 'd2', verdict: 'held', strongest_attack_encountered: { claim_id: 'c2', strength: 0.5, scheme: 'rebut', challenger_camp: 'b' } }),
    ], []);
    const strong = computeTierAndSortKey([
      entry({ debate_id: 'd1', verdict: 'held', strongest_attack_encountered: { claim_id: 'c1', strength: 0.9, scheme: 'rebut', challenger_camp: 'a' } }),
      entry({ debate_id: 'd2', verdict: 'held', strongest_attack_encountered: { claim_id: 'c2', strength: 0.9, scheme: 'rebut', challenger_camp: 'b' } }),
    ], []);
    expect(strong.sort_key).toBeGreaterThan(weak.sort_key);
  });

  it('sort_key is clamped to [tier_rank, tier_rank + 0.99]', () => {
    const entries = Array.from({ length: 20 }, (_, i) =>
      entry({
        debate_id: `d${i}`,
        verdict: 'held',
        strongest_attack_encountered: { claim_id: `c${i}`, strength: 1.0, scheme: 'rebut', challenger_camp: 'a' },
      }),
    );
    const r = computeTierAndSortKey(entries, []);
    expect(r.sort_key).toBeLessThan(4);
  });

  it('weakened verdicts reduce evidence score', () => {
    const held = computeTierAndSortKey([
      entry({ debate_id: 'd1', verdict: 'held' }),
    ], []);
    const weakened = computeTierAndSortKey([
      entry({ debate_id: 'd1', verdict: 'weakened' }),
    ], []);
    expect(weakened.sort_key).toBeLessThan(held.sort_key);
  });

  it('open verdict has positive but small weight', () => {
    const r = computeTierAndSortKey([
      entry({ verdict: 'open' }),
    ], []);
    expect(r.sort_key).toBeGreaterThan(2);
  });
});

// ── computeDescriptionHash ─────────────────────────────────────────────────

describe('computeDescriptionHash', () => {
  it('returns sha256-prefixed hash', () => {
    const h = computeDescriptionHash('test');
    expect(h).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('is deterministic', () => {
    expect(computeDescriptionHash('same')).toBe(computeDescriptionHash('same'));
  });

  it('differs for different inputs', () => {
    expect(computeDescriptionHash('a')).not.toBe(computeDescriptionHash('b'));
  });
});

// ── harvestDebateTested ────────────────────────────────────────────────────

describe('harvestDebateTested', () => {
  const baseParams = () => ({
    debateId: 'debate-100',
    date: '2026-07-12',
    pipelineVersion: '2026-07-abc123',
    injectionManifest: { povNodeIds: ['saf-belief-001'] },
    concessions: [],
    refinedNodeIds: new Set<string>(),
    constants: DEBATE_TESTED_DEFAULTS,
  });

  it('produces a record for an engaged belief node', () => {
    const nodes = new Map([['saf-belief-001', makePovNode('saf-belief-001')]]);
    const anNodes = [
      anNode('c1', 'safetyist', ['saf-belief-001'], 0.6),
      anNode('c2', 'accelerationist', [], 0.7),
    ];
    const anEdges = [anEdge('c2', 'c1')];

    const results = harvestDebateTested({
      ...baseParams(),
      anNodes, anEdges, taxonomyNodes: nodes,
    });

    expect(results).toHaveLength(1);
    expect(results[0].nodeId).toBe('saf-belief-001');
    expect(results[0].entry.verdict).toBe('held');
    expect(results[0].entry.pipeline_version).toBe('2026-07-abc123');
    expect(results[0].entry.strongest_attack_encountered).not.toBeNull();
    expect(results[0].updatedRecord.tier).toBe('contested');
    expect(results[0].updatedRecord.description_hash).toMatch(/^sha256:/);
  });

  it('produces a record for an engaged desire node (t/1660 BDI generalization)', () => {
    const nodes = new Map([['acc-desire-001', makePovNode('acc-desire-001', { category: 'Desires' })]]);
    const anNodes = [
      anNode('c1', 'accelerationist', ['acc-desire-001'], 0.6),
      anNode('c2', 'safetyist', [], 0.7),
    ];
    const anEdges = [anEdge('c2', 'c1')];

    const results = harvestDebateTested({
      ...baseParams(),
      injectionManifest: { povNodeIds: ['acc-desire-001'] },
      anNodes, anEdges, taxonomyNodes: nodes,
    });

    expect(results).toHaveLength(1);
    expect(results[0].nodeId).toBe('acc-desire-001');
    expect(results[0].entry.verdict).toBe('held');
    expect(results[0].entry.strongest_attack_encountered).not.toBeNull();
    expect(results[0].updatedRecord.tier).toBe('contested');
    expect(results[0].updatedRecord.description_hash).toMatch(/^sha256:/);
  });

  it('produces a record for an engaged intention node (t/1660 BDI generalization)', () => {
    const nodes = new Map([['saf-intention-001', makePovNode('saf-intention-001', { category: 'Intentions' })]]);
    const anNodes = [
      anNode('c1', 'safetyist', ['saf-intention-001'], 0.6),
      anNode('c2', 'accelerationist', [], 0.7),
    ];
    const anEdges = [anEdge('c2', 'c1')];

    const results = harvestDebateTested({
      ...baseParams(),
      injectionManifest: { povNodeIds: ['saf-intention-001'] },
      anNodes, anEdges, taxonomyNodes: nodes,
    });

    expect(results).toHaveLength(1);
    expect(results[0].nodeId).toBe('saf-intention-001');
    expect(results[0].entry.verdict).toBe('held');
    expect(results[0].entry.strongest_attack_encountered).not.toBeNull();
    expect(results[0].updatedRecord.tier).toBe('contested');
  });

  it('still excludes situation / non-BDI nodes (no category → undefined bdi_impact)', () => {
    // Situation nodes (sit-*/cc-*) have no BDI category; categoryToBdiImpact
    // coerces their category to undefined, so they never harvest a record (t/1660).
    const sitNode = makePovNode('sit-001', { category: undefined as unknown as PovNode['category'] });
    const nodes = new Map([['sit-001', sitNode]]);
    const anNodes = [anNode('c1', 'accelerationist', ['sit-001'], 0.6)];

    const results = harvestDebateTested({
      ...baseParams(),
      injectionManifest: { povNodeIds: ['sit-001'] },
      anNodes, anEdges: [], taxonomyNodes: nodes,
    });

    expect(results).toHaveLength(0);
  });

  it('records strongest_attack_encountered even for cited verdict', () => {
    const nodes = new Map([['saf-belief-001', makePovNode('saf-belief-001')]]);
    const anNodes = [
      anNode('c1', 'safetyist', ['saf-belief-001'], 0.6),
      anNode('c2', 'accelerationist', [], 0.3),
    ];
    const anEdges = [anEdge('c2', 'c1')];

    const results = harvestDebateTested({
      ...baseParams(),
      anNodes, anEdges, taxonomyNodes: nodes,
    });

    expect(results[0].entry.strongest_attack_encountered).not.toBeNull();
    expect(results[0].entry.strongest_attack_encountered!.strength).toBe(0.3);
  });

  it('updates description_hash on refined entry', () => {
    const nodes = new Map([['saf-belief-001', makePovNode('saf-belief-001', {
      description: 'revised description',
    })]]);
    const anNodes = [anNode('c1', 'safetyist', ['saf-belief-001'], 0.6)];

    const results = harvestDebateTested({
      ...baseParams(),
      anNodes, anEdges: [],
      taxonomyNodes: nodes,
      refinedNodeIds: new Set(['saf-belief-001']),
    });

    expect(results[0].entry.verdict).toBe('refined');
    expect(results[0].updatedRecord.description_hash).toBe(
      computeDescriptionHash('revised description'),
    );
    expect(results[0].updatedRecord.revisions).toHaveLength(1);
    expect(results[0].updatedRecord.revisions[0].held_since).toBeNull();
  });

  it('flips held_since to true when held after refined (content-increase pass)', () => {
    const existingRecord = {
      tier: 'contested' as const,
      sort_key: 2.5,
      engagements: 1, challenges: 0, held: 0, weakened: 0,
      revisions: [{ date: '2026-07-01', debate_id: 'debate-050', held_since: null, prior_falsifiability: 'medium' }],
      last_tested: '2026-07-01',
      description_hash: computeDescriptionHash('Description of saf-belief-001'),
      record: [entry({ debate_id: 'debate-050', verdict: 'refined', strongest_attack_encountered: null })],
    };
    const node = makePovNode('saf-belief-001', {
      graph_attributes: { falsifiability: 'high', debate_tested: existingRecord },
    });
    const nodes = new Map([['saf-belief-001', node]]);
    const anNodes = [
      anNode('c1', 'safetyist', ['saf-belief-001'], 0.6),
      anNode('c2', 'accelerationist', [], 0.7),
    ];
    const anEdges = [anEdge('c2', 'c1')];

    const results = harvestDebateTested({
      ...baseParams(),
      anNodes, anEdges, taxonomyNodes: nodes,
    });

    expect(results[0].entry.verdict).toBe('held');
    expect(results[0].updatedRecord.revisions[0].held_since).toBe(true);
  });

  it('blocks held_since flip when falsifiability decreased (content-increase gate)', () => {
    const existingRecord = {
      tier: 'contested' as const,
      sort_key: 2.5,
      engagements: 1, challenges: 0, held: 0, weakened: 0,
      revisions: [{ date: '2026-07-01', debate_id: 'debate-050', held_since: null, prior_falsifiability: 'high' }],
      last_tested: '2026-07-01',
      description_hash: computeDescriptionHash('Description of saf-belief-001'),
      record: [entry({ debate_id: 'debate-050', verdict: 'refined', strongest_attack_encountered: null })],
    };
    const node = makePovNode('saf-belief-001', {
      graph_attributes: { falsifiability: 'low', debate_tested: existingRecord },
    });
    const nodes = new Map([['saf-belief-001', node]]);
    const anNodes = [
      anNode('c1', 'safetyist', ['saf-belief-001'], 0.6),
      anNode('c2', 'accelerationist', [], 0.7),
    ];
    const anEdges = [anEdge('c2', 'c1')];

    const results = harvestDebateTested({
      ...baseParams(),
      anNodes, anEdges, taxonomyNodes: nodes,
    });

    expect(results[0].entry.verdict).toBe('held');
    expect(results[0].updatedRecord.revisions[0].held_since).toBeNull();
  });

  it('sets held_since to false on weakened after refined', () => {
    const existingRecord = {
      tier: 'contested' as const,
      sort_key: 2.5,
      engagements: 1, challenges: 0, held: 0, weakened: 0,
      revisions: [{ date: '2026-07-01', debate_id: 'debate-050', held_since: null }],
      last_tested: '2026-07-01',
      description_hash: computeDescriptionHash('Description of saf-belief-001'),
      record: [entry({ debate_id: 'debate-050', verdict: 'refined', strongest_attack_encountered: null })],
    };
    const node = makePovNode('saf-belief-001', {
      graph_attributes: { debate_tested: existingRecord },
      concession_history: [{ debate_id: 'debate-100', speaker: 'safetyist', text: 'I concede', turn: 3, conceded_to: 'accelerationist', concession_type: 'full', bdi_impact: 'belief' }],
    });
    const nodes = new Map([['saf-belief-001', node]]);
    const anNodes = [
      anNode('c1', 'safetyist', ['saf-belief-001'], 0.3),
      anNode('c2', 'accelerationist', [], 0.8),
    ];
    const anEdges = [anEdge('c2', 'c1')];

    const results = harvestDebateTested({
      ...baseParams(),
      anNodes, anEdges, taxonomyNodes: nodes,
    });

    expect(results[0].entry.verdict).toBe('weakened');
    expect(results[0].updatedRecord.revisions[0].held_since).toBe(false);
  });
});

// ── Fault injection tests ──────────────────────────────────────────────────

describe('harvestDebateTested fault injection', () => {
  const baseParams = () => ({
    debateId: 'debate-fault',
    date: '2026-07-12',
    pipelineVersion: '2026-07-abc123',
    concessions: [],
    refinedNodeIds: new Set<string>(),
    constants: DEBATE_TESTED_DEFAULTS,
  });

  it('handles missing taxonomy_refs gracefully (no claims attributed)', () => {
    const nodes = new Map([['saf-belief-001', makePovNode('saf-belief-001')]]);
    const anNodes = [
      anNode('c1', 'safetyist', [], 0.6),
      anNode('c2', 'accelerationist', [], 0.7),
    ];

    const results = harvestDebateTested({
      ...baseParams(),
      injectionManifest: { povNodeIds: ['saf-belief-001'] },
      anNodes, anEdges: [], taxonomyNodes: nodes,
    });

    expect(results).toHaveLength(0);
  });

  it('handles absent injection_manifest gracefully', () => {
    const nodes = new Map([['saf-belief-001', makePovNode('saf-belief-001')]]);
    const anNodes = [anNode('c1', 'safetyist', ['saf-belief-001'], 0.6)];

    const results = harvestDebateTested({
      ...baseParams(),
      injectionManifest: null,
      anNodes, anEdges: [], taxonomyNodes: nodes,
    });

    expect(results).toHaveLength(0);
  });

  it('handles malformed session (empty AN nodes and edges)', () => {
    const nodes = new Map([['saf-belief-001', makePovNode('saf-belief-001')]]);

    const results = harvestDebateTested({
      ...baseParams(),
      injectionManifest: { povNodeIds: ['saf-belief-001'] },
      anNodes: [], anEdges: [], taxonomyNodes: nodes,
    });

    expect(results).toHaveLength(0);
  });

  it('handles node in manifest but missing from taxonomy', () => {
    const nodes = new Map<string, PovNode>();
    const anNodes = [anNode('c1', 'safetyist', ['saf-belief-999'], 0.6)];

    const results = harvestDebateTested({
      ...baseParams(),
      injectionManifest: { povNodeIds: ['saf-belief-999'] },
      anNodes, anEdges: [], taxonomyNodes: nodes,
    });

    expect(results).toHaveLength(0);
  });

  it('handles AN nodes with no computed_strength', () => {
    const nodes = new Map([['saf-belief-001', makePovNode('saf-belief-001')]]);
    const anNodes = [{
      id: 'c1', text: 'claim', speaker: 'safetyist', taxonomy_refs: ['saf-belief-001'],
      turn_number: 1,
    } as ArgumentNetworkNode];

    const results = harvestDebateTested({
      ...baseParams(),
      injectionManifest: { povNodeIds: ['saf-belief-001'] },
      anNodes, anEdges: [], taxonomyNodes: nodes,
    });

    expect(results).toHaveLength(1);
    expect(results[0].entry.strongest_attack_encountered).toBeNull();
  });
});

// ── Bug regression tests (t/1575) ────────────────────────────────────────

describe('t/1575 regression', () => {
  const baseParams = () => ({
    debateId: 'debate-100',
    date: '2026-07-15',
    pipelineVersion: '2026-07-abc123',
    concessions: [] as ConcessionRecord[],
    refinedNodeIds: new Set<string>(),
    constants: DEBATE_TESTED_DEFAULTS,
  });

  it('debate-wide concession with no node linkage does NOT produce weakened verdict', () => {
    const nodes = new Map([['saf-belief-001', makePovNode('saf-belief-001')]]);
    const anNodes = [
      anNode('c1', 'safetyist', ['saf-belief-001'], 0.6),
      anNode('c2', 'accelerationist', [], 0.7),
    ];
    const anEdges = [anEdge('c2', 'c1')];
    const concessions: ConcessionRecord[] = [{
      debate_id: 'debate-100',
      speaker: 'safetyist',
      text: 'I concede on an unrelated point',
      turn: 5,
      conceded_to: 'some-other-node',
      concession_type: 'full',
      bdi_impact: 'belief',
    }];

    const results = harvestDebateTested({
      ...baseParams(),
      concessions,
      injectionManifest: { povNodeIds: ['saf-belief-001'] },
      anNodes, anEdges, taxonomyNodes: nodes,
    });

    expect(results).toHaveLength(1);
    expect(results[0].entry.verdict).not.toBe('weakened');
    expect(results[0].entry.concession).toBeNull();
  });

  it('node-scoped concession in debate-wide array DOES produce weakened verdict', () => {
    const nodes = new Map([['saf-belief-001', makePovNode('saf-belief-001')]]);
    const anNodes = [
      anNode('c1', 'safetyist', ['saf-belief-001'], 0.6),
      anNode('c2', 'accelerationist', [], 0.7),
    ];
    const anEdges = [anEdge('c2', 'c1')];
    const concessions: ConcessionRecord[] = [{
      debate_id: 'debate-100',
      speaker: 'safetyist',
      text: 'I concede this belief',
      turn: 5,
      conceded_to: 'saf-belief-001',
      concession_type: 'full',
      bdi_impact: 'belief',
    }];

    const results = harvestDebateTested({
      ...baseParams(),
      concessions,
      injectionManifest: { povNodeIds: ['saf-belief-001'] },
      anNodes, anEdges, taxonomyNodes: nodes,
    });

    expect(results).toHaveLength(1);
    expect(results[0].entry.verdict).toBe('weakened');
    expect(results[0].entry.concession).not.toBeNull();
  });

  it('node-scoped desire concession produces weakened verdict (t/1660 BDI generalization)', () => {
    const nodes = new Map([['acc-desire-001', makePovNode('acc-desire-001', { category: 'Desires' })]]);
    const anNodes = [
      anNode('c1', 'accelerationist', ['acc-desire-001'], 0.6),
      anNode('c2', 'safetyist', [], 0.7),
    ];
    const anEdges = [anEdge('c2', 'c1')];
    const concessions: ConcessionRecord[] = [{
      debate_id: 'debate-100',
      speaker: 'accelerationist',
      text: 'I concede this desire',
      turn: 5,
      conceded_to: 'acc-desire-001',
      concession_type: 'full',
      bdi_impact: 'desire',
    }];

    const results = harvestDebateTested({
      ...baseParams(),
      concessions,
      injectionManifest: { povNodeIds: ['acc-desire-001'] },
      anNodes, anEdges, taxonomyNodes: nodes,
    });

    expect(results).toHaveLength(1);
    expect(results[0].entry.verdict).toBe('weakened');
    expect(results[0].entry.concession).not.toBeNull();
  });

  it('node-scoped intention concession produces weakened verdict (t/1660 BDI generalization)', () => {
    const nodes = new Map([['saf-intention-001', makePovNode('saf-intention-001', { category: 'Intentions' })]]);
    const anNodes = [
      anNode('c1', 'safetyist', ['saf-intention-001'], 0.6),
      anNode('c2', 'accelerationist', [], 0.7),
    ];
    const anEdges = [anEdge('c2', 'c1')];
    const concessions: ConcessionRecord[] = [{
      debate_id: 'debate-100',
      speaker: 'safetyist',
      text: 'I concede this intention',
      turn: 5,
      conceded_to: 'saf-intention-001',
      concession_type: 'full',
      bdi_impact: 'intention',
    }];

    const results = harvestDebateTested({
      ...baseParams(),
      concessions,
      injectionManifest: { povNodeIds: ['saf-intention-001'] },
      anNodes, anEdges, taxonomyNodes: nodes,
    });

    expect(results).toHaveLength(1);
    expect(results[0].entry.verdict).toBe('weakened');
    expect(results[0].entry.concession).not.toBeNull();
  });

  it('desire concession is NOT applied to a belief node (cross-category isolation, t/1660)', () => {
    // A desire-impact concession must not weaken a Beliefs node: the verdict path
    // matches concession.bdi_impact against the node's own category-derived impact.
    const nodes = new Map([['saf-belief-001', makePovNode('saf-belief-001')]]);
    const anNodes = [
      anNode('c1', 'safetyist', ['saf-belief-001'], 0.6),
      anNode('c2', 'accelerationist', [], 0.7),
    ];
    const anEdges = [anEdge('c2', 'c1')];
    const concessions: ConcessionRecord[] = [{
      debate_id: 'debate-100',
      speaker: 'safetyist',
      text: 'I concede this desire',
      turn: 5,
      conceded_to: 'saf-belief-001',
      concession_type: 'full',
      bdi_impact: 'desire',
    }];

    const results = harvestDebateTested({
      ...baseParams(),
      concessions,
      injectionManifest: { povNodeIds: ['saf-belief-001'] },
      anNodes, anEdges, taxonomyNodes: nodes,
    });

    expect(results).toHaveLength(1);
    expect(results[0].entry.verdict).not.toBe('weakened');
    expect(results[0].entry.concession).toBeNull();
  });

  it('held verdict does NOT flip held_since when description was edited externally', () => {
    const originalDesc = 'Description of saf-belief-001';
    const editedDesc = 'Manually edited description that differs from original';
    const existingRecord = {
      tier: 'contested' as const,
      sort_key: 2.5,
      engagements: 1, challenges: 0, held: 0, weakened: 0,
      revisions: [{ date: '2026-07-01', debate_id: 'debate-050', held_since: null, prior_falsifiability: 'medium' }],
      last_tested: '2026-07-01',
      description_hash: computeDescriptionHash(originalDesc),
      record: [entry({ debate_id: 'debate-050', verdict: 'refined', strongest_attack_encountered: null })],
    };
    const node = makePovNode('saf-belief-001', {
      description: editedDesc,
      graph_attributes: { falsifiability: 'high', debate_tested: existingRecord },
    });
    const nodes = new Map([['saf-belief-001', node]]);
    const anNodes = [
      anNode('c1', 'safetyist', ['saf-belief-001'], 0.6),
      anNode('c2', 'accelerationist', [], 0.7),
    ];
    const anEdges = [anEdge('c2', 'c1')];

    const results = harvestDebateTested({
      ...baseParams(),
      injectionManifest: { povNodeIds: ['saf-belief-001'] },
      anNodes, anEdges, taxonomyNodes: nodes,
    });

    expect(results[0].entry.verdict).toBe('held');
    expect(results[0].updatedRecord.revisions[0].held_since).toBeNull();
  });
});
