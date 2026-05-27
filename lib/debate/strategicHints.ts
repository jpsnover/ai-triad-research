// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Opponent-aware strategic hints — pure computation from existing data structures.
 * Three hint types: commitment traps, capability gaps, strategy shifts.
 * No LLM calls — all computed from argument network, edges, and commitment stores.
 */

import type { ArgumentNetworkNode, ArgumentNetworkEdge, CommitmentStore } from './types.js';

// ── Types ──────────────────────────────────────────────

export interface StrategicHint {
  type: 'commitment_trap' | 'capability_gap' | 'strategy_shift';
  target_speaker: string;
  hint: string;
}

// ── Constants ──────────────────────────────────────────

const COOPERATIVE_SCHEMES = new Set([
  'EXTEND', 'INTEGRATE', 'CONCEDE-AND-PIVOT',
]);

const ADVERSARIAL_SCHEMES = new Set([
  'COUNTEREXAMPLE', 'UNDERCUT', 'BURDEN-SHIFT', 'DISTINGUISH',
]);

/** Minimum word length to include in overlap matching. */
const MIN_WORD_LENGTH = 5;
/** Minimum shared words between asserted and conceded to flag a trap. */
const MIN_OVERLAP_WORDS = 3;

// ── Helpers ────────────────────────────────────────────

/** Extract significant words from text for overlap matching. */
function significantWords(text: string): Set<string> {
  return new Set(
    text.toLowerCase().split(/\s+/).filter(w => w.length >= MIN_WORD_LENGTH),
  );
}

// ── A. Commitment Trap Detection ───────────────────────

/**
 * Scan opponents' commitment stores for tensions between asserted and
 * conceded claims. Surfaces DISTINGUISH move opportunities.
 */
export function detectCommitmentTraps(
  currentSpeaker: string,
  nodes: readonly ArgumentNetworkNode[],
  commitments: Record<string, CommitmentStore>,
): StrategicHint[] {
  const hints: StrategicHint[] = [];

  for (const [speaker, store] of Object.entries(commitments)) {
    if (speaker === currentSpeaker) continue;
    if (store.conceded.length === 0 || store.asserted.length === 0) continue;

    // Build word sets for all asserted claims
    const assertedSets = store.asserted.map(a => ({
      text: a,
      words: significantWords(a),
    }));

    for (const concededText of store.conceded) {
      const concededWords = significantWords(concededText);
      if (concededWords.size < MIN_OVERLAP_WORDS) continue;

      for (const asserted of assertedSets) {
        let overlap = 0;
        for (const w of concededWords) {
          if (asserted.words.has(w)) overlap++;
        }

        if (overlap >= MIN_OVERLAP_WORDS) {
          hints.push({
            type: 'commitment_trap',
            target_speaker: speaker,
            hint: `${speaker} asserted "${asserted.text.slice(0, 80)}..." but conceded "${concededText.slice(0, 80)}..." — potential DISTINGUISH opportunity.`,
          });
          break; // One hint per concession
        }
      }
    }
  }

  // Also check AN topology: opponent nodes attacked by the same opponent
  const nodesBySpeaker = new Map<string, ArgumentNetworkNode[]>();
  for (const n of nodes) {
    if (n.speaker === currentSpeaker || n.speaker === 'system' || n.speaker === 'document' || n.speaker === 'user') continue;
    if (!nodesBySpeaker.has(n.speaker)) nodesBySpeaker.set(n.speaker, []);
    nodesBySpeaker.get(n.speaker)!.push(n);
  }

  // Check for taxonomy ref overlap between asserted nodes and conceded commitments
  for (const [speaker, store] of Object.entries(commitments)) {
    if (speaker === currentSpeaker || store.conceded.length === 0) continue;
    const speakerNodes = nodesBySpeaker.get(speaker) ?? [];
    if (speakerNodes.length === 0) continue;

    // Collect taxonomy refs from concession-adjacent nodes
    const concededNodeRefs = new Set<string>();
    for (const concText of store.conceded) {
      const concWords = significantWords(concText);
      for (const node of speakerNodes) {
        const nodeWords = significantWords(node.text);
        let overlap = 0;
        for (const w of concWords) {
          if (nodeWords.has(w)) overlap++;
        }
        if (overlap >= 2) {
          for (const ref of node.taxonomy_refs) concededNodeRefs.add(ref);
        }
      }
    }

    // Find still-asserted nodes sharing taxonomy refs with conceded territory
    if (concededNodeRefs.size === 0) continue;
    for (const node of speakerNodes) {
      const sharedRef = node.taxonomy_refs.find(r => concededNodeRefs.has(r));
      if (sharedRef && (node.computed_strength ?? node.base_strength ?? 0.5) >= 0.4) {
        const existing = hints.find(h => h.target_speaker === speaker && h.type === 'commitment_trap');
        if (!existing) {
          hints.push({
            type: 'commitment_trap',
            target_speaker: speaker,
            hint: `${speaker} still holds "${node.text.slice(0, 60)}..." (${sharedRef}) despite concessions in the same taxonomy area — DISTINGUISH to expose the tension.`,
          });
        }
      }
    }
  }

  return hints.slice(0, 2);
}

