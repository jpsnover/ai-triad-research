// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import type { PovNode, CrossCuttingNode as SituationNode } from '../../../types/taxonomy';
import { AI_POVERS, POVER_INFO, POV_KEYS } from '../../../types/debate';
import { useTaxonomyStore } from '../../useTaxonomyStore';
// Circular import — safe because all references are at call-time, never at module init
import { useDebateStore } from '../store';
import type { NodeScoringSource, RelevanceSourceEntry } from '../types';

import { getGlobalRecorder } from '@lib/flight-recorder/index';
import { nodeTypeFromId } from '@lib/debate/nodeIdUtils';
import { embedDoctrinalBoundaries, computeDoctrinalAnchoring, checkThresholdAnomalies } from '@lib/debate/doctrinalAnchoring';
import type { BoundaryEmbeddings } from '@lib/debate/doctrinalAnchoring';
import { computeLineageDistribution, formatLineageContext } from '@lib/debate/topicCritique';
import { cosineSimilarity, scoreNodeRelevanceMeanTopN, selectRelevantNodes, selectRelevantSituationNodes, buildRelevanceQuery, scoreNodesViaAN } from '../../../utils/taxonomyRelevance';
import type { ANClaimEmbedding, RelevanceOptions } from '../../../utils/taxonomyRelevance';
import type { TaxonomyContext } from '../../../utils/taxonomyContext';
import { getLineageMapping, getL2Categories, isLineageDataLoaded } from '../../../data/lineageCategories';
import { api } from '@bridge';

export type { TaxonomyContext };

// ── Doctrinal anchoring cache ────────────────────────────────────────
// Tracks which POVs have had doctrinal anchoring applied in this session.
// Once anchored, PovNode objects are mutated in place (doctrinally_anchored, confidence floor).
let _doctrinalAnchoringApplied = new Set<string>();
let _boundaryEmbeddingsCache: BoundaryEmbeddings | null = null;

// ── Synthetic embeddings cache ───────────────────────────────────────
// Loaded once per session from synthetic_embeddings.json via the bridge.
let _syntheticVectorsCache: Record<string, number[][]> | null = null;
let _syntheticVectorsLoaded = false;

/** Reset doctrinal anchoring cache (call when debate changes or taxonomy reloads). */
export function resetDoctrinalAnchoringCache(): void {
  _doctrinalAnchoringApplied = new Set();
  _boundaryEmbeddingsCache = null;
  _syntheticVectorsCache = null;
  _syntheticVectorsLoaded = false;
}

