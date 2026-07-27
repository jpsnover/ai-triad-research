// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import type { DebateEngineInternals } from './internals.js';
import { type SpeakerId, POVER_INFO } from '../types.js';
import { formatCommitments, formatEstablishedPoints } from '../argumentNetwork.js';

// ── Commitment context ─────────────────────────────────────

export function getCommitmentContext(engine: DebateEngineInternals, poverId: Exclude<SpeakerId, 'user'>): string {
  const commitments = engine.session.commitments?.[poverId];
  if (!commitments) return '';

  const an = engine.session.argument_network;
  const priorClaims = an?.nodes
    .filter(n => n.speaker === poverId)
    .map(n => ({ text: n.text }));

  return formatCommitments(commitments, priorClaims);
}

/** Get recent claims from other debaters so the current speaker doesn't echo them */
export function getEstablishedPointsContext(engine: DebateEngineInternals, poverId: Exclude<SpeakerId, 'user'>): string {
  const an = engine.session.argument_network;
  if (!an || an.nodes.length === 0) return '';

  const allNodes = an.nodes.map(n => ({
    id: n.id,
    text: n.canonical_proposition || n.text,
    speaker: POVER_INFO[n.speaker as Exclude<SpeakerId, 'user'>]?.label ?? n.speaker,
  }));

  return formatEstablishedPoints(allNodes, POVER_INFO[poverId].label, 14, an.edges.filter(e => e.type !== 'revoice_of') as { source: string; target: string; type: 'supports' | 'attacks' }[]);
}
