// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import type { DebateEngineInternals } from './internals.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { type ExtendedAIAdapter } from '../aiAdapter.js';
import { type TaxonomyRef, POVER_INFO, POV_KEYS, type PovKey, type TurnValidation } from '../types.js';
import { type TaxonomyContext, formatTaxonomyContext, computeInjectionManifest } from '../taxonomyContext.js';
import { resolveRepoRoot, resolveDataRoot, loadSituationStatements } from '../taxonomyLoader.js';
import { scoreNodeRelevance, scoreNodesLexical, scoreNodesViaAN, selectRelevantNodes, selectRelevantSituationNodes, buildRelevanceQuery, computePolicymakerRelevanceBoost, type RelevanceOptions, type ANClaimEmbedding, type ScoredPovNode, filterByTopicConstraints } from '../taxonomyRelevance.js';
import { formatRecentTranscript } from '../helpers.js';
import { loadGreatestHitsFile } from '../corpusCoverage.js';
import { ActionableError } from '../errors.js';
import { filterByExclusionAbsolute, SCOPE_BOUNDARY_THRESHOLD } from '../exclusionGuard.js';
import { getGlobalRecorder } from '../../flight-recorder/index.js';

export function getNodeLabelMap(engine: DebateEngineInternals): Map<string, string> {
  if (engine._nodeLabelMap) return engine._nodeLabelMap;
  const m = new Map<string, string>();
  for (const pov of [engine.taxonomy.accelerationist, engine.taxonomy.safetyist, engine.taxonomy.skeptic]) {
    for (const n of pov.nodes) m.set(n.id, n.label);
  }
  for (const n of engine.taxonomy.situations?.nodes ?? []) m.set(n.id, n.label);
  engine._nodeLabelMap = m;
  return m;
}

export function enrichTaxonomyRefs(engine: DebateEngineInternals, refs: TaxonomyRef[]): void {
  const manifest = engine._lastInjectionManifest;
  if (!manifest) return;

  // Use the full relevance scores map (covers POV + situation nodes).
  // Falls back to manifest's POV-only array for backwards compatibility.
  const scoreMap = engine._lastRelevanceScores ?? new Map<string, number>();
  if (scoreMap.size === 0 && manifest.nodeScores && manifest.povNodeIds) {
    for (let i = 0; i < manifest.povNodeIds.length; i++) {
      if (i < manifest.nodeScores.length) {
        scoreMap.set(manifest.povNodeIds[i], manifest.nodeScores[i]);
      }
    }
  }
  const primarySet = new Set(manifest.povPrimaryIds);
  const labelMap = getNodeLabelMap(engine);

  for (const ref of refs) {
    const score = scoreMap.get(ref.node_id);
    if (score != null) ref.relevance_score = score;
    if (primarySet.has(ref.node_id)) ref.primary = true;
    const label = labelMap.get(ref.node_id);
    if (label) ref.label = label;
  }
}

/** Find node label + pov from the loaded taxonomy, or undefined if not present. */
export function findNodeMeta(engine: DebateEngineInternals, nodeId: string): { label: string; pov: string; description: string } | undefined {
  for (const pov of POV_KEYS) {
    const n = engine.taxonomy[pov]?.nodes.find(x => x.id === nodeId);
    if (n) return { label: n.label, pov, description: n.description };
  }
  const sit = engine.taxonomy.situations?.nodes.find(x => x.id === nodeId);
  if (sit) return { label: sit.label, pov: 'situations', description: sit.description };
  return undefined;
}

/** Convert TurnValidation.clarifies_taxonomy hints into TaxonomySuggestion entries,
 *  append to session, dedupe by (node_id, suggestion_type, source). */