export async function loadSyntheticVectors(): Promise<Record<string, number[][]> | null> {
  if (_syntheticVectorsLoaded) return _syntheticVectorsCache;
  try {
    const raw = await api.loadSyntheticEmbeddings();
    if (raw) {
      _syntheticVectorsCache = {};
      for (const [nodeId, entry] of Object.entries(raw)) {
        if (entry.vectors?.length) _syntheticVectorsCache[nodeId] = entry.vectors;
      }
      console.log(`[taxonomy] Loaded synthetic embeddings for ${Object.keys(_syntheticVectorsCache).length} nodes`);
    }
  } catch (err) {
    getGlobalRecorder()?.record({ type: 'system.error', component: 'debate-store', level: 'warn', message: 'Failed to load synthetic embeddings', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
  }
  _syntheticVectorsLoaded = true;
  return _syntheticVectorsCache;
}

export function mergeSyntheticVectors(
  nodeEmbeddings: Record<string, { pov: string; vector: number[] }>,
  syntheticVectors: Record<string, number[][]>,
): Record<string, { pov: string; vector: number[]; vectors?: number[][] }> {
  const merged: Record<string, { pov: string; vector: number[]; vectors?: number[][] }> = {};
  for (const [nodeId, entry] of Object.entries(nodeEmbeddings)) {
    const sv = syntheticVectors[nodeId];
    merged[nodeId] = sv ? { ...entry, vectors: sv } : entry;
  }
  return merged;
}

export function enrichPolicyRefs(
  policyRefs: (string | { policy_id: string; relevance: string })[] | undefined,
  draftWorkProduct: Record<string, unknown> | undefined,
): (string | { policy_id: string; relevance: string })[] | undefined {
  if (!policyRefs || policyRefs.length === 0) return policyRefs;
  const draftPolicyRefs = draftWorkProduct?.policy_refs as { policy_id: string; relevance: string }[] | undefined;
  if (!Array.isArray(draftPolicyRefs) || draftPolicyRefs.length === 0) return policyRefs;

  // Build lookup from draft's rich policy refs
  const draftMap = new Map<string, string>();
  for (const dp of draftPolicyRefs) {
    if (dp && typeof dp === 'object' && dp.policy_id && dp.relevance) {
      draftMap.set(dp.policy_id, dp.relevance);
    }
  }
  if (draftMap.size === 0) return policyRefs;

  return policyRefs.map(ref => {
    if (typeof ref === 'string') {
      const relevance = draftMap.get(ref);
      return relevance ? { policy_id: ref, relevance } : ref;
    }
    return ref;
  });
}

export function getAllKnownNodeIds(): Set<string> {
  const s = new Set<string>();
  const state = useTaxonomyStore.getState();
  for (const pov of POV_KEYS) {
    for (const n of state[pov]?.nodes ?? []) s.add(n.id);
  }
  for (const n of state.situations?.nodes ?? []) s.add(n.id);
  return s;
}

export function getAllPolicyIds(): Set<string> {
  const s = new Set<string>();
  for (const p of useTaxonomyStore.getState().policyRegistry ?? []) s.add(p.id);
  return s;
}

export function findNodeMetaInStore(nodeId: string): { label: string; pov: string; description: string } | undefined {
  const state = useTaxonomyStore.getState();
  for (const pov of POV_KEYS) {
    const n = state[pov]?.nodes.find(x => x.id === nodeId);
    if (n) return { label: n.label, pov, description: n.description };
  }
  const sit = state.situations?.nodes.find(x => x.id === nodeId);
  if (sit) return { label: sit.label, pov: 'situations', description: sit.description };
  return undefined;
}

/** Get taxonomy data from the taxonomy store for a given POV */
export function getTaxonomyContext(pov: string): TaxonomyContext {
  const state = useTaxonomyStore.getState();

  const povFile = state[pov as 'accelerationist' | 'safetyist' | 'skeptic'];
  const povNodes: PovNode[] = povFile?.nodes ?? [];
  const situationNodes: SituationNode[] = state.situations?.nodes ?? [];
  const policyRegistry = (state.policyRegistry ?? []).map(p => ({ id: p.id, action: p.action, source_povs: p.source_povs }));

  return { povNodes, situationNodes, policyRegistry };
}

interface TaxonomyContextWithSources extends TaxonomyContext {
  nodeSourceMap?: Map<string, NodeScoringSource>;
  injectionManifest?: Record<string, unknown>;
}

/** Serialize nodeSourceMap to an array for storage on transcript entry metadata. Only includes refs actually used. */
export function serializeNodeSourceMap(
  sourceMap: Map<string, NodeScoringSource> | undefined,
  refs: { node_id: string }[],
): RelevanceSourceEntry[] | undefined {
  if (!sourceMap || sourceMap.size === 0) return undefined;
  const result: RelevanceSourceEntry[] = [];
  for (const ref of refs) {
    const src = sourceMap.get(ref.node_id);
    if (src) {
      result.push({
        node_id: ref.node_id,
        source: src.source,
        an_score: src.anScore,
        topic_score: src.topicScore,
        best_claim_id: src.bestClaimId,
        best_claim_text: src.bestClaimText,
        best_claim_sim: src.bestClaimSim,
      });
    }
  }
  return result.length > 0 ? result : undefined;
}

// ── getRelevantTaxonomyContext phase helpers (t/1848) ────────────────
// getRelevantTaxonomyContext was a single 80-complexity async pipeline.
// Its cohesive phases are extracted here as helpers (bodies moved verbatim;
// see ADR-007 split pattern) so the orchestrator stays readable and each
// phase is independently testable.
type NodeEmbeddingMap = Record<string, { pov: string; vector: number[]; vectors?: number[][] }>;

/** Embed all POV+CC nodes into a combined map, merging synthetic multi-vectors when available. */
async function buildNodeEmbeddingMap(pov: string, allPovNodes: PovNode[], allCCNodes: SituationNode[]): Promise<{ nodeEmbeddings: NodeEmbeddingMap; allNodeIds: string[] }> {
  const allNodeTexts = [
    ...allPovNodes.map(n => `${n.label}: ${n.description}`),
    ...allCCNodes.map(n => `${n.label}: ${n.description}`),
  ];
  const allNodeIds = [
    ...allPovNodes.map(n => n.id),
    ...allCCNodes.map(n => n.id),
  ];
  const { vectors: allVectors } = await api.computeEmbeddings(allNodeTexts, allNodeIds);
  const baseNodeEmbeddings: Record<string, { pov: string; vector: number[] }> = {};
  for (let i = 0; i < allNodeIds.length; i++) {
    baseNodeEmbeddings[allNodeIds[i]] = { pov, vector: allVectors[i] };
  }

  // Merge synthetic multi-vector embeddings when available
  const synVecs = await loadSyntheticVectors();
  const nodeEmbeddings = synVecs
    ? mergeSyntheticVectors(baseNodeEmbeddings, synVecs)
    : baseNodeEmbeddings;
  return { nodeEmbeddings, allNodeIds };
}

/** Doctrinal anchoring: embed boundary strings once, then apply confidence floors to Beliefs (once per POV). */
/** Embed doctrinal boundary strings into the shared cache once (across POVs). */
async function ensureBoundaryEmbeddingsCache(): Promise<void> {
  if (_boundaryEmbeddingsCache) return;
  const boundaries: Record<string, string[]> = {};
  for (const p of AI_POVERS) {
    const info = POVER_INFO[p];
    if ((info?.doctrinal_boundaries?.length ?? 0) > 0) {
      boundaries[info.pov] = info.doctrinal_boundaries ?? [];
    }
  }
  if (Object.keys(boundaries).length > 0) {
    _boundaryEmbeddingsCache = await embedDoctrinalBoundaries(
      boundaries,
      async (text: string) => {
        const { vector } = await api.computeQueryEmbedding(text);
        return vector;
      },
    );
  }
}

async function applyDoctrinalAnchoring(pov: string, allPovNodes: PovNode[], nodeEmbeddings: NodeEmbeddingMap): Promise<void> {
  if (_doctrinalAnchoringApplied.has(pov)) return;
  try {
    // Embed boundary strings (cached across POVs)
    await ensureBoundaryEmbeddingsCache();

    const boundaryVectors = _boundaryEmbeddingsCache?.[pov] ?? [];
    if (boundaryVectors.length > 0) {
      const beliefs = allPovNodes.filter(n => n.category === 'Beliefs');
      const results = computeDoctrinalAnchoring(beliefs, boundaryVectors, nodeEmbeddings);
      const anomaly = checkThresholdAnomalies(results, beliefs.length);
      if (anomaly) console.warn(anomaly.warning);
      const anchoredCount = results.filter(r => r.anchored).length;
      const floorCount = results.filter(r => r.floorApplied).length;
      if (anchoredCount > 0) {
        console.log(`[doctrinal] ${pov}: ${anchoredCount}/${beliefs.length} Beliefs anchored, ${floorCount} floor-applied`);
      }
    }
    _doctrinalAnchoringApplied.add(pov);
  } catch (err) {
    getGlobalRecorder()?.record({
      type: 'system.error',
      component: 'debate-store',
      level: 'warn',
      message: 'Doctrinal anchoring failed',
      error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
    });
    console.warn('[doctrinal] Anchoring failed (non-blocking):', err);
    _doctrinalAnchoringApplied.add(pov); // don't retry on failure
  }
}

/** Per-node source attribution: best-matching AN claim + AN-vs-topic comparison for each node. */
function buildNodeSourceMap(
  allNodeIds: string[],
  scores: Map<string, number>,
  topicScores: Map<string, number>,
  nodeEmbeddings: NodeEmbeddingMap,
  claimEmbeddings: ANClaimEmbedding[],
  anNodes: { id: string; text?: string }[],
): Map<string, NodeScoringSource> {
  const nodeSourceMap = new Map<string, NodeScoringSource>();
  for (const nodeId of allNodeIds) {
    const anScore = scores.get(nodeId) ?? 0;
    const topicScore = topicScores.get(nodeId) ?? 0;
    const entry = nodeEmbeddings[nodeId];
    if (!entry?.vector) continue;

    // Find best matching AN claim for this node
    let bestSim = 0;
    let bestClaim: typeof claimEmbeddings[0] | null = null;
    for (const claim of claimEmbeddings) {
      const sim = cosineSimilarity(entry.vector, claim.vector);
      if (sim > bestSim) { bestSim = sim; bestClaim = claim; }
    }

    const anNode = bestClaim ? anNodes.find(n => n.id === bestClaim!.id) : null;
    nodeSourceMap.set(nodeId, {
      source: anScore >= topicScore * 0.5 ? 'an' : 'topic',
      anScore,
      topicScore,
      bestClaimId: bestClaim?.id,
      bestClaimText: anNode?.text,
      bestClaimSim: bestSim,
    });
  }
  return nodeSourceMap;
}

/** Score nodes by relevance: AN-claim similarity when embeddings exist (with per-node source tracking), else topic query. */
async function computeRelevanceScores(
  topic: string,
  recentTranscript: string,
  nodeEmbeddings: NodeEmbeddingMap,
  allNodeIds: string[],
): Promise<{ scores: Map<string, number>; nodeSourceMap?: Map<string, NodeScoringSource> }> {
  const debate = useDebateStore.getState().activeDebate;
  const anNodes = debate?.argument_network?.nodes ?? [];
  let scores: Map<string, number>;
  let nodeSourceMap: Map<string, NodeScoringSource> | undefined;

  // Use pre-computed embeddings from AN nodes (set by t/442 on extraction)
  const embeddedAnNodes = anNodes.filter(n => n.embedding && n.embedding.length > 0);

  if (embeddedAnNodes.length > 0) {
    // AN-based scoring: use cached embeddings from extraction, score nodes by max similarity
    const claimEmbeddings: ANClaimEmbedding[] = embeddedAnNodes.map(n => ({
      id: n.id,
      vector: n.embedding!,
      strength: n.computed_strength,
    }));

    scores = scoreNodesViaAN(claimEmbeddings, nodeEmbeddings, undefined, true);
    console.log(`[taxonomy] AN-based scoring: ${claimEmbeddings.length}/${anNodes.length} claims (with embeddings) against ${allNodeIds.length} nodes`);

    // Also compute topic-only scores for hybrid source tracking
    const query = buildRelevanceQuery(topic, recentTranscript);
    const { vector: queryVector } = await api.computeQueryEmbedding(query);
    const topicScores = scoreNodeRelevanceMeanTopN(queryVector, nodeEmbeddings);

    // Build per-node source tracking: which AN claim matched best, AN vs topic comparison
    nodeSourceMap = buildNodeSourceMap(allNodeIds, scores, topicScores, nodeEmbeddings, claimEmbeddings, anNodes);
  } else {
    // No AN yet (pre-opening) — fall back to single topic query
    const query = buildRelevanceQuery(topic, recentTranscript);
    const { vector: queryVector } = await api.computeQueryEmbedding(query);
    scores = scoreNodeRelevanceMeanTopN(queryVector, nodeEmbeddings);
    console.log(`[taxonomy] Topic-query scoring (no AN claims yet): ${allNodeIds.length} nodes`);
  }
  return { scores, nodeSourceMap };
}

/** Build the lineage→node map (intellectual_lineage graph attribute) for the given nodes. */
function buildLineageByNode(nodes: PovNode[]): Record<string, string[]> {
  const lineageByNode: Record<string, string[]> = {};
  for (const node of nodes) {
    const ga = (node as { graph_attributes?: { intellectual_lineage?: (string | { name: string })[] } }).graph_attributes;
    const lineage = ga?.intellectual_lineage;
    if (lineage && lineage.length > 0) {
      lineageByNode[node.id] = lineage.map(v => typeof v === 'string' ? v : v.name);
    }
  }
  return lineageByNode;
}

/** Build the name→L2-cluster map from the lineage mapping. */
function buildNameToCluster(mapping: ReturnType<typeof getLineageMapping>): Record<string, string> {
  const nameToCluster: Record<string, string> = {};
  for (const [name, val] of Object.entries(mapping)) {
    nameToCluster[name] = val.l2;
  }
  return nameToCluster;
}

/** Build relevance-selection options, applying a lineage-tradition boost when a frame + lineage data are available. */
function buildRelevanceOptions(threshold: number, debate: ReturnType<typeof useDebateStore.getState>['activeDebate'], allPovNodes: PovNode[]): RelevanceOptions {
  const relevanceOpts: RelevanceOptions = { threshold, minPerCategory: 3, maxTotal: 35 };
  const lineageFrame = debate?.topic?.critique?.lineage_frame;
  getGlobalRecorder()?.record({
    type: 'lineage.boost-check',
    component: 'debate-store',
    level: 'debug',
    message: 'Lineage boost check',
    data: {
      has_lineage_frame: !!lineageFrame,
      frame_count: lineageFrame?.length ?? 0,
      lineage_data_loaded: isLineageDataLoaded(),
    },
  });
  if (lineageFrame && lineageFrame.length > 0 && isLineageDataLoaded()) {
    const mapping = getLineageMapping();
    const lineageByNode = buildLineageByNode(allPovNodes);
    const nameToCluster = buildNameToCluster(mapping);
    relevanceOpts.lineageBoost = {
      traditions: lineageFrame.map(f => f.cluster_id),
      boost: 0.08,
      lineageByNode,
      nameToCluster,
    };
    getGlobalRecorder()?.record({
      type: 'lineage.boost-applied',
      component: 'debate-store',
      level: 'info',
      message: 'Lineage boost applied',
      data: {
        traditions: lineageFrame.map((f: { cluster_id: string; label?: string }) => f.label ?? f.cluster_id),
        node_count_with_lineage: Object.keys(lineageByNode).length,
        cluster_count: Object.keys(nameToCluster).length,
        boost_value: 0.08,
      },
    });
  } else if (lineageFrame) {
    getGlobalRecorder()?.record({
      type: 'lineage.boost-skipped',
      component: 'debate-store',
      level: 'warn',
      message: 'Lineage boost skipped',
      data: {
        reason: lineageFrame.length === 0 ? 'empty_frame' : 'data_not_loaded',
        frame_count: lineageFrame.length,
        lineage_data_loaded: isLineageDataLoaded(),
      },
    });
  }
  return relevanceOpts;
}

/** Build the diagnostics injection manifest and log the lineage-boost promotion outcome. */
function buildInjectionManifest(
  scoredPov: ReturnType<typeof selectRelevantNodes>,
  scoredCC: ReturnType<typeof selectRelevantSituationNodes>,
  threshold: number,
  allPovNodes: PovNode[],
): Record<string, unknown> {
  // Log lineage boost outcome — confirms how many nodes were actually promoted
  const _lb = (scoredPov as unknown as { _lineageBoost?: { boostedNodeIds: string[]; promotedNodeIds: string[]; promotedCount: number } })._lineageBoost;
  if (_lb) {
    getGlobalRecorder()?.record({
      type: 'lineage.boost-result',
      component: 'debate-store',
      level: _lb.promotedCount > 0 ? 'info' : 'debug',
      message: _lb.promotedCount > 0
        ? `Lineage boost promoted ${_lb.promotedCount} nodes`
        : 'Lineage boost applied but promoted 0 nodes',
      data: { boosted_count: _lb.boostedNodeIds.length, promoted_count: _lb.promotedCount, promoted_node_ids: _lb.promotedNodeIds?.slice(0, 10), total_selected: scoredPov.length, total_candidates: allPovNodes.length },
    });
  }

  // Build injection manifest for diagnostics (mirrors debateEngine's _lastInjectionManifest)
  const injectionManifest: Record<string, unknown> = {
    povNodeIds: scoredPov.map(s => s.node.id),
    povPrimaryIds: scoredPov.filter(s => s.score >= threshold + 0.1).map(s => s.node.id).slice(0, 5),
    situationNodeIds: scoredCC.map(s => s.node.id),
  };
  if (_lb && _lb.boostedNodeIds.length > 0) {
    injectionManifest.lineage_boost = {
      boosted: _lb.boostedNodeIds.length,
      promoted: _lb.promotedCount,
      boostedNodeIds: _lb.boostedNodeIds.slice(0, 20),
      promotedNodeIds: _lb.promotedNodeIds.slice(0, 20),
    };
  }
  return injectionManifest;
}

/** Emit the situation interpretation-divergence summary — surfaces interpretation alignment at debate setup. */
function recordSituationDivergence(filteredCC: SituationNode[], allCCNodes: SituationNode[]): void {
  const withDiv = filteredCC.filter(n => n.interpretation_divergence != null);
  if (withDiv.length > 0) {
    const high = withDiv.filter(n => n.interpretation_divergence! > 0.40).length;
    const medium = withDiv.filter(n => n.interpretation_divergence! >= 0.20 && n.interpretation_divergence! <= 0.40).length;
    const low = withDiv.filter(n => n.interpretation_divergence! < 0.20).length;
    const mean = withDiv.reduce((s, n) => s + n.interpretation_divergence!, 0) / withDiv.length;
    const deprioritized = allCCNodes.filter(n => n.interpretation_divergence != null && n.interpretation_divergence < 0.20).length - low;
    getGlobalRecorder()?.record({
      type: 'situation.divergence-summary',
      component: 'debate-store',
      level: low > 0 ? 'warn' : 'info',
      message: `Situation divergence: ${high} high, ${medium} moderate, ${low} low (mean ${mean.toFixed(2)})`,
      data: {
        activated_count: withDiv.length,
        high_divergence: high,
        medium_divergence: medium,
        low_divergence: low,
        mean_divergence: Math.round(mean * 100) / 100,
        deprioritized_count: deprioritized > 0 ? deprioritized : 0,
      },
    });
  }
}

/** Unfiltered fallback context when relevance scoring fails — first 21 POV + 10 CC nodes, no scores. */
function buildUnfilteredFallback(
  state: ReturnType<typeof useTaxonomyStore.getState>,
  allPovNodes: PovNode[],
  allCCNodes: SituationNode[],
  err: unknown,
): TaxonomyContextWithSources {
  console.warn('[taxonomy] Relevance scoring failed, using unfiltered:', err);
  try {
    const s = useDebateStore.getState();
    if (s.debateWarnings.length < 50) {
      useDebateStore.setState({ debateWarnings: [...s.debateWarnings, 'Taxonomy relevance scoring unavailable'] });
    }
  } catch (e) { getGlobalRecorder()?.record({ type: 'system.error', component: 'debate-store', level: 'warn', message: 'Store not ready during relevance scoring fallback', error: { name: (e as Error).name ?? 'Error', message: String(e), stack: (e as Error).stack } }); }
  const policyRegistry = (state.policyRegistry ?? []).map(p => ({ id: p.id, action: p.action, source_povs: p.source_povs }));
  // Fallback: first 21 POV nodes + first 10 CC nodes
  return {
    povNodes: allPovNodes.slice(0, 21),
    situationNodes: allCCNodes.slice(0, 10),
    policyRegistry,
  };
}

/**
 * Get taxonomy context filtered by relevance to the debate topic.
 * Falls back to unfiltered if embeddings unavailable.
 */
export async function getRelevantTaxonomyContext(
  pov: string,
  topic: string,
  recentTranscript: string,
  threshold: number = 0.45,
): Promise<TaxonomyContextWithSources> {
  const state = useTaxonomyStore.getState();
  const povFile = state[pov as 'accelerationist' | 'safetyist' | 'skeptic'];
  const allPovNodes: PovNode[] = povFile?.nodes ?? [];
  const allCCNodes: SituationNode[] = state.situations?.nodes ?? [];

  try {
    const { nodeEmbeddings, allNodeIds } = await buildNodeEmbeddingMap(pov, allPovNodes, allCCNodes);

    // Doctrinal anchoring: embed boundary strings once, then apply confidence floors to Beliefs
    await applyDoctrinalAnchoring(pov, allPovNodes, nodeEmbeddings);

    // Score nodes by relevance (AN-claim-based when embeddings exist, else topic-query fallback)
    const { scores, nodeSourceMap } = await computeRelevanceScores(topic, recentTranscript, nodeEmbeddings, allNodeIds);

    // Build relevance options with optional lineage boost
    const debate = useDebateStore.getState().activeDebate;
    const relevanceOpts = buildRelevanceOptions(threshold, debate, allPovNodes);

    const scoredPov = selectRelevantNodes(allPovNodes, scores, relevanceOpts);
    const scoredCC = selectRelevantSituationNodes(allCCNodes, scores, threshold, 3, 15);

    const injectionManifest = buildInjectionManifest(scoredPov, scoredCC, threshold, allPovNodes);

    // Unwrap ScoredPovNode → PovNode and build nodeScores map
    const filteredPov = scoredPov.map(s => s.node);
    const filteredCC = scoredCC.map(s => s.node);
    const nodeScores = new Map<string, number>();
    for (const s of scoredPov) nodeScores.set(s.node.id, s.score);
    for (const s of scoredCC) nodeScores.set(s.node.id, s.score);

    console.log(`[taxonomy] Relevance-filtered: ${filteredPov.length} POV nodes (from ${allPovNodes.length}), ${filteredCC.length} CC nodes (from ${allCCNodes.length})`);

    recordSituationDivergence(filteredCC, allCCNodes);

    const policyRegistry = (state.policyRegistry ?? []).map(p => ({ id: p.id, action: p.action, source_povs: p.source_povs }));
    return { povNodes: filteredPov, situationNodes: filteredCC, policyRegistry, nodeScores, nodeSourceMap, injectionManifest };
  } catch (err) {
    getGlobalRecorder()?.record({
      type: 'system.error',
      component: 'debate-store',
      level: 'warn',
      message: 'Taxonomy relevance scoring failed, using unfiltered fallback',
      error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
    });
    return buildUnfilteredFallback(state, allPovNodes, allCCNodes, err);
  }
}

/** Format cross-POV tensions for injection into a specific debater's prompt */
export function formatDebaterEdgeContext(debaterPov: string): string {
  const edgesFile = useTaxonomyStore.getState().edgesFile;
  if (!edgesFile?.edges) return '';

  const povPrefixes: Record<string, string> = {
    accelerationist: 'acc-', safetyist: 'saf-', skeptic: 'skp-',
  };

  const myPrefix = povPrefixes[debaterPov];
  if (!myPrefix) return '';

  const otherPrefixes = Object.entries(povPrefixes)
    .filter(([pov]) => pov !== debaterPov)
    .map(([, prefix]) => prefix);

  const signalTypes = new Set(['CONTRADICTS', 'TENSION_WITH', 'WEAKENS']);

  // Find edges connecting this debater's POV to other POVs
  const relevantEdges = edgesFile.edges.filter(e => {
    if (!signalTypes.has(e.type)) return false;
    if (e.status !== 'approved' && e.confidence < 0.75) return false;
    const srcIsMine = e.source.startsWith(myPrefix);
    const tgtIsMine = e.target.startsWith(myPrefix);
    const srcIsOther = otherPrefixes.some(p => e.source.startsWith(p));
    const tgtIsOther = otherPrefixes.some(p => e.target.startsWith(p));
    return (srcIsMine && tgtIsOther) || (tgtIsMine && srcIsOther);
  });

  if (relevantEdges.length === 0) return '';

  // Take top 5-15 by confidence
  const top = relevantEdges
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 15);

  // Resolve node labels for readability
  const getLabel = (id: string): string => {
    const state = useTaxonomyStore.getState();
    for (const pov of POV_KEYS) {
      const node = state[pov]?.nodes?.find(n => n.id === id);
      if (node) return node.label;
    }
    return id;
  };

  const lines = [
    '',
    '=== KNOWN TENSIONS WITH OPPOSING POSITIONS ===',
    'These are documented structural disagreements between your position and other perspectives.',
    'Use these to target your arguments at real fault lines rather than talking past opponents.',
  ];
  for (const e of top) {
    const srcLabel = getLabel(e.source);
    const tgtLabel = getLabel(e.target);
    lines.push(`${e.source} (${srcLabel}) ${e.type} ${e.target} (${tgtLabel})`);
    if (e.rationale) {
      lines.push(`  ${e.rationale.slice(0, 150)}`);
    }
  }
  return lines.join('\n');
}

/** Format relevant edges between active debaters' nodes for the moderator */
export function formatEdgeContext(activePovers: string[]): string {
  const edgesFile = useTaxonomyStore.getState().edgesFile;
  if (!edgesFile?.edges) return '';

  // Map pover labels to POV prefixes
  const povPrefixes: Record<string, string> = {
    accelerationist: 'acc-', safetyist: 'saf-', skeptic: 'skp-',
  };
  const labelToPov: Record<string, string> = {
    Accelerationist: 'accelerationist', Safetyist: 'safetyist', Skeptic: 'skeptic',
    Prometheus: 'accelerationist', Sentinel: 'safetyist', Cassandra: 'skeptic',
  };

  // Find cross-POV edges of high-signal types
  const signalTypes = new Set(['CONTRADICTS', 'TENSION_WITH', 'WEAKENS', 'RESPONDS_TO']);
  const activePovs = activePovers.map(l => labelToPov[l]).filter(Boolean);
  const activePrefixes = activePovs.map(p => povPrefixes[p]).filter(Boolean);

  const relevantEdges = edgesFile.edges.filter(e => {
    if (!signalTypes.has(e.type)) return false;
    if (e.status !== 'approved' && e.confidence < 0.75) return false;
    // Must be cross-POV
    const srcPrefix = activePrefixes.find(p => e.source.startsWith(p));
    const tgtPrefix = activePrefixes.find(p => e.target.startsWith(p));
    return srcPrefix && tgtPrefix && srcPrefix !== tgtPrefix;
  });

  if (relevantEdges.length === 0) return '';

  // Take top edges by confidence
  const top = relevantEdges
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 15);

  const lines = ['', '=== KNOWN TENSIONS BETWEEN POSITIONS ==='];
  for (const e of top) {
    lines.push(`${e.source} ${e.type} ${e.target} (confidence: ${(e.confidence ?? 0).toFixed(2)})`);
  }
  return lines.join('\n');
}

