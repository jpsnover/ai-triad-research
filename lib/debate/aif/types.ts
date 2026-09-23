// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// AIF v1 node/edge shapes (t/3590 / B4a spec, SO-cleared).
// In-memory only. Do not persist or cross a process boundary without adopting ADR-0002.

import type { SpeakerId } from '../types/phase.js';

/**
 * I-node (information / claim token).
 *
 * One per utterance — a reasserted claim is a new I-node at its later `turn`, never
 * a mutation of an existing one. `held` is a property of this utterance token, not a
 * static per-claim-type summary.
 */
export interface INode {
  id: string;
  type: 'claim';
  speaker: SpeakerId;
  /** 0-based transcript index. Stable reference for temporal metrics. */
  turn: number;
  /** Debate round. Carried so consumers avoid re-deriving turn→round. */
  round: number;
  text: string;
  /** retained_hold move: speaker reasserts this claim despite an incoming attack. */
  held: boolean;
}

/**
 * CA-node (conflict / attack).
 *
 * Cross-agent only: `speaker(attacker) ≠ speaker(target)` is a hard graph invariant
 * enforced at construction. Same-speaker conflict is not representable in v1.
 * No `status`, no `condition` (see spec §4).
 */
export interface CaNode {
  id: string;
  type: 'conflict';
  /** I-node id of the attacking claim. */
  attacker: string;
  /** I-node id of the claim under attack. */
  target: string;
}

/**
 * RA-node (support / inference).
 *
 * `concession` is a move label: the `from` speaker grants the `to` I-node (an
 * opponent's claim). It is NOT a provenance marker — a classifier-detected concession
 * will also have `concession: true`.
 */
export interface RaNode {
  id: string;
  type: 'support';
  from: string;
  to: string;
  /** concession move: `from` grants `to`, an opponent's claim. */
  concession: boolean;
}

/**
 * In-memory AIF graph for one debate session.
 *
 * All edge endpoints must reference an `id` in `nodes`. Graph-local ids only
 * (`i-<n>`, `ca-<n>`, `ra-<n>`); no global registry.
 *
 * ADR-0002 applies if this graph is ever persisted or crosses a process
 * boundary — including diagnostic dumps and flight-recorder events (spec §5).
 */
export interface AifGraph {
  debateId: string;
  nodes: INode[];
  conflicts: CaNode[];
  supports: RaNode[];
}
