// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import {
  computeStructuralScore,
  critiqueTopicPrompt,
  parseTopicCritique,
} from './topicCritique.js';
import type { StructuralScoreInput } from './topicCritique.js';
import type { SourceEvidenceIndex } from './evidenceFromSummaries.js';
import type { Category } from './taxonomyTypes.js';

// ── Helpers ──────────────────────────────────────────────

/** Create a simple embedding vector — unit vector in the given dimension. */
function unitVec(dim: number, size = 10): number[] {
  const v = new Array(size).fill(0);
  v[dim % size] = 1;
  return v;
}

/** Topic embedding that is similar to dim-0 vectors. */
const TOPIC_VEC = unitVec(0);

function makeNode(id: string, pov: string, category: Category): { id: string; pov: string; category: Category } {
  return { id, pov, category };
}

function makeEmbedding(id: string, pov: string, vec: number[]): [string, { pov: string; vector: number[] }] {
  return [id, { pov, vector: vec }];
}

// ── computeStructuralScore — basic ──────────────────────

describe('computeStructuralScore — basic', () => {
  it('returns zeroed score when no embeddings provided', () => {
    const result = computeStructuralScore({
      topicEmbedding: TOPIC_VEC,
      povNodes: [makeNode('acc-beliefs-001', 'accelerationist', 'Beliefs')],
      situationNodes: [],
      embeddings: {},
    });
    expect(result.total).toBe(0);
    expect(result.activated_nodes).toHaveLength(0);
  });

  it('returns zeroed score when topic embedding is empty', () => {
    const result = computeStructuralScore({
      topicEmbedding: [],
      povNodes: [makeNode('acc-beliefs-001', 'accelerationist', 'Beliefs')],
      situationNodes: [],
      embeddings: Object.fromEntries([makeEmbedding('acc-beliefs-001', 'accelerationist', unitVec(0))]),
    });
    expect(result.total).toBe(0);
    expect(result.activated_nodes).toHaveLength(0);
  });

  it('activates nodes above threshold', () => {
    const embeddings = Object.fromEntries([
      makeEmbedding('acc-beliefs-001', 'accelerationist', unitVec(0)), // sim = 1.0 (identical)
      makeEmbedding('saf-beliefs-001', 'safetyist', unitVec(5)),       // sim = 0.0 (orthogonal)
    ]);
    const result = computeStructuralScore({
      topicEmbedding: TOPIC_VEC,
      povNodes: [
        makeNode('acc-beliefs-001', 'accelerationist', 'Beliefs'),
        makeNode('saf-beliefs-001', 'safetyist', 'Beliefs'),
      ],
      situationNodes: [],
      embeddings,
    });
    expect(result.activated_nodes).toHaveLength(1);
    expect(result.activated_nodes[0].id).toBe('acc-beliefs-001');
    expect(result.activated_nodes[0].similarity).toBeCloseTo(1.0);
  });

  it('sorts activated nodes by similarity descending', () => {
    // Create two vectors with different similarities to TOPIC_VEC
    const vec80 = [...TOPIC_VEC];
    vec80[1] = 0.6; // slightly off — lower similarity
    const embeddings = Object.fromEntries([
      makeEmbedding('acc-beliefs-001', 'accelerationist', TOPIC_VEC),  // sim = 1.0
      makeEmbedding('acc-beliefs-002', 'accelerationist', vec80),       // sim < 1.0
    ]);
    const result = computeStructuralScore({
      topicEmbedding: TOPIC_VEC,
      povNodes: [
        makeNode('acc-beliefs-001', 'accelerationist', 'Beliefs'),
        makeNode('acc-beliefs-002', 'accelerationist', 'Beliefs'),
      ],
      situationNodes: [],
      embeddings,
    });
    expect(result.activated_nodes.length).toBeGreaterThanOrEqual(1);
    if (result.activated_nodes.length >= 2) {
      expect(result.activated_nodes[0].similarity).toBeGreaterThanOrEqual(result.activated_nodes[1].similarity);
    }
  });
});

// ── Crux density scoring ────────────────────────────────

