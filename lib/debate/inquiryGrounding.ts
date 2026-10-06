// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Grounding envelope builder for the inquiry pipeline (t/3577).
// Anchors an inquiry to the most relevant situation node and attaches the top-N
// POV nodes per camp by embedding similarity.

import type { GroundingEnvelope, NodeRef, Camp, AppliedTag, TagSelection } from '../inquiry/index.js';
import type { PovNode, SituationNode } from './taxonomyTypes.js';
import type { NodeEmbeddingMap } from './relevanceSelection.js';
import { applyTagSelection } from './relevanceSelection.js';
import { TAG_BOOST_INCREMENT } from './debateConfig.js';
import { cosineSimilarity } from '../embeddings/similarity.js';
import { getGlobalRecorder } from '../flight-recorder/index.js';

function warn(message: string): void {
  getGlobalRecorder()?.record({ type: 'system.error', component: 'inquiryGrounding', level: 'warn', message });
}

export interface GroundingTaxonomy {
  povNodes: PovNode[];
  situationNodes: SituationNode[];
  nodeEmbeddings: NodeEmbeddingMap;
}

export interface GroundingOptions {
  /** Pin a specific situation as the anchor instead of deriving one by embedding. */
  situationId?: string;
  /** Maximum POV nodes to include per camp. Default: 3. */
  topNodesPerCamp?: number;
  /** Optional POV-scoped tag selection (t/3965). Filter/boost applies ONLY to the named POV's camp. */
  tagSelection?: TagSelection;
}

const VALID_CAMPS = new Set<string>(['acc', 'saf', 'skp', 'cc']);
const DEFAULT_TOP_PER_CAMP = 3;

function isCamp(value: string): value is Camp {
  return VALID_CAMPS.has(value);
}

/**
 * Build a GroundingEnvelope for an inquiry question.
 *
 * 1. Embeds the question (and situation descriptions if no situationId is pinned).
 * 2. Selects the anchor situation by cosine similarity (or uses the pinned id).
 * 3. Scores every POV node with a precomputed embedding against the question vector.
 * 4. Returns the top-N nodes per camp as NodeRef arrays.
 *
 * ADR-001: returns an empty-but-valid envelope on zero-hit / empty-corpus inputs.
 * Each fallback path logs a WARN via the flight recorder.
 */
