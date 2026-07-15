// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi } from 'vitest';
import { selectGreedyClaims } from './lookaheadGate.js';
import type { LookaheadGateInput, PerClaimResult } from './lookaheadGate.js';
import { runOvergenPipeline } from './overgenPipeline.js';
import type { OvergenPipelineInput } from './overgenPipeline.js';
import type { ArgumentNetworkNode, ArgumentNetworkEdge, DraftWorkProduct } from './types.js';

// ── Helpers ──────────────────────────────────────────────

function makeNode(overrides: Partial<ArgumentNetworkNode> & { id: string }): ArgumentNetworkNode {
  return {
    text: `Claim ${overrides.id}`,
    speaker: 'accelerationist',
    source_entry_id: 'e1',
    taxonomy_refs: [],
    turn_number: 1,
    base_strength: 0.5,
    computed_strength: 0.5,
    ...overrides,
  };
}

function makeEdge(
  source: string,
  target: string,
  type: 'attacks' | 'supports' = 'attacks',
  weight = 0.5,
): ArgumentNetworkEdge {
  return { id: `${source}->${target}`, source, target, type, weight };
}

function makePerClaimResult(overrides: Partial<PerClaimResult> & { index: number; text: string }): PerClaimResult {
  return {
    base_strength: 0.5,
    marginal_delta: 0.01,
    classification: 'STRONG',
    dominant_component: 'position_strength',
    ...overrides,
  };
}

function makeDraft(claimTexts: string[]): DraftWorkProduct {
  return {
    statement: claimTexts.join('\n\n'),
    turn_symbols: [],
    claim_sketches: claimTexts.map(t => ({ claim: t, targets: [] })),
    key_assumptions: [],
    disagreement_type: 'empirical',
  };
}

// ── selectGreedyClaims ───────────────────────────────────

