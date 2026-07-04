// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import {
  computeStructuralScore,
  critiqueTopicPrompt,
  formatStructuralContext,
  formatLineageContext,
  parseTopicCritique,
  computeLineageDistribution,
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

  it('applies higher threshold to situation nodes than POV nodes (t/244)', () => {
    // Vector with cosine similarity ~0.45 to TOPIC_VEC — above POV threshold (0.35) but below situation threshold (0.50)
    const midVec = [0.45, 0, 0, 0, 0, 0, 0, 0, 0, Math.sqrt(1 - 0.45 * 0.45)];
    const nodes = [makeNode('acc-beliefs-001', 'accelerationist', 'Beliefs')];
    const embeddings = Object.fromEntries([
      makeEmbedding('acc-beliefs-001', 'accelerationist', midVec),
      makeEmbedding('sit-001', 'situations', midVec),
      makeEmbedding('sit-002', 'situations', midVec),
    ]);
    const result = computeStructuralScore({
      topicEmbedding: TOPIC_VEC,
      povNodes: nodes,
      situationNodes: [{ id: 'sit-001' }, { id: 'sit-002' }],
      embeddings,
    });
    // POV node should activate (0.45 > 0.35), situation nodes should NOT (0.45 < 0.50)
    expect(result.activated_nodes.some(n => n.id === 'acc-beliefs-001')).toBe(true);
    expect(result.activated_nodes.some(n => n.id === 'sit-001')).toBe(false);
    expect(result.situation_activation).toBe(0);
  });

  it('caps activated situations at 30', () => {
    const nodes = [makeNode('acc-beliefs-001', 'accelerationist', 'Beliefs')];
    // Create 50 situation nodes all at high similarity
    const sitEntries = Array.from({ length: 50 }, (_, i) => {
      const id = `sit-${String(i + 1).padStart(3, '0')}`;
      return makeEmbedding(id, 'situations', TOPIC_VEC);
    });
    const embeddings = Object.fromEntries([
      makeEmbedding('acc-beliefs-001', 'accelerationist', TOPIC_VEC),
      ...sitEntries,
    ]);
    const sitNodes = Array.from({ length: 50 }, (_, i) => ({ id: `sit-${String(i + 1).padStart(3, '0')}` }));
    const result = computeStructuralScore({
      topicEmbedding: TOPIC_VEC,
      povNodes: nodes,
      situationNodes: sitNodes,
      embeddings,
    });
    const sitActivated = result.activated_nodes.filter(n => n.id.startsWith('sit-'));
    expect(sitActivated.length).toBeLessThanOrEqual(30);
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
    expect(prompt).toContain('Self-check');
  });

  it('includes naturalness constraint', () => {
    const prompt = critiqueTopicPrompt('test topic');
    expect(prompt).toContain('sound like a question a thoughtful person would actually ask');
    expect(prompt).toContain('not a grant proposal abstract');
    expect(prompt).toContain('prioritize natural language over maximizing every dimension score');
  });

  it('caps incorporations to 2-3 highest-severity and includes scope_additions schema', () => {
    const prompt = critiqueTopicPrompt('test topic');
    expect(prompt).toContain('2-3 highest-severity reframe_suggestions');
    expect(prompt).toContain('"scope_additions"');
    expect(prompt).toContain('"dimension"');
    expect(prompt).toContain('"detail"');
    expect(prompt).not.toContain('INCORPORATING every reframe_suggestion');
  });
});

// ── formatStructuralContext ─────────────────────────────

