// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import type {
  TranscriptEntry,
  ArgumentNetworkNode,
  ArgumentNetworkEdge,
  CommitmentStore,
  TrackedCrux,
  ContextSummary,
  SpeakerId,
  UnansweredClaimEntry,
} from './types.js';
import { POVER_INFO } from './types.js';

export interface TieredCompressionInput {
  transcript: TranscriptEntry[];
  nodes: ReadonlyArray<ArgumentNetworkNode>;
  edges: ReadonlyArray<ArgumentNetworkEdge>;
  commitments: Record<string, CommitmentStore>;
  cruxTracker?: TrackedCrux[];
  unansweredClaims?: { claim_id: string; text: string; speaker: string }[];
  existingSummaries: ContextSummary[];
}

const RECENT_WINDOW = 8;
const MEDIUM_WINDOW = 16;

export function buildMediumTierSummary(
  entries: TranscriptEntry[],
  nodes: ReadonlyArray<ArgumentNetworkNode>,
  edges: ReadonlyArray<ArgumentNetworkEdge>,
  commitments: Record<string, CommitmentStore>,
): string {
  const lines: string[] = [];

  // Extract key claims from entries in this tier, grouped by speaker
  const entryIds = new Set(entries.map(e => e.id));
  const tierNodes = nodes.filter(n => entryIds.has(n.source_entry_id));

  const bySpeaker = new Map<string, ArgumentNetworkNode[]>();
  for (const node of tierNodes) {
    const list = bySpeaker.get(node.speaker) ?? [];
    list.push(node);
    bySpeaker.set(node.speaker, list);
  }

  for (const [speaker, claims] of bySpeaker) {
    const label = POVER_INFO[speaker as Exclude<SpeakerId, 'user'>]?.label ?? speaker;
    const topClaims = claims
      .sort((a, b) => (b.computed_strength ?? 0.5) - (a.computed_strength ?? 0.5))
      .slice(0, 5);
    lines.push(`${label}'s key claims:`);
    for (const c of topClaims) {
      const strength = c.computed_strength != null ? ` [strength: ${c.computed_strength.toFixed(2)}]` : '';
      lines.push(`  - ${c.text}${strength}`);
    }
  }

  // Commitments made during this window
  for (const [speaker, store] of Object.entries(commitments)) {
    const label = POVER_INFO[speaker as Exclude<SpeakerId, 'user'>]?.label ?? speaker;
    const recentConcessions = store.conceded.slice(-3);
    if (recentConcessions.length > 0) {
      lines.push(`${label} conceded: ${recentConcessions.join('; ')}`);
    }
  }

  // Key edges — cross-POV interactions
  const crossPovEdges = edges.filter(e => {
    const source = nodes.find(n => n.id === e.source);
    const target = nodes.find(n => n.id === e.target);
    if (!source || !target) return false;
    return source.speaker !== target.speaker && entryIds.has(source.source_entry_id);
  });

  const attacks = crossPovEdges.filter(e => e.type === 'attacks');
  const supports = crossPovEdges.filter(e => e.type === 'supports');

  if (attacks.length > 0 || supports.length > 0) {
    lines.push(`Cross-POV interactions: ${attacks.length} attacks, ${supports.length} supports`);
  }

  return lines.join('\n');
}