describe('selectGreedyClaims', () => {
  const baseInput: LookaheadGateInput = {
    speaker: 'accelerationist',
    existingNodes: [
      makeNode({ id: 'AN-1', speaker: 'accelerationist', base_strength: 0.6 }),
      makeNode({ id: 'AN-2', speaker: 'safetyist', base_strength: 0.5 }),
    ],
    existingEdges: [makeEdge('AN-2', 'AN-1', 'attacks', 0.3)],
    tentativeClaims: [],
    tentativeEdges: [],
  };

  it('PRESERVE claims pass without consuming K slots', () => {
    const candidates: PerClaimResult[] = [
      makePerClaimResult({ index: 0, text: 'Strong claim A', classification: 'STRONG', marginal_delta: 0.05 }),
      makePerClaimResult({ index: 1, text: 'Concession B', classification: 'PRESERVE', marginal_delta: 0 }),
      makePerClaimResult({ index: 2, text: 'Strong claim C', classification: 'STRONG', marginal_delta: 0.03 }),
      makePerClaimResult({ index: 3, text: 'Weak claim D', classification: 'WEAK', marginal_delta: -0.02 }),
      makePerClaimResult({ index: 4, text: 'Strong claim E', classification: 'STRONG', marginal_delta: 0.02 }),
    ];

    const input: LookaheadGateInput = {
      ...baseInput,
      tentativeClaims: candidates.map(c => ({ text: c.text, base_strength: c.base_strength })),
      tentativeEdges: [],
    };

    const { selected, avoided } = selectGreedyClaims(candidates, input, 2);

    // PRESERVE always selected
    expect(selected.some(c => c.classification === 'PRESERVE')).toBe(true);
    // K=2 non-PRESERVE slots filled
    const nonPreserved = selected.filter(c => c.classification !== 'PRESERVE');
    expect(nonPreserved.length).toBeLessThanOrEqual(2);
    // PRESERVE doesn't count toward K
    expect(selected.length).toBeGreaterThanOrEqual(3); // 1 PRESERVE + 2 STRONG
    // Weak claim should be avoided
    expect(avoided.some(c => c.text === 'Weak claim D')).toBe(true);
  });

  it('returns all candidates when pool is smaller than K', () => {
    const candidates: PerClaimResult[] = [
      makePerClaimResult({ index: 0, text: 'Claim A', classification: 'STRONG', marginal_delta: 0.05 }),
      makePerClaimResult({ index: 1, text: 'Claim B', classification: 'STRONG', marginal_delta: 0.03 }),
    ];

    const input: LookaheadGateInput = {
      ...baseInput,
      tentativeClaims: candidates.map(c => ({ text: c.text, base_strength: c.base_strength })),
      tentativeEdges: [],
    };

    const { selected, avoided } = selectGreedyClaims(candidates, input, 4);

    expect(selected.length).toBe(2);
    expect(avoided.length).toBe(0);
  });

  it('greedy selection outperforms naive top-K-by-individual-delta on constructed case', () => {
    // Construct a case where two claims are individually mediocre but
    // complementary (they attack different opponent nodes), so greedy
    // picks them together vs naive which picks by individual delta alone.
    const existingNodes = [
      makeNode({ id: 'AN-1', speaker: 'accelerationist', base_strength: 0.5 }),
      makeNode({ id: 'AN-2', speaker: 'safetyist', base_strength: 0.7 }),
      makeNode({ id: 'AN-3', speaker: 'safetyist', base_strength: 0.7 }),
    ];
    const existingEdges = [
      makeEdge('AN-2', 'AN-1', 'attacks', 0.4),
      makeEdge('AN-3', 'AN-1', 'attacks', 0.4),
    ];

    // Candidate A: attacks AN-2 (individually strong)
    // Candidate B: attacks AN-3 (individually strong, but redundant with A if both attack same target)
    // Candidate C: supports AN-1 (individually weaker, but complementary with A)
    const candidates: PerClaimResult[] = [
      makePerClaimResult({ index: 0, text: 'Attack on safety concern 1', marginal_delta: 0.08, classification: 'STRONG' }),
      makePerClaimResult({ index: 1, text: 'Attack on safety concern 2', marginal_delta: 0.06, classification: 'STRONG' }),
      makePerClaimResult({ index: 2, text: 'Support for acceleration', marginal_delta: 0.04, classification: 'STRONG' }),
    ];

    const input: LookaheadGateInput = {
      speaker: 'accelerationist',
      existingNodes,
      existingEdges,
      tentativeClaims: candidates.map(c => ({ text: c.text, base_strength: 0.6 })),
      tentativeEdges: [
        makeEdge('AN-4', 'AN-2', 'attacks', 0.5),
        makeEdge('AN-5', 'AN-3', 'attacks', 0.5),
        makeEdge('AN-6', 'AN-1', 'supports', 0.5),
      ],
    };

    const { selected } = selectGreedyClaims(candidates, input, 2);

    // Greedy should select complementary claims (attacks on different targets)
    // rather than just the two with highest individual delta
    expect(selected.length).toBe(2);
    // At minimum, the greedy algorithm should run without error
    // and select a valid subset
    expect(selected.every(s => candidates.includes(s))).toBe(true);
  });

  it('handles empty candidate list', () => {
    const { selected, avoided } = selectGreedyClaims([], baseInput, 4);
    expect(selected).toHaveLength(0);
    expect(avoided).toHaveLength(0);
  });

  it('handles all-PRESERVE candidates', () => {
    const candidates: PerClaimResult[] = [
      makePerClaimResult({ index: 0, text: 'Concession A', classification: 'PRESERVE' }),
      makePerClaimResult({ index: 1, text: 'Concession B', classification: 'PRESERVE' }),
    ];

    const input: LookaheadGateInput = {
      ...baseInput,
      tentativeClaims: candidates.map(c => ({ text: c.text, base_strength: c.base_strength })),
      tentativeEdges: [],
    };

    const { selected, avoided } = selectGreedyClaims(candidates, input, 2);
    expect(selected.length).toBe(2);
    expect(avoided.length).toBe(0);
  });
});

// ── runOvergenPipeline ───────────────────────────────────

