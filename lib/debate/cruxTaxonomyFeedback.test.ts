// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import {
  findPromotionCandidates,
  buildDraftSituationNode,
  computeWeightAdjustments,
  applyConfidenceAdjustment,
  applyPriorityAdjustment,
  formatPromotionReport,
  formatWeightAdjustmentReport,
} from './cruxTaxonomyFeedback.js';
import type { CruxRegistry, CruxRegistryEntry, CruxOccurrence } from './types.js';
import type { PovNode } from './taxonomyTypes.js';

function makeOccurrence(overrides: Partial<CruxOccurrence> = {}): CruxOccurrence {
  return {
    debate_id: 'debate-1',
    debate_topic: 'AI safety',
    date: new Date().toISOString(),
    an_id: 'crux-1',
    final_state: 'irreducible',
    turns_engaged: 3,
    intervention_issued: false,
    resolved_post_intervention: false,
    model: 'gemini-2.5-flash',
    ...overrides,
  };
}

function makeEntry(overrides: Partial<CruxRegistryEntry> = {}): CruxRegistryEntry {
  return {
    id: 'abc123',
    description: 'Whether current AI capabilities pose existential risk',
    embedding: [0.1, 0.2, 0.3, 0.4],
    disagreement_type: 'empirical',
    first_seen_debate: 'debate-1',
    first_seen_date: new Date().toISOString(),
    occurrences: [
      makeOccurrence({ debate_id: 'd1' }),
      makeOccurrence({ debate_id: 'd2' }),
      makeOccurrence({ debate_id: 'd3' }),
    ],
    related_taxonomy_nodes: ['acc-beliefs-001'],
    promoted_to_situation: null,
    ...overrides,
  };
}

function makeRegistry(entries: CruxRegistryEntry[]): CruxRegistry {
  return { version: 1, entries, last_updated: '' };
}

function makeNode(overrides: Partial<PovNode> = {}): PovNode {
  return {
    id: 'acc-beliefs-001',
    category: 'beliefs',
    label: 'Test node',
    description: 'A test node',
    parent_id: null,
    children: [],
    situation_refs: [],
    confidence: 0.75,
    confidence_history: [],
    priority: 3,
    priority_history: [],
    ...overrides,
  } as PovNode;
}

// ── findPromotionCandidates ─────────────────────────────

describe('findPromotionCandidates', () => {
  it('returns entries with 3+ irreducible occurrences', () => {
    const entry = makeEntry();
    const reg = makeRegistry([entry]);
    const candidates = findPromotionCandidates(reg);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].irreducible_count).toBe(3);
  });

  it('excludes already-promoted entries', () => {
    const entry = makeEntry({ promoted_to_situation: 'sit-001' });
    const reg = makeRegistry([entry]);
    expect(findPromotionCandidates(reg)).toHaveLength(0);
  });

  it('excludes entries with fewer than 3 irreducible occurrences', () => {
    const entry = makeEntry({
      occurrences: [
        makeOccurrence({ final_state: 'irreducible' }),
        makeOccurrence({ final_state: 'engaged' }),
      ],
    });
    const reg = makeRegistry([entry]);
    expect(findPromotionCandidates(reg)).toHaveLength(0);
  });

  it('counts only irreducible (not engaged) occurrences toward threshold', () => {
    const entry = makeEntry({
      occurrences: [
        makeOccurrence({ final_state: 'irreducible' }),
        makeOccurrence({ final_state: 'irreducible' }),
        makeOccurrence({ final_state: 'engaged' }),
        makeOccurrence({ final_state: 'engaged' }),
      ],
    });
    const reg = makeRegistry([entry]);
    expect(findPromotionCandidates(reg)).toHaveLength(0);
  });

  it('sorts by irreducible count descending', () => {
    const a = makeEntry({
      id: 'a',
      occurrences: [
        makeOccurrence(), makeOccurrence(), makeOccurrence(),
      ],
    });
    const b = makeEntry({
      id: 'b',
      occurrences: [
        makeOccurrence(), makeOccurrence(), makeOccurrence(), makeOccurrence(),
      ],
    });
    const reg = makeRegistry([a, b]);
    const candidates = findPromotionCandidates(reg);
    expect(candidates[0].entry.id).toBe('b');
  });
});

// ── buildDraftSituationNode ─────────────────────────────

describe('buildDraftSituationNode', () => {
  it('creates a draft with crux description in label', () => {
    const entry = makeEntry();
    const draft = buildDraftSituationNode(entry);
    expect(draft.label).toContain('Derived from crux:');
    expect(draft.label).toContain(entry.description);
    expect(draft.disagreement_type).toBe('empirical');
  });

  it('includes occurrence count in description', () => {
    const entry = makeEntry();
    const draft = buildDraftSituationNode(entry);
    expect(draft.description).toContain('3 of 3 debates');
    expect(draft.description).toContain('POV interpretation authoring');
  });
});

// ── computeWeightAdjustments ────────────────────────────