/** Fallback lineage frame computed from all taxonomy nodes (document/situation debates without a topic critique). */
function computeFallbackLineageContext(): string | undefined {
  if (!isLineageDataLoaded()) return undefined;
  const taxState = useTaxonomyStore.getState();
  const mapping = getLineageMapping();
  const l2Cats = getL2Categories();

  const allNodeIds: string[] = [];
  const allNodes: PovNode[] = [];
  for (const pov of ['accelerationist', 'safetyist', 'skeptic'] as const) {
    const file = taxState[pov];
    if (!file?.nodes) continue;
    for (const node of file.nodes) {
      allNodeIds.push(node.id);
      allNodes.push(node);
    }
  }

  const lineageByNode = buildLineageByNode(allNodes);
  const nameToCluster = buildNameToCluster(mapping);
  const clusterLabels: Record<string, string> = {};
  for (const cat of l2Cats) {
    clusterLabels[cat.id] = cat.label;
  }

  const frame = computeLineageDistribution({ activatedNodeIds: allNodeIds, lineageByNode, nameToCluster, clusterLabels });
  if (frame.length === 0) return undefined;
  return formatLineageContext(frame);
}

/** Build lineage context string from pre-computed critique or fallback from all taxonomy nodes. */
export function buildLineageContext(): string | undefined {
  const debate = useDebateStore.getState().activeDebate;
  const lineageFrame = debate?.topic?.critique?.lineage_frame;
  if (lineageFrame && lineageFrame.length > 0) {
    return formatLineageContext(lineageFrame);
  }
  return computeFallbackLineageContext();
}

/** Helper to get node label for fact check (standalone, no React hooks) */
export function getNodeLabelForFactCheck(nodeId: string): string {
  const state = useTaxonomyStore.getState();
  if (nodeTypeFromId(nodeId) === 'situation') {
    const node = state.situations?.nodes?.find((n: { id: string }) => n.id === nodeId);
    return node?.label || nodeId;
  }
  const povMap: Record<string, string> = { 'acc-': 'accelerationist', 'saf-': 'safetyist', 'skp-': 'skeptic' };
  for (const [prefix, pov] of Object.entries(povMap)) {
    if (nodeId.startsWith(prefix)) {
      const povFile = state[pov as 'accelerationist' | 'safetyist' | 'skeptic'];
      const node = povFile?.nodes?.find((n: { id: string }) => n.id === nodeId);
      return node?.label || nodeId;
    }
  }
  return nodeId;
}