export async function buildGroundingEnvelope(
  question: string,
  taxonomy: GroundingTaxonomy,
  embed: (texts: string[]) => Promise<number[][]>,
  opts: GroundingOptions = {},
): Promise<{ envelope: GroundingEnvelope; appliedTag?: AppliedTag }> {
  const topN = opts.topNodesPerCamp ?? DEFAULT_TOP_PER_CAMP;

  if (taxonomy.povNodes.length === 0) {
    warn('buildGroundingEnvelope: empty povNodes corpus — returning empty envelope');
    return { envelope: { nodesByCamp: {} } };
  }

  // ── Embed question ────────────────────────────────────────────────────────
  let questionVectors: number[][];
  try {
    questionVectors = await embed([question]);
  } catch (err) {
    warn(`buildGroundingEnvelope: embed call failed (${String(err)}) — returning empty envelope`);
    return { envelope: { nodesByCamp: {} } };
  }

  const questionVec = questionVectors[0];
  if (!questionVec || questionVec.length === 0) {
    warn('buildGroundingEnvelope: embed returned empty vector for question — returning empty envelope');
    return { envelope: { nodesByCamp: {} } };
  }

  // ── Anchor situation ──────────────────────────────────────────────────────
  let anchorSituationId: string | undefined;
  let anchorSummary: string | undefined;

  if (opts.situationId !== undefined) {
    const pinned = taxonomy.situationNodes.find(s => s.id === opts.situationId);
    if (pinned) {
      anchorSituationId = pinned.id;
      anchorSummary = pinned.description;
    } else {
      warn(`buildGroundingEnvelope: pinned situationId '${opts.situationId}' not found — deriving anchor from embeddings`);
    }
  }

  if (anchorSituationId === undefined && taxonomy.situationNodes.length > 0) {
    // Embed all situation descriptions in one call alongside the question.
    const situationTexts = taxonomy.situationNodes.map(s => s.description || s.label);
    let situationVectors: number[][];
    try {
      situationVectors = await embed(situationTexts);
    } catch (err) {
      warn(`buildGroundingEnvelope: situation embed failed (${String(err)}) — anchor omitted`);
      situationVectors = [];
    }

    let bestScore = -Infinity;
    for (let i = 0; i < taxonomy.situationNodes.length; i++) {
      const vec = situationVectors[i];
      if (!vec || vec.length === 0) continue;
      const score = cosineSimilarity(questionVec, vec);
      if (score > bestScore) {
        bestScore = score;
        anchorSituationId = taxonomy.situationNodes[i].id;
        anchorSummary = taxonomy.situationNodes[i].description || taxonomy.situationNodes[i].label;
      }
    }
  } else if (taxonomy.situationNodes.length === 0) {
    warn('buildGroundingEnvelope: no situationNodes in corpus — anchor omitted');
  }

  // ── Score POV nodes by camp ────────────────────────────────────────────────
  const nodeById = new Map(taxonomy.povNodes.map(n => [n.id, n]));
  const byCamp = new Map<Camp, { score: number; node: PovNode }[]>();

  for (const [nodeId, embedding] of Object.entries(taxonomy.nodeEmbeddings)) {
    if (!isCamp(embedding.pov)) continue;
    const node = nodeById.get(nodeId);
    if (!node) continue;

    const vec = embedding.vector;
    if (!vec || vec.length === 0) continue;

    const score = cosineSimilarity(questionVec, vec);
    const camp = embedding.pov as Camp;
    if (!byCamp.has(camp)) byCamp.set(camp, []);
    byCamp.get(camp)!.push({ score, node });
  }

  const nodesByCamp: Partial<Record<Camp, NodeRef[]>> = {};

  // POV-to-camp mapping for tag scoping (t/3965). Tag applies ONLY inside the named camp's loop.
  const POV_TO_CAMP: Record<string, Camp> = { accelerationist: 'acc', safetyist: 'saf', skeptic: 'skp' };
  const tagCamp = opts.tagSelection ? POV_TO_CAMP[opts.tagSelection.pov] : undefined;
  let appliedTag: AppliedTag | undefined;

  for (const [camp, scored] of byCamp.entries()) {
    let activeScoredEntries = scored;

    if (opts.tagSelection && camp === tagCamp) {
      const sel = opts.tagSelection;
      const { filteredNodes, excludedCount, boostIds } = applyTagSelection(
        scored.map(s => s.node),
        { tag: sel.tag, mode: sel.mode },
      );

      if (sel.mode === 'scope') {
        const filteredIds = new Set(filteredNodes.map(n => n.id));
        activeScoredEntries = scored.filter(s => filteredIds.has(s.node.id));
        if (excludedCount > 0) {
          warn(`buildGroundingEnvelope: scope tag '${sel.tag}' on '${sel.pov}' excluded ${excludedCount} untagged nodes from grounding`);
        }
        appliedTag = { pov: sel.pov, tag: sel.tag, mode: sel.mode, included: filteredNodes.length, excludedUntagged: excludedCount };
      } else {
        // Prioritize: boost tagged nodes' scores before sort so they rank higher
        const boostSet = new Set(boostIds);
        activeScoredEntries = scored.map(s =>
          boostSet.has(s.node.id) ? { ...s, score: s.score + TAG_BOOST_INCREMENT } : s,
        );
        appliedTag = { pov: sel.pov, tag: sel.tag, mode: sel.mode, included: boostIds.length, excludedUntagged: 0 };
      }
    }

    activeScoredEntries.sort((a, b) => b.score - a.score);
    nodesByCamp[camp] = activeScoredEntries.slice(0, topN).map(({ node }) => ({
      nodeId: node.id,
      label: node.label,
      camp,
    }));
  }

  // ADR-001: warn when a camp returns zero nodes (embedding corpus gap)
  for (const camp of ['acc', 'saf', 'skp', 'cc'] as Camp[]) {
    const refs = nodesByCamp[camp];
    if (!refs || refs.length === 0) {
      warn(`buildGroundingEnvelope: zero nodes selected for camp '${camp}' — embedding corpus may be incomplete`);
    }
  }

  const envelope: GroundingEnvelope = { nodesByCamp };
  if (anchorSituationId !== undefined) envelope.anchorSituationId = anchorSituationId;
  if (anchorSummary !== undefined) envelope.anchorSummary = anchorSummary;

  return { envelope, appliedTag };
}
