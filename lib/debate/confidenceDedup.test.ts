// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import {
  evaluateDedup,
  buildHistoryEntry,
  addToIndex,
  rebuildIndex,
  hashTopicEmbedding,
  TOPIC_DEDUP_THRESHOLD,
  ATTACK_DEDUP_THRESHOLD,
} from './confidenceDedup.js';
import type { ConfidenceIndexEntry, ConfidenceUpdateIndex, DedupDecision } from './confidenceDedup.js';

// ── Helpers ─────────────────────────────────────────────

/** Create a unit vector in a specific dimension. */
function makeEmbedding(dim: number, size = 384): number[] {
  const v = new Array(size).fill(0);
  v[dim % size] = 1;
  return v;
}

/** Create a vector with controlled similarity to a reference. */
function makeSimilarEmbedding(base: number[], similarity: number, size = 384): number[] {
  const ortho = new Array(size).fill(0);
  ortho[size - 1] = 1;
  const v = new Array(size).fill(0);
  for (let i = 0; i < size; i++) {
    v[i] = similarity * base[i] + Math.sqrt(Math.max(0, 1 - similarity * similarity)) * ortho[i];
  }
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return v.map(x => x / norm);
}

function makeEntry(overrides: Partial<ConfidenceIndexEntry> = {}): ConfidenceIndexEntry {
  return {
    debate_id: 'deb-001',
    topic_embedding_hash: '0.50,0.00,0.00,0.00,0.00,0.00,0.00,0.00',
    attack_claim_embedding: makeEmbedding(0),
    delta: -0.08,
    date: '2026-05-24',
    model: 'gemini-2.0-flash',
    embedding_model: 'all-MiniLM-L6-v2',
    attack_claim: 'Scaling laws show diminishing returns',
    ...overrides,
  };
}

// ── hashTopicEmbedding ──────────────────────────────────

describe('hashTopicEmbedding', () => {
  it('produces deterministic hash from first 8 dims', () => {
    const emb = makeEmbedding(0);
    const hash = hashTopicEmbedding(emb);
    expect(hash).toBe('1.00,0.00,0.00,0.00,0.00,0.00,0.00,0.00');
  });

  it('produces different hashes for different embeddings', () => {
    expect(hashTopicEmbedding(makeEmbedding(0))).not.toBe(hashTopicEmbedding(makeEmbedding(3)));
  });
});

// ── evaluateDedup ───────────────────────────────────────