export function buildDistantTierSummary(
  nodes: ReadonlyArray<ArgumentNetworkNode>,
  edges: ReadonlyArray<ArgumentNetworkEdge>,
  commitments: Record<string, CommitmentStore>,
  cruxTracker?: TrackedCrux[],
  unansweredClaims?: UnansweredClaimEntry[],
  transcript?: ReadonlyArray<TranscriptEntry>,
): string {
  const lines: string[] = [];

  // Concession summary
  for (const [speaker, store] of Object.entries(commitments)) {
    const label = POVER_INFO[speaker as Exclude<SpeakerId, 'user'>]?.label ?? speaker;
    if (store.conceded.length > 0) {
      lines.push(`${label} has conceded ${store.conceded.length} point(s): ${store.conceded.slice(0, 5).join('; ')}${store.conceded.length > 5 ? ` (+${store.conceded.length - 5} more)` : ''}`);
    }
    if (store.challenged.length > 0) {
      lines.push(`${label} has challenged ${store.challenged.length} point(s)`);
    }
  }

  // Crux resolution status with disagreement types
  if (cruxTracker && cruxTracker.length > 0) {
    const resolved = cruxTracker.filter(c => c.state === 'resolved');
    const irreducible = cruxTracker.filter(c => c.state === 'irreducible');
    const active = cruxTracker.filter(c => c.state !== 'resolved' && c.state !== 'irreducible');
    if (resolved.length > 0) {
      lines.push(`Resolved cruxes: ${resolved.map(c => c.description).join('; ')}`);
    }
    if (irreducible.length > 0) {
      lines.push(`Irreducible disagreements: ${irreducible.map(c => `${c.description} (${c.disagreement_type ?? 'unknown type'})`).join('; ')}`);
    }
    if (active.length > 0) {
      lines.push(`Active cruxes: ${active.map(c => c.description).join('; ')}`);
    }
    // Disagreement type distribution
    const typeCounts: Record<string, number> = {};
    for (const c of cruxTracker) {
      const dt = c.disagreement_type ?? 'unclassified';
      typeCounts[dt] = (typeCounts[dt] ?? 0) + 1;
    }
    const typeStr = Object.entries(typeCounts).map(([t, n]) => `${n} ${t}`).join(', ');
    if (typeStr) lines.push(`Disagreement types: ${typeStr}`);
  }

  // Top-strength surviving claims across the whole network
  const topNodes = [...nodes]
    .filter(n => (n.computed_strength ?? 0) > 0.6)
    .sort((a, b) => (b.computed_strength ?? 0) - (a.computed_strength ?? 0))
    .slice(0, 8);
  if (topNodes.length > 0) {
    lines.push('Strongest surviving claims:');
    for (const n of topNodes) {
      const label = POVER_INFO[n.speaker as Exclude<SpeakerId, 'user'>]?.label ?? n.speaker;
      lines.push(`  - [${label}, ${n.computed_strength?.toFixed(2)}] ${n.text}`);
    }
  }

  // Unanswered claims — raised but never responded to
  if (unansweredClaims && unansweredClaims.length > 0) {
    const stillOpen = unansweredClaims.filter(c => !c.addressed_round);
    if (stillOpen.length > 0) {
      lines.push(`Unanswered claims (${stillOpen.length}):`);
      for (const c of stillOpen.slice(0, 5)) {
        const label = POVER_INFO[c.speaker as Exclude<SpeakerId, 'user'>]?.label ?? c.speaker;
        lines.push(`  - [${label}] ${c.claim_text}`);
      }
      if (stillOpen.length > 5) lines.push(`  ... +${stillOpen.length - 5} more`);
    }
  }

  // Top cross-POV attack edges with warrants
  const crossPovAttacks = edges
    .filter(e => {
      if (e.type !== 'attacks') return false;
      const src = nodes.find(n => n.id === e.source);
      const tgt = nodes.find(n => n.id === e.target);
      return src && tgt && src.speaker !== tgt.speaker;
    })
    .sort((a, b) => (b.weight ?? 0.5) - (a.weight ?? 0.5))
    .slice(0, 5);
  if (crossPovAttacks.length > 0) {
    lines.push('Key cross-perspective attacks:');
    for (const e of crossPovAttacks) {
      const src = nodes.find(n => n.id === e.source);
      const tgt = nodes.find(n => n.id === e.target);
      if (!src || !tgt) continue;
      const srcLabel = POVER_INFO[src.speaker as Exclude<SpeakerId, 'user'>]?.label ?? src.speaker;
      const tgtLabel = POVER_INFO[tgt.speaker as Exclude<SpeakerId, 'user'>]?.label ?? tgt.speaker;
      const attackType = (e as { attack_type?: string }).attack_type ?? 'attacks';
      const warrant = (e as { warrant?: string }).warrant;
      lines.push(`  - ${srcLabel} ${attackType}s ${tgtLabel}: "${src.text.slice(0, 80)}..." → "${tgt.text.slice(0, 80)}..."${warrant ? ` (${warrant})` : ''}`);
    }
  }

  // Dialectical move distribution from transcript
  if (transcript && transcript.length > 0) {
    const moveCounts: Record<string, number> = {};
    for (const entry of transcript) {
      const moveTypes = (entry.metadata as Record<string, unknown>)?.move_types;
      if (Array.isArray(moveTypes)) {
        for (const m of moveTypes) {
          const name = typeof m === 'string' ? m : (m as { move?: string })?.move;
          if (name) moveCounts[name] = (moveCounts[name] ?? 0) + 1;
        }
      }
    }
    if (Object.keys(moveCounts).length > 0) {
      const moveStr = Object.entries(moveCounts)
        .sort((a, b) => b[1] - a[1])
        .map(([m, n]) => `${m} (${n})`)
        .join(', ');
      lines.push(`Dialectical moves used: ${moveStr}`);
    }
  }

  // Network summary
  const attackCount = edges.filter(e => e.type === 'attacks').length;
  const supportCount = edges.filter(e => e.type === 'supports').length;
  lines.push(`Argument network: ${nodes.length} claims, ${attackCount} attacks, ${supportCount} supports`);

  return lines.join('\n');
}

