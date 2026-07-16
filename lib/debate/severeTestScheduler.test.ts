import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  computeImportance,
  computeDeficit,
  computeNodeImportance,
  generateBatchConfig,
  loadTestingRecords,
  IMPORTANCE_WEIGHTS,
  DEFICIT_SCORES,
} from './severeTestScheduler.js';
import type { PovNode } from './taxonomyTypes.js';
import type { NodeTestingRecord } from './debateTested.js';
import {
  isReeligible,
  getLastTestedDate,
  getChallengerCamps,
  WELL_TESTED_EXCLUSION,
} from './debateTested.js';
import type { DebateTestedRecord } from './taxonomyTypes.js';

// ── Re-eligibility ───────────────────────────────────────────────────────────

function makeRecord(overrides: Partial<DebateTestedRecord> = {}): DebateTestedRecord {
  return {
    tier: 'well_tested',
    sort_key: 3.5,
    engagements: 5,
    challenges: 3,
    held: 3,
    weakened: 0,
    revisions: [],
    last_tested: '2026-04-01',
    description_hash: 'sha256:abc',
    record: [
      {
        debate_id: 'd1', date: '2026-03-01', pipeline_version: 'v1', verdict: 'held',
        strongest_attack_encountered: { claim_id: 'c1', strength: 0.7, scheme: 'undercut', challenger_camp: 'safetyist' },
        claim_outcomes: { thrived: 1, survived: 0, died: 0 }, concession: null,
      },
      {
        debate_id: 'd2', date: '2026-04-01', pipeline_version: 'v1', verdict: 'held',
        strongest_attack_encountered: { claim_id: 'c2', strength: 0.6, scheme: 'rebut', challenger_camp: 'skeptic' },
        claim_outcomes: { thrived: 1, survived: 0, died: 0 }, concession: null,
      },
    ],
    ...overrides,
  };
}

describe('getLastTestedDate', () => {
  it('returns the last record entry date', () => {
    const dt = makeRecord();
    expect(getLastTestedDate(dt).toISOString().slice(0, 10)).toBe('2026-04-01');
  });

  it('falls back to last_tested when record is empty', () => {
    const dt = makeRecord({ record: [], last_tested: '2026-01-15' });
    expect(getLastTestedDate(dt).toISOString().slice(0, 10)).toBe('2026-01-15');
  });
});

describe('getChallengerCamps', () => {
  it('extracts unique challenger camps from record', () => {
    const dt = makeRecord();
    const camps = getChallengerCamps(dt);
    expect(camps.size).toBe(2);
    expect(camps.has('safetyist')).toBe(true);
    expect(camps.has('skeptic')).toBe(true);
  });

  it('returns empty set for records with no attacks', () => {
    const dt = makeRecord({
      record: [{
        debate_id: 'd1', date: '2026-03-01', pipeline_version: 'v1', verdict: 'cited',
        strongest_attack_encountered: null,
        claim_outcomes: { thrived: 0, survived: 0, died: 0 }, concession: null,
      }],
    });
    expect(getChallengerCamps(dt).size).toBe(0);
  });
});

