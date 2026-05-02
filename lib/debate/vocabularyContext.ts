// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import type { StandardizedTerm, ColloquialTerm, CampOrigin } from '../dictionary/types.js';

export interface VocabularyContextOptions {
  pov: string;
  standardizedTerms: StandardizedTerm[];
  colloquialTerms: ColloquialTerm[];
}

const POV_TO_CAMP: Record<string, CampOrigin> = {
  accelerationist: 'accelerationist',
  safetyist: 'safetyist',
  skeptic: 'skeptic',
};

export function formatVocabularyContext(options: VocabularyContextOptions): string {
  const { pov, standardizedTerms, colloquialTerms } = options;
  if (standardizedTerms.length === 0) return '';

  const camp = POV_TO_CAMP[pov];
  const bareTerms = colloquialTerms.filter(t => t.status === 'do_not_use_bare');

  const ownTerms = standardizedTerms.filter(t => t.primary_camp_origin === camp);
  const crossTerms = standardizedTerms.filter(t => t.primary_camp_origin !== camp);

  const lines: string[] = [];
  lines.push('=== VOCABULARY CONSTRAINTS ===');
  lines.push('Use only standardized terms from the vocabulary below. Do not use bare colloquial terms — they are ambiguous across camps and the system will reject them. The display form will be substituted for the canonical form when output is shown to readers.');
  lines.push('');

  if (ownTerms.length > 0) {
    lines.push(`Your camp's terms (${camp}):`);
    for (const t of ownTerms) {
      lines.push(`  ${t.canonical_form} → "${t.display_form}": ${truncate(t.definition, 120)}`);
    }
    lines.push('');
  }

  if (crossTerms.length > 0) {
    lines.push('Cross-camp terms you may engage with:');
    for (const t of crossTerms) {
      lines.push(`  ${t.canonical_form} → "${t.display_form}" (${t.primary_camp_origin}): ${truncate(t.definition, 100)}`);
    }
    lines.push('');
  }

  if (bareTerms.length > 0) {
    lines.push('DO NOT USE BARE (ambiguous across camps):');
    lines.push(`  ${bareTerms.map(t => `"${t.colloquial_term}"`).join(', ')}`);
    lines.push('');
  }

  return lines.join('\n');
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 3) + '...';
}