export function routeTurnValidatorHints(engine: DebateEngineInternals, validation: TurnValidation, entryId: string): void {
  const HINT_TO_SUGGESTION = {
    narrow: 'narrow',
    broaden: 'broaden',
    split: 'split',
    merge: 'merge',
    qualify: 'qualify',
    retire: 'retire',
    new_node: 'new_node',
  } as const;

  engine.session.taxonomy_suggestions ||= [];
  const existing = engine.session.taxonomy_suggestions;

  for (const hint of validation.clarifies_taxonomy) {
    const type = HINT_TO_SUGGESTION[hint.action];
    if (!type) continue;

    // New-node hints reference a label, not a node_id.
    if (type === 'new_node') {
      const duplicate = existing.some(
        s => s.source === 'turn-validator' && s.suggestion_type === 'new_node' &&
          (s.node_label ?? '') === (hint.label ?? ''),
      );
      if (duplicate || !hint.label) continue;
      existing.push({
        node_id: `pending:${hint.label}`,
        node_label: hint.label,
        node_pov: 'unknown',
        suggestion_type: 'new_node',
        rationale: hint.rationale || 'Proposed mid-debate by the turn validator.',
        evidence_claim_ids: hint.evidence_claim_id ? [hint.evidence_claim_id] : undefined,
        source: 'turn-validator',
        origin_entry_id: entryId,
      });
      continue;
    }

    if (!hint.node_id) continue;
    const duplicate = existing.some(
      s => s.source === 'turn-validator' &&
        s.node_id === hint.node_id &&
        s.suggestion_type === type,
    );
    if (duplicate) continue;

    const meta = findNodeMeta(engine, hint.node_id);
    existing.push({
      node_id: hint.node_id,
      node_label: meta?.label ?? hint.node_id,
      node_pov: meta?.pov ?? 'unknown',
      suggestion_type: type,
      current_description: meta?.description,
      rationale: hint.rationale || 'Surfaced mid-debate by the turn validator.',
      evidence_claim_ids: hint.evidence_claim_id ? [hint.evidence_claim_id] : undefined,
      source: 'turn-validator',
      origin_entry_id: entryId,
      merge_with_node_ids: type === 'merge' ? hint.node_ids : undefined,
    });
  }
}

// ── Taxonomy context ───────────────────────────────────────

export function getTaxonomyContext(engine: DebateEngineInternals, pov: string): TaxonomyContext {
  const povFile = engine.taxonomy[pov as PovKey];
  return {
    povNodes: povFile?.nodes ?? [],
    situationNodes: engine.taxonomy.situations.nodes,
    policyRegistry: engine.taxonomy.policyRegistry,
  };
}

