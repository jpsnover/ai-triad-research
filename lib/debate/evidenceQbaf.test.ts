// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi } from 'vitest';
import {
  buildEvidenceQbaf,
  buildClassificationPrompt,
  parseClassifications,
  buildEvidenceGraph,
} from './evidenceQbaf.js';
import type { EvidenceItem } from './evidenceRetriever.js';
import type { AIAdapter } from './aiAdapter.js';

// ── Helpers ──────────────────────────────────────────────

function makeEvidence(overrides: Partial<EvidenceItem> & { id: string }): EvidenceItem {
  return {
    source_doc_id: 'test-source',
    text: 'Test evidence text',
    similarity_score: 0.7,
    ...overrides,
  };
}

function makeMockAdapter(response: string): AIAdapter {
  return {
    generateText: vi.fn().mockResolvedValue(response),
  };
}

// ── parseClassifications ─────────────────────────────────

describe('parseClassifications', () => {
  it('parses valid JSON array', () => {
    const input = JSON.stringify([
      { index: 1, relation: 'support', reason: 'agrees' },
      { index: 2, relation: 'contradict', reason: 'disagrees' },
      { index: 3, relation: 'irrelevant', reason: 'off-topic' },
    ]);
    const result = parseClassifications(input, 3);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ index: 1, relation: 'support', reason: 'agrees' });
    expect(result[1]).toEqual({ index: 2, relation: 'contradict', reason: 'disagrees' });
    expect(result[2]).toEqual({ index: 3, relation: 'irrelevant', reason: 'off-topic' });
  });

  it('strips markdown code fences', () => {
    const input = '```json\n[{"index": 1, "relation": "support"}]\n```';
    const result = parseClassifications(input, 1);
    expect(result).toHaveLength(1);
    expect(result[0].relation).toBe('support');
  });

  it('filters invalid indices', () => {
    const input = JSON.stringify([
      { index: 0, relation: 'support' },
      { index: 1, relation: 'support' },
      { index: 99, relation: 'support' },
    ]);
    const result = parseClassifications(input, 3);
    expect(result).toHaveLength(1);
    expect(result[0].index).toBe(1);
  });

  it('filters invalid relation values', () => {
    const input = JSON.stringify([
      { index: 1, relation: 'maybe' },
      { index: 2, relation: 'support' },
    ]);
    const result = parseClassifications(input, 2);
    expect(result).toHaveLength(1);
    expect(result[0].index).toBe(2);
  });

  it('returns empty for malformed JSON', () => {
    const result = parseClassifications('not json at all', 3);
    expect(result).toEqual([]);
  });
});

// ── buildEvidenceGraph ───────────────────────────────────

describe('buildEvidenceGraph', () => {
  it('creates claim root node and evidence children', () => {
    const classified = [
      { id: 'ev-1', source_doc_id: 's1', text: 'evidence 1', relation: 'support' as const, similarity: 0.8 },
      { id: 'ev-2', source_doc_id: 's2', text: 'evidence 2', relation: 'contradict' as const, similarity: 0.6 },
    ];
    const { nodes, edges } = buildEvidenceGraph(0.5, 0.5, classified);

    expect(nodes).toHaveLength(3); // claim + 2 evidence
    expect(nodes[0]).toEqual({ id: 'claim', base_strength: 0.5 });
    expect(edges).toHaveLength(2);
    expect(edges[0]).toEqual({ source: 'ev-1', target: 'claim', type: 'supports', weight: 0.8 });
    expect(edges[1]).toEqual({ source: 'ev-2', target: 'claim', type: 'attacks', weight: 0.6 });
  });

  it('handles empty classified items', () => {
    const { nodes, edges } = buildEvidenceGraph(0.5, 0.5, []);
    expect(nodes).toHaveLength(1);
    expect(edges).toHaveLength(0);
  });
});

// ── buildClassificationPrompt ────────────────────────────

describe('buildClassificationPrompt', () => {
  it('includes claim text and evidence items', () => {
    const items = [
      makeEvidence({ id: 'ev-1', source_doc_id: 'src-1', text: 'Evidence paragraph one' }),
      makeEvidence({ id: 'ev-2', source_doc_id: 'src-2', text: 'Evidence paragraph two' }),
    ];
    const prompt = buildClassificationPrompt('Test claim about AI safety', items);
    expect(prompt).toContain('Test claim about AI safety');
    expect(prompt).toContain('[1] (src-1): Evidence paragraph one');
    expect(prompt).toContain('[2] (src-2): Evidence paragraph two');
    expect(prompt).toContain('"support"');
    expect(prompt).toContain('"contradict"');
    expect(prompt).toContain('"irrelevant"');
  });

  it('injects domain vocabulary when provided', () => {
    const terms = [
      { canonical_form: 'alignment_tax', display_form: 'alignment tax', definition: 'Performance cost of safety', primary_camp_origin: 'accelerationist' as const },
    ] as import('../dictionary/types').StandardizedTerm[];
    const prompt = buildClassificationPrompt('test claim', [makeEvidence({ id: 'ev-1' })], terms);
    expect(prompt).toContain('alignment_tax');
    expect(prompt).toContain('Performance cost of safety');
  });

  it('omits vocabulary section when no terms provided', () => {
    const prompt = buildClassificationPrompt('test claim', [makeEvidence({ id: 'ev-1' })]);
    expect(prompt).not.toContain('Domain vocabulary');
  });
});

