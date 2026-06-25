// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { getGlobalRecorder } from '@lib/flight-recorder/index';

export interface SourceSentence {
  text: string;
  start: number;
}

/** Split text into sentences (rough but effective). Fragments ≤10 chars are skipped. */
export function splitSentences(text: string): SourceSentence[] {
  const results: SourceSentence[] = [];
  // Split on sentence-ending punctuation followed by whitespace.
  const regex = /[^.!?\n]+[.!?\n]+[\s]*/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const s = match[0].trim();
    if (s.length > 10) results.push({ text: s, start: match.index });
  }
  return results;
}

/** Convert a wildcard pattern (`*` and `?`) into a global, case-insensitive RegExp, or null if invalid. */
export function wildcardToRegex(pattern: string): RegExp | null {
  try {
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
    return new RegExp(escaped, 'gi');
  } catch (err) {
    getGlobalRecorder()?.record({
      type: 'system.error',
      component: 'debate-source-viewer',
      level: 'warn',
      message: 'Invalid wildcard pattern',
      error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
    });
    return null;
  }
}