describe('computeStructuralScore — crux density', () => {
  it('scores 0 when one POV dominates (>60%)', () => {
    const nodes = [
      makeNode('acc-beliefs-001', 'accelerationist', 'Beliefs'),
      makeNode('acc-beliefs-002', 'accelerationist', 'Beliefs'),
      makeNode('acc-beliefs-003', 'accelerationist', 'Beliefs'),
      makeNode('saf-beliefs-001', 'safetyist', 'Beliefs'),
    ];
    // All activated with high similarity
    const embeddings = Object.fromEntries(
      nodes.map(n => makeEmbedding(n.id, n.pov, TOPIC_VEC)),
    );
    const result = computeStructuralScore({
      topicEmbedding: TOPIC_VEC,
      povNodes: nodes,
      situationNodes: [],
      embeddings,
    });
    expect(result.crux_density).toBe(0); // acc has 75%
  });

  it('scores 2 when all three POVs balanced', () => {
    const nodes = [
      makeNode('acc-beliefs-001', 'accelerationist', 'Beliefs'),
      makeNode('acc-beliefs-002', 'accelerationist', 'Beliefs'),
      makeNode('saf-beliefs-001', 'safetyist', 'Beliefs'),
      makeNode('saf-beliefs-002', 'safetyist', 'Beliefs'),
      makeNode('skp-beliefs-001', 'skeptic', 'Beliefs'),
      makeNode('skp-beliefs-002', 'skeptic', 'Beliefs'),
    ];
    const embeddings = Object.fromEntries(
      nodes.map(n => makeEmbedding(n.id, n.pov, TOPIC_VEC)),
    );
    const result = computeStructuralScore({
      topicEmbedding: TOPIC_VEC,
      povNodes: nodes,
      situationNodes: [],
      embeddings,
    });
    expect(result.crux_density).toBe(2); // each ~33%
  });

  it('scores 1 when two POVs well-represented', () => {
    const nodes = [
      makeNode('acc-beliefs-001', 'accelerationist', 'Beliefs'),
      makeNode('acc-beliefs-002', 'accelerationist', 'Beliefs'),
      makeNode('saf-beliefs-001', 'safetyist', 'Beliefs'),
      makeNode('saf-beliefs-002', 'safetyist', 'Beliefs'),
    ];
    const embeddings = Object.fromEntries(
      nodes.map(n => makeEmbedding(n.id, n.pov, TOPIC_VEC)),
    );
    const result = computeStructuralScore({
      topicEmbedding: TOPIC_VEC,
      povNodes: nodes,
      situationNodes: [],
      embeddings,
    });
    expect(result.crux_density).toBe(1); // 2 POVs, 50% each
  });
});

// ── BDI heterogeneity scoring ───────────────────────────

describe('computeStructuralScore — BDI heterogeneity', () => {
  it('scores 2 when all three BDI layers represented', () => {
    const nodes = [
      makeNode('acc-beliefs-001', 'accelerationist', 'Beliefs'),
      makeNode('acc-desires-001', 'accelerationist', 'Desires'),
      makeNode('acc-intentions-001', 'accelerationist', 'Intentions'),
    ];
    const embeddings = Object.fromEntries(
      nodes.map(n => makeEmbedding(n.id, n.pov, TOPIC_VEC)),
    );
    const result = computeStructuralScore({
      topicEmbedding: TOPIC_VEC,
      povNodes: nodes,
      situationNodes: [],
      embeddings,
    });
    expect(result.bdi_heterogeneity).toBe(2);
  });

  it('scores 0 when one BDI layer dominates', () => {
    const nodes = [
      makeNode('acc-beliefs-001', 'accelerationist', 'Beliefs'),
      makeNode('acc-beliefs-002', 'accelerationist', 'Beliefs'),
      makeNode('acc-beliefs-003', 'accelerationist', 'Beliefs'),
      makeNode('acc-beliefs-004', 'accelerationist', 'Beliefs'),
    ];
    const embeddings = Object.fromEntries(
      nodes.map(n => makeEmbedding(n.id, n.pov, TOPIC_VEC)),
    );
    const result = computeStructuralScore({
      topicEmbedding: TOPIC_VEC,
      povNodes: nodes,
      situationNodes: [],
      embeddings,
    });
    expect(result.bdi_heterogeneity).toBe(0);
  });
});

// ── Evidence coverage scoring ───────────────────────────