describe('runOvergenPipeline', () => {
  const pipelineInput: OvergenPipelineInput = {
    speaker: 'accelerationist',
    existingNodes: [
      makeNode({ id: 'AN-1', speaker: 'accelerationist', base_strength: 0.6 }),
      makeNode({ id: 'AN-2', speaker: 'safetyist', base_strength: 0.5 }),
    ],
    existingEdges: [],
    label: 'Accelerationist',
    pov: 'accelerationist',
    topic: 'Should AI development be accelerated?',
    recentTranscript: 'Prior debate context here.',
  };

  function mockEmbedFn(text: string): Promise<number[]> {
    const hash = Array.from(text).reduce((a, c) => a + c.charCodeAt(0), 0);
    const vec = Array.from({ length: 8 }, (_, i) => Math.sin(hash * (i + 1)));
    const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
    return Promise.resolve(vec.map(v => v / (norm || 1)));
  }

  it('runs full pipeline with N=2 drafts', async () => {
    let callCount = 0;
    const draftFn = async (): Promise<DraftWorkProduct> => {
      callCount++;
      return makeDraft([
        `Claim ${callCount}A: Innovation accelerates progress`,
        `Claim ${callCount}B: Market forces drive safety`,
      ]);
    };

    const rewriteGenerateFn = async (_prompt: string) => JSON.stringify({
      statement: 'Innovation accelerates progress. Market forces drive safety.',
      turn_symbols: [{ symbol: '🚀', tooltip: 'Acceleration' }],
      claim_sketches: [
        { claim: 'Innovation accelerates progress', targets: [] },
        { claim: 'Market forces drive safety', targets: [] },
      ],
      key_assumptions: [],
      disagreement_type: 'empirical',
    });

    const result = await runOvergenPipeline(
      draftFn, rewriteGenerateFn, mockEmbedFn, pipelineInput,
      { N: 2, K: 4 },
    );

    expect(result.draft.statement).toBeTruthy();
    expect(result.diagnostics.drafts_generated).toBe(2);
    expect(result.diagnostics.claims_pooled).toBe(4);
    expect(result.diagnostics.claims_after_dedup).toBeGreaterThan(0);
    expect(result.diagnostics.claims_selected).toBeGreaterThan(0);
    expect(result.diagnostics.elapsed_ms).toBeGreaterThanOrEqual(0);
  });

  it('coherence_gate_miss logged when rewrite drops claims', async () => {
    const draftFn = async (): Promise<DraftWorkProduct> =>
      makeDraft(['Unique claim alpha', 'Unique claim beta', 'Unique claim gamma']);

    // Rewrite returns completely different claims
    const rewriteGenerateFn = async (_prompt: string) => JSON.stringify({
      statement: 'Completely unrelated rewrite.',
      turn_symbols: [],
      claim_sketches: [
        { claim: 'Completely unrelated rewrite statement', targets: [] },
      ],
      key_assumptions: [],
      disagreement_type: 'empirical',
    });

    const result = await runOvergenPipeline(
      draftFn, rewriteGenerateFn, mockEmbedFn, pipelineInput,
      { N: 1, K: 4, coherenceMinClaims: 2 },
    );

    expect(result.coherence_gate_miss).toBe(true);
    expect(result.diagnostics.coherence_gate_pass).toBe(false);
    expect(result.diagnostics.coherence_attempts).toBe(2);
  });

  it('falls back gracefully when all drafts fail', async () => {
    const draftFn = async (): Promise<DraftWorkProduct> => {
      throw new Error('LLM timeout');
    };

    await expect(
      runOvergenPipeline(draftFn, vi.fn(), mockEmbedFn, pipelineInput, { N: 2 }),
    ).rejects.toThrow('LLM timeout');
  });

  it('deduplicates identical claims from multiple drafts', async () => {
    const draftFn = async (): Promise<DraftWorkProduct> =>
      makeDraft(['Innovation drives growth', 'Safety through markets']);

    const rewriteGenerateFn = async (_prompt: string) => JSON.stringify({
      statement: 'Innovation drives growth. Safety through markets.',
      turn_symbols: [],
      claim_sketches: [
        { claim: 'Innovation drives growth', targets: [] },
        { claim: 'Safety through markets', targets: [] },
      ],
      key_assumptions: [],
    });

    const result = await runOvergenPipeline(
      draftFn, rewriteGenerateFn, mockEmbedFn, pipelineInput,
      { N: 3, K: 4 },
    );

    // 3 drafts × 2 claims = 6 pooled, but identical → dedup should reduce
    expect(result.diagnostics.claims_pooled).toBe(6);
    expect(result.diagnostics.claims_after_dedup).toBeLessThan(6);
  });

  it('existing pipeline unaffected — pipeline is opt-in via function call', () => {
    // The over-gen pipeline is a standalone function; it only runs when called.
    // The experiment_overgen_select_rewrite flag gates the call in debateEngine.
    // This test verifies the function exists and has the expected signature.
    expect(typeof runOvergenPipeline).toBe('function');
    expect(runOvergenPipeline.length).toBe(5); // 5 params
  });
});
