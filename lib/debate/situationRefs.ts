// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Post-debate extraction of situation references (t/193).
 *
 * After a debate closes, identifies which situations were substantively
 * discussed — via explicit sit- ID citations and semantic matching of
 * turn content against situation descriptions/BDI interpretations.
 *
 * Returns DebateRef entries that can be written back to situation nodes,
 * closing the feedback loop between debates and the taxonomy.
 */

import type { SituationNode } from './taxonomyTypes.js';
import { interpretationText } from './taxonomyTypes.js';
import type { TranscriptEntry } from './types.js';

// ── Types ─────────────────────────────────────────────────

/** A reference from a situation node back to a debate that substantively discussed it. */
export interface SituationDebateRef {
  /** Debate session ID. */
  debate_id: string;
  /** Transcript entry IDs (turn IDs) where this situation was engaged. */
  turns: string[];
  /** How the situation was matched. */
  match_type: 'explicit_citation' | 'semantic_match' | 'both';
  /** Peak semantic similarity score (0-1). 0 for explicit-only citations. */
  relevance_score: number;
}

/** Result of the extraction pass — maps situation IDs to their debate refs. */
export interface SituationRefExtractionResult {
  /** Per-situation debate references. */
  refs: Map<string, SituationDebateRef>;
  /** Summary statistics. */
  stats: {
    situations_checked: number;
    situations_matched: number;
    explicit_citations: number;
    semantic_matches: number;
    both: number;
  };
}

// ── Extraction engine ─────────────────────────────────────

/**
 * Extract situation debate_refs from a completed debate transcript.
 *
 * Two-pass matching:
 * 1. **Explicit**: any turn with a sit-* ID in taxonomy_refs
 * 2. **Semantic**: word-overlap Jaccard similarity between turn content
 *    and each situation's label + description + interpretations
 *
 * @param debateId - The debate session ID
 * @param transcript - Full debate transcript
 * @param situationNodes - All situation nodes from the taxonomy
 * @param semanticThreshold - Minimum Jaccard similarity for semantic match (default 0.15)
 * @returns Extraction result with per-situation refs and stats
 */
export function extractSituationDebateRefs(
  debateId: string,
  transcript: TranscriptEntry[],
  situationNodes: SituationNode[],
  semanticThreshold: number = 0.15,
): SituationRefExtractionResult {
  if (situationNodes.length === 0 || transcript.length === 0) {
    return {
      refs: new Map(),
      stats: { situations_checked: situationNodes.length, situations_matched: 0, explicit_citations: 0, semantic_matches: 0, both: 0 },
    };
  }

  // Only consider debate turns (opening + statement), not system/moderator entries
  const debateTurns = transcript.filter(e => e.type === 'opening' || e.type === 'statement');

  // Pass 1: Explicit citations — collect which turns cite which sit- IDs
  const explicitMap = new Map<string, Set<string>>(); // sit-id → set of entry IDs
  for (const entry of debateTurns) {
    for (const ref of entry.taxonomy_refs) {
      if (ref.node_id.startsWith('sit-')) {
        if (!explicitMap.has(ref.node_id)) explicitMap.set(ref.node_id, new Set());
        explicitMap.get(ref.node_id)!.add(entry.id);
      }
    }
  }

  // Pre-tokenize situation nodes for semantic matching
  const sitTokenSets = situationNodes.map(sit => ({
    id: sit.id,
    tokens: tokenize(buildSituationText(sit)),
  }));

  // Pre-tokenize debate turns
  const turnTokenSets = debateTurns.map(entry => ({
    id: entry.id,
    tokens: tokenize(entry.content),
  }));

  // Pass 2: Semantic matching — Jaccard similarity between each turn and situation
  const semanticMap = new Map<string, { turns: Set<string>; bestScore: number }>();
  for (const sit of sitTokenSets) {
    let bestScore = 0;
    const matchedTurns = new Set<string>();

    for (const turn of turnTokenSets) {
      const score = jaccardSimilarity(turn.tokens, sit.tokens);
      if (score >= semanticThreshold) {
        matchedTurns.add(turn.id);
        if (score > bestScore) bestScore = score;
      }
    }

    if (matchedTurns.size > 0) {
      semanticMap.set(sit.id, { turns: matchedTurns, bestScore });
    }
  }

  // Merge explicit + semantic into final refs
  const allSitIds = new Set([...explicitMap.keys(), ...semanticMap.keys()]);
  const refs = new Map<string, SituationDebateRef>();
  let explicitCount = 0;
  let semanticCount = 0;
  let bothCount = 0;

  for (const sitId of allSitIds) {
    const hasExplicit = explicitMap.has(sitId);
    const hasSemantic = semanticMap.has(sitId);

    const turns = new Set<string>();
    if (hasExplicit) for (const t of explicitMap.get(sitId)!) turns.add(t);
    if (hasSemantic) for (const t of semanticMap.get(sitId)!.turns) turns.add(t);

    const matchType = hasExplicit && hasSemantic
      ? 'both'
      : hasExplicit
        ? 'explicit_citation'
        : 'semantic_match';

    if (matchType === 'both') bothCount++;
    else if (matchType === 'explicit_citation') explicitCount++;
    else semanticCount++;

    refs.set(sitId, {
      debate_id: debateId,
      turns: [...turns].sort(),
      match_type: matchType,
      relevance_score: semanticMap.get(sitId)?.bestScore ?? 0,
    });
  }

  return {
    refs,
    stats: {
      situations_checked: situationNodes.length,
      situations_matched: refs.size,
      explicit_citations: explicitCount,
      semantic_matches: semanticCount,
      both: bothCount,
    },
  };
}

// ── Helpers ───────────────────────────────────────────────

/** Build a text representation of a situation node for tokenization. */
function buildSituationText(sit: SituationNode): string {
  const parts = [sit.label, sit.description];
  if (sit.interpretations) {
    for (const key of ['accelerationist', 'safetyist', 'skeptic'] as const) {
      const text = interpretationText(sit.interpretations[key]);
      if (text) parts.push(text);
    }
  }
  return parts.join(' ');
}

function tokenize(text: string): Set<string> {
  return new Set(
    text.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(w => w.length > 2),
  );
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const w of a) if (b.has(w)) intersection++;
  const union = a.size + b.size - intersection;
  return union > 0 ? intersection / union : 0;
}