describe('computeStructuralScore — evidence coverage', () => {
  it('scores 0 when no evidence index provided', () => {
    const nodes = [makeNode('acc-beliefs-001', 'accelerationist', 'Beliefs')];
    const embeddings = Object.fromEntries(
      nodes.map(n => makeEmbedding(n.id, n.pov, TOPIC_VEC)),
    );
    const result = computeStructuralScore({
      topicEmbedding: TOPIC_VEC,
      povNodes: nodes,
      situationNodes: [],
      embeddings,
    });
    expect(result.evidence_coverage).toBe(0);
  });

  it('scores 2 when >60% nodes have multi-source evidence', () => {
    const nodes = [
      makeNode('acc-beliefs-001', 'accelerationist', 'Beliefs'),
      makeNode('saf-beliefs-001', 'safetyist', 'Beliefs'),
    ];
    const embeddings = Object.fromEntries(
      nodes.map(n => makeEmbedding(n.id, n.pov, TOPIC_VEC)),
    );
    const evidenceIndex: SourceEvidenceIndex = {
      'acc-beliefs-001': {
        facts: [
          { claim: 'Fact A', label: 'empirical', doc_id: 'doc-1', specificity: 'precise' },
          { claim: 'Fact B', label: 'empirical', doc_id: 'doc-2', specificity: 'precise' },
        ],
        keyPoints: [],
      },
      'saf-beliefs-001': {
        facts: [{ claim: 'Fact C', label: 'empirical', doc_id: 'doc-3', specificity: 'precise' }],
        keyPoints: [{ point: 'Point', doc_id: 'doc-4' }],
      },
    };
    const result = computeStructuralScore({
      topicEmbedding: TOPIC_VEC,
      povNodes: nodes,
      situationNodes: [],
      embeddings,
      evidenceIndex,
    });
    expect(result.evidence_coverage).toBe(2);
  });

  it('scores 1 when 30-60% nodes have evidence', () => {
    const nodes = [
      makeNode('acc-beliefs-001', 'accelerationist', 'Beliefs'),
      makeNode('saf-beliefs-001', 'safetyist', 'Beliefs'),
      makeNode('skp-beliefs-001', 'skeptic', 'Beliefs'),
    ];
    const embeddings = Object.fromEntries(
      nodes.map(n => makeEmbedding(n.id, n.pov, TOPIC_VEC)),
    );
    const evidenceIndex: SourceEvidenceIndex = {
      'acc-beliefs-001': {
        facts: [{ claim: 'Fact', label: 'empirical', doc_id: 'doc-1', specificity: 'precise' }],
        keyPoints: [],
      },
    };
    const result = computeStructuralScore({
      topicEmbedding: TOPIC_VEC,
      povNodes: nodes,
      situationNodes: [],
      embeddings,
      evidenceIndex,
    });
    expect(result.evidence_coverage).toBe(1); // 1/3 = 33%
  });
});

// ── Situation activation scoring ────────────────────────

describe('computeStructuralScore — situation activation', () => {
  it('scores 0 with no situation nodes', () => {
    const nodes = [makeNode('acc-beliefs-001', 'accelerationist', 'Beliefs')];
    const embeddings = Object.fromEntries(
      nodes.map(n => makeEmbedding(n.id, n.pov, TOPIC_VEC)),
    );
    const result = computeStructuralScore({
      topicEmbedding: TOPIC_VEC,
      povNodes: nodes,
      situationNodes: [],
      embeddings,
    });
    expect(result.situation_activation).toBe(0);
  });

  it('scores 2 with 2+ activated situation nodes', () => {
    const nodes = [makeNode('acc-beliefs-001', 'accelerationist', 'Beliefs')];
    const embeddings = Object.fromEntries([
      makeEmbedding('acc-beliefs-001', 'accelerationist', TOPIC_VEC),
      makeEmbedding('sit-001', 'situations', TOPIC_VEC),
      makeEmbedding('sit-002', 'situations', TOPIC_VEC),
    ]);
    const result = computeStructuralScore({
      topicEmbedding: TOPIC_VEC,
      povNodes: nodes,
      situationNodes: [{ id: 'sit-001' }, { id: 'sit-002' }],
      embeddings,
    });
    expect(result.situation_activation).toBe(2);
  });

  it('scores 1 with exactly 1 activated situation node', () => {
    const nodes = [makeNode('acc-beliefs-001', 'accelerationist', 'Beliefs')];
    const embeddings = Object.fromEntries([
      makeEmbedding('acc-beliefs-001', 'accelerationist', TOPIC_VEC),
      makeEmbedding('sit-001', 'situations', TOPIC_VEC),
    ]);
    const result = computeStructuralScore({
      topicEmbedding: TOPIC_VEC,
      povNodes: nodes,
      situationNodes: [{ id: 'sit-001' }],
      embeddings,
    });
    expect(result.situation_activation).toBe(1);
  });
});

// ── critiqueTopicPrompt ─────────────────────────────────

describe('critiqueTopicPrompt', () => {
  it('includes the topic in the prompt', () => {
    const prompt = critiqueTopicPrompt('Should we regulate AI?');
    expect(prompt).toContain('Should we regulate AI?');
  });

  it('mentions all five frame dimensions', () => {
    const prompt = critiqueTopicPrompt('test topic');
    expect(prompt).toContain('Conditionality');
    expect(prompt).toContain('Mechanism focus');
    expect(prompt).toContain('Stakeholder breadth');
    expect(prompt).toContain('Tension acknowledgment');
    expect(prompt).toContain('Scope boundedness');
  });

  it('requests rewritten_topic', () => {
    const prompt = critiqueTopicPrompt('test');
    expect(prompt).toContain('rewritten_topic');
    expect(prompt).toContain('MANDATORY');
  });
});

// ── parseTopicCritique ──────────────────────────────────