describe('computeWeightAdjustments', () => {
  it('produces confidence reduction for empirical crux with beliefs node', () => {
    const entry = makeEntry({
      disagreement_type: 'empirical',
      occurrences: [makeOccurrence(), makeOccurrence()],
      related_taxonomy_nodes: ['acc-beliefs-005'],
    });
    const adj = computeWeightAdjustments(makeRegistry([entry]));
    expect(adj).toHaveLength(1);
    expect(adj[0].type).toBe('confidence');
    expect(adj[0].delta).toBe(-0.05);
    expect(adj[0].node_id).toBe('acc-beliefs-005');
  });

  it('produces priority increase for values crux with desires node', () => {
    const entry = makeEntry({
      disagreement_type: 'values',
      occurrences: [makeOccurrence(), makeOccurrence()],
      related_taxonomy_nodes: ['saf-desires-003'],
    });
    const adj = computeWeightAdjustments(makeRegistry([entry]));
    expect(adj).toHaveLength(1);
    expect(adj[0].type).toBe('priority');
    expect(adj[0].delta).toBe(1);
    expect(adj[0].node_id).toBe('saf-desires-003');
  });

  it('skips definitional cruxes (no weight impact)', () => {
    const entry = makeEntry({
      disagreement_type: 'definitional',
      occurrences: [makeOccurrence(), makeOccurrence()],
      related_taxonomy_nodes: ['acc-beliefs-001', 'saf-desires-001'],
    });
    expect(computeWeightAdjustments(makeRegistry([entry]))).toHaveLength(0);
  });

  it('skips entries with fewer than 2 irreducible occurrences', () => {
    const entry = makeEntry({
      disagreement_type: 'empirical',
      occurrences: [makeOccurrence({ final_state: 'irreducible' }), makeOccurrence({ final_state: 'engaged' })],
      related_taxonomy_nodes: ['acc-beliefs-001'],
    });
    expect(computeWeightAdjustments(makeRegistry([entry]))).toHaveLength(0);
  });

  it('only adjusts matching BDI category nodes', () => {
    const entry = makeEntry({
      disagreement_type: 'empirical',
      occurrences: [makeOccurrence(), makeOccurrence()],
      related_taxonomy_nodes: ['saf-desires-001', 'acc-intentions-002'],
    });
    expect(computeWeightAdjustments(makeRegistry([entry]))).toHaveLength(0);
  });
});

// ── applyConfidenceAdjustment ───────────────────────────

describe('applyConfidenceAdjustment', () => {
  it('reduces confidence and records history', () => {
    const node = makeNode({ confidence: 0.75 });
    const adj = { node_id: 'acc-beliefs-001', type: 'confidence' as const, delta: -0.05, reason: 'test', crux_description: 'test', irreducible_count: 2 };
    const result = applyConfidenceAdjustment(node, adj);
    expect(result.applied).toBe(true);
    expect(result.new_value).toBe(0.7);
    expect(node.confidence_history).toHaveLength(1);
    expect(node.confidence_history![0].delta).toBe(-0.05);
  });

  it('clamps confidence at 0', () => {
    const node = makeNode({ confidence: 0.02 });
    const adj = { node_id: 'x', type: 'confidence' as const, delta: -0.05, reason: 'test', crux_description: 'test', irreducible_count: 2 };
    const result = applyConfidenceAdjustment(node, adj);
    expect(result.new_value).toBe(0);
  });

  it('returns not applied when confidence is null', () => {
    const node = makeNode({ confidence: undefined });
    const adj = { node_id: 'x', type: 'confidence' as const, delta: -0.05, reason: 'test', crux_description: 'test', irreducible_count: 2 };
    expect(applyConfidenceAdjustment(node, adj).applied).toBe(false);
  });
});

// ── applyPriorityAdjustment ─────────────────────────────

describe('applyPriorityAdjustment', () => {
  it('increases priority and records history', () => {
    const node = makeNode({ priority: 3 });
    const adj = { node_id: 'saf-desires-001', type: 'priority' as const, delta: 1, reason: 'test', crux_description: 'test', irreducible_count: 2 };
    const result = applyPriorityAdjustment(node, adj);
    expect(result.applied).toBe(true);
    expect(result.new_value).toBe(4);
    expect(node.priority_history).toHaveLength(1);
  });

  it('caps priority at 5', () => {
    const node = makeNode({ priority: 5 });
    const adj = { node_id: 'x', type: 'priority' as const, delta: 1, reason: 'test', crux_description: 'test', irreducible_count: 2 };
    const result = applyPriorityAdjustment(node, adj);
    expect(result.new_value).toBe(5);
  });

  it('returns not applied when priority is null', () => {
    const node = makeNode({ priority: undefined });
    const adj = { node_id: 'x', type: 'priority' as const, delta: 1, reason: 'test', crux_description: 'test', irreducible_count: 2 };
    expect(applyPriorityAdjustment(node, adj).applied).toBe(false);
  });
});

// ── formatPromotionReport ───────────────────────────────

describe('formatPromotionReport', () => {
  it('returns no-candidates message when empty', () => {
    expect(formatPromotionReport([])).toContain('No cruxes meet');
  });

  it('formats candidates with type and occurrence stats', () => {
    const entry = makeEntry();
    const candidates = findPromotionCandidates(makeRegistry([entry]));
    const report = formatPromotionReport(candidates);
    expect(report).toContain('PROMOTION CANDIDATES');
    expect(report).toContain('EMPIRICAL');
    expect(report).toContain('3/3');
    expect(report).toContain('human review');
  });
});

// ── formatWeightAdjustmentReport ────────────────────────

describe('formatWeightAdjustmentReport', () => {
  it('returns no-adjustments message when empty', () => {
    expect(formatWeightAdjustmentReport([])).toContain('No weight adjustments');
  });

  it('formats adjustments with sign and reason', () => {
    const entry = makeEntry({
      disagreement_type: 'empirical',
      occurrences: [makeOccurrence(), makeOccurrence()],
      related_taxonomy_nodes: ['acc-beliefs-001'],
    });
    const adj = computeWeightAdjustments(makeRegistry([entry]));
    const report = formatWeightAdjustmentReport(adj);
    expect(report).toContain('WEIGHT ADJUSTMENTS');
    expect(report).toContain('-0.05');
    expect(report).toContain('acc-beliefs-001');
  });
});
