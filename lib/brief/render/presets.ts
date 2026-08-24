// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// T4 Render — presets as selection/compression MASKS over the same deck_spec
// (spec §3). Presets never change extraction; they pick which slides appear and
// a per-slide readability word cap. The cap is a FAIR, uniform readability
// budget — NOT a truncate-to-beat-T5 device (TL e/113#2 gate-integrity MUST):
// genuine content asymmetry must surface to the T5 symmetry gate, not be trimmed.

import type { BriefPreset } from '../types.js';
import type { SlideKind } from './slideModel.js';

export interface PresetProfile {
  /** Ordered slide kinds included for this preset. */
  slides: SlideKind[];
  /**
   * Uniform per-card / per-entry readability cap (words). Applied identically to
   * every camp — a slide simply cannot hold unbounded copy. Over-cap copy is
   * trimmed at SENTENCE boundaries and a warning is emitted when traced content
   * is dropped (assemble.ts). Same cap for all camps ⇒ no gate-gaming.
   */
  perEntryWordCap: number;
  /** Classroom: derive extra discussion-prompt audience questions from cruxes. */
  discussionPrompts: boolean;
}

const CONFERENCE_SLIDES: SlideKind[] = [
  'title', 'question', 'how_to_read', 'agreements', 'positions',
  'empirical_cruxes', 'values_cruxes', 'audience_questions',
  'change_minds', 'evidence_shelf', 'provenance',
];

// Policymaker (~6): terse executive cut — the question, the cruxes + their asks,
// what to ask yourself, and provenance. Drops legend/agreements/positions-map/
// change-minds/evidence per the approved design (e/113).
const POLICYMAKER_SLIDES: SlideKind[] = [
  'title', 'question', 'empirical_cruxes', 'values_cruxes', 'audience_questions', 'provenance',
];

// Classroom (~16): full grammar + framing-meta, glossary, open-threads appendix,
// and discussion prompts per crux.
const CLASSROOM_SLIDES: SlideKind[] = [
  ...CONFERENCE_SLIDES,
  'framing_meta', 'glossary', 'open_threads_appendix',
];

export const PRESET_PROFILES: Record<BriefPreset, PresetProfile> = {
  policymaker: { slides: POLICYMAKER_SLIDES, perEntryWordCap: 40, discussionPrompts: false },
  conference:  { slides: CONFERENCE_SLIDES,  perEntryWordCap: 90, discussionPrompts: false },
  classroom:   { slides: CLASSROOM_SLIDES,   perEntryWordCap: 110, discussionPrompts: true },
};

export function profileFor(preset: BriefPreset): PresetProfile {
  return PRESET_PROFILES[preset];
}
