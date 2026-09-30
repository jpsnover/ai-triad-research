// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

export interface OutletBand {
  words: number;
  guidance: string;
  /** Per-outlet readability targets for the edit pass. Absent → DEFAULT_READABILITY_TARGETS (grade-10). */
  readability?: { fkMax: number; maxSentWords: number; maxParaWords: number };
}

export const OUTLET_BANDS: Readonly<Record<string, OutletBand>> = {
  WashingtonPost: {
    words: 800,
    guidance: 'The Washington Post: max 800 words, strong news hook, hyperlink-able sources, zero jargon; national public audience.',
  },
  NYTimes: {
    words: 800,
    guidance: 'The New York Times Guest Essay: ~800 words, sharp thesis, general national readership.',
  },
  WallStreetJournal: {
    words: 900,
    guidance: 'The Wall Street Journal: 600-1200 words, rapid thesis, business/policy relevance, market and regulatory framing, zero jargon; executives, investors, policymakers.',
  },
  USAToday: {
    words: 650,
    guidance: 'USA Today: 550-750 words, embed verifiable source references, plain and direct; broad national audience.',
  },
  ForeignAffairs: {
    words: 1200,
    guidance: 'Foreign Affairs / policy platform: 800-1500 words, deeper structural analysis permitted; subject specialists, Hill staff, agency officials.',
  },
  Politico: {
    words: 1000,
    guidance: 'Politico: ~1000 words, policy-mechanics focus, timely; Hill and agency audience.',
  },
  Regional: {
    words: 650,
    guidance: 'Regional / local daily: 500-800 words, direct regional relevance, local anecdotes, state-level calls to action; municipal voters and state legislators.',
  },
  Generic: {
    words: 800,
    guidance: 'General-interest opinion desk: ~800 words, strong news hook, plain language, broad public audience.',
  },
  TechPolicyPress: {
    words: 1500,
    guidance: 'Tech Policy Press (Perspective/Analysis): 1200-2000 words in 3-5 subheaded sections. Analytical and evidence-grounded with a clear argumentative throughline; sophisticated but clear (college-level register, precise policy vocabulary — do NOT dumb down, but keep sentences disciplined). Anchor in a specific, current policy development (named legislation, institution, or event) and draw out the broader governance/democratic stakes — concrete-first, not abstract theory. Sparing first person from a stated vantage; rhetorical questions and concrete hypotheticals used sparingly; cite verifiable sources. Audience: policymakers, technologists, researchers, and informed advocates at the tech-and-democracy intersection.',
    readability: { fkMax: 14, maxSentWords: 40, maxParaWords: 120 },
  },
};

export function resolveOutletBand(outlet: string | undefined): OutletBand {
  return OUTLET_BANDS[outlet ?? 'Generic'] ?? OUTLET_BANDS['Generic']!;
}
