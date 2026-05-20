// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Replace internal speaker IDs (prometheus, sentinel, cassandra) with
 * display labels (Accelerationist, Safetyist, Skeptic) in AI-generated text.
 *
 * Case-insensitive; preserves possessives (e.g. "prometheus's" → "Accelerationist's").
 */

const SPEAKER_MAP: [RegExp, string][] = [
  [/\bprometheus\b/gi, 'Accelerationist'],
  [/\bsentinel\b/gi, 'Safetyist'],
  [/\bcassandra\b/gi, 'Skeptic'],
];

export function humanizeSpeakerIds(text: string): string {
  let result = text;
  for (const [re, label] of SPEAKER_MAP) {
    result = result.replace(re, label);
  }
  return result;
}
