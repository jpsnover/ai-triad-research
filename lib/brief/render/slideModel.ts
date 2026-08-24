// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// T4 Render — the target-neutral slide IR (t/2802).
// assemble.ts builds SlideModel[] ONCE from deck_spec + narration; both the
// pptx renderer and the HTML-for-PDF renderer consume the SAME SlideModel[] so
// the two output targets cannot drift in content (only in medium).

/** Every slide kind in the grammar (spec §2.3) plus the classroom-preset extras. */
export type SlideKind =
  | 'title'
  | 'question'
  | 'how_to_read'
  | 'agreements'
  | 'positions'
  | 'empirical_cruxes'
  | 'values_cruxes'
  | 'audience_questions'
  | 'change_minds'
  | 'evidence_shelf'
  | 'provenance'
  | 'framing_meta'          // classroom
  | 'glossary'             // classroom
  | 'open_threads_appendix'; // classroom

/** A line of slide copy paired with the RFC 6901 trace it came from (speaker notes). */
export interface TraceRef {
  text: string;
  /** The narration entry's own resolvable pointer — never fabricated here. */
  trace: string;
}

/** One camp's card on the Positions slide — carries `camp` for parity/attribution. */
export interface CampCard {
  camp: string;
  title: string;
  lines: string[];
}

export type SlideBlock =
  | { type: 'text'; text: string }
  | { type: 'bullets'; items: string[] }
  | { type: 'card_row'; cards: CampCard[] }
  | { type: 'fork'; prompt: string; ifYes: string; ifNo: string }
  | { type: 'badge_row'; badges: { label: string; value: string }[] }
  | { type: 'table'; headers: string[]; rows: string[][] }
  | { type: 'note'; text: string };

export interface SlideModel {
  kind: SlideKind;
  title: string;
  blocks: SlideBlock[];
  /** Verbatim spec text + trace refs; drives PowerPoint speaker notes (spec §2.3). */
  speakerNotes: TraceRef[];
  /** Set on single-camp slides; per-camp cards carry their own `camp` in card_row. */
  camp?: string;
  /** "IN PROGRESS" when meta.snapshot — the allowOpen watermark. */
  watermark?: string;
}