describe('evaluateDedup', () => {
  it('applies when no prior entries exist', () => {
    const entry = makeEntry();
    const decision = evaluateDedup('b-001', entry, makeEmbedding(0), []);
    expect(decision.action.action).toBe('apply');
    expect(decision.beliefId).toBe('b-001');
  });

  it('applies when prior entries use different embedding model', () => {
    const prior = makeEntry({ embedding_model: 'other-model-v1' });
    const entry = makeEntry({ debate_id: 'deb-002' });
    const decision = evaluateDedup('b-001', entry, makeEmbedding(0), [prior]);
    expect(decision.action.action).toBe('apply');
  });

  it('detects attack-vector duplicate (same model) — supersedes when stronger', () => {
    const base = makeEmbedding(0);
    const prior = makeEntry({ delta: -0.05, attack_claim_embedding: base });
    const entry = makeEntry({ debate_id: 'deb-002', delta: -0.10, attack_claim_embedding: base });

    const decision = evaluateDedup('b-001', entry, makeEmbedding(5), [prior]);
    expect(decision.action.action).toBe('supersede');
    if (decision.action.action === 'supersede') {
      expect(decision.action.supersededDebateId).toBe('deb-001');
    }
    expect(decision.similarityAttack).toBeCloseTo(1.0);
  });

  it('detects attack-vector duplicate (same model) — discards when weaker', () => {
    const base = makeEmbedding(0);
    const prior = makeEntry({ delta: -0.10, attack_claim_embedding: base });
    const entry = makeEntry({ debate_id: 'deb-002', delta: -0.05, attack_claim_embedding: base });

    const decision = evaluateDedup('b-001', entry, makeEmbedding(5), [prior]);
    expect(decision.action.action).toBe('discard');
  });

  it('detects cross-model robustness (same attack, different model)', () => {
    const base = makeEmbedding(0);
    const prior = makeEntry({ model: 'gemini-2.0-flash', attack_claim_embedding: base });
    const entry = makeEntry({
      debate_id: 'deb-002',
      model: 'claude-sonnet-4-20250514',
      attack_claim_embedding: base,
    });

    const decision = evaluateDedup('b-001', entry, makeEmbedding(5), [prior]);
    expect(decision.action.action).toBe('robustness');
    if (decision.action.action === 'robustness') {
      expect(decision.action.robustness).toBe(2);
      expect(decision.action.modelConfirmations).toContain('gemini-2.0-flash');
      expect(decision.action.modelConfirmations).toContain('claude-sonnet-4-20250514');
    }
  });

  it('counts robustness across 3+ models', () => {
    const base = makeEmbedding(0);
    const priors = [
      makeEntry({ debate_id: 'deb-001', model: 'gemini-2.0-flash', attack_claim_embedding: base }),
      makeEntry({ debate_id: 'deb-002', model: 'claude-sonnet-4-20250514', attack_claim_embedding: base }),
    ];
    const entry = makeEntry({
      debate_id: 'deb-003',
      model: 'llama-3.3-70b',
      attack_claim_embedding: base,
    });

    const decision = evaluateDedup('b-001', entry, makeEmbedding(5), priors);
    expect(decision.action.action).toBe('robustness');
    if (decision.action.action === 'robustness') {
      expect(decision.action.robustness).toBe(3);
      expect(decision.action.modelConfirmations).toHaveLength(3);
    }
  });

  it('detects topic-based duplicate — supersedes when stronger', () => {
    const topicEmb = makeEmbedding(0);
    // Prior attack embedding similar to topic (simulates same-topic debate)
    const priorAttack = makeSimilarEmbedding(topicEmb, 0.85);
    // New attack is novel (different dimension) but topic overlaps
    const newAttack = makeEmbedding(10);

    const prior = makeEntry({ attack_claim_embedding: priorAttack, delta: -0.05 });
    const entry = makeEntry({
      debate_id: 'deb-002',
      attack_claim_embedding: newAttack,
      delta: -0.12,
    });

    const decision = evaluateDedup('b-001', entry, topicEmb, [prior]);
    // Topic sim between topicEmb and priorAttack ≈ 0.85 (> 0.80 threshold)
    // Attack sim between newAttack and priorAttack should be low (novel attack)
    expect(decision.action.action).toBe('supersede');
    expect(decision.similarityTopic).toBeGreaterThanOrEqual(TOPIC_DEDUP_THRESHOLD);
  });

  it('detects topic-based duplicate — discards when weaker', () => {
    const topicEmb = makeEmbedding(0);
    const priorAttack = makeSimilarEmbedding(topicEmb, 0.85);
    const newAttack = makeEmbedding(10);

    const prior = makeEntry({ attack_claim_embedding: priorAttack, delta: -0.12 });
    const entry = makeEntry({
      debate_id: 'deb-002',
      attack_claim_embedding: newAttack,
      delta: -0.05,
    });

    const decision = evaluateDedup('b-001', entry, topicEmb, [prior]);
    expect(decision.action.action).toBe('discard');
  });

  it('applies novel attack on novel topic', () => {
    const prior = makeEntry({ attack_claim_embedding: makeEmbedding(0) });
    const entry = makeEntry({
      debate_id: 'deb-002',
      attack_claim_embedding: makeEmbedding(50), // orthogonal
    });

    const decision = evaluateDedup('b-001', entry, makeEmbedding(100), [prior]);
    expect(decision.action.action).toBe('apply');
  });

  it('handles entries with empty embeddings gracefully', () => {
    const prior = makeEntry({ attack_claim_embedding: [] });
    const entry = makeEntry({ debate_id: 'deb-002' });

    const decision = evaluateDedup('b-001', entry, makeEmbedding(0), [prior]);
    // Can't compute similarity → no match → apply
    expect(decision.action.action).toBe('apply');
  });

  it('handles new entry with empty attack embedding', () => {
    const prior = makeEntry();
    const entry = makeEntry({ debate_id: 'deb-002', attack_claim_embedding: [] });

    const decision = evaluateDedup('b-001', entry, makeEmbedding(0), [prior]);
    expect(decision.action.action).toBe('apply');
  });
});