describe('formatStructuralContext', () => {
  it('warns when no nodes activated', () => {
    const score = computeStructuralScore({
      topicEmbedding: [],
      povNodes: [],
      situationNodes: [],
      embeddings: {},
    });
    const ctx = formatStructuralContext(score);
    expect(ctx).toContain('WARNING: No taxonomy nodes activated');
  });

  it('warns when a POV dominates above 60%', () => {
    const ctx = formatStructuralContext({
      crux_density: 1, evidence_coverage: 1, bdi_heterogeneity: 1,
      abstraction_level: 1, situation_activation: 1, total: 5,
      activated_nodes: [
        { id: 'acc-B-001', similarity: 0.8, pov: 'acc', category: 'Beliefs' },
        { id: 'acc-B-002', similarity: 0.7, pov: 'acc', category: 'Beliefs' },
        { id: 'acc-B-003', similarity: 0.7, pov: 'acc', category: 'Beliefs' },
        { id: 'saf-B-001', similarity: 0.6, pov: 'saf', category: 'Beliefs' },
      ],
      pov_distribution: { acc: 3, saf: 1 },
      bdi_distribution: { Beliefs: 4 },
    });
    expect(ctx).toContain('WARNING: acc dominates with 75%');
    expect(ctx).toContain('underrepresented perspectives');
  });

  it('reports missing BDI layers', () => {
    const ctx = formatStructuralContext({
      crux_density: 1, evidence_coverage: 1, bdi_heterogeneity: 1,
      abstraction_level: 1, situation_activation: 0, total: 4,
      activated_nodes: [],
      pov_distribution: { acc: 2, saf: 2 },
      bdi_distribution: { Beliefs: 4, Desires: 0, Intentions: 0 },
    });
    expect(ctx).toContain('Missing BDI layers: Desires, Intentions');
  });

  it('reports no situation nodes', () => {
    const ctx = formatStructuralContext({
      crux_density: 1, evidence_coverage: 1, bdi_heterogeneity: 1,
      abstraction_level: 1, situation_activation: 0, total: 4,
      activated_nodes: [{ id: 'acc-B-001', similarity: 0.8 }],
      pov_distribution: { acc: 1 },
      bdi_distribution: { Beliefs: 1 },
    });
    expect(ctx).toContain('No situation nodes activated');
  });

  it('counts situation nodes when present', () => {
    const ctx = formatStructuralContext({
      crux_density: 1, evidence_coverage: 1, bdi_heterogeneity: 1,
      abstraction_level: 1, situation_activation: 2, total: 6,
      activated_nodes: [
        { id: 'sit-001', similarity: 0.7 },
        { id: 'sit-201', similarity: 0.6 },
      ],
      pov_distribution: {},
      bdi_distribution: {},
    });
    expect(ctx).toContain('Situation nodes activated: 2');
  });

  it('includes structural sub-scores', () => {
    const ctx = formatStructuralContext({
      crux_density: 2, evidence_coverage: 1, bdi_heterogeneity: 2,
      abstraction_level: 1, situation_activation: 0, total: 6,
      activated_nodes: [],
      pov_distribution: {},
      bdi_distribution: {},
    });
    expect(ctx).toContain('crux_density=2/2');
    expect(ctx).toContain('total: 6/10');
  });
});

