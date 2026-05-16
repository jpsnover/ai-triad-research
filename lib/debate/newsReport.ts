// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Input preparation helpers for the News Report feature.
 * Extracts transcript highlights and argument network summaries
 * for feeding into newsReportPrompt().
 */

import type { TranscriptEntry, ArgumentNetworkNode, ArgumentNetworkEdge, SpeakerId } from './types.js';
import { POVER_INFO } from './types.js';

// ── Speaker label resolution ─────────────────────────────

function journalisticLabel(speaker: string): string {
  switch (speaker) {
    case 'prometheus': return 'Accelerationist advocates';
    case 'sentinel': return 'Safety researchers';
    case 'cassandra': return 'AI skeptics';
    case 'moderator': return 'The moderator';
    default: return speaker;
  }
}

function shortLabel(speaker: string): string {
  const info = POVER_INFO[speaker as Exclude<SpeakerId, 'user'>];
  return info?.label ?? speaker;
}

// ── Transcript highlights ────────────────────────────────

/**
 * Select the most newsworthy transcript entries for the news report prompt.
 *
 * Selects: opening statements, strongest claim per debater (by AN strength),
 * concession turns, and closing positions. Returns formatted text, ~2000 tokens max.
 */
export function extractTranscriptHighlights(
  transcript: TranscriptEntry[],
  anNodes?: ArgumentNetworkNode[],
): string {
  const debaterSpeakers = new Set(['prometheus', 'sentinel', 'cassandra']);
  const sections: string[] = [];

  // 1. Opening statements (first statement per debater)
  const openings = new Map<string, TranscriptEntry>();
  for (const entry of transcript) {
    if ((entry.type === 'opening' || entry.type === 'statement') &&
        debaterSpeakers.has(entry.speaker) &&
        !openings.has(entry.speaker)) {
      openings.set(entry.speaker, entry);
    }
    if (openings.size >= 3) break;
  }
  if (openings.size > 0) {
    sections.push('=== OPENING POSITIONS ===');
    for (const [speaker, entry] of openings) {
      const text = truncate(entry.content, 300);
      sections.push(`${shortLabel(speaker)}: ${text}`);
    }
  }

  // 2. Strongest claim per debater (by computed_strength from AN)
  if (anNodes && anNodes.length > 0) {
    const bestByDebater = new Map<string, ArgumentNetworkNode>();
    for (const node of anNodes) {
      if (!debaterSpeakers.has(node.speaker)) continue;
      const existing = bestByDebater.get(node.speaker);
      const strength = node.computed_strength ?? node.base_strength ?? 0;
      const existingStrength = existing?.computed_strength ?? existing?.base_strength ?? 0;
      if (!existing || strength > existingStrength) {
        bestByDebater.set(node.speaker, node);
      }
    }
    if (bestByDebater.size > 0) {
      sections.push('\n=== STRONGEST ARGUMENTS ===');
      for (const [speaker, node] of bestByDebater) {
        const strength = (node.computed_strength ?? node.base_strength ?? 0).toFixed(2);
        sections.push(`${shortLabel(speaker)} (strength ${strength}): "${truncate(node.text, 250)}"`);
      }
    }
  }

  // 3. Concession turns (entries where metadata indicates concession)
  const concessions: TranscriptEntry[] = [];
  for (const entry of transcript) {
    if (!debaterSpeakers.has(entry.speaker)) continue;
    const meta = entry.metadata as Record<string, unknown> | undefined;
    const moves = meta?.move_types as Array<{ move?: string }> | undefined;
    if (moves?.some(m => /concede|pivot|integrate/i.test(m.move ?? ''))) {
      concessions.push(entry);
    }
  }
  if (concessions.length > 0) {
    sections.push('\n=== CONCESSIONS & PIVOTS ===');
    for (const entry of concessions.slice(0, 3)) {
      sections.push(`${shortLabel(entry.speaker)}: ${truncate(entry.content, 250)}`);
    }
  }

  // 4. Closing positions (last statement per debater)
  const closings = new Map<string, TranscriptEntry>();
  for (let i = transcript.length - 1; i >= 0; i--) {
    const entry = transcript[i];
    if ((entry.type === 'concluding' || entry.type === 'statement') &&
        debaterSpeakers.has(entry.speaker) &&
        !closings.has(entry.speaker)) {
      closings.set(entry.speaker, entry);
    }
    if (closings.size >= 3) break;
  }
  if (closings.size > 0) {
    sections.push('\n=== CLOSING POSITIONS ===');
    for (const [speaker, entry] of closings) {
      sections.push(`${shortLabel(speaker)}: ${truncate(entry.content, 300)}`);
    }
  }

  return sections.join('\n');
}

// ── Argument network summary ─────────────────────────────

/**
 * Extract the top claims by QBAF strength with their attack/support relationships.
 * Returns a structured text summary of the debate's argumentative structure.
 */
export function summarizeArgumentNetwork(
  nodes: ArgumentNetworkNode[],
  edges: ArgumentNetworkEdge[],
  maxClaims: number = 8,
): string {
  if (nodes.length === 0) return '';

  // Sort by computed_strength (QBAF post-propagation), fallback to base_strength
  const sorted = [...nodes]
    .filter(n => n.speaker !== 'system' && n.speaker !== 'document')
    .sort((a, b) =>
      (b.computed_strength ?? b.base_strength ?? 0) - (a.computed_strength ?? a.base_strength ?? 0),
    );

  const topClaims = sorted.slice(0, maxClaims);
  const topIds = new Set(topClaims.map(n => n.id));

  // Build edge map for top claims
  const edgeMap = new Map<string, { supports: string[]; attacks: string[] }>();
  for (const claim of topClaims) {
    edgeMap.set(claim.id, { supports: [], attacks: [] });
  }

  for (const edge of edges) {
    if (!topIds.has(edge.source) && !topIds.has(edge.target)) continue;

    const sourceNode = topClaims.find(n => n.id === edge.source);
    const targetNode = topClaims.find(n => n.id === edge.target);

    if (edge.type === 'supports' && targetNode && sourceNode) {
      const entry = edgeMap.get(edge.target);
      const label = `${shortLabel(sourceNode.speaker)}: "${truncate(sourceNode.text, 80)}"`;
      entry?.supports.push(label);
    } else if (edge.type === 'attacks' && targetNode && sourceNode) {
      const entry = edgeMap.get(edge.target);
      const attackType = edge.attack_type ? ` [${edge.attack_type}]` : '';
      const label = `${shortLabel(sourceNode.speaker)}: "${truncate(sourceNode.text, 80)}"${attackType}`;
      entry?.attacks.push(label);
    }
  }

  // Format
  const lines: string[] = [`Top ${topClaims.length} claims by argument strength:`];
  for (const claim of topClaims) {
    const strength = (claim.computed_strength ?? claim.base_strength ?? 0).toFixed(2);
    lines.push(`\n[${claim.id}] ${shortLabel(claim.speaker)} (strength: ${strength}):`);
    lines.push(`  "${truncate(claim.text, 200)}"`);

    const rel = edgeMap.get(claim.id);
    if (rel?.supports.length) {
      lines.push(`  Supported by: ${rel.supports.join('; ')}`);
    }
    if (rel?.attacks.length) {
      lines.push(`  Attacked by: ${rel.attacks.join('; ')}`);
    }
  }

  return lines.join('\n');
}

// ── Utility ──────────────────────────────────────────────

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 3).replace(/\s+\S*$/, '') + '...';
}

export { journalisticLabel };