// ── buildHistoryEntry ───────────────────────────────────

describe('buildHistoryEntry', () => {
  it('builds entry for apply action', () => {
    const decision: DedupDecision = {
      beliefId: 'b-001',
      debateId: 'deb-001',
      action: { action: 'apply', reason: 'First update' },
    };
    const entry = buildHistoryEntry(decision, 0.72, -0.08, 'Scaling laws plateau', '2026-05-24');

    expect(entry.date).toBe('2026-05-24');
    expect(entry.value).toBe(0.72);
    expect(entry.delta).toBe(-0.08);
    expect(entry.attack_claim).toBe('Scaling laws plateau');
    expect(entry.supersedes).toBeUndefined();
    expect(entry.robustness).toBeUndefined();
  });

  it('builds entry for supersede action', () => {
    const decision: DedupDecision = {
      beliefId: 'b-001',
      debateId: 'deb-002',
      action: { action: 'supersede', supersededDebateId: 'deb-001', reason: 'Stronger attack' },
    };
    const entry = buildHistoryEntry(decision, 0.65, -0.15, 'Stronger argument', '2026-05-25');

    expect(entry.supersedes).toBe('deb-001');
    expect(entry.robustness).toBeUndefined();
  });

  it('builds entry for robustness action', () => {
    const decision: DedupDecision = {
      beliefId: 'b-001',
      debateId: 'deb-003',
      action: {
        action: 'robustness',
        supersededDebateId: 'deb-001',
        robustness: 3,
        modelConfirmations: ['gemini-2.0-flash', 'claude-sonnet-4-20250514', 'llama-3.3-70b'],
        reason: 'Confirmed by 3 models',
      },
    };
    const entry = buildHistoryEntry(decision, 0.42, -0.08, 'Recursive improvement fails', '2026-05-25');

    expect(entry.supersedes).toBe('deb-001');
    expect(entry.robustness).toBe(3);
    expect(entry.model_confirmations).toEqual(['gemini-2.0-flash', 'claude-sonnet-4-20250514', 'llama-3.3-70b']);
  });

  it('omits attack_claim when empty string', () => {
    const decision: DedupDecision = {
      beliefId: 'b-001',
      debateId: 'deb-001',
      action: { action: 'apply', reason: 'Manual' },
    };
    const entry = buildHistoryEntry(decision, 0.80, 0, '', '2026-05-24');
    expect(entry.attack_claim).toBeUndefined();
  });
});

// ── addToIndex ──────────────────────────────────────────

describe('addToIndex', () => {
  it('adds first entry for a belief', () => {
    const index: ConfidenceUpdateIndex = {};
    const entry = makeEntry();
    addToIndex(index, 'b-001', entry);

    expect(index['b-001']).toHaveLength(1);
    expect(index['b-001'][0].debate_id).toBe('deb-001');
  });

  it('appends to existing entries', () => {
    const index: ConfidenceUpdateIndex = { 'b-001': [makeEntry()] };
    addToIndex(index, 'b-001', makeEntry({ debate_id: 'deb-002' }));

    expect(index['b-001']).toHaveLength(2);
  });

  it('removes superseded entry when superseding', () => {
    const index: ConfidenceUpdateIndex = {
      'b-001': [
        makeEntry({ debate_id: 'deb-001' }),
        makeEntry({ debate_id: 'deb-003' }),
      ],
    };
    addToIndex(index, 'b-001', makeEntry({ debate_id: 'deb-002' }), 'deb-001');

    expect(index['b-001']).toHaveLength(2);
    expect(index['b-001'].map(e => e.debate_id)).toEqual(['deb-003', 'deb-002']);
  });
});