// ── buildEvidenceQbaf (integration) ──────────────────────

describe('buildEvidenceQbaf', () => {
  it('returns base strength when no evidence items', async () => {
    const adapter = makeMockAdapter('[]');
    const result = await buildEvidenceQbaf('test claim', [], adapter, 'test-model');
    expect(result.computed_strength).toBe(0.5);
    expect(result.qbaf_iterations).toBe(0);
    expect(result.evidence_items).toEqual([]);
    expect(adapter.generateText).not.toHaveBeenCalled();
  });

  it('classifies and computes QBAF strength for supporting evidence', async () => {
    const items = [
      makeEvidence({ id: 'ev-1', source_doc_id: 'src-1', text: 'Supporting evidence', similarity_score: 0.8 }),
      makeEvidence({ id: 'ev-2', source_doc_id: 'src-2', text: 'More support', similarity_score: 0.6 }),
    ];
    const adapter = makeMockAdapter(JSON.stringify([
      { index: 1, relation: 'support', reason: 'agrees with claim' },
      { index: 2, relation: 'support', reason: 'also supports' },
    ]));

    const result = await buildEvidenceQbaf('test claim', items, adapter, 'test-model');
    expect(result.computed_strength).toBeGreaterThan(0.5); // Support should boost strength
    expect(result.evidence_items).toHaveLength(2);
    expect(result.evidence_items[0].relation).toBe('support');
  });

  it('computes lower strength for contradicting evidence', async () => {
    const items = [
      makeEvidence({ id: 'ev-1', source_doc_id: 'src-1', text: 'Contradicting evidence', similarity_score: 0.8 }),
      makeEvidence({ id: 'ev-2', source_doc_id: 'src-2', text: 'More contradiction', similarity_score: 0.7 }),
    ];
    const adapter = makeMockAdapter(JSON.stringify([
      { index: 1, relation: 'contradict', reason: 'disputes claim' },
      { index: 2, relation: 'contradict', reason: 'also disputes' },
    ]));

    const result = await buildEvidenceQbaf('test claim', items, adapter, 'test-model');
    expect(result.computed_strength).toBeLessThan(0.5); // Attacks should reduce strength
    expect(result.evidence_items).toHaveLength(2);
    expect(result.evidence_items[0].relation).toBe('contradict');
  });

  it('filters irrelevant evidence and returns base strength when all irrelevant', async () => {
    const items = [
      makeEvidence({ id: 'ev-1', source_doc_id: 'src-1', text: 'Unrelated text', similarity_score: 0.5 }),
    ];
    const adapter = makeMockAdapter(JSON.stringify([
      { index: 1, relation: 'irrelevant', reason: 'not related' },
    ]));

    const result = await buildEvidenceQbaf('test claim', items, adapter, 'test-model');
    expect(result.computed_strength).toBe(0.5);
    expect(result.evidence_items).toEqual([]);
  });

  it('uses evaluator model when specified in options', async () => {
    const items = [makeEvidence({ id: 'ev-1' })];
    const adapter = makeMockAdapter(JSON.stringify([{ index: 1, relation: 'support' }]));

    await buildEvidenceQbaf('test claim', items, adapter, 'default-model', {
      model: 'evaluator-model',
    });

    expect(adapter.generateText).toHaveBeenCalledWith(
      expect.any(String),
      'evaluator-model',
      expect.any(Object),
    );
  });

  it('throws ActionableError on LLM failure', async () => {
    const items = [makeEvidence({ id: 'ev-1' })];
    const adapter: AIAdapter = {
      generateText: vi.fn().mockRejectedValue(new Error('API key invalid')),
    };

    await expect(
      buildEvidenceQbaf('test claim', items, adapter, 'test-model'),
    ).rejects.toThrow(/Classify evidence/);
  });

  it('handles malformed LLM response gracefully', async () => {
    const items = [makeEvidence({ id: 'ev-1' })];
    const adapter = makeMockAdapter('This is not JSON');

    const result = await buildEvidenceQbaf('test claim', items, adapter, 'test-model');
    // Malformed response → no classifications → base strength
    expect(result.computed_strength).toBe(0.5);
    expect(result.evidence_items).toEqual([]);
  });

  it('records qbaf_iterations from engine', async () => {
    const items = [
      makeEvidence({ id: 'ev-1', similarity_score: 0.9 }),
      makeEvidence({ id: 'ev-2', similarity_score: 0.8 }),
    ];
    const adapter = makeMockAdapter(JSON.stringify([
      { index: 1, relation: 'support' },
      { index: 2, relation: 'contradict' },
    ]));

    const result = await buildEvidenceQbaf('test claim', items, adapter, 'model');
    expect(result.qbaf_iterations).toBeGreaterThan(0);
  });
});
