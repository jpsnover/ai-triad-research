import { describe, it, expect } from 'vitest';
import {
  checkClaimExclusionBoundary,
  checkDraftScopeBoundary,
  EXCLUSION_RATIO_THRESHOLD,
  SCOPE_BOUNDARY_THRESHOLD,
} from './exclusionGuard.js';
import type { ArgumentNetworkNode } from './types.js';

function makeVector(seed: number, dim = 384): number[] {
  const v = new Array(dim).fill(0);
  v[0] = Math.cos(seed);
  v[1] = Math.sin(seed);
  return v;
}

function makeNode(overrides: Partial<ArgumentNetworkNode> & { id: string; text: string }): ArgumentNetworkNode {
  return {
    speaker: 'accelerationist',
    source_entry_id: 'e1',
    taxonomy_refs: [],
    turn_number: 1,
    base_strength: 0.5,
    ...overrides,
  } as ArgumentNetworkNode;
}

describe('checkClaimExclusionBoundary', () => {
  it('returns empty when no exclusion_vector exists', () => {
    const nodes = [makeNode({
      id: 'AN-1', text: 'test claim',
      embedding: makeVector(0),
      claim_taxonomy_attribution: { primary_ref: 'acc-beliefs-001', attribution_confidence: 0.8 },
    })];
    const embeddings = {
      'acc-beliefs-001': { pov: 'accelerationist', vector: makeVector(0) },
    };
    const result = checkClaimExclusionBoundary(nodes, embeddings);
    expect(result).toEqual([]);
  });

  it('returns empty when claim has no embedding', () => {
    const nodes = [makeNode({
      id: 'AN-1', text: 'test claim',
      claim_taxonomy_attribution: { primary_ref: 'acc-beliefs-001', attribution_confidence: 0.8 },
    })];
    const embeddings = {
      'acc-beliefs-001': { pov: 'accelerationist', vector: makeVector(0), exclusion_vector: makeVector(1) },
    };
    const result = checkClaimExclusionBoundary(nodes, embeddings);
    expect(result).toEqual([]);
  });

  it('returns empty when claim has no attribution', () => {
    const nodes = [makeNode({
      id: 'AN-1', text: 'test claim',
      embedding: makeVector(0),
    })];
    const embeddings = {
      'acc-beliefs-001': { pov: 'accelerationist', vector: makeVector(0), exclusion_vector: makeVector(1) },
    };
    const result = checkClaimExclusionBoundary(nodes, embeddings);
    expect(result).toEqual([]);
  });

  it('flags claim when exclusion similarity exceeds ratio threshold', () => {
    const claimVec = makeVector(0.1);
    const mainVec = makeVector(2.0);
    const exclVec = makeVector(0.1);

    const nodes = [makeNode({
      id: 'AN-1', text: 'claim in exclusion zone',
      embedding: claimVec,
      claim_taxonomy_attribution: { primary_ref: 'acc-beliefs-001', attribution_confidence: 0.7 },
    })];
    const embeddings = {
      'acc-beliefs-001': { pov: 'accelerationist', vector: mainVec, exclusion_vector: exclVec },
    };
    const result = checkClaimExclusionBoundary(nodes, embeddings);
    expect(result.length).toBe(1);
    expect(result[0].claim_id).toBe('AN-1');
    expect(result[0].node_id).toBe('acc-beliefs-001');
    expect(result[0].similarity_exclusion).toBeGreaterThan(result[0].similarity_main * EXCLUSION_RATIO_THRESHOLD);
  });

  it('does not flag when exclusion similarity is below ratio', () => {
    const claimVec = makeVector(0.1);
    const mainVec = makeVector(0.1);
    const exclVec = makeVector(2.0);

    const nodes = [makeNode({
      id: 'AN-1', text: 'safe claim',
      embedding: claimVec,
      claim_taxonomy_attribution: { primary_ref: 'acc-beliefs-001', attribution_confidence: 0.9 },
    })];
    const embeddings = {
      'acc-beliefs-001': { pov: 'accelerationist', vector: mainVec, exclusion_vector: exclVec },
    };
    const result = checkClaimExclusionBoundary(nodes, embeddings);
    expect(result).toEqual([]);
  });

  it('accepts custom threshold', () => {
    const claimVec = makeVector(0.5);
    const mainVec = makeVector(0.7);
    const exclVec = makeVector(0.5);

    const nodes = [makeNode({
      id: 'AN-1', text: 'edge case claim',
      embedding: claimVec,
      claim_taxonomy_attribution: { primary_ref: 'acc-beliefs-001', attribution_confidence: 0.7 },
    })];
    const embeddings = {
      'acc-beliefs-001': { pov: 'accelerationist', vector: mainVec, exclusion_vector: exclVec },
    };
    const atDefault = checkClaimExclusionBoundary(nodes, embeddings);
    const atLoose = checkClaimExclusionBoundary(nodes, embeddings, 0.5);
    expect(atLoose.length).toBeGreaterThanOrEqual(atDefault.length);
  });
});

