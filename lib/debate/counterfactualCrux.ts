// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Counterfactual crux identification via CE-QArg-style argument removal analysis.
 *
 * For each claim in the argument network, systematically tests which argument
 * removals would flip the claim's computed strength across the 0.5 threshold.
 * Arguments whose removal changes the outcome (thrived/survived/died) are the
 * "crux arguments" — they are game-theoretically decisive to the debate outcome.
 *
 * Based on: CE-QArg counterfactual explanations (arXiv:2407.08497).
 * Reference: t/29 — "Counterfactual crux identification via CE-QArg-style argument removal analysis"
 */

import { computeQbafStrengths } from './qbaf.js';
import type { QbafNode, QbafEdge, QbafOptions } from './qbaf.js';
import type { ArgumentNetworkNode, ArgumentNetworkEdge } from './types.js';
import { ActionableError } from './errors.js';

// ── Types ─────────────────────────────────────────────────

/**
 * Outcome category for a claim, matching the classifyOutcome() thresholds
 * from claimOutcomes.ts.
 */
export type ClaimOutcomeCategory = 'thrived' | 'survived' | 'died';

/**
 * Counterfactual reasoning type (RATIO 2024, LNAI 14638 pp. 277–285).
 * - interventional: Pearl do-calculus — "If X *were* forced, what would happen?"
 * - backtracking: Lewis — "If X *had been* different, what would the history look like?"
 * - normative: Value/rule change — "If we *adopted* principle P, what follows?"
 * - none: The crux is not counterfactual (direct empirical or definitional question).
 */
export type CounterfactualType = 'interventional' | 'backtracking' | 'normative' | 'none';

/**
 * A single counterfactual crux: removing `flipping_argument` from the QBAF
 * graph causes `claim` to flip between two outcome categories.
 */
export interface CounterfactualCrux {
  /** The AN node whose outcome is being predicted. */
  claim_id: string;
  /** Text of the claim, for human-readable reporting. */
  claim_text: string;
  /** The AN node whose removal flips the claim's outcome. */
  flipping_argument_id: string;
  /** Text of the flipping argument, for human-readable reporting. */
  flipping_argument_text: string;
  /** Edge type of the relationship: 'attacks' or 'supports'. */
  edge_type: 'attacks' | 'supports';
  /** The outcome if the flipping argument is present (baseline). */
  original_outcome: ClaimOutcomeCategory;
  /** The outcome if the flipping argument is removed. */
  counterfactual_outcome: ClaimOutcomeCategory;
  /** Baseline computed strength of the claim (0–1). */
  original_strength: number;
  /** Counterfactual computed strength without the flipping argument (0–1). */
  counterfactual_strength: number;
  /** Change in strength: counterfactual − original. */
  strength_delta: number;
  /** Counterfactual reasoning type — set by LLM classification, not by the algorithmic analysis. */
  counterfactual_type?: CounterfactualType;
}

/**
 * Result of computeCounterfactualCruxes().
 */
export interface CounterfactualCruxResult {
  /** All discovered counterfactual cruxes, sorted by |strength_delta| descending. */
  cruxes: CounterfactualCrux[];
  /** Total claims analysed. */
  claims_analysed: number;
  /** Total edge removals tested. */
  removals_tested: number;
  /** Number of removals that caused an outcome flip. */
  flips_found: number;
}

// ── Outcome classification ─────────────────────────────────

/**
 * Classify a computed strength value into an outcome category.
 *
 * Uses the same threshold as classifyOutcome() in claimOutcomes.ts but
 * ignores reference count — for counterfactual purposes we care only
 * about QBAF strength, not how often the claim is cited.
 *
 * Thresholds:
 *   - thrived:  strength ≥ 0.5
 *   - survived: strength ≥ 0.3
 *   - died:     strength < 0.3
 */
export function classifyStrengthOutcome(strength: number): ClaimOutcomeCategory {
  if (strength >= 0.5) return 'thrived';
  if (strength >= 0.3) return 'survived';
  return 'died';
}

// ── Network conversion ─────────────────────────────────────

/**
 * Convert ArgumentNetwork nodes/edges into the QbafNode/QbafEdge format
 * expected by computeQbafStrengths().
 *
 * Nodes without a base_strength default to 0.5. Edges without a weight
 * default to 0.5 (moderate influence).
 */
function toQbafNodes(nodes: ReadonlyArray<ArgumentNetworkNode>): QbafNode[] {
  return nodes.map(n => ({
    id: n.id,
    base_strength: n.base_strength ?? 0.5,
  }));
}

