// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { ActionableError } from '../debate/errors.js';
import { loadOutletsData } from './loadOutlets.js';

export interface OutletBandStyle {
  /** Replaces the audience clause in the system prompt L1 ("trying to <audience>"). */
  audience: string;
  /** Replaces the READING LEVEL bullet in STYLE MECHANICS. */
  readingLevel: string;
  /** Replaces the SENTENCE LENGTH bullet in STYLE MECHANICS. */
  sentenceMechanics: string;
  /** Replaces the PARAGRAPH LENGTH bullet in STYLE MECHANICS. */
  paragraphMechanics: string;
  /** Replaces the jargon bullet in STYLE MECHANICS. */
  jargonGuidance: string;
  /** Replaces the body_markdown format instruction in the output schema. */
  bodyFormat: string;
}

export interface OutletBand {
  words: number;
  guidance: string;
  /** Per-outlet readability targets for the edit pass. Absent → DEFAULT_READABILITY_TARGETS (grade-10). */
  readability?: { fkMax: number; maxSentWords: number; maxParaWords: number };
  /** Per-outlet generation style overrides. Absent → mass-market grade-10 defaults. */
  style?: OutletBandStyle;
}

export const OUTLET_BANDS: Readonly<Record<string, OutletBand>> = loadOutletsData().outlets;

export function resolveOutletBand(outlet: string | undefined): OutletBand {
  if (outlet === undefined) {
    return OUTLET_BANDS['TechPolicyPress']!; // deliberate house default, no WARN
  }
  const band = OUTLET_BANDS[outlet];
  if (band === undefined) {
    throw new ActionableError({
      goal: 'Resolve outlet band for op-ed generation',
      problem: `Unknown outlet "${outlet}". Valid outlets: ${Object.keys(OUTLET_BANDS).join(', ')}.`,
      location: 'lib/oped/outletBands.ts — resolveOutletBand',
      nextSteps: [
        `Pass one of the valid outlet names: ${Object.keys(OUTLET_BANDS).join(', ')}.`,
        'Check request.params.outlet for a typo.',
      ],
    });
  }
  return band;
}