export async function getRelevantTaxonomyContext(engine: DebateEngineInternals, pov: string, priorRefs: string[] = []): Promise<string> {
  const ctx = getTaxonomyContext(engine, pov);

  // Build the per-turn query from topic + recent transcript
  const recentTranscript = formatRecentTranscript(engine.session.transcript, 8, engine.session.context_summaries);
  const query = buildRelevanceQuery(engine.session.topic.final, recentTranscript);

  let scores: Map<string, number> | null = null;
  let scoringMode: 'embedding' | 'lexical' = 'embedding';
  let roundFocusVector: number[] | null = null;

  const adapter = engine.adapter as ExtendedAIAdapter;
  const hasEmbeddings = Object.keys(engine.taxonomy.embeddings).length > 0;

  // ── Hybrid AN + topic scoring ──
  // AN-based: score taxonomy nodes by max similarity to any active AN claim
  // Topic-based: score by similarity to topic query (floor at 0.5×)
  // Final: max(AN_score, topic_score × 0.5)
  const an = engine.session.argument_network;
  const claimEmbeddings: ANClaimEmbedding[] = (an?.nodes ?? [])
    .filter(n => n.embedding && n.embedding.length > 0)
    .map(n => ({ id: n.id, vector: n.embedding!, strength: n.computed_strength }));

  if (hasEmbeddings && claimEmbeddings.length > 0) {
    // Topic score as floor
    let topicScores: Map<string, number> | null = null;
    if (adapter.computeQueryEmbedding) {
      try {
        const { vector } = await adapter.computeQueryEmbedding(query);
        if (vector && vector.length > 0) {
          topicScores = scoreNodeRelevance(vector, engine.taxonomy.embeddings);
          roundFocusVector = vector;
        }
      } catch (err) {
        getGlobalRecorder()?.record({ type: 'system.error', component: 'debate-engine', level: 'warn', debate_id: engine.session?.id, message: 'Topic embedding for relevance floor failed', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
        engine.warn('Topic embedding for relevance floor', err, 'Using AN-only scoring');
      }
    }

    // AN score via cached claim embeddings
    const anScores = scoreNodesViaAN(claimEmbeddings, engine.taxonomy.embeddings, undefined, true);

    // Hybrid: max(AN_score, topic_score × 0.5)
    scores = new Map<string, number>();
    const allIds = new Set([...anScores.keys(), ...(topicScores?.keys() ?? [])]);
    for (const id of allIds) {
      const anScore = anScores.get(id) ?? 0;
      const topicFloor = (topicScores?.get(id) ?? 0) * 0.5;
      scores.set(id, Math.max(anScore, topicFloor));
    }
  } else if (hasEmbeddings && adapter.computeQueryEmbedding) {
    // First-mover fallback: no AN claims yet — topic-only scoring
    try {
      const { vector } = await adapter.computeQueryEmbedding(query);
      if (vector && vector.length > 0) {
        scores = scoreNodeRelevance(vector, engine.taxonomy.embeddings);
        roundFocusVector = vector;
      }
    } catch (err) {
      getGlobalRecorder()?.record({ type: 'system.error', component: 'debate-engine', level: 'warn', debate_id: engine.session?.id, message: 'Query embedding for relevance filter failed', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
      engine.warn('Query embedding for relevance filter', err, 'Falling back to lexical scoring');
    }
  }

  // Fallback: lexical overlap (no adapter embedding available)
  if (!scores) {
    scores = scoreNodesLexical(query, ctx.povNodes, ctx.situationNodes);
    scoringMode = 'lexical';
    console.warn('[relevance] Embedding adapter unavailable — using lexical fallback (reduced precision)');
  }

  // Diversification: down-weight nodes the speaker recently cited so fresh-but-relevant
  // nodes rise into the shortlist. Multiplicative penalty keeps strong-relevance recent
  // nodes in the mix when they still dominate other candidates.
  if (priorRefs.length > 0) {
    const recent = new Set(priorRefs);
    for (const [id, score] of scores) {
      if (recent.has(id)) scores.set(id, score * 0.55);
    }
  }

  // Apply adaptive situation score adjustments from crux re-scoring (t/23)
  if (engine._situationScoreAdjustments) {
    for (const [id, adj] of engine._situationScoreAdjustments) {
      const base = scores.get(id) ?? 0;
      scores.set(id, Math.max(0, base + adj));
    }
  }

  const relevanceOpts: RelevanceOptions = {
    scoringMode,
    embeddingThreshold: 0.48,
    lexicalThreshold: 0.22,
    minPerCategory: parseInt(process.env.TAXONOMY_MIN_PER_BDI || '') || 3,
    maxTotal: parseInt(process.env.TAXONOMY_MAX_NODES || '') || 12,
    nodeEmbeddings: roundFocusVector ? engine.taxonomy.embeddings as Record<string, { pov: string; vector: number[]; exclusion_vector?: number[] }> : undefined,
    queryVector: roundFocusVector ?? undefined,
  };

  // Apply lineage boost when lineage_frame is available
  const lineageFrame = engine.session.topic.critique?.lineage_frame;
  const lc = engine.taxonomy.lineageCategories;
  if (lineageFrame && lineageFrame.length > 0 && lc) {
    const lineageByNode: Record<string, string[]> = {};
    for (const povKey of ['accelerationist', 'safetyist', 'skeptic'] as const) {
      for (const node of engine.taxonomy[povKey]?.nodes ?? []) {
        const ga = (node as { graph_attributes?: { intellectual_lineage?: (string | { name: string })[] } }).graph_attributes;
        const lineage = ga?.intellectual_lineage;
        if (lineage && lineage.length > 0) {
          lineageByNode[node.id] = lineage.map(v => typeof v === 'string' ? v : v.name);
        }
      }
    }
    const nameToCluster: Record<string, string> = {};
    for (const [name, val] of Object.entries(lc.mapping)) {
      nameToCluster[name] = val.l2;
    }
    relevanceOpts.lineageBoost = {
      traditions: lineageFrame.map(f => f.cluster_id),
      boost: 0.08,
      lineageByNode,
      nameToCluster,
    };
  }

  // Load greatest-hits exclusion set when enabled (t/1438).
  // Flag-On + missing file = ActionableError (CL binding condition #1 self-cert).
  if (engine.config.excludeGreatestHits) {
    const __dir = path.dirname(fileURLToPath(import.meta.url));
    const repoRoot = resolveRepoRoot(__dir);
    const dataRoot = resolveDataRoot(repoRoot);
    const knownNodeIds = new Set(ctx.povNodes.map(n => n.id));
    const exclusionSet = loadGreatestHitsFile(dataRoot, knownNodeIds);
    if (!exclusionSet) {
      throw new ActionableError({
        goal: 'Apply greatest-hits node exclusion for debate setup',
        problem: 'excludeGreatestHits is enabled but calibration/greatest-hits.json is missing',
        location: 'getRelevantTaxonomyContext',
        nextSteps: [
          'Generate the file: call generateGreatestHitsFile(dataRoot) from corpusCoverage.ts',
          `Expected at: ${path.join(dataRoot, 'calibration', 'greatest-hits.json')}`,
          'Or set excludeGreatestHits: false in the debate config to disable',
        ],
      });
    }
    relevanceOpts.greatestHitsExclude = exclusionSet;
  }

  const scoredPovRaw = selectRelevantNodes(ctx.povNodes, scores, relevanceOpts);

  // Log greatest-hits exclusion (t/1438)
  const ghResult = (scoredPovRaw as ScoredPovNode[] & { _greatestHits?: { excludedCount: number; excludedNodeIds: string[] } })._greatestHits;
  if (ghResult && ghResult.excludedCount > 0) {
    getGlobalRecorder()?.record({
      type: 'turn.taxonomy_inject', component: 'debate-engine', level: 'info',
      message: `Greatest-hits exclusion: ${ghResult.excludedCount} nodes pre-filtered`,
      data: ghResult,
    });
  }

  const constraintFilter = filterByTopicConstraints(scoredPovRaw, engine.session.topic.scope);
  const scoredPov = constraintFilter.nodes;

  if (constraintFilter.demoted.length > 0 || constraintFilter.boosted.length > 0) {
    getGlobalRecorder()?.record({
      type: 'turn.taxonomy_inject', component: 'debate-engine', level: 'info',
      message: `Topic constraint filter: ${constraintFilter.demoted.length} demoted, ${constraintFilter.boosted.length} boosted, ${constraintFilter.restorations.length} restored`,
      data: {
        demoted: constraintFilter.demoted,
        boosted: constraintFilter.boosted,
        restorations: constraintFilter.restorations,
      },
    });
  }

  // Apply policymaker situation relevance boost before selection
  const sitScores = new Map(scores);
  const policyBoostedSitIds: string[] = [];
  if (engine.session.audience === 'policymakers') {
    for (const sit of ctx.situationNodes) {
      const boost = computePolicymakerRelevanceBoost(sit, engine.session.audience);
      if (boost > 0) {
        sitScores.set(sit.id, (sitScores.get(sit.id) ?? 0) + boost);
        policyBoostedSitIds.push(sit.id);
      }
    }
  }

  // Apply exploration summary situation boosts/penalties (Phase 0.9 Step 2)
  if (engine._explorationBoosts.size > 0) {
    for (const [sitId, adjustment] of engine._explorationBoosts) {
      if (sitScores.has(sitId)) {
        sitScores.set(sitId, (sitScores.get(sitId) ?? 0) + adjustment);
      }
    }
  }

  let filteredSit = selectRelevantSituationNodes(ctx.situationNodes, sitScores, { ...relevanceOpts, maxTotal: undefined }, 3, 8);

  // Situation exclusion filter (t/490): skip situations whose exclusion zone matches the round focus
  let situationExclusionSkipped: { node_id: string; similarity_exclusion: number }[] = [];
  if (roundFocusVector) {
    const sitIds = filteredSit.map(s => s.node.id);
    const sitExclResult = filterByExclusionAbsolute(sitIds, roundFocusVector, engine.taxonomy.embeddings as Record<string, { pov: string; vector: number[]; exclusion_vector?: number[] }>);
    if (sitExclResult.skipped.length > 0) {
      const passedSet = new Set(sitExclResult.passed);
      filteredSit = filteredSit.filter(s => passedSet.has(s.node.id));
      situationExclusionSkipped = sitExclResult.skipped;
    }
  }

  const filteredCtx = {
    povNodes: scoredPov.map(s => s.node),
    situationNodes: filteredSit.map(s => s.node),
    policyRegistry: ctx.policyRegistry,
    nodeScores: scores,
  };
  // Cache activated situations for AN claim grounding (t/243)
  engine._activatedSituations = filteredSit.map(s => ({
    id: s.node.id,
    text: `${s.node.label} ${s.node.description}`,
  }));
  engine._lastInjectionManifest = computeInjectionManifest(filteredCtx, pov);
  engine._lastInjectionManifest.scoring_mode = scoringMode;
  engine._lastRelevanceScores = scores;

  // Flight recorder: taxonomy injection details
  getGlobalRecorder()?.record({
    type: 'turn.taxonomy_inject', component: 'debate-engine', level: 'info',
    message: `Taxonomy inject: ${scoredPov.length} POV nodes selected`,
    data: {
      pov_nodes: scoredPov.length,
      avg_relevance: scoredPov.length > 0 ? +(scoredPov.reduce((s, n) => s + n.score, 0) / scoredPov.length).toFixed(3) : 0,
      min_relevance: scoredPov.length > 0 ? +Math.min(...scoredPov.map(n => n.score)).toFixed(3) : 0,
      filtered_out: ctx.povNodes.length - scoredPov.length,
      scoring_mode: scoringMode,
    },
  });
  getGlobalRecorder()?.record({
    type: 'turn.situation_inject', component: 'debate-engine', level: 'info',
    message: `Situation inject: ${filteredSit.length} nodes selected${situationExclusionSkipped.length > 0 ? `, ${situationExclusionSkipped.length} excluded` : ''}`,
    data: {
      injected_ids: filteredSit.map(s => s.node.id),
      count: filteredSit.length,
      primary_count: filteredSit.filter(s => s.score > 0.5).length,
      divergence_adjusted: policyBoostedSitIds.length,
      exclusion_skipped: situationExclusionSkipped.length > 0 ? situationExclusionSkipped : undefined,
    },
  });

  // Log lineage boost diagnostics
  const lbResult = (scoredPov as ScoredPovNode[] & { _lineageBoost?: import('../taxonomyRelevance.js').LineageBoostResult })._lineageBoost;
  if (lbResult && lbResult.boostedNodeIds.length > 0) {
    (engine._lastInjectionManifest as Record<string, unknown>).lineage_boost = {
      boosted: lbResult.boostedNodeIds.length,
      promoted: lbResult.promotedCount,
      boostedNodeIds: lbResult.boostedNodeIds.slice(0, 20),
      promotedNodeIds: lbResult.promotedNodeIds.slice(0, 20),
    };
  }

  // Log scope filter trace for diagnostics UI (10.5)
  if (constraintFilter.demoted.length > 0 || constraintFilter.boosted.length > 0 || constraintFilter.restorations.length > 0) {
    (engine._lastInjectionManifest as Record<string, unknown>).scope_filter_trace = {
      demoted: constraintFilter.demoted,
      boosted: constraintFilter.boosted,
      restorations: constraintFilter.restorations,
    };
  }

  // Log policymaker situation boost diagnostics
  if (policyBoostedSitIds.length > 0) {
    (engine._lastInjectionManifest as Record<string, unknown>).policymaker_situation_boost = {
      boosted: policyBoostedSitIds.length,
      situations: policyBoostedSitIds.slice(0, 20),
    };
  }

  // Log situation exclusion filter diagnostics (t/490)
  if (situationExclusionSkipped.length > 0) {
    (engine._lastInjectionManifest as Record<string, unknown>).situation_exclusion_filter = {
      skipped: situationExclusionSkipped,
      threshold: SCOPE_BOUNDARY_THRESHOLD,
    };
  }

  engine._lastRelevanceScores = scores;

  // Inject comp-linguist per-POV situation register-statements when enabled (t/1450).
  // Graceful-missing: a missing/malformed sidecar yields null and the feature stays off (AC1).
  let situationStatements: import('../taxonomyContext.js').SituationStatements | null = null;
  if (engine.config.enableSituationStatements) {
    try {
      const __dir = path.dirname(fileURLToPath(import.meta.url));
      const repoRoot = resolveRepoRoot(__dir);
      const dataRoot = resolveDataRoot(repoRoot);
      situationStatements = loadSituationStatements(dataRoot);
    } catch (err) {
      getGlobalRecorder()?.record({ type: 'system.error', component: 'debate-engine', level: 'warn', debate_id: engine.session?.id, message: 'Situation statements sidecar load failed — proceeding without', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
    }
  }

  return formatTaxonomyContext(filteredCtx, pov, undefined, situationStatements ? { situationStatements } : undefined);
}

export function formatDebaterEdgeContext(engine: DebateEngineInternals, debaterPov: string): { text: string; edges_used: { source: string; target: string; type: string; confidence: number }[] } {
  if (!engine.taxonomy.edges?.edges) return { text: '', edges_used: [] };

  const povPrefixes: Record<string, string> = {
    accelerationist: 'acc-', safetyist: 'saf-', skeptic: 'skp-',
  };
  const myPrefix = povPrefixes[debaterPov];
  if (!myPrefix) return { text: '', edges_used: [] };

  const otherPrefixes = Object.entries(povPrefixes)
    .filter(([pov]) => pov !== debaterPov)
    .map(([, prefix]) => prefix);

  const signalTypes = new Set(['CONTRADICTS', 'TENSION_WITH', 'WEAKENS']);

  const relevantEdges = engine.taxonomy.edges.edges.filter(e => {
    if (!signalTypes.has(e.type)) return false;
    if (e.status !== 'approved' && e.confidence < 0.75) return false;
    const srcIsMine = e.source.startsWith(myPrefix);
    const tgtIsMine = e.target.startsWith(myPrefix);
    const srcIsOther = otherPrefixes.some(p => e.source.startsWith(p));
    const tgtIsOther = otherPrefixes.some(p => e.target.startsWith(p));
    return (srcIsMine && tgtIsOther) || (tgtIsMine && srcIsOther);
  });

  if (relevantEdges.length === 0) return { text: '', edges_used: [] };

  const top = relevantEdges.sort((a, b) => b.confidence - a.confidence).slice(0, 15);
  const lines = [
    '',
    '=== KNOWN TENSIONS WITH OPPOSING POSITIONS ===',
    'These are documented structural disagreements between your position and other perspectives.',
    'Use these to target your arguments at real fault lines rather than talking past opponents.',
  ];
  for (const e of top) {
    lines.push(`${e.source} ${e.type} ${e.target}`);
    if (e.rationale) lines.push(`  ${e.rationale.slice(0, 150)}`);
  }
  const edges_used = top.map(e => ({ source: e.source, target: e.target, type: e.type, confidence: e.confidence }));
  return { text: lines.join('\n'), edges_used };
}

export function formatModeratorEdgeContext(engine: DebateEngineInternals): { text: string; edges_used: { source: string; target: string; type: string; confidence: number }[] } {
  if (!engine.taxonomy.edges?.edges) return { text: '', edges_used: [] };

  const povPrefixes: Record<string, string> = {
    accelerationist: 'acc-', safetyist: 'saf-', skeptic: 'skp-',
  };
  const signalTypes = new Set(['CONTRADICTS', 'TENSION_WITH', 'WEAKENS', 'RESPONDS_TO']);
  const activePovs = engine.config.activePovers.map(p => POVER_INFO[p].pov);
  const activePrefixes = activePovs.map(p => povPrefixes[p]).filter(Boolean);

  const relevantEdges = engine.taxonomy.edges.edges.filter(e => {
    if (!signalTypes.has(e.type)) return false;
    if (e.status !== 'approved' && e.confidence < 0.75) return false;
    const srcPrefix = activePrefixes.find(p => e.source.startsWith(p));
    const tgtPrefix = activePrefixes.find(p => e.target.startsWith(p));
    return srcPrefix && tgtPrefix && srcPrefix !== tgtPrefix;
  });

  if (relevantEdges.length === 0) return { text: '', edges_used: [] };

  const top = relevantEdges.sort((a, b) => b.confidence - a.confidence).slice(0, 15);
  const lines = ['', '=== KNOWN TENSIONS BETWEEN POSITIONS ==='];
  for (const e of top) {
    lines.push(`${e.source} ${e.type} ${e.target} (confidence: ${e.confidence.toFixed(2)})`);
  }
  const edges_used = top.map(e => ({ source: e.source, target: e.target, type: e.type, confidence: e.confidence }));
  return { text: lines.join('\n'), edges_used };
}
