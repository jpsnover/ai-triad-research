// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Canonical, framework-agnostic taxonomy relevance-selection pipeline (t/3248 / t/3257,
// relocation-first). ONE pure implementation called by BOTH the debate client (renderer
// thin-wrapper, T3) and the server endpoint (`POST /api/taxonomy/relevant-nodes`, T2) —
// parity holds by construction when inputs match (order-preserving; the T2 parity fixture
// asserts it). Extracted from the renderer `getRelevantTaxonomyContext` orchestration
// (taxonomyContext.ts) per Rosetta's extraction read (t/3258#3) + the TL-approved
// decomposition (t/3257#7/#8).
//
// PURITY CONTRACT (load-bearing — this is why it can be a second server caller):
//   • NO store reads, NO module-singleton caches (they break server determinism/multi-tenancy),
//     NO flight-recorder/console output. All state crosses via `input`; all diagnostics are the
//     CALLER's job (server→pino, client→FR+warnings) reconstructed from the returned result.
//   • `povNodes` is treated READ-ONLY — doctrinal anchoring runs on CLONES (see below), so the
//     server's cached taxonomy is never mutated across requests (W2, t/3257#10).
//   • Embedding IO is the injected `embed` cb (server: its computeEmbeddings; fixture: a
//     deterministic stub) — used ONLY for the doctrinal-boundary strings + the topic-query
//     fallback. The corpus `nodeEmbeddings` is pre-built by the caller.

import type { PovNode, SituationNode } from './taxonomyTypes.js';
import { cosineSimilarity } from '../embeddings/similarity.js';
import {
  scoreNodesViaAN,
  scoreNodeRelevanceMeanTopN,
  buildRelevanceQuery,
  selectRelevantNodes,
  selectRelevantSituationNodes,
  type ANClaimEmbedding,
  type RelevanceOptions,
  type ScoredPovNode,
  type ScoredSituationNode,
} from './taxonomyRelevance.js';
import { computeDoctrinalAnchoring } from './doctrinalAnchoring.js';

/** Corpus embedding map (single vector + optional synthetic multi-vectors), keyed by node id. */
export type NodeEmbeddingMap = Record<string, { pov: string; vector: number[]; vectors?: number[][] }>;

/**
 * Per-node scoring provenance: whether the node was surfaced by AN-claim similarity or the topic
 * query, plus the best-matching AN claim. Relocated from the renderer debate-store types so BOTH
 * the lib fn and the server T2 caller can type against it without a renderer path (DebateTool
 * t/3257#14). The renderer `useDebateStore/types.ts` re-exports this (source of truth is here).
 */
export interface NodeScoringSource {
  source: 'an' | 'topic';
  anScore: number;
  topicScore: number;
  bestClaimId?: string;
  bestClaimText?: string;
  bestClaimSim?: number;
}

/** AN claim embedding + its text (text needed for `bestClaimText` provenance; `ANClaimEmbedding` alone lacks it). */
export type ANClaimInput = ANClaimEmbedding & { text?: string };
// Re-exported so the server T2 caller types against `@lib/debate/relevanceSelection` alone (ServerAPI t/3257#15).
export type { ANClaimEmbedding } from './taxonomyRelevance.js';

/**
 * Doctrinal-anchoring adjustment for one Belief node — the client thin-wrapper re-applies these to
 * the store (today's in-place side-effect: `doctrinally_anchored` + a confidence floor for anchored
 * Beliefs); the server passes them through and does not apply. `floorApplied` distinguishes an
 * anchored-but-not-floored node (confidence/evidential unchanged) from a floored one, so the
 * re-apply mirrors today's behaviour EXACTLY (only floored nodes get their confidence rewritten).
 */
export interface DoctrinalAdjustment {
  nodeId: string;
  doctrinallyAnchored: boolean;
  floorApplied: boolean;
  /** The (post-floor) confidence to write when floorApplied; the node's current value otherwise. */
  confidence: number;
  /** The pre-floor confidence preserved when floorApplied; equals `confidence` otherwise. */
  evidentialConfidence: number;
}