export function buildTieredContext(input: TieredCompressionInput): {
  distantSummary: string | null;
  mediumSummary: string | null;
  mediumEntryIds: string[];
  distantEntryIds: string[];
} {
  const filtered = input.transcript.filter(e => e.type !== 'system');
  const total = filtered.length;

  if (total <= RECENT_WINDOW) {
    return { distantSummary: null, mediumSummary: null, mediumEntryIds: [], distantEntryIds: [] };
  }

  const recentStart = total - RECENT_WINDOW;

  // Medium tier: entries from recentStart - MEDIUM_WINDOW to recentStart
  const mediumStart = Math.max(0, recentStart - (MEDIUM_WINDOW - RECENT_WINDOW));
  const mediumEntries = filtered.slice(mediumStart, recentStart);

  let mediumSummary: string | null = null;
  if (mediumEntries.length > 0) {
    mediumSummary = buildMediumTierSummary(
      mediumEntries, input.nodes, input.edges, input.commitments,
    );
  }

  // Distant tier: everything before mediumStart
  let distantSummary: string | null = null;
  const distantEntries = filtered.slice(0, mediumStart);
  if (distantEntries.length > 0 || total > MEDIUM_WINDOW) {
    distantSummary = buildDistantTierSummary(
      input.nodes, input.edges, input.commitments, input.cruxTracker,
      input.unansweredClaims, distantEntries,
    );
  }

  return {
    distantSummary,
    mediumSummary,
    mediumEntryIds: mediumEntries.map(e => e.id),
    distantEntryIds: distantEntries.map(e => e.id),
  };
}

export function formatTieredTranscript(
  transcript: TranscriptEntry[],
  contextSummaries: ContextSummary[],
  nodes: ReadonlyArray<ArgumentNetworkNode>,
  edges: ReadonlyArray<ArgumentNetworkEdge>,
  commitments: Record<string, CommitmentStore>,
  cruxTracker?: TrackedCrux[],
): string {
  const tiered = buildTieredContext({
    transcript, nodes, edges, commitments, cruxTracker,
    existingSummaries: contextSummaries,
  });

  const parts: string[] = [];

  if (tiered.distantSummary) {
    parts.push(`[Distant context — structural summary]:\n${tiered.distantSummary}`);
  }

  if (tiered.mediumSummary) {
    parts.push(`[Medium context — key claims & commitments]:\n${tiered.mediumSummary}`);
  }

  // Fall back to legacy summary for entries predating tiered compression
  if (!tiered.distantSummary && !tiered.mediumSummary && contextSummaries.length > 0) {
    const latest = contextSummaries[contextSummaries.length - 1];
    parts.push(`[Earlier debate summary]: ${latest.summary}`);
  }

  // Recent tier: full text of last 8 entries
  const filtered = transcript.filter(e => e.type !== 'system');
  const recent = filtered.slice(-RECENT_WINDOW);
  for (const e of recent) {
    const label = e.speaker === 'user' ? 'Moderator'
      : e.speaker === 'system' ? 'System'
      : POVER_INFO[e.speaker as Exclude<SpeakerId, 'user'>]?.label || e.speaker;
    const typeTag = e.type === 'question' ? ' [question]' : e.type === 'opening' ? ' [opening]' : '';
    const contentStr = typeof e.content === 'string' ? e.content : JSON.stringify(e.content);
    parts.push(`${label}${typeTag}: ${contentStr}`);
  }

  return parts.join('\n\n');
}