function toQbafEdges(edges: ReadonlyArray<ArgumentNetworkEdge>): QbafEdge[] {
  return edges
    .filter(e => e.type === 'supports' || e.type === 'attacks')
    .map(e => ({
      source: e.source,
      target: e.target,
      type: e.type as 'supports' | 'attacks',
      weight: e.weight ?? 0.5,
      attack_type: e.attack_type,
    }));
}

// ── Baseline strength computation ──────────────────────────

/**
 * Compute the baseline QBAF strengths for the full argument network.
 * Returns a Map from node ID to computed strength.
 */
function computeBaseline(
  qbafNodes: QbafNode[],
  qbafEdges: QbafEdge[],
  options?: QbafOptions,
): Map<string, number> {
  const result = computeQbafStrengths(qbafNodes, qbafEdges, options);
  return result.strengths;
}

// ── Main algorithm ─────────────────────────────────────────

/**
 * Compute counterfactual cruxes for all debate claims in the argument network.
 *
 * Algorithm (CE-QArg-style):
 * For each claim C in the network:
 *   1. Record C's baseline computed_strength (from full QBAF).
 *   2. Classify the baseline outcome: thrived / survived / died.
 *   3. For each edge E that directly touches C (E.source or E.target === C.id):
 *      a. Remove E from the edge set.
 *      b. Re-run QBAF propagation on the reduced network.
 *      c. Record the counterfactual strength and outcome.
 *      d. If outcome changed → record as a CounterfactualCrux.
 *   4. Collect all cruxes, sort by |strength_delta| descending.
 *
 * Performance: O(N × E_per_node × QBAF_iterations). For a 100-node network
 * with ~2 edges per node and 30 QBAF iterations, this is ~6 000 operations —
 * well within 1 s.
 *
 * @param nodes - ArgumentNetworkNode array (excludes system/document nodes if desired).
 * @param edges - ArgumentNetworkEdge array.
 * @param options - Optional QBAF computation options (max iterations, convergence threshold, etc.)
 * @returns CounterfactualCruxResult with all discovered cruxes.
 * @throws ActionableError if the network is malformed (e.g., edge references unknown node).
 */
export function computeCounterfactualCruxes(
  nodes: ReadonlyArray<ArgumentNetworkNode>,
  edges: ReadonlyArray<ArgumentNetworkEdge>,
  options?: QbafOptions,
): CounterfactualCruxResult {
  if (nodes.length === 0) {
    return { cruxes: [], claims_analysed: 0, removals_tested: 0, flips_found: 0 };
  }

  // Build lookup maps for fast access
  const nodeById = new Map<string, ArgumentNetworkNode>();
  for (const n of nodes) {
    nodeById.set(n.id, n);
  }

  // Validate: all edge endpoints must reference known nodes
  for (const e of edges) {
    if (!nodeById.has(e.source) || !nodeById.has(e.target)) {
      throw new ActionableError({
        goal: 'Compute counterfactual cruxes for the argument network',
        problem: `Edge ${e.id} references unknown node(s): source="${e.source}", target="${e.target}"`,
        location: 'counterfactualCrux.ts › computeCounterfactualCruxes()',
        nextSteps: [
          'Ensure the edges array is derived from the same nodes array.',
          'Run networkGc to prune dangling edges before calling this function.',
          'Check that argument network extraction did not produce orphan edges.',
        ],
      });
    }
  }

  const qbafNodes = toQbafNodes(nodes);
  const qbafEdges = toQbafEdges(edges);

  // Compute baseline strengths (full network)
  const baseline = computeBaseline(qbafNodes, qbafEdges, options);

  // Build an index of edges touching each node (by source or target)
  const edgesTouchingNode = new Map<string, QbafEdge[]>();
  for (const n of qbafNodes) {
    edgesTouchingNode.set(n.id, []);
  }
  for (const e of qbafEdges) {
    edgesTouchingNode.get(e.source)?.push(e);
    // Avoid double-adding when source === target (degenerate self-loop)
    if (e.source !== e.target) {
      edgesTouchingNode.get(e.target)?.push(e);
    }
  }

  const cruxes: CounterfactualCrux[] = [];
  let removals_tested = 0;
  let flips_found = 0;

  // Analyse each claim node
  for (const node of nodes) {
    const baselineStrength = baseline.get(node.id) ?? (node.base_strength ?? 0.5);
    const baselineOutcome = classifyStrengthOutcome(baselineStrength);

    const touchingEdges = edgesTouchingNode.get(node.id) ?? [];

    for (const edge of touchingEdges) {
      removals_tested++;

      // Build reduced edge set by excluding this edge
      const reducedEdges = qbafEdges.filter(e => e !== edge);

      // Re-run QBAF on reduced network
      const cfResult = computeQbafStrengths(qbafNodes, reducedEdges, options);
      const cfStrength = cfResult.strengths.get(node.id) ?? (node.base_strength ?? 0.5);
      const cfOutcome = classifyStrengthOutcome(cfStrength);

      if (cfOutcome !== baselineOutcome) {
        flips_found++;

        // Determine which endpoint is the "flipping argument" (not the claim itself)
        const flippingId = edge.source === node.id ? edge.target : edge.source;
        const flippingNode = nodeById.get(flippingId);

        cruxes.push({
          claim_id: node.id,
          claim_text: node.text,
          flipping_argument_id: flippingId,
          flipping_argument_text: flippingNode?.text ?? flippingId,
          edge_type: edge.type,
          original_outcome: baselineOutcome,
          counterfactual_outcome: cfOutcome,
          original_strength: baselineStrength,
          counterfactual_strength: cfStrength,
          strength_delta: cfStrength - baselineStrength,
        });
      }
    }
  }

  // Sort by absolute strength delta descending — largest impact first
  cruxes.sort((a, b) => Math.abs(b.strength_delta) - Math.abs(a.strength_delta));

  return {
    cruxes,
    claims_analysed: nodes.length,
    removals_tested,
    flips_found,
  };
}