// ── B. Capability Steering ─────────────────────────────

const POV_LABELS: Record<string, string> = {
  acc: 'accelerationist',
  saf: 'safety',
  skp: 'skeptic',
  cc: 'cross-cutting',
};

/**
 * Track taxonomy_refs frequency per speaker. Identify branches where
 * opponents have sparse coverage relative to the current speaker.
 */
export function detectCapabilityGaps(
  currentSpeaker: string,
  nodes: readonly ArgumentNetworkNode[],
): StrategicHint[] {
  const hints: StrategicHint[] = [];

  // Count taxonomy refs by POV prefix per speaker
  const refCounts = new Map<string, Map<string, number>>();

  for (const node of nodes) {
    if (node.speaker === 'system' || node.speaker === 'document' || node.speaker === 'user') continue;
    if (!refCounts.has(node.speaker)) refCounts.set(node.speaker, new Map());
    const counts = refCounts.get(node.speaker)!;

    for (const ref of node.taxonomy_refs) {
      const prefix = ref.split('-')[0];
      counts.set(prefix, (counts.get(prefix) ?? 0) + 1);
    }
  }

  const myRefs = refCounts.get(currentSpeaker);
  if (!myRefs) return hints;

  for (const [speaker, theirRefs] of refCounts.entries()) {
    if (speaker === currentSpeaker) continue;

    for (const [prefix, myCount] of myRefs.entries()) {
      if (prefix === 'pol' || prefix === 'sit') continue; // skip shared categories
      const theirCount = theirRefs.get(prefix) ?? 0;
      if (myCount >= 3 && theirCount <= 1) {
        const areaLabel = POV_LABELS[prefix] ?? prefix;
        hints.push({
          type: 'capability_gap',
          target_speaker: speaker,
          hint: `${speaker} has sparse coverage in ${areaLabel} taxonomy (${theirCount} ref${theirCount !== 1 ? 's' : ''} vs your ${myCount}). Consider steering toward this area to exploit the knowledge gap.`,
        });
      }
    }
  }

  return hints.slice(0, 2);
}

// ── C. Strategic Type Detection ────────────────────────

/**
 * Track cooperative vs adversarial move ratios per agent over a rolling
 * window. Surface strategy shifts for diagnostic and tactical value.
 */
