// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/3257 relocation-parity gate (TL condition, p/336#260 / t/3257#19).
//
// The extraction (getRelevantTaxonomyContext → lib-pure selectRelevantTaxonomy) is a behavior-
// preserving refactor, but the client's LOCAL selection drives prod debates until the endpoint
// flip, and the T2 server===client fixture can't catch a relocation regression (its 'client' IS
// the relocated fn). This test proves OLD-client-selection === NEW-lib-fn-selection by computing
// the expected output from the UNCHANGED leaf fns wired EXACTLY as the removed orchestration did
// (computeRelevanceScores + buildRelevanceOptions + selectRelevantNodes/Situation, verbatim
// constants: scoreNodesViaAN strengthWeighted=true, topN 3, {threshold, minPerCategory:3,
// maxTotal:35} with NO minPerPov, selectRelevantSituationNodes(_,_,threshold,3,15)). Any drift in
// the new fn's wiring — a stray minPerPov, wrong threshold/strength flag, changed order — FAILS here.

import { describe, it, expect } from 'vitest';
import type { PovNode, CrossCuttingNode as SituationNode } from '../../../types/taxonomy';
import { selectRelevantTaxonomy, type ANClaimInput, type NodeEmbeddingMap } from '@lib/debate/relevanceSelection';
import {
  scoreNodesViaAN,
  scoreNodeRelevanceMeanTopN,
  selectRelevantNodes,
  selectRelevantSituationNodes,
  buildRelevanceQuery,
  type RelevanceOptions,
} from '../../../utils/taxonomyRelevance';

// ── Deterministic fixture (fixed vectors → no embedding IO) ──
const QUERY_VEC = [0.2, 0.9, 0.1];
const V = (a: number, b: number, c: number): number[] => [a, b, c];

function povNode(id: string, category: 'Beliefs' | 'Desires' | 'Intentions', confidence?: number): PovNode {
  return { id, category, label: `L ${id}`, description: `D ${id}`, parent_id: null, children: [], situation_refs: [], confidence } as unknown as PovNode;
}
function sitNode(id: string): SituationNode {
  return { id, label: `S ${id}`, description: `sd ${id}`, interpretations: {}, linked_nodes: [], conflict_ids: [] } as unknown as SituationNode;
}

const POV_NODES: PovNode[] = [
  povNode('acc-beliefs-001', 'Beliefs', 0.5),
  povNode('acc-beliefs-002', 'Beliefs', 0.8),
  povNode('acc-desires-001', 'Desires', 0.4),
  povNode('acc-desires-002', 'Desires'),
  povNode('acc-intentions-001', 'Intentions', 0.6),
];
const SIT_NODES: SituationNode[] = [sitNode('sit-001'), sitNode('sit-002'), sitNode('sit-003')];

const NODE_EMBEDDINGS: NodeEmbeddingMap = {
  'acc-beliefs-001': { pov: 'accelerationist', vector: V(0.9, 0.1, 0.1) },
  'acc-beliefs-002': { pov: 'accelerationist', vector: V(0.1, 0.9, 0.2) },
  'acc-desires-001': { pov: 'accelerationist', vector: V(0.3, 0.7, 0.4) },
  'acc-desires-002': { pov: 'accelerationist', vector: V(0.8, 0.2, 0.1) },
  'acc-intentions-001': { pov: 'accelerationist', vector: V(0.2, 0.8, 0.6) },
  'sit-001': { pov: 'accelerationist', vector: V(0.15, 0.85, 0.1) },
  'sit-002': { pov: 'accelerationist', vector: V(0.9, 0.05, 0.2) },
  'sit-003': { pov: 'accelerationist', vector: V(0.25, 0.75, 0.5) },
};

const AN_CLAIMS: ANClaimInput[] = [
  { id: 'AN-1', vector: V(0.1, 0.95, 0.15), strength: 0.8, text: 'claim one' },
  { id: 'AN-2', vector: V(0.85, 0.15, 0.1), strength: 0.5, text: 'claim two' },
];