describe('checkDraftScopeBoundary', () => {
  it('returns empty when no exclusion_vector exists', () => {
    const embeddings = {
      'acc-beliefs-001': { pov: 'accelerationist', vector: makeVector(0) },
    };
    const result = checkDraftScopeBoundary(
      makeVector(0), ['acc-beliefs-001'], embeddings, 'accelerationist', 'draft text',
    );
    expect(result).toEqual([]);
  });

  it('returns empty when ref IDs have no embeddings', () => {
    const embeddings = {
      'acc-beliefs-002': { pov: 'accelerationist', vector: makeVector(0), exclusion_vector: makeVector(0) },
    };
    const result = checkDraftScopeBoundary(
      makeVector(0), ['acc-beliefs-001'], embeddings, 'accelerationist', 'draft text',
    );
    expect(result).toEqual([]);
  });

  it('flags draft when similarity to exclusion_vector exceeds threshold', () => {
    const draftVec = makeVector(0.1);
    const exclVec = makeVector(0.1);

    const embeddings = {
      'acc-beliefs-001': { pov: 'accelerationist', vector: makeVector(2.0), exclusion_vector: exclVec },
    };
    const result = checkDraftScopeBoundary(
      draftVec, ['acc-beliefs-001'], embeddings, 'accelerationist', 'draft about excluded topic',
    );
    expect(result.length).toBe(1);
    expect(result[0].debater).toBe('accelerationist');
    expect(result[0].node_id).toBe('acc-beliefs-001');
    expect(result[0].similarity).toBeGreaterThan(SCOPE_BOUNDARY_THRESHOLD);
    expect(result[0].draft_excerpt).toBe('draft about excluded topic');
  });

  it('does not flag draft below threshold', () => {
    const draftVec = makeVector(0);
    const exclVec = makeVector(Math.PI);

    const embeddings = {
      'acc-beliefs-001': { pov: 'accelerationist', vector: makeVector(0), exclusion_vector: exclVec },
    };
    const result = checkDraftScopeBoundary(
      draftVec, ['acc-beliefs-001'], embeddings, 'accelerationist', 'on-topic draft',
    );
    expect(result).toEqual([]);
  });

  it('truncates draft_excerpt to 200 chars', () => {
    const longDraft = 'A'.repeat(500);
    const vec = makeVector(0.1);
    const embeddings = {
      'n1': { pov: 'acc', vector: makeVector(2.0), exclusion_vector: vec },
    };
    const result = checkDraftScopeBoundary(
      vec, ['n1'], embeddings, 'acc', longDraft,
    );
    expect(result.length).toBe(1);
    expect(result[0].draft_excerpt.length).toBe(200);
  });

  it('accepts custom threshold', () => {
    const draftVec = makeVector(0.3);
    const exclVec = makeVector(0.3);
    const embeddings = {
      'n1': { pov: 'acc', vector: makeVector(2.0), exclusion_vector: exclVec },
    };
    const atDefault = checkDraftScopeBoundary(draftVec, ['n1'], embeddings, 'acc', 'text');
    const atStrict = checkDraftScopeBoundary(draftVec, ['n1'], embeddings, 'acc', 'text', 0.3);
    expect(atStrict.length).toBeGreaterThanOrEqual(atDefault.length);
  });

  it('checks multiple refs independently', () => {
    const draftVec = makeVector(0.1);
    const matchExcl = makeVector(0.1);
    const noMatchExcl = makeVector(Math.PI);
    const embeddings = {
      'n1': { pov: 'acc', vector: makeVector(2.0), exclusion_vector: matchExcl },
      'n2': { pov: 'acc', vector: makeVector(0), exclusion_vector: noMatchExcl },
    };
    const result = checkDraftScopeBoundary(
      draftVec, ['n1', 'n2'], embeddings, 'acc', 'text',
    );
    expect(result.length).toBe(1);
    expect(result[0].node_id).toBe('n1');
  });
});