export interface SelectRelevantTaxonomyInput {
  // ── static (server-derivable; the client passes them from its store) ──
  povNodes: PovNode[];
  situationNodes: SituationNode[];
  policyRegistry: { id: string; action: string; source_povs?: string[] }[];
  /** Corpus map, caller-built (incl. synthetic multi-vector merge). */
  nodeEmbeddings: NodeEmbeddingMap;
  /** Static lineage name→L2 map. `undefined` ⇒ no lineage boost (subsumes the old `isLineageDataLoaded()`). */
  lineageMapping?: Record<string, { l2: string }>;
  /** The current POV's doctrinal boundary strings (from POVER_INFO). Embedded inside via `embed`. */
  doctrinalBoundaries?: { strings: string[]; isRejection?: boolean[] };
  // ── per-session (MUST cross the wire — the server cannot reconstruct these) ──
  session: {
    /** `argument_network.nodes[]` with embeddings — the PRIMARY scoring signal; `text` for provenance. */
    anClaimEmbeddings: ANClaimInput[];
    lineageFrame?: { cluster_id: string; label?: string }[];
    /** `debate.source_type`; lineage frame is only "expected" for `'topic'` debates. */
    sourceType?: string;
    excludeGreatestHits?: boolean;
    /** Fetched by the caller (renderer: bridge; server: its own) and passed as an array. */
    greatestHitsList?: string[];
  };
  params: {
    pov: string;
    topic: string;
    recentTranscript: string;
    threshold?: number;      // default 0.45
    minPerCategory?: number; // default 3
    maxTotal?: number;       // default 35
    topN?: number;           // mean-top-N for multi-vector nodes; default 3
    scoringMode?: 'embedding' | 'lexical';
    // NOTE: `minPerPov` is deliberately NOT a param — selectRelevantNodes reads `opts.minPerPov ?? 2`,
    // so leaving it unset keeps BOTH callers at the default 2 (ServerAPI parity note, t/3257#15).
  };
  /** Injected embedding fn — boundary strings + topic-query fallback ONLY (never the corpus). */
  embed: (texts: string[], ids?: string[]) => Promise<number[][]>;
}

export interface RelevantTaxonomyResult {
  /** Selected POV nodes, IN `selectRelevantNodes` ORDER (W3 — the client injects in this order). */
  povNodes: { nodeId: string; score: number }[];
  situationNodes: { nodeId: string; score: number }[];
  policyRegistry: { id: string; action: string; source_povs?: string[] }[];
  /** Per-node provenance — a plain object (a Map serializes to `{}` over the wire; ServerAPI t/3257#15). */
  nodeSourceMap: Record<string, NodeScoringSource>;
  injectionManifest: Record<string, unknown>;
  /** Doctrinal-anchoring adjustments for the client to re-apply; server passes through. */
  anchoring: DoctrinalAdjustment[];
}

/** Doctrinal anchoring WITHOUT mutating the input `povNodes` (W2): clone the Beliefs, let
 *  computeDoctrinalAnchoring mutate the clones in place, and derive explicit adjustments. */
async function computeAnchoringAdjustments(
  povNodes: PovNode[],
  nodeEmbeddings: NodeEmbeddingMap,
  doctrinalBoundaries: SelectRelevantTaxonomyInput['doctrinalBoundaries'],
  embed: SelectRelevantTaxonomyInput['embed'],
): Promise<DoctrinalAdjustment[]> {
  if (!doctrinalBoundaries || doctrinalBoundaries.strings.length === 0) return [];
  const boundaryVectors = await embed(doctrinalBoundaries.strings);
  if (boundaryVectors.length === 0) return [];

  const beliefs = povNodes.filter(n => n.category === 'Beliefs');
  // Shallow clone is sufficient: computeDoctrinalAnchoring only writes scalar fields
  // (doctrinally_anchored, confidence, evidential_confidence) on the node objects.
  const clones = beliefs.map(n => ({ ...n }));
  const results = computeDoctrinalAnchoring(
    clones, boundaryVectors, nodeEmbeddings, undefined, undefined, doctrinalBoundaries.isRejection,
  );

  const adjustments: DoctrinalAdjustment[] = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const clone = clones[i]; // clones are all Beliefs → 1:1 with results, in order
    if (!r.anchored && !r.floorApplied) continue;
    adjustments.push({
      nodeId: r.nodeId,
      doctrinallyAnchored: r.anchored,
      floorApplied: r.floorApplied,
      confidence: clone.confidence ?? 0,
      evidentialConfidence: r.floorApplied ? (clone.evidential_confidence ?? clone.confidence ?? 0) : (clone.confidence ?? 0),
    });
  }
  return adjustments;
}