describe('parseTopicCritique', () => {
  const minStructural = computeStructuralScore({
    topicEmbedding: [],
    povNodes: [],
    situationNodes: [],
    embeddings: {},
  });

  it('parses valid frame response', () => {
    const raw = JSON.stringify({
      frame_scores: { conditionality: 2, mechanism: 1, stakeholder: 2, tension: 1, scope: 0 },
      issues: [{ dimension: 'scope', severity: 'high', description: 'Too open', suggestion: 'Add constraints' }],
      reframe_suggestions: [{ dimension: 'scope', original_weakness: 'No bounds', reframed_fragment: 'Within the EU AI Act...' }],
      rewritten_topic: 'Under what conditions would pre-deployment AI testing improve safety?',
    });
    const result = parseTopicCritique(raw, minStructural);
    expect(result.frame_score!.conditionality).toBe(2);
    expect(result.frame_score!.mechanism).toBe(1);
    expect(result.frame_score!.total).toBe(6);
    expect(result.composite_score).toBe(6); // 0 structural + 6 frame
    expect(result.rating).toBe('weak');
    expect(result.rewritten_topic).toContain('pre-deployment');
    // 1 LLM issue + 5 structural issues from zeroed minStructural
    const llmIssues = result.issues.filter(i => i.dimension === 'scope');
    expect(llmIssues).toHaveLength(1);
    expect(result.reframe_suggestions).toHaveLength(1);
  });

  it('assigns strong rating for score >= 14', () => {
    // Create a structural score of 8
    const goodStructural = { ...minStructural, total: 8 };
    const raw = JSON.stringify({
      frame_scores: { conditionality: 2, mechanism: 1, stakeholder: 1, tension: 1, scope: 1 },
      issues: [],
      reframe_suggestions: [],
      rewritten_topic: 'Better topic',
    });
    const result = parseTopicCritique(raw, goodStructural);
    expect(result.composite_score).toBe(14); // 8 + 6
    expect(result.rating).toBe('strong');
  });

  it('assigns fair rating for score 8-13', () => {
    const midStructural = { ...minStructural, total: 5 };
    const raw = JSON.stringify({
      frame_scores: { conditionality: 1, mechanism: 1, stakeholder: 1, tension: 1, scope: 0 },
      issues: [],
      reframe_suggestions: [],
      rewritten_topic: 'Better topic',
    });
    const result = parseTopicCritique(raw, midStructural);
    expect(result.composite_score).toBe(9); // 5 + 4
    expect(result.rating).toBe('fair');
  });

  it('clamps invalid scores to 0-2 range', () => {
    const raw = JSON.stringify({
      frame_scores: { conditionality: 5, mechanism: -1, stakeholder: 2, tension: 3, scope: 1 },
      issues: [],
      reframe_suggestions: [],
      rewritten_topic: 'Topic',
    });
    const result = parseTopicCritique(raw, minStructural);
    expect(result.frame_score!.conditionality).toBe(2);
    expect(result.frame_score!.mechanism).toBe(0);
    expect(result.frame_score!.tension).toBe(2);
  });

  it('handles missing fields gracefully', () => {
    const raw = JSON.stringify({
      frame_scores: { conditionality: 1 },
    });
    const result = parseTopicCritique(raw, minStructural);
    expect(result.frame_score!.mechanism).toBe(0);
    expect(result.rewritten_topic).toBe('');
    // Structural issues present from zeroed minStructural, but no LLM issues
    const llmIssues = result.issues.filter(i =>
      !['crux_density', 'evidence_coverage', 'bdi_heterogeneity', 'abstraction_level', 'situation_activation'].includes(i.dimension),
    );
    expect(llmIssues).toEqual([]);
    expect(result.reframe_suggestions).toEqual([]);
  });

  it('strips markdown fences from response', () => {
    const raw = '```json\n{"frame_scores":{"conditionality":1,"mechanism":1,"stakeholder":1,"tension":1,"scope":1},"issues":[],"reframe_suggestions":[],"rewritten_topic":"Better"}\n```';
    const result = parseTopicCritique(raw, minStructural);
    expect(result.frame_score!.total).toBe(5);
    expect(result.rewritten_topic).toBe('Better');
  });

  it('includes structural issues in output', () => {
    // All structural dimensions at 0 should produce issues
    const result = parseTopicCritique(
      JSON.stringify({
        frame_scores: { conditionality: 0, mechanism: 0, stakeholder: 0, tension: 0, scope: 0 },
        issues: [],
        reframe_suggestions: [],
        rewritten_topic: 'Better',
      }),
      minStructural,
    );
    // Should have structural issues for crux_density (0 nodes) and situation_activation
    const structIssues = result.issues.filter(i => ['crux_density', 'situation_activation'].includes(i.dimension));
    expect(structIssues.length).toBeGreaterThanOrEqual(2);
  });
});