describe('isReeligible', () => {
  const now = new Date('2026-07-15');

  it('returns false for recently tested, multi-camp, low-citation well_tested node', () => {
    const dt = makeRecord({ last_tested: '2026-06-01' });
    dt.record[dt.record.length - 1].date = '2026-06-01';
    expect(isReeligible(dt, 5, 0, now)).toBe(false);
  });

  it('returns true when last test is >90 days ago', () => {
    const dt = makeRecord();
    dt.record[dt.record.length - 1].date = '2026-03-01';
    expect(isReeligible(dt, 0, 0, now)).toBe(true);
  });

  it('returns true when organic citations >= 20', () => {
    const dt = makeRecord({ last_tested: '2026-06-01' });
    dt.record[dt.record.length - 1].date = '2026-06-01';
    expect(isReeligible(dt, 20, 0, now)).toBe(true);
  });

  it('returns true when consecutive exclusions >= 3', () => {
    const dt = makeRecord({ last_tested: '2026-06-01' });
    dt.record[dt.record.length - 1].date = '2026-06-01';
    expect(isReeligible(dt, 0, 3, now)).toBe(true);
  });

  it('returns true when only one challenger camp', () => {
    const dt = makeRecord();
    dt.record[dt.record.length - 1].date = '2026-06-01';
    dt.record[1].strongest_attack_encountered!.challenger_camp = 'safetyist';
    expect(isReeligible(dt, 0, 0, now)).toBe(true);
  });

  it('returns false at exactly 90 days (boundary)', () => {
    const dt = makeRecord();
    dt.record[dt.record.length - 1].date = '2026-04-16';
    expect(isReeligible(dt, 0, 0, now)).toBe(false);
  });
});

// ── Importance computation ───────────────────────────────────────────────────

describe('computeImportance', () => {
  it('returns weighted sum of inputs', () => {
    const result = computeImportance({
      degree: 1.0, cruxDensity: 1.0, policyLinkage: 1.0, doctrinalAnchor: 1.0, usage: 1.0,
    });
    expect(result).toBeCloseTo(1.0, 5);
  });

  it('returns 0 for all-zero inputs', () => {
    expect(computeImportance({
      degree: 0, cruxDensity: 0, policyLinkage: 0, doctrinalAnchor: 0, usage: 0,
    })).toBe(0);
  });

  it('weights sum to 1.0', () => {
    const sum = Object.values(IMPORTANCE_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1.0, 10);
  });
});

describe('computeDeficit', () => {
  it('returns 1.0 for untested', () => {
    expect(computeDeficit('untested', false)).toBe(1.0);
  });

  it('returns stale score for stale non-untested', () => {
    expect(computeDeficit('contested', true)).toBe(0.6);
  });

  it('returns tier score for non-stale', () => {
    expect(computeDeficit('well_tested', false)).toBe(0.1);
  });

  it('untested is not affected by stale flag', () => {
    expect(computeDeficit('untested', true)).toBe(1.0);
  });
});

describe('computeNodeImportance', () => {
  const nodes: PovNode[] = [
    {
      id: 'acc-belief-001', category: 'Beliefs', label: 'Test', description: 'desc',
      parent_id: null, children: ['c1', 'c2'], situation_refs: ['s1'],
      graph_attributes: { policy_actions: [{ action: 'a', framing: 'f' }] },
      doctrinally_anchored: true, debate_refs: ['d1', 'd2', 'd3'],
    } as unknown as PovNode,
    {
      id: 'saf-belief-001', category: 'Beliefs', label: 'Test2', description: 'desc2',
      parent_id: null, children: [], situation_refs: [],
      graph_attributes: {},
      debate_refs: [],
    } as unknown as PovNode,
  ];

  const cruxLinks = new Map([['acc-belief-001', 5], ['saf-belief-001', 0]]);

  it('normalizes and computes importance for multiple nodes', () => {
    const result = computeNodeImportance(nodes, cruxLinks);
    expect(result.size).toBe(2);
    const acc = result.get('acc-belief-001')!;
    const saf = result.get('saf-belief-001')!;
    expect(acc.importance).toBeGreaterThan(saf.importance);
    expect(acc.inputs.degree).toBe(1.0);
    expect(acc.inputs.doctrinalAnchor).toBe(1.0);
    expect(saf.inputs.degree).toBe(0);
  });
});

// ── Scheduler ────────────────────────────────────────────────────────────────

function makeTestRecord(id: string, pov: string, tier: string, stale = false): NodeTestingRecord {
  return {
    nodeId: id, pov, category: 'Beliefs', label: `Label ${id}`,
    tier: tier as NodeTestingRecord['tier'],
    sortKey: 0, engagements: 0, challenges: 0, held: 0, weakened: 0,
    lastTested: '2026-06-01', refined: false, stale,
    challengerCamps: [],
  };
}

