// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Multi-signal confidence formula for Belief nodes.
 * Computes initial confidence scores using epistemic_type, falsifiability,
 * source document count, debate refs, and taxonomy edge balance.
 *
 * See docs/weighted-bdi-proposal.md §"Initial Assignment" for formula spec.
 */

import type { PovNode, WeightHistoryEntry } from './taxonomyTypes.js';
import type { Edge } from './taxonomyTypes.js';

// ── Signal computation ──────────────────────────────────

export interface ConfidenceSignals {
  /** epistemic_type from graph_attributes */
  epistemic_type?: string;
  /** falsifiability from graph_attributes */
  falsifiability?: string;
  /** Number of unique source documents in evidence index */
  source_doc_count: number;
  /** Number of debates referencing this node (debate_refs.length) */
  debate_ref_count: number;
  /** Number of SUPPORTS edges targeting this node */
  supports_received: number;
  /** Number of CONTRADICTS/WEAKENS edges targeting this node */
  attacks_received: number;
}

/**
 * Compute the base confidence from epistemic_type + falsifiability.
 */
export function computeBase(epistemicType?: string, falsifiability?: string): number {
  switch (epistemicType) {
    case 'empirical_claim':
      switch (falsifiability) {
        case 'high': return 0.80;
        case 'medium': return 0.70;
        case 'low': return 0.60;
        default: return 0.70; // missing falsifiability → treat as medium
      }
    case 'predictive': return 0.40;
    case 'interpretive_lens': return 0.50;
    case 'definitional': return 0.50;
    default: return 0.50; // unknown or missing epistemic_type
  }
}

/**
 * Compute evidence boost: +0.05 per unique source doc, capped at +0.15.
 */
export function computeEvidenceBoost(sourceDocCount: number): number {
  return Math.min(0.15, sourceDocCount * 0.05);
}

/**
 * Compute debate boost: +0.03 per debate ref, capped at +0.10.
 */
export function computeDebateBoost(debateRefCount: number): number {
  return Math.min(0.10, debateRefCount * 0.03);
}

/**
 * Compute edge boost: net effect of supports vs attacks.
 * Range: -0.05 (heavily attacked) to +0.05 (heavily supported).
 */
export function computeEdgeBoost(supportsReceived: number, attacksReceived: number): number {
  return Math.min(0.05, supportsReceived * 0.02) - Math.min(0.05, attacksReceived * 0.02);
}

/**
 * Compute the full multi-signal confidence score.
 * Returns clamped value in [0.10, 0.95].
 */
export function computeBeliefConfidence(signals: ConfidenceSignals): number {
  const base = computeBase(signals.epistemic_type, signals.falsifiability);
  const evidenceBoost = computeEvidenceBoost(signals.source_doc_count);
  const debateBoost = computeDebateBoost(signals.debate_ref_count);
  const edgeBoost = computeEdgeBoost(signals.supports_received, signals.attacks_received);

  const raw = base + evidenceBoost + debateBoost + edgeBoost;
  return Math.round(Math.max(0.10, Math.min(0.95, raw)) * 100) / 100;
}

// ── Edge counting helpers ───────────────────────────────

const ATTACK_EDGE_TYPES = new Set(['CONTRADICTS', 'WEAKENS']);
const SUPPORT_EDGE_TYPES = new Set(['SUPPORTS']);

/**
 * Count supports and attacks received by each node from taxonomy edges.
 * Returns maps from node ID → count.
 */
export function countEdgesByTarget(edges: Edge[]): {
  supports: Map<string, number>;
  attacks: Map<string, number>;
} {
  const supports = new Map<string, number>();
  const attacks = new Map<string, number>();

  for (const edge of edges) {
    if (edge.status === 'rejected') continue;

    if (SUPPORT_EDGE_TYPES.has(edge.type)) {
      supports.set(edge.target, (supports.get(edge.target) ?? 0) + 1);
      if (edge.bidirectional) {
        supports.set(edge.source, (supports.get(edge.source) ?? 0) + 1);
      }
    } else if (ATTACK_EDGE_TYPES.has(edge.type)) {
      attacks.set(edge.target, (attacks.get(edge.target) ?? 0) + 1);
      if (edge.bidirectional) {
        attacks.set(edge.source, (attacks.get(edge.source) ?? 0) + 1);
      }
    }
  }

  return { supports, attacks };
}

// ── Batch assignment ────────────────────────────────────

export interface BeliefConfidenceInput {
  node: PovNode;
  sourceDocCount: number;
}

export interface BeliefConfidenceResult {
  nodeId: string;
  confidence: number;
  signals: ConfidenceSignals;
}

/**
 * Compute confidence for a batch of Belief nodes.
 * Filters to Beliefs only. Returns results + the date-stamped history entry.
 */
export function assignBeliefConfidences(
  inputs: BeliefConfidenceInput[],
  edges: Edge[],
  date: string,
): BeliefConfidenceResult[] {
  const { supports, attacks } = countEdgesByTarget(edges);
  const results: BeliefConfidenceResult[] = [];

  for (const { node, sourceDocCount } of inputs) {
    if (node.category !== 'Beliefs') continue;

    const signals: ConfidenceSignals = {
      epistemic_type: node.graph_attributes?.epistemic_type,
      falsifiability: node.graph_attributes?.falsifiability,
      source_doc_count: sourceDocCount,
      debate_ref_count: node.debate_refs?.length ?? 0,
      supports_received: supports.get(node.id) ?? 0,
      attacks_received: attacks.get(node.id) ?? 0,
    };

    const confidence = computeBeliefConfidence(signals);

    // Apply to node
    node.confidence = confidence;
    const historyEntry: WeightHistoryEntry = {
      date,
      value: confidence,
      delta: 0,
      reason: 'Initial multi-signal assignment',
    };
    node.confidence_history = [historyEntry];

    results.push({ nodeId: node.id, confidence, signals });
  }

  return results;
}
