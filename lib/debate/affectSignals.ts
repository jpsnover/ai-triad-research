// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import type { DebatePhase } from './types.js';

export type AffectCategory = 'urgency' | 'fear' | 'hope' | 'outrage' | 'empathy';
export type AffectProfile = Record<AffectCategory, number>;

export const AFFECT_CATEGORIES: AffectCategory[] = ['urgency', 'fear', 'hope', 'outrage', 'empathy'];

export const AFFECT_LEXICONS: Record<AffectCategory, string[]> = {
  urgency: [
    'immediately', 'urgent', 'urgently', 'critical', 'critically',
    'crisis', 'emergency', 'imminent', 'imminently', 'pressing',
    'without delay', 'must act', 'cannot wait', "before it's too late",
    'rapid', 'rapidly', 'swift', 'swiftly', 'deadline', 'imperative',
    'overdue', 'at once', 'no time to waste', 'act now', 'accelerating',
    'vital', 'essential', 'necessity', 'demands immediate',
  ],
  fear: [
    'danger', 'dangerous', 'threat', 'threaten', 'risk', 'risky',
    'harmful', 'catastrophic', 'catastrophe', 'devastating', 'disastrous',
    'disaster', 'alarming', 'alarm', 'worried', 'peril', 'perilous',
    'hazard', 'hazardous', 'menace', 'menacing', 'dire', 'existential',
    'nightmare', 'irreversible', 'uncontrollable', 'unpredictable',
    'jeopardize', 'endanger', 'undermine', 'could lead to',
    'may result in', 'fallout', 'frightening', 'terrifying', 'severe',
  ],
  hope: [
    'hope', 'hopeful', 'promising', 'potential', 'opportunity',
    'improve', 'improvement', 'progress', 'benefit', 'beneficial',
    'advantage', 'optimistic', 'optimism', 'flourish', 'transform',
    'transformative', 'advancement', 'solution', 'breakthrough', 'positive',
    'vision', 'aspire', 'aspiration', 'enable', 'empower', 'can achieve',
    'will allow', 'opens the door', 'path forward', 'constructive',
    'productive', 'innovative', 'unlock',
  ],
  outrage: [
    'outrageous', 'unacceptable', 'intolerable', 'unjust', 'unfair',
    'disgraceful', 'shameful', 'appalling', 'egregious', 'inexcusable',
    'immoral', 'violation', 'exploit', 'exploitative', 'reckless',
    'recklessly', 'negligent', 'negligence', 'irresponsible', 'arrogant',
    'callous', 'refuse to', 'turn a blind eye', 'scandalous',
    'unconscionable', 'reprehensible', 'deplorable', 'at the expense of',
    'willfully ignore', 'deliberately disregard', 'contemptible',
  ],
  empathy: [
    'people', 'human', 'community', 'communities', 'victim', 'victims',
    'suffer', 'suffering', 'pain', 'impact on', 'lived experience',
    'families', 'workers', 'vulnerable', 'dignity', 'welfare', 'wellbeing',
    'affected by', 'those who', 'real people', 'ordinary', 'day to day',
    'in practice', 'individual', 'individuals', 'struggle', 'burden',
    'harm to', 'care', 'compassion',
  ],
};

export const AFFECT_SATURATION_RATE: Record<AffectCategory, number> = {
  urgency: 4.0,
  fear:    3.0,
  hope:    5.0,
  outrage: 2.5,
  empathy: 4.0,
};

export const AFFECT_PHASE_BASELINES: Record<Exclude<DebatePhase, 'terminated'>, AffectProfile> = {
  confrontation: { urgency: 0.30, fear: 0.25, hope: 0.20, outrage: 0.20, empathy: 0.15 },
  argumentation: { urgency: 0.20, fear: 0.15, hope: 0.35, outrage: 0.10, empathy: 0.25 },
  concluding:    { urgency: 0.25, fear: 0.10, hope: 0.45, outrage: 0.05, empathy: 0.30 },
};

const INTENSITY_WEIGHTS: Record<AffectCategory, number> = {
  urgency: 0.20,
  fear:    0.30,
  hope:    0.10,
  outrage: 0.30,
  empathy: 0.10,
};

const MAX_ACCEPTABLE_DEVIATION = 0.35;
const MIN_WORD_COUNT = 20;

function categoryScore(text: string, category: AffectCategory): number {
  const wordCount = Math.max(1, text.split(/\s+/).length);
  const lower = text.toLowerCase();
  const hits = AFFECT_LEXICONS[category].filter(term => lower.includes(term)).length;
  const rate = (hits / wordCount) * 100;
  return Math.min(1.0, rate / AFFECT_SATURATION_RATE[category]);
}

export function computeAffectEvidence(text: string): Record<AffectCategory, string[]> {
  const empty: Record<AffectCategory, string[]> = { urgency: [], fear: [], hope: [], outrage: [], empathy: [] };
  if (text.split(/\s+/).length < MIN_WORD_COUNT) return empty;
  const lower = text.toLowerCase();
  const result = { ...empty };
  for (const cat of AFFECT_CATEGORIES) {
    result[cat] = AFFECT_LEXICONS[cat].filter(term => lower.includes(term));
  }
  return result;
}

export function computeAffectProfile(text: string): AffectProfile | null {
  if (text.split(/\s+/).length < MIN_WORD_COUNT) return null;
  const profile = {} as AffectProfile;
  for (const cat of AFFECT_CATEGORIES) {
    profile[cat] = categoryScore(text, cat);
  }
  return profile;
}

export function computeAffectIntensity(text: string): number | null {
  if (text.split(/\s+/).length < MIN_WORD_COUNT) return null;
  return AFFECT_CATEGORIES.reduce(
    (sum, cat) => sum + INTENSITY_WEIGHTS[cat] * categoryScore(text, cat),
    0,
  );
}

export function computeAffectAppropriateness(
  profile: AffectProfile,
  phase: DebatePhase,
): number | null {
  if (phase === 'terminated') return null;
  const baseline = AFFECT_PHASE_BASELINES[phase];
  const meanDeviation =
    AFFECT_CATEGORIES.reduce((sum, cat) => sum + Math.abs(profile[cat] - baseline[cat]), 0) /
    AFFECT_CATEGORIES.length;
  return Math.max(0, 1 - meanDeviation / MAX_ACCEPTABLE_DEVIATION);
}