/** Score nodes: AN-claim similarity (primary, with per-node provenance) when AN claim embeddings
 *  exist, else the topic-query fallback. Mirrors the renderer computeRelevanceScores exactly. */
async function computeScores(
  anClaimEmbeddings: ANClaimInput[],
  nodeEmbeddings: NodeEmbeddingMap,
  allNodeIds: string[],
  params: SelectRelevantTaxonomyInput['params'],
  embed: SelectRelevantTaxonomyInput['embed'],
): Promise<{ scores: Map<string, number>; nodeSourceMap: Record<string, NodeScoringSource> }> {
  const embedded = anClaimEmbeddings.filter(n => n.vector && n.vector.length > 0);
  const query = buildRelevanceQuery(params.topic, params.recentTranscript);
  const [queryVector] = await embed([query]);
  const topN = params.topN ?? 3;

  if (embedded.length > 0) {
    const scores = scoreNodesViaAN(embedded, nodeEmbeddings, undefined, true);
    const topicScores = scoreNodeRelevanceMeanTopN(queryVector, nodeEmbeddings, topN);
    const nodeSourceMap = buildNodeSourceMap(allNodeIds, scores, topicScores, nodeEmbeddings, embedded);
    return { scores, nodeSourceMap };
  }
  // No AN claims yet (pre-opening) — single topic query, no provenance.
  const scores = scoreNodeRelevanceMeanTopN(queryVector, nodeEmbeddings, topN);
  return { scores, nodeSourceMap: {} };
}

/** Per-node provenance: best-matching AN claim + AN-vs-topic comparison. Pure (moved verbatim from
 *  the renderer buildNodeSourceMap; returns a plain object instead of a Map for wire-serialization). */
function buildNodeSourceMap(
  allNodeIds: string[],
  scores: Map<string, number>,
  topicScores: Map<string, number>,
  nodeEmbeddings: NodeEmbeddingMap,
  claimEmbeddings: ANClaimInput[],
): Record<string, NodeScoringSource> {
  const out: Record<string, NodeScoringSource> = {};
  for (const nodeId of allNodeIds) {
    const anScore = scores.get(nodeId) ?? 0;
    const topicScore = topicScores.get(nodeId) ?? 0;
    const entry = nodeEmbeddings[nodeId];
    if (!entry?.vector) continue;
    let bestSim = 0;
    let bestClaim: ANClaimInput | null = null;
    for (const claim of claimEmbeddings) {
      const sim = cosineSimilarity(entry.vector, claim.vector);
      if (sim > bestSim) { bestSim = sim; bestClaim = claim; }
    }
    out[nodeId] = {
      source: anScore >= topicScore * 0.5 ? 'an' : 'topic',
      anScore,
      topicScore,
      bestClaimId: bestClaim?.id,
      bestClaimText: bestClaim?.text,
      bestClaimSim: bestSim,
    };
  }
  return out;
}

/** Build relevance-selection options, applying the lineage-tradition boost when a frame + static
 *  lineage map are present. Pure (lineage comes from params, not renderer singletons; no logging). */
