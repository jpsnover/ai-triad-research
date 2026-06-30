// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

const SENTENCE_SPLITTER = /[.!?]+(?:\s|$)/;

export function meanSentenceLength(text: string): number {
  const sentences = text.split(SENTENCE_SPLITTER).filter(s => s.trim().length > 0);
  if (sentences.length === 0) return 0;
  const totalWords = sentences.reduce((sum, s) => sum + wordCount(s), 0);
  return totalWords / sentences.length;
}

export function lexicalDiversity(text: string): number {
  const words = extractWords(text);
  if (words.length === 0) return 0;
  const unique = new Set(words);
  return unique.size / words.length;
}

export function jargonDensity(text: string, domainTerms: Set<string>): number {
  const words = extractWords(text);
  if (words.length === 0) return 0;
  const jargonCount = words.filter(w => domainTerms.has(w)).length;
  return jargonCount / words.length;
}

function extractWords(text: string): string[] {
  return text.toLowerCase().match(/[a-z'-]+/g)?.filter(w => w.length >= 2) ?? [];
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(w => w.length > 0).length;
}
