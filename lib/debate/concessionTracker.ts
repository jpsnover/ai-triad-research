// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Concession accumulator — indexes debate concessions by taxonomy node,
 * classifies concession quality (full/conditional/tactical), and flags
 * nodes for harvest when threshold is crossed.
 */

import type { DebateSession, SpeakerId } from './types.js';
import { POVER_INFO } from './types.js';
import type { ConcessionRecord, ConcessionType } from './taxonomyTypes.js';

// ── Types ─────────────────────────────────────────────────

export interface ConcessionEntry {
  text: string;
  speaker: string;
  turn: number;
  conceded_to: string;
}

export interface ClassifiedConcession {
  index: number;
  concession_type: ConcessionType;
  affected_node: string | null;
  bdi_impact: 'belief' | 'desire' | 'intention';
}

export interface NodeConcessionSummary {
  node_id: string;
  concessions: ConcessionRecord[];
  weighted_score: number;
  distinct_debates: number;
  meets_threshold: boolean;
}

// ── Concession weight constants ───────────────────────────

const CONCESSION_WEIGHTS: Record<ConcessionType, number> = {
  full: 1.0,
  conditional: 0.5,
  tactical: 0.0,
};

const DEFAULT_THRESHOLD = 3.0;
const DEFAULT_MIN_DEBATES = 2;

// ── Classification prompt ─────────────────────────────────

export function classifyConcessionsPrompt(
  concessions: ConcessionEntry[],
  taxonomyNodeIds: string[],
  taxonomyDescriptions: Record<string, string>,
): string {
  const concessionsBlock = concessions
    .map((c, i) => `  [${i + 1}] (Turn ${c.turn}) ${c.speaker} to ${c.conceded_to}: "${c.text}"`)
    .join('\n');

  const nodesBlock = taxonomyNodeIds
    .map(id => `  ${id}: "${taxonomyDescriptions[id] ?? ''}"`)
    .join('\n');

  return `Classify each concession from this debate and map it to the taxonomy node
whose position was undermined or qualified by the concession.

CONCESSIONS:
${concessionsBlock}

TAXONOMY NODES REFERENCED IN THIS DEBATE:
${nodesBlock}

For each concession, answer THREE questions:

1. concession_type — What kind of concession is this?
   - "full": The speaker genuinely accepts the opponent's point without conditions.
     Markers: "I accept that...", "You're right that...", "I now agree...",
     "The evidence does support..."
   - "conditional": The speaker accepts the point only if a stated condition holds.
     Markers: "I concede X, provided Y...", "If [condition], then I accept...",
     "I'll grant that, assuming..."
   - "tactical": The speaker grants the point for argument's sake only, without
     genuinely updating their position.
     Markers: "Even if I accepted...", "For the sake of argument...",
     "Granting that for now...", "Setting aside whether..."

2. affected_node — Which taxonomy node's position was undermined or qualified?
   Pick the single node from the list above whose core claim is most directly
   challenged by this concession. If no node clearly matches, use null.

3. bdi_impact — Which BDI layer does this concession affect?
   - "belief": The concession accepts an empirical fact the speaker previously denied
   - "desire": The concession accepts a normative priority the speaker previously rejected
   - "intention": The concession accepts a strategy or approach the speaker previously opposed

Return ONLY JSON (no markdown):
{
  "classified_concessions": [
    {
      "index": 1,
      "concession_type": "full",
      "affected_node": "acc-beliefs-001",
      "bdi_impact": "belief"
    }
  ]
}

RULES:
- Every concession in the input must appear in the output (same count).
- If the concession doesn't clearly map to any listed node, set affected_node to null.
- Use the linguistic markers above to classify type — do not guess based on content alone.
- A concession immediately followed by "however" or "but" that fully reverses the point
  is tactical, not full — the reversal signals the speaker didn't genuinely update.`;
}

// ── Accumulator logic ─────────────────────────────────────

/**
 * Extract concession entries from a debate session's commitment stores.
 */
export function extractConcessions(debate: DebateSession): ConcessionEntry[] {
  if (!debate.commitments) return [];

  const entries: ConcessionEntry[] = [];

  for (const [speaker, store] of Object.entries(debate.commitments)) {
    const label = POVER_INFO[speaker as Exclude<SpeakerId, 'user'>]?.label ?? speaker;

    for (const text of store.conceded) {
      // Find the turn where this concession was made
      const matchingEntry = debate.transcript.find(e =>
        e.speaker === speaker && e.content.includes(text.slice(0, 50))
      );
      const turn = matchingEntry
        ? debate.transcript.indexOf(matchingEntry)
        : 0;

      // Determine who it was conceded to (addressing field or previous speaker)
      const concededTo = matchingEntry?.addressing
        ? (POVER_INFO[matchingEntry.addressing as Exclude<SpeakerId, 'user'>]?.label ?? String(matchingEntry.addressing))
        : 'opponent';

      entries.push({ text, speaker: label, turn, conceded_to: concededTo });
    }
  }

  return entries;
}

/**
 * Build ConcessionRecords from classified concessions.
 */
export function buildConcessionRecords(
  debateId: string,
  concessions: ConcessionEntry[],
  classifications: ClassifiedConcession[],
): Map<string, ConcessionRecord[]> {
  const byNode = new Map<string, ConcessionRecord[]>();

  for (const cls of classifications) {
    if (!cls.affected_node) continue;

    const entry = concessions[cls.index - 1];
    if (!entry) continue;

    const record: ConcessionRecord = {
      debate_id: debateId,
      speaker: entry.speaker,
      text: entry.text,
      turn: entry.turn,
      conceded_to: entry.conceded_to,
      concession_type: cls.concession_type,
      bdi_impact: cls.bdi_impact,
    };

    if (!byNode.has(cls.affected_node)) byNode.set(cls.affected_node, []);
    byNode.get(cls.affected_node)!.push(record);
  }

  return byNode;
}

/**
 * Compute per-node concession summaries with weighted scores and threshold check.
 */
export function summarizeNodeConcessions(
  existingHistory: ConcessionRecord[],
  newRecords: ConcessionRecord[],
  threshold: number = DEFAULT_THRESHOLD,
  minDebates: number = DEFAULT_MIN_DEBATES,
): NodeConcessionSummary & { allRecords: ConcessionRecord[] } {
  const allRecords = [...existingHistory, ...newRecords];

  const weightedScore = allRecords.reduce(
    (sum, r) => sum + (CONCESSION_WEIGHTS[r.concession_type] ?? 0), 0
  );

  const distinctDebates = new Set(allRecords.map(r => r.debate_id)).size;

  return {
    node_id: '', // Caller sets this
    concessions: allRecords,
    weighted_score: weightedScore,
    distinct_debates: distinctDebates,
    meets_threshold: weightedScore >= threshold && distinctDebates >= minDebates,
    allRecords,
  };
}
