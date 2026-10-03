// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { loadOutletsData } from './loadOutlets.js';

// Deterministic readability checks ported from measure_oped_quality.py (t/3707).
// Used by the conditional edit pass in generate.ts; exported for unit tests and
// CL's validation tooling.

export interface ReadabilityChecks {
  fkGrade: number;
  maxParaWords: number;
  maxSentWords: number;
}

function countSyllables(word: string): number {
  const cleaned = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!cleaned) return 0;
  const groups = cleaned.match(/[aeiouy]+/g) ?? [];
  // Silent trailing 'e': subtract one cluster when word ends in 'e' and has >1 cluster
  const count = cleaned.endsWith('e') && groups.length > 1 ? groups.length - 1 : groups.length;
  return Math.max(1, count);
}

/** Flesch-Kincaid grade level. Returns 0 for empty/single-word text. */
export function fkGrade(text: string): number {
  const words = text.match(/\b[a-zA-Z'-]+\b/g) ?? [];
  if (words.length === 0) return 0;
  // Split on terminal punctuation; drop empty fragments
  const sentences = text.split(/[.!?]+/).map(s => s.trim()).filter(s => /[a-zA-Z]/.test(s));
  if (sentences.length === 0) return 0;
  const syllables = words.reduce((sum, w) => sum + countSyllables(w), 0);
  return 0.39 * (words.length / sentences.length) + 11.8 * (syllables / words.length) - 15.59;
}

/** Word count of the longest paragraph (double-newline delimited). */
export function maxParagraphWords(text: string): number {
  const paras = text.split(/\n\n+/).map(p => p.trim()).filter(p => /[a-zA-Z]/.test(p));
  if (paras.length === 0) return 0;
  return Math.max(...paras.map(p => (p.match(/\b\S+\b/g) ?? []).length));
}

/** Word count of the longest sentence. */
export function maxSentenceWords(text: string): number {
  const sents = text.split(/[.!?]+/).map(s => s.trim()).filter(s => /[a-zA-Z]/.test(s));
  if (sents.length === 0) return 0;
  return Math.max(...sents.map(s => (s.match(/\b\S+\b/g) ?? []).length));
}

export function measureReadability(body: string): ReadabilityChecks {
  return {
    fkGrade: fkGrade(body),
    maxParaWords: maxParagraphWords(body),
    maxSentWords: maxSentenceWords(body),
  };
}

export interface ReadabilityTargets {
  fkMax: number;
  maxSentWords: number;
  maxParaWords: number;
}

export const DEFAULT_READABILITY_TARGETS: ReadabilityTargets = loadOutletsData().styleDefaults.readability;

/** True when the draft misses any target. Defaults to grade-10 targets. */
export function needsEdit(checks: ReadabilityChecks, targets: ReadabilityTargets = DEFAULT_READABILITY_TARGETS): boolean {
  return checks.fkGrade > targets.fkMax || checks.maxParaWords > targets.maxParaWords || checks.maxSentWords > targets.maxSentWords;
}

/** Render the specific violations for injection into the edit prompt's {{VIOLATIONS}} slot. */
export function buildViolationsText(checks: ReadabilityChecks, targets: ReadabilityTargets = DEFAULT_READABILITY_TARGETS): string {
  const parts: string[] = [];
  if (checks.fkGrade > targets.fkMax)
    parts.push(`Flesch-Kincaid grade: ${checks.fkGrade.toFixed(1)} (target: no higher than ${targets.fkMax})`);
  if (checks.maxParaWords > targets.maxParaWords)
    parts.push(`Longest paragraph: ${checks.maxParaWords} words (target: at most ~${targets.maxParaWords} words)`);
  if (checks.maxSentWords > targets.maxSentWords)
    parts.push(`Longest sentence: ${checks.maxSentWords} words (target: no sentence over ${targets.maxSentWords} words)`);
  return parts.join('\n');
}

// Banned AI-tells: the explicit list from the generation system prompt + soul-doc
// flattening verbs. Same set the generation prompt bans; the edit-pass guardrail
// checks that the edit did not INTRODUCE any that were absent from the original.
export const BANNED_TELLS: readonly string[] = [
  'in conclusion',
  'furthermore',
  'moreover',
  'ultimately',
  'it is important to note',
  'mitigate',
  'robust',
  'leverage',
  'utilize',
  'ensure',
];

/**
 * Deterministic paragraph-split backstop (t/3710). If the LLM edit pass still leaves
 * a paragraph over `maxWords`, this splits it at sentence boundaries into ≤maxWords
 * chunks. A single sentence longer than `maxWords` is left intact — the LLM is
 * responsible for sentence-level rewriting; this only inserts paragraph breaks.
 */
export function splitLongParagraphs(text: string, maxWords = 90): string {
  return text
    .split(/\n\n+/)
    .flatMap((para) => {
      if ((para.match(/\b\S+\b/g) ?? []).length <= maxWords) return [para];
      // Split at sentence-terminal whitespace, keeping punctuation with its sentence.
      const sentences = para.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 0);
      const chunks: string[] = [];
      let chunk = '';
      let chunkWords = 0;
      for (const sent of sentences) {
        const sw = (sent.match(/\b\S+\b/g) ?? []).length;
        if (chunk && chunkWords + sw > maxWords) {
          chunks.push(chunk.trim());
          chunk = sent;
          chunkWords = sw;
        } else {
          chunk = chunk ? `${chunk} ${sent}` : sent;
          chunkWords += sw;
        }
      }
      if (chunk.trim()) chunks.push(chunk.trim());
      return chunks.length > 0 ? chunks : [para];
    })
    .join('\n\n');
}

/**
 * Returns tells present in `edited` that were absent in `original` (case-insensitive).
 * An empty return means the edit introduced no new banned tells.
 */
export function findIntroducedTells(original: string, edited: string): string[] {
  const orig = original.toLowerCase();
  const edit = edited.toLowerCase();
  return BANNED_TELLS.filter(tell => !orig.includes(tell) && edit.includes(tell));
}
