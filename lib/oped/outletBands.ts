// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

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
    style: {
      audience: 'persuade an informed policy audience — policymakers, technologists, researchers, and advocates at the tech-and-democracy intersection',
      readingLevel: 'Write for a college-educated policy audience — Flesch-Kincaid grade ~13 (no higher than 14). Achieve clarity through sentence discipline, NOT by simplifying vocabulary: keep the precise policy and technical terms your expert readers expect.',
      sentenceMechanics: 'average under ~24 words; no sentence over 40 words. Vary length; after a long sentence, a short one.',
      paragraphMechanics: 'at most ~120 words per paragraph.',
      jargonGuidance: 'Use the precise policy/technical vocabulary your expert audience expects; define only genuinely obscure terms. Do NOT flatten specialized terms into lay paraphrase.',
      bodyFormat: 'Organize the body into **3-5 sections with short Markdown `##` subheadings**; each section advances one part of the argument. Do NOT repeat the headline inside the body.',
    },
  },
};

export function resolveOutletBand(outlet: string | undefined): OutletBand {
  return OUTLET_BANDS[outlet ?? 'TechPolicyPress'] ?? OUTLET_BANDS['TechPolicyPress']!;
}