// ── rebuildIndex ────────────────────────────────────────

describe('rebuildIndex', () => {
  it('rebuilds from history entries with attack_claim', () => {
    const histories = {
      'b-001': [
        { date: '2026-05-20', value: 0.72, delta: -0.08, reason: 'test', attack_claim: 'Claim A' },
        { date: '2026-05-22', value: 0.65, delta: -0.07, reason: 'test', attack_claim: 'Claim B' },
      ],
      'b-002': [
        { date: '2026-05-20', value: 0.50, delta: -0.10, reason: 'test' },
        // No attack_claim → skipped
      ],
    };
    const embedFn = (text: string) => {
      const v = new Array(384).fill(0);
      v[0] = text.length / 100;
      return v;
    };

    const index = rebuildIndex(histories, 'all-MiniLM-L6-v2', embedFn);

    expect(Object.keys(index)).toEqual(['b-001']);
    expect(index['b-001']).toHaveLength(2);
    expect(index['b-001'][0].embedding_model).toBe('all-MiniLM-L6-v2');
    expect(index['b-001'][0].attack_claim).toBe('Claim A');
  });

  it('returns empty index when no attack_claim entries', () => {
    const histories = {
      'b-001': [{ date: '2026-05-20', value: 0.72, delta: -0.08, reason: 'test' }],
    };
    const index = rebuildIndex(histories, 'all-MiniLM-L6-v2', () => new Array(384).fill(0));
    expect(Object.keys(index)).toHaveLength(0);
  });

  it('preserves supersedes as debate_id fallback', () => {
    const histories = {
      'b-001': [
        { date: '2026-05-20', value: 0.72, delta: -0.08, reason: 'test', attack_claim: 'X', supersedes: 'deb-orig' },
      ],
    };
    const index = rebuildIndex(histories, 'all-MiniLM-L6-v2', () => new Array(384).fill(0));
    expect(index['b-001'][0].debate_id).toBe('deb-orig');
  });
});

// ── weight_type discriminator ───────────────────────────

describe('weight_type discriminator', () => {
  it('ignores operationality entries when evaluating confidence dedup', () => {
    const base = makeEmbedding(0);
    const prior = makeEntry({ attack_claim_embedding: base, weight_type: 'operationality' });
    const entry = makeEntry({ debate_id: 'deb-002', attack_claim_embedding: base }); // default: confidence

    const decision = evaluateDedup('b-001', entry, makeEmbedding(5), [prior]);
    // Prior is operationality, new is confidence → no match → apply
    expect(decision.action.action).toBe('apply');
  });

  it('ignores confidence entries when evaluating operationality dedup', () => {
    const base = makeEmbedding(0);
    const prior = makeEntry({ attack_claim_embedding: base }); // default: confidence
    const entry = makeEntry({ debate_id: 'deb-002', attack_claim_embedding: base, weight_type: 'operationality' });

    const decision = evaluateDedup('i-001', entry, makeEmbedding(5), [prior]);
    expect(decision.action.action).toBe('apply');
  });

  it('deduplicates within the same weight_type', () => {
    const base = makeEmbedding(0);
    const prior = makeEntry({ attack_claim_embedding: base, weight_type: 'operationality', delta: -1 });
    const entry = makeEntry({
      debate_id: 'deb-002',
      attack_claim_embedding: base,
      weight_type: 'operationality',
      delta: -1,
    });

    const decision = evaluateDedup('i-001', entry, makeEmbedding(5), [prior]);
    // Same attack, same model, same type → discard (equal magnitude)
    expect(decision.action.action).toBe('discard');
  });

  it('treats missing weight_type as confidence (backward compat)', () => {
    const base = makeEmbedding(0);
    const prior = makeEntry({ attack_claim_embedding: base }); // no weight_type
    const entry = makeEntry({ debate_id: 'deb-002', attack_claim_embedding: base }); // no weight_type

    const decision = evaluateDedup('b-001', entry, makeEmbedding(5), [prior]);
    // Both default to confidence → same type → dedup applies
    expect(decision.action.action).toBe('discard'); // equal magnitude
  });
});