function makeNode(id: string): PovNode {
  return {
    id, category: 'Beliefs', label: `Label ${id}`, description: `Desc ${id}`,
    parent_id: null, children: ['c1'], situation_refs: ['s1'],
    graph_attributes: { policy_actions: [{ action: 'a', framing: 'f' }] },
    debate_refs: ['d1'],
  } as unknown as PovNode;
}

describe('generateBatchConfig', () => {
  const records: NodeTestingRecord[] = [
    makeTestRecord('acc-belief-001', 'accelerationist', 'untested'),
    makeTestRecord('acc-belief-002', 'accelerationist', 'cited'),
    makeTestRecord('saf-belief-001', 'safetyist', 'untested'),
    makeTestRecord('saf-belief-002', 'safetyist', 'contested'),
    makeTestRecord('skp-belief-001', 'skeptic', 'untested'),
    makeTestRecord('skp-belief-002', 'skeptic', 'well_tested'),
  ];
  const nodes = records.map(r => makeNode(r.nodeId));
  const cruxLinks = new Map<string, number>();

  it('generates a batch config with balanced POV round-robin', () => {
    const config = generateBatchConfig({
      records, nodes, cruxLinks, topN: 6, generatedDate: '2026-07-15',
    });
    expect(config.name).toBe('severe-test-batch-2026-07-15');
    expect(config.debates).toHaveLength(6);
    const povs = config.debates.map(d => d.targetPov);
    expect(povs[0]).toBe('accelerationist');
    expect(povs[1]).toBe('safetyist');
    expect(povs[2]).toBe('skeptic');
  });

  it('respects topN limit', () => {
    const config = generateBatchConfig({
      records, nodes, cruxLinks, topN: 3, generatedDate: '2026-07-15',
    });
    expect(config.debates).toHaveLength(3);
  });

  it('prioritizes untested over cited/contested/well_tested', () => {
    const config = generateBatchConfig({
      records, nodes, cruxLinks, topN: 6, generatedDate: '2026-07-15',
    });
    const untestedEntries = config.debates.filter(d =>
      records.find(r => r.nodeId === d.targetNodeId)?.tier === 'untested'
    );
    expect(untestedEntries.length).toBe(3);
    for (let i = 0; i < 3; i++) {
      const r = records.find(rec => rec.nodeId === config.debates[i].targetNodeId)!;
      expect(r.tier).toBe('untested');
    }
  });

  it('excludes specified node IDs', () => {
    const config = generateBatchConfig({
      records, nodes, cruxLinks, topN: 6, generatedDate: '2026-07-15',
      excludeNodeIds: new Set(['acc-belief-001']),
    });
    expect(config.debates.find(d => d.targetNodeId === 'acc-belief-001')).toBeUndefined();
  });

  it('enforces MAX_TESTS_PER_NODE_PER_CYCLE (no duplicates)', () => {
    const duped: NodeTestingRecord[] = [
      makeTestRecord('acc-belief-001', 'accelerationist', 'untested'),
      makeTestRecord('acc-belief-001', 'accelerationist', 'untested'),
    ];
    const config = generateBatchConfig({
      records: duped, nodes: [makeNode('acc-belief-001')], cruxLinks, topN: 5,
      generatedDate: '2026-07-15',
    });
    expect(config.debates).toHaveLength(1);
  });

  it('handles fewer candidates than topN', () => {
    const config = generateBatchConfig({
      records: [makeTestRecord('acc-belief-001', 'accelerationist', 'untested')],
      nodes: [makeNode('acc-belief-001')], cruxLinks, topN: 10,
      generatedDate: '2026-07-15',
    });
    expect(config.debates).toHaveLength(1);
  });

  it('uses custom batch name when provided', () => {
    const config = generateBatchConfig({
      records, nodes, cruxLinks, topN: 3, batchName: 'pilot-batch',
      generatedDate: '2026-07-15',
    });
    expect(config.name).toBe('pilot-batch');
  });
});

