// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

export interface OutletBand {
  words: number;
  guidance: string;
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
};

export function resolveOutletBand(outlet: string | undefined): OutletBand {
  return OUTLET_BANDS[outlet ?? 'Generic'] ?? OUTLET_BANDS['Generic']!;
}