const TOPIC = 'test topic';
const TRANSCRIPT = 'recent transcript';
const THRESHOLD = 0.45;
const embed = async (texts: string[]): Promise<number[][]> => texts.map(() => QUERY_VEC);

/** Recompute the selection the way the REMOVED orchestration did — the "old client" reference. */
function oldClientSelection(anClaims: ANClaimInput[]) {
  // computeRelevanceScores: AN-primary when claims exist, else topic-query fallback.
  let scores: Map<string, number>;
  if (anClaims.length > 0) {
    scores = scoreNodesViaAN(anClaims, NODE_EMBEDDINGS, undefined, true); // strengthWeighted=true
  } else {
    scores = scoreNodeRelevanceMeanTopN(QUERY_VEC, NODE_EMBEDDINGS, 3);
  }
  // buildRelevanceOptions: no lineage frame here → plain opts, NO minPerPov.
  const opts: RelevanceOptions = { threshold: THRESHOLD, minPerCategory: 3, maxTotal: 35 };
  const scoredPov = selectRelevantNodes(POV_NODES, scores, opts);
  const scoredCC = selectRelevantSituationNodes(SIT_NODES, scores, THRESHOLD, 3, 15);
  return {
    pov: scoredPov.map(s => ({ nodeId: s.node.id, score: s.score })),
    cc: scoredCC.map(s => ({ nodeId: s.node.id, score: s.score })),
  };
}

async function newLibSelection(anClaimEmbeddings: ANClaimInput[]) {
  const result = await selectRelevantTaxonomy({
    povNodes: POV_NODES,
    situationNodes: SIT_NODES,
    policyRegistry: [],
    nodeEmbeddings: NODE_EMBEDDINGS,
    session: { anClaimEmbeddings },
    params: { pov: 'accelerationist', topic: TOPIC, recentTranscript: TRANSCRIPT, threshold: THRESHOLD },
    embed,
  });
  return { pov: result.povNodes, cc: result.situationNodes, nodeSourceMap: result.nodeSourceMap };
}

describe('relocation parity: new selectRelevantTaxonomy === old client selection (t/3257)', () => {
  it('AN-primary path: identical POV + situation selection, same nodes AND ORDER + scores', async () => {
    const expected = oldClientSelection(AN_CLAIMS);
    const actual = await newLibSelection(AN_CLAIMS);
    expect(actual.pov).toEqual(expected.pov);   // toEqual on ordered arrays asserts order too
    expect(actual.cc).toEqual(expected.cc);
    // Sanity: a non-trivial selection is exercised (guards a fixture that selects nothing).
    expect(actual.pov.length).toBeGreaterThan(0);
  });

  it('topic-query fallback (no AN claims): identical selection', async () => {
    const expected = oldClientSelection([]);
    const actual = await newLibSelection([]);
    expect(actual.pov).toEqual(expected.pov);
    expect(actual.cc).toEqual(expected.cc);
  });

  it('query is built the pre-extraction way (buildRelevanceQuery) — embed receives topic+transcript', async () => {
    const seen: string[][] = [];
    const spyEmbed = async (texts: string[]): Promise<number[][]> => { seen.push(texts); return texts.map(() => QUERY_VEC); };
    await selectRelevantTaxonomy({
      povNodes: POV_NODES, situationNodes: SIT_NODES, policyRegistry: [], nodeEmbeddings: NODE_EMBEDDINGS,
      session: { anClaimEmbeddings: AN_CLAIMS },
      params: { pov: 'accelerationist', topic: TOPIC, recentTranscript: TRANSCRIPT, threshold: THRESHOLD }, embed: spyEmbed,
    });
    expect(seen.flat()).toContain(buildRelevanceQuery(TOPIC, TRANSCRIPT));
  });
});
