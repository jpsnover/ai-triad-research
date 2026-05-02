// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * QBAF multi-agent combinator — merges semantically similar claims
 * across POVs using cosine similarity + NLI validation gate.
 *
 * Per Risk Assessor (e/15#9, e/16#5):
 * - Cosine > threshold AND NLI entailment → merge
 * - NLI contradiction → flag as QBAF attack edge
 * - NLI neutral → keep as separate claims
 * - Merge audit log for every attempt
 */

import { cosineSimilarity } from './taxonomyRelevance.js';
import type { QbafNode, QbafEdge } from './qbaf.js';

// ── Types ─────────────────────────────────────────────────

export type NliResult = 'entailment' | 'contradiction' | 'neutral';

/** Callback for NLI classification — callers provide the implementation (IPC, subprocess, etc.) */
export type NliClassifier = (textA: string, textB: string) => Promise<NliResult>;

export interface ClaimInput {
  id: string;
  text: string;
  speaker: string;
  pov: string;
  base_strength: number;
  vector?: number[];
}

export interface MergeAuditEntry {
  claimA: string;
  claimB: string;
  textA: string;
  textB: string;
  cosineSimilarity: number;
  nliResult: NliResult;
  action: 'merged' | 'attack_edge' | 'kept_separate';
}

export interface CombinatorResult {
  nodes: QbafNode[];
  edges: QbafEdge[];
  mergeMap: Map<string, string>; // merged claim ID → canonical claim ID
  auditLog: MergeAuditEntry[];
}

export interface CombinatorOptions {
  /** Cosine similarity threshold for merge candidates. Default: 0.9. */
  cosineThreshold?: number;
  /** Weight for auto-discovered attack edges from NLI contradiction. Default: 0.7. */
  contradictionWeight?: number;
  /** If true, skip NLI and use cosine-only (NOT recommended for production). */
  skipNli?: boolean;
}

// ── Combinator ────────────────────────────────────────────

/**
 * Merge semantically similar claims across POVs into a unified QBAF graph.
 * Dual gate: cosine similarity + NLI entailment confirmation.
 */
export async function combineClaims(
  claims: ClaimInput[],
  classifyNli: NliClassifier,
  options?: CombinatorOptions,
): Promise<CombinatorResult> {
  const threshold = options?.cosineThreshold ?? 0.9;
  const contradictionWeight = options?.contradictionWeight ?? 0.7;
  const skipNli = options?.skipNli ?? false;

  const auditLog: MergeAuditEntry[] = [];
  const mergeMap = new Map<string, string>(); // merged → canonical
  const attackEdges: QbafEdge[] = [];

  // Find merge candidates: cross-POV pairs above cosine threshold
  for (let i = 0; i < claims.length; i++) {
    for (let j = i + 1; j < claims.length; j++) {
      const a = claims[i];
      const b = claims[j];

      // Only merge cross-POV claims
      if (a.pov === b.pov) continue;

      // Skip if either already merged
      if (mergeMap.has(a.id) || mergeMap.has(b.id)) continue;

      // Skip if no vectors
      if (!a.vector || !b.vector) continue;

      const cosine = cosineSimilarity(a.vector, b.vector);
      if (cosine < threshold) continue;

      // Cosine threshold passed — apply NLI gate
      let nliResult: NliResult = 'entailment';
      if (!skipNli) {
        nliResult = await classifyNli(a.text, b.text);
      }

      if (nliResult === 'entailment') {
        // Merge: b → a (a is canonical, higher base_strength wins)
        const [canonical, merged] = a.base_strength >= b.base_strength ? [a, b] : [b, a];
        mergeMap.set(merged.id, canonical.id);
        // Boost canonical strength (supported from another POV)
        canonical.base_strength = Math.min(1.0, (canonical.base_strength + merged.base_strength) / 2 + 0.05);
        auditLog.push({ claimA: a.id, claimB: b.id, textA: a.text, textB: b.text, cosineSimilarity: cosine, nliResult, action: 'merged' });
      } else if (nliResult === 'contradiction') {
        // Contradiction → attack edge between the two claims
        attackEdges.push({
          source: a.id,
          target: b.id,
          type: 'attacks',
          weight: contradictionWeight,
          attack_type: 'rebut',
        });
        auditLog.push({ claimA: a.id, claimB: b.id, textA: a.text, textB: b.text, cosineSimilarity: cosine, nliResult, action: 'attack_edge' });
      } else {
        // Neutral — keep separate
        auditLog.push({ claimA: a.id, claimB: b.id, textA: a.text, textB: b.text, cosineSimilarity: cosine, nliResult, action: 'kept_separate' });
      }
    }
  }

  // Build nodes: exclude merged claims
  const nodes: QbafNode[] = claims
    .filter(c => !mergeMap.has(c.id))
    .map(c => ({ id: c.id, base_strength: c.base_strength }));

  // Build edges: remap any edges targeting merged claims to their canonical
  const edges: QbafEdge[] = attackEdges.map(e => ({
    ...e,
    source: mergeMap.get(e.source) ?? e.source,
    target: mergeMap.get(e.target) ?? e.target,
  }));

  return { nodes, edges, mergeMap, auditLog };
}