describe('critiqueTopicPrompt with structuralContext', () => {
  it('includes structural block when context provided', () => {
    const prompt = critiqueTopicPrompt('test topic', 'WARNING: acc dominates');
    expect(prompt).toContain('=== STRUCTURAL ANALYSIS (pre-computed from taxonomy) ===');
    expect(prompt).toContain('WARNING: acc dominates');
    expect(prompt).toContain('address any structural warnings');
  });

  it('omits structural block when context not provided', () => {
    const prompt = critiqueTopicPrompt('test topic');
    expect(prompt).not.toContain('STRUCTURAL ANALYSIS');
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

  it('parses scope_additions when present', () => {
    const raw = JSON.stringify({
      frame_scores: { conditionality: 2, mechanism: 2, stakeholder: 2, tension: 2, scope: 2 },
      issues: [],
      reframe_suggestions: [],
      scope_additions: [
        { dimension: 'mechanism', detail: 'Specific liability frameworks for AI-generated content' },
        { dimension: 'stakeholder', detail: 'Include judiciary as separate institutional actor' },
      ],
      rewritten_topic: 'Great topic',
    });
    const result = parseTopicCritique(raw, minStructural);
    expect(result.scope_additions).toHaveLength(2);
    expect(result.scope_additions![0].dimension).toBe('mechanism');
    expect(result.scope_additions![1].detail).toContain('judiciary');
  });

  it('returns undefined scope_additions when field absent', () => {
    const raw = JSON.stringify({
      frame_scores: { conditionality: 1, mechanism: 1, stakeholder: 1, tension: 1, scope: 1 },
      issues: [],
      reframe_suggestions: [],
      rewritten_topic: 'Topic',
    });
    const result = parseTopicCritique(raw, minStructural);
    expect(result.scope_additions).toBeUndefined();
  });

  it('filters invalid scope_additions entries', () => {
    const raw = JSON.stringify({
      frame_scores: { conditionality: 1, mechanism: 1, stakeholder: 1, tension: 1, scope: 1 },
      issues: [],
      reframe_suggestions: [],
      scope_additions: [
        { dimension: 'mechanism', detail: 'valid entry' },
        { dimension: 123, detail: 'bad dimension type' },
        { dimension: 'scope' },
        'not an object',
      ],
      rewritten_topic: 'Topic',
    });
    const result = parseTopicCritique(raw, minStructural);
    expect(result.scope_additions).toHaveLength(1);
    expect(result.scope_additions![0].detail).toBe('valid entry');
  });
});

// ── computeLineageDistribution ──────────────────────────

describe('computeLineageDistribution', () => {
  const clusterLabels: Record<string, string> = {
    'ai-safety': 'AI Safety & Alignment',
    'labor-econ': 'Labor & Political Economy',
    'tech-society': 'Technology & Society',
    'legal-theory': 'Legal Theory & Applied Ethics',
  };

  const nameToCluster: Record<string, string> = {
    'AI alignment research': 'ai-safety',
    'machine learning fairness': 'ai-safety',
    'RLHF': 'ai-safety',
    'labor economics': 'labor-econ',
    'automation displacement': 'labor-econ',
    'STS frameworks': 'tech-society',
    'tort law': 'legal-theory',
  };

  it('returns empty array when no activated nodes', () => {
    const result = computeLineageDistribution({
      activatedNodeIds: [],
      lineageByNode: {},
      nameToCluster,
      clusterLabels,
    });
    expect(result).toEqual([]);
  });

  it('returns empty array when no lineage data on nodes', () => {
    const result = computeLineageDistribution({
      activatedNodeIds: ['acc-beliefs-001'],
      lineageByNode: {},
      nameToCluster,
      clusterLabels,
    });
    expect(result).toEqual([]);
  });

  it('returns dominant cluster above 15% threshold', () => {
    const result = computeLineageDistribution({
      activatedNodeIds: ['n1', 'n2'],
      lineageByNode: {
        n1: ['AI alignment research', 'RLHF', 'machine learning fairness'],
        n2: ['AI alignment research', 'labor economics'],
      },
      nameToCluster,
      clusterLabels,
    });
    // ai-safety: 4/5 = 80%, labor-econ: 1/5 = 20%
    expect(result).toHaveLength(2);
    expect(result[0].cluster_id).toBe('ai-safety');
    expect(result[0].label).toBe('AI Safety & Alignment');
    expect(result[0].percentage).toBeCloseTo(0.8);
    expect(result[1].cluster_id).toBe('labor-econ');
  });

  it('filters clusters below 15% threshold', () => {
    const result = computeLineageDistribution({
      activatedNodeIds: ['n1', 'n2', 'n3'],
      lineageByNode: {
        n1: ['AI alignment research', 'RLHF', 'machine learning fairness'],
        n2: ['AI alignment research', 'RLHF'],
        n3: ['labor economics', 'AI alignment research', 'RLHF', 'machine learning fairness', 'tort law'],
      },
      nameToCluster,
      clusterLabels,
    });
    // ai-safety: 7/10 = 70%, labor-econ: 1/10 = 10% (below 12%), legal-theory: 1/10 = 10%
    // Only ai-safety should be above threshold
    const belowThreshold = result.filter(r => r.percentage < 0.12);
    expect(belowThreshold).toHaveLength(0);
  });

  it('caps at 3 traditions', () => {
    // Create scenario with 4+ clusters all above threshold
    const bigNameToCluster: Record<string, string> = {
      a1: 'c1', a2: 'c2', a3: 'c3', a4: 'c4',
    };
    const bigLabels: Record<string, string> = {
      c1: 'Cluster 1', c2: 'Cluster 2', c3: 'Cluster 3', c4: 'Cluster 4',
    };
    const result = computeLineageDistribution({
      activatedNodeIds: ['n1'],
      lineageByNode: { n1: ['a1', 'a2', 'a3', 'a4'] },
      nameToCluster: bigNameToCluster,
      clusterLabels: bigLabels,
    });
    // Each at 25% (above threshold), but capped at 3
    expect(result.length).toBeLessThanOrEqual(3);
  });

  it('skips uncategorized lineage names', () => {
    const result = computeLineageDistribution({
      activatedNodeIds: ['n1'],
      lineageByNode: { n1: ['AI alignment research', 'unknown tradition'] },
      nameToCluster: { 'AI alignment research': 'ai-safety', 'unknown tradition': 'uncategorized' },
      clusterLabels,
    });
    // Only ai-safety should be counted (uncategorized skipped)
    expect(result).toHaveLength(1);
    expect(result[0].cluster_id).toBe('ai-safety');
    expect(result[0].percentage).toBe(1);
  });

  it('sorts by percentage descending', () => {
    const result = computeLineageDistribution({
      activatedNodeIds: ['n1', 'n2'],
      lineageByNode: {
        n1: ['labor economics', 'automation displacement', 'STS frameworks'],
        n2: ['labor economics', 'STS frameworks'],
      },
      nameToCluster,
      clusterLabels,
    });
    // labor-econ: 3/5 = 60%, tech-society: 2/5 = 40%
    expect(result[0].percentage).toBeGreaterThan(result[1].percentage);
  });
});

// ── formatLineageContext ────────────────────────────────

describe('formatLineageContext', () => {
  it('returns empty string for empty frame', () => {
    expect(formatLineageContext([])).toBe('');
  });

  it('formats traditions with percentages', () => {
    const result = formatLineageContext([
      { cluster_id: 'ai-safety', label: 'AI Safety & Alignment', percentage: 0.45 },
      { cluster_id: 'labor-econ', label: 'Labor & Political Economy', percentage: 0.22 },
    ]);
    expect(result).toContain('Dominant intellectual traditions:');
    expect(result).toContain('AI Safety & Alignment (45%)');
    expect(result).toContain('Labor & Political Economy (22%)');
  });
});