export function detectStrategyShifts(
  nodes: readonly ArgumentNetworkNode[],
  edges: readonly ArgumentNetworkEdge[],
  recentTurnThreshold: number,
): StrategicHint[] {
  const hints: StrategicHint[] = [];

  // Tally move types per speaker, split into overall and recent
  const stats = new Map<string, {
    coop: number; adv: number; other: number;
    recent_coop: number; recent_adv: number; recent_other: number;
  }>();

  // Build node lookup for speaker/turn resolution
  const nodeMap = new Map<string, ArgumentNetworkNode>();
  for (const n of nodes) nodeMap.set(n.id, n);

  for (const edge of edges) {
    const sourceNode = nodeMap.get(edge.source);
    if (!sourceNode) continue;
    if (sourceNode.speaker === 'system' || sourceNode.speaker === 'document' || sourceNode.speaker === 'user') continue;

    const speaker = sourceNode.speaker;
    if (!stats.has(speaker)) {
      stats.set(speaker, { coop: 0, adv: 0, other: 0, recent_coop: 0, recent_adv: 0, recent_other: 0 });
    }
    const s = stats.get(speaker)!;
    const scheme = edge.scheme ?? '';
    const isRecent = sourceNode.turn_number >= recentTurnThreshold;

    if (COOPERATIVE_SCHEMES.has(scheme)) {
      s.coop++;
      if (isRecent) s.recent_coop++;
    } else if (ADVERSARIAL_SCHEMES.has(scheme)) {
      s.adv++;
      if (isRecent) s.recent_adv++;
    } else if (scheme) {
      s.other++;
      if (isRecent) s.recent_other++;
    }
  }

  for (const [speaker, s] of stats.entries()) {
    const totalAll = s.coop + s.adv + s.other;
    const totalRecent = s.recent_coop + s.recent_adv + s.recent_other;
    if (totalAll < 3 || totalRecent < 2) continue;

    const overallCoopRatio = s.coop / totalAll;
    const recentCoopRatio = s.recent_coop / totalRecent;
    const shift = recentCoopRatio - overallCoopRatio;

    if (Math.abs(shift) >= 0.25) {
      const direction = shift > 0 ? 'more cooperative' : 'more adversarial';
      const recentStyle = recentCoopRatio > 0.5 ? 'cooperative' : 'adversarial';
      hints.push({
        type: 'strategy_shift',
        target_speaker: speaker,
        hint: `${speaker} has shifted ${direction} recently (${(recentCoopRatio * 100).toFixed(0)}% cooperative in recent turns vs ${(overallCoopRatio * 100).toFixed(0)}% overall). Current stance: ${recentStyle}.`,
      });
    }
  }

  return hints.slice(0, 2);
}

// ── Public API ─────────────────────────────────────────

/** Default character budget for the strategic hints block. */
export const DEFAULT_HINT_CHAR_BUDGET = 2048;

export interface StrategicHintsResult {
  hints: string[];
  /** Number of hints dropped due to char budget. */
  dropped: number;
}

/**
 * Compute all strategic hints for the current speaker's plan stage.
 * Returns formatted hint strings ready for prompt injection, capped at charBudget.
 * Priority when budget exceeded: commitment traps > strategy shifts > capability gaps.
 * Pure computation — no LLM calls.
 */
export function computeStrategicHints(
  currentSpeaker: string,
  nodes: readonly ArgumentNetworkNode[],
  edges: readonly ArgumentNetworkEdge[],
  commitments: Record<string, CommitmentStore>,
  currentRound: number,
  charBudget: number = DEFAULT_HINT_CHAR_BUDGET,
): StrategicHintsResult {
  const rollingWindowStart = Math.max(1, currentRound - 2);

  const traps = detectCommitmentTraps(currentSpeaker, nodes, commitments);
  const shifts = detectStrategyShifts(nodes, edges, rollingWindowStart);
  const gaps = detectCapabilityGaps(currentSpeaker, nodes);

  // Priority order: traps > shifts > gaps
  const all: StrategicHint[] = [...traps, ...shifts, ...gaps];

  const hints: string[] = [];
  let usedChars = 0;
  let dropped = 0;

  for (const h of all) {
    const newTotal = usedChars + h.hint.length;
    if (newTotal > charBudget && hints.length > 0) {
      dropped++;
      continue;
    }
    hints.push(h.hint);
    usedChars += h.hint.length;
  }

  return { hints, dropped };
}