function buildOptions(
  threshold: number,
  params: SelectRelevantTaxonomyInput['params'],
  povNodes: PovNode[],
  lineageFrame: SelectRelevantTaxonomyInput['session']['lineageFrame'],
  lineageMapping: SelectRelevantTaxonomyInput['lineageMapping'],
): RelevanceOptions {
  const opts: RelevanceOptions = {
    threshold,
    minPerCategory: params.minPerCategory ?? 3,
    maxTotal: params.maxTotal ?? 35,
    // minPerPov intentionally unset → selectRelevantNodes defaults it to 2 (parity, t/3257#15).
  };
  if (params.scoringMode) opts.scoringMode = params.scoringMode;
  if (lineageFrame && lineageFrame.length > 0 && lineageMapping) {
    const lineageByNode: Record<string, string[]> = {};
    for (const node of povNodes) {
      const lineage = (node as { graph_attributes?: { intellectual_lineage?: (string | { name: string })[] } })
        .graph_attributes?.intellectual_lineage;
      if (lineage && lineage.length > 0) {
        lineageByNode[node.id] = lineage.map(v => (typeof v === 'string' ? v : v.name));
      }
    }
    const nameToCluster: Record<string, string> = {};
    for (const [name, val] of Object.entries(lineageMapping)) nameToCluster[name] = val.l2;
    opts.lineageBoost = {
      traditions: lineageFrame.map(f => f.cluster_id),
      boost: 0.08,
      lineageByNode,
      nameToCluster,
    };
  }
  return opts;
}

/** Diagnostics-free injection manifest (the FR/console logging that wrapped this in the renderer is
 *  the caller's job now; the `_lineageBoost` promotion data ships in the manifest for that). */
function buildManifest(
  scoredPov: ScoredPovNode[],
  scoredCC: ScoredSituationNode[],
  threshold: number,
): Record<string, unknown> {
  const lb = (scoredPov as unknown as { _lineageBoost?: { boostedNodeIds: string[]; promotedNodeIds: string[]; promotedCount: number } })._lineageBoost;
  const manifest: Record<string, unknown> = {
    povNodeIds: scoredPov.map(s => s.node.id),
    povPrimaryIds: scoredPov.filter(s => s.score >= threshold + 0.1).map(s => s.node.id).slice(0, 5),
    situationNodeIds: scoredCC.map(s => s.node.id),
  };
  if (lb && lb.boostedNodeIds.length > 0) {
    manifest.lineage_boost = {
      boosted: lb.boostedNodeIds.length,
      promoted: lb.promotedCount,
      boostedNodeIds: lb.boostedNodeIds.slice(0, 20),
      promotedNodeIds: lb.promotedNodeIds.slice(0, 20),
    };
  }
  return manifest;
}

/**
 * The single relevance-selection pipeline. Deterministic given its inputs; the T2 parity fixture
 * asserts server selection === today's client selection (same nodes, same ORDER, same
 * nodeSourceMap/injectionManifest).
 */
export async function selectRelevantTaxonomy(input: SelectRelevantTaxonomyInput): Promise<RelevantTaxonomyResult> {
  const { povNodes, situationNodes, policyRegistry, nodeEmbeddings, lineageMapping, doctrinalBoundaries, session, params, embed } = input;
  const threshold = params.threshold ?? 0.45;

  // 1. Doctrinal anchoring (read-only in; adjustments out — W2).
  const anchoring = await computeAnchoringAdjustments(povNodes, nodeEmbeddings, doctrinalBoundaries, embed);

  // 2. Relevance scores + per-node provenance (AN-primary, topic-query fallback).
  const allNodeIds = [...povNodes.map(n => n.id), ...situationNodes.map(n => n.id)];
  const { scores, nodeSourceMap } = await computeScores(session.anClaimEmbeddings, nodeEmbeddings, allNodeIds, params, embed);

  // 3. Selection options (+ lineage boost) and greatest-hits exclusion (pure — list passed in).
  const opts = buildOptions(threshold, params, povNodes, session.lineageFrame, lineageMapping);
  if (session.excludeGreatestHits && session.greatestHitsList && session.greatestHitsList.length > 0) {
    opts.greatestHitsExclude = new Set(session.greatestHitsList);
  }

  // 4. Order-preserving selection (W3).
  const scoredPov = selectRelevantNodes(povNodes, scores, opts);
  const scoredCC = selectRelevantSituationNodes(situationNodes, scores, threshold, 3, 15);

  return {
    povNodes: scoredPov.map(s => ({ nodeId: s.node.id, score: s.score })),
    situationNodes: scoredCC.map(s => ({ nodeId: s.node.id, score: s.score })),
    policyRegistry,
    nodeSourceMap,
    injectionManifest: buildManifest(scoredPov, scoredCC, threshold),
    anchoring,
  };
}