// ── Synthesis reporting ────────────────────────────────────

/**
 * Format counterfactual cruxes as natural-language sentences for injection
 * into the concluding-phase moderator prompt or news report.
 *
 * Each sentence follows the CE-QArg template:
 *   "If [argument X] were removed, [claim Y] would flip from [outcome A] to [outcome B]."
 *
 * @param result - Output of computeCounterfactualCruxes().
 * @param maxCruxes - Maximum number of cruxes to include (default: 5).
 * @returns Formatted multi-line string, or empty string if no cruxes found.
 */
export function formatCounterfactualCruxReport(
  result: CounterfactualCruxResult,
  maxCruxes = 5,
): string {
  if (result.cruxes.length === 0) return '';

  const top = result.cruxes.slice(0, maxCruxes);
  const lines = [
    '',
    '=== COUNTERFACTUAL CRUX ANALYSIS ===',
    'Key arguments whose removal would flip a claim\'s debate outcome:',
  ];

  for (const crux of top) {
    const direction = crux.strength_delta > 0 ? 'strengthened' : 'weakened';
    const claimSnippet = truncateText(crux.claim_text, 80);
    const argSnippet = truncateText(crux.flipping_argument_text, 80);
    const typeTag = crux.counterfactual_type ? ` [${crux.counterfactual_type}]` : '';
    lines.push(
      `- If "${argSnippet}" were removed, "${claimSnippet}" would flip ` +
      `from ${crux.original_outcome} to ${crux.counterfactual_outcome} ` +
      `(${direction} by ${Math.abs(crux.strength_delta).toFixed(3)}).${typeTag}`,
    );
  }

  if (result.cruxes.length > maxCruxes) {
    lines.push(`  ...and ${result.cruxes.length - maxCruxes} more counterfactual crux(es).`);
  }

  return lines.join('\n');
}

/**
 * Filter counterfactual cruxes to those that cross POV boundaries —
 * i.e., the claim and the flipping argument belong to different speakers.
 * Cross-POV cruxes are the most debate-theoretically significant because
 * they represent arguments from one perspective that are decisive for another.
 */
export function filterCrossPovCruxes(
  cruxes: CounterfactualCrux[],
  nodes: ReadonlyArray<ArgumentNetworkNode>,
): CounterfactualCrux[] {
  const speakerById = new Map<string, string>();
  for (const n of nodes) {
    speakerById.set(n.id, n.speaker as string);
  }

  return cruxes.filter(crux => {
    const claimSpeaker = speakerById.get(crux.claim_id);
    const argSpeaker = speakerById.get(crux.flipping_argument_id);
    return claimSpeaker !== undefined && argSpeaker !== undefined && claimSpeaker !== argSpeaker;
  });
}

// ── Helpers ───────────────────────────────────────────────

function truncateText(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1) + '…';
}
