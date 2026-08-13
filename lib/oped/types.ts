// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import type { PovKey } from '../debate/types.js';

export type { PovKey };

// ── Shared generation params ──────────────────────────────────────────────────

export interface OpEdParams {
  outlet?: string;
  wordCount: number;
  newsHook?: string;
  thesis?: string;
  authorBio?: string;
  model: string;
}

// ── Grounding reference (op-ed shape — node + editorial context) ──────────────

export interface OpEdGroundingRef {
  node_id: string;
  label: string;
  category: string;
  pov: PovKey;
  relevance: string;
  how_reflected: string;
}

// ── Per-voice member (self-contained — e/91#2 condition 3) ───────────────────
//
// Every field needed to render, export, or submit one voice stands alone here.
// Members share only topic/params from the set wrapper; nothing else crosses
// the boundary, so a future per-doc split is a mechanical migration.

export interface OpEdMember {
  pov: PovKey;
  /** Partial-set contract (e/91#2 condition 1): a run with failures finalizes
   *  as a partial set — failed/cancelled members carry status, not an omission. */
  status: 'complete' | 'failed' | 'cancelled';
  headline: string;
  subtitle: string;
  body: string;
  pitch?: string;
  wordCount: number;
  grounding: OpEdGroundingRef[];
}

// ── Set wrapper (e/91#2 conditions 2 & 4) ────────────────────────────────────
//
// One document per run — the product's atomic unit for create/open/share/submit.
// Single-voice runs are a set of 1; there is no special storage shape for them.
// schema_version is a literal 1 from day one so future migrations are unambiguous.

export interface OpEdSet {
  schema_version: 1;
  set_id: string;
  topic: string;
  params: OpEdParams;
  created_at: string;
  opeds: OpEdMember[];
}

// ── Local library listing summary (t/2591) ───────────────────────────────────
//
// Returned by list-oped-sets IPC so OpEdTable renders camp chips + voice count
// without loading the full set doc. Derived from OpEdSet at list time.

export interface OpEdSetSummary {
  set_id: string;
  topic: string;
  created_at: string;
  updated_at?: string;
  camps: PovKey[];
  voice_count: number;
}

// ── Community index entry (e/91#2 condition 5) ────────────────────────────────
//
// Carried in the listing index so list rows render camp chips without loading
// the full set doc. voice_count = opeds.length at submission time.

export interface OpEdCommunityEntry {
  id: string;
  topic: string;
  created_at: string;
  updated_at: string;
  camps: PovKey[];
  voice_count: number;
  community_metadata: unknown;
}