// ── Phase B: pre-computed records ───────────────────────────────────────────

function makePrecomputedRecord(
  id: string, pov: string, tier: string, importance: number, deficit: number,
): NodeTestingRecord {
  return {
    ...makeTestRecord(id, pov, tier),
    importance,
    deficit,
    testingPriority: importance * deficit,
  };
}

describe('generateBatchConfig with pre-computed testingPriority', () => {
  it('uses pre-computed priority without nodes/cruxLinks', () => {
    const precomputed = [
      makePrecomputedRecord('acc-belief-001', 'accelerationist', 'untested', 0.8, 1.0),
      makePrecomputedRecord('saf-belief-001', 'safetyist', 'cited', 0.6, 0.7),
      makePrecomputedRecord('skp-belief-001', 'skeptic', 'contested', 0.5, 0.4),
    ];
    const config = generateBatchConfig({
      records: precomputed, topN: 3, generatedDate: '2026-07-15',
    });
    expect(config.debates).toHaveLength(3);
    expect(config.debates[0].targetNodeId).toBe('acc-belief-001');
    expect(config.debates[0].testingPriority).toBe(0.8);
  });

  it('preserves POV round-robin with pre-computed records', () => {
    const precomputed = [
      makePrecomputedRecord('acc-belief-001', 'accelerationist', 'untested', 0.9, 1.0),
      makePrecomputedRecord('acc-belief-002', 'accelerationist', 'cited', 0.85, 0.7),
      makePrecomputedRecord('saf-belief-001', 'safetyist', 'untested', 0.7, 1.0),
      makePrecomputedRecord('skp-belief-001', 'skeptic', 'untested', 0.6, 1.0),
    ];
    const config = generateBatchConfig({
      records: precomputed, topN: 4, generatedDate: '2026-07-15',
    });
    const povs = config.debates.map(d => d.targetPov);
    expect(povs[0]).toBe('accelerationist');
    expect(povs[1]).toBe('safetyist');
    expect(povs[2]).toBe('skeptic');
    expect(povs[3]).toBe('accelerationist');
  });

  it('respects excludeNodeIds with pre-computed records', () => {
    const precomputed = [
      makePrecomputedRecord('acc-belief-001', 'accelerationist', 'untested', 0.9, 1.0),
      makePrecomputedRecord('saf-belief-001', 'safetyist', 'untested', 0.7, 1.0),
    ];
    const config = generateBatchConfig({
      records: precomputed, topN: 5, generatedDate: '2026-07-15',
      excludeNodeIds: new Set(['acc-belief-001']),
    });
    expect(config.debates).toHaveLength(1);
    expect(config.debates[0].targetNodeId).toBe('saf-belief-001');
  });

  it('throws when records lack testingPriority and no nodes/cruxLinks provided', () => {
    const plain = [makeTestRecord('acc-belief-001', 'accelerationist', 'untested')];
    expect(() => generateBatchConfig({
      records: plain, topN: 5, generatedDate: '2026-07-15',
    })).toThrow('nodes and cruxLinks are required');
  });
});

// ── loadTestingRecords ──────────────────────────────────────────────────────

describe('loadTestingRecords', () => {
  const tmpFile = path.join(os.tmpdir(), `test-records-${process.pid}.json`);

  afterEach(() => {
    try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
  });

  it('reads and parses a JSON file of NodeTestingRecord[]', () => {
    const records = [
      makePrecomputedRecord('acc-belief-001', 'accelerationist', 'untested', 0.8, 1.0),
    ];
    fs.writeFileSync(tmpFile, JSON.stringify(records), 'utf-8');
    const loaded = loadTestingRecords(tmpFile);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].nodeId).toBe('acc-belief-001');
    expect(loaded[0].testingPriority).toBe(0.8);
  });
});
