// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

export type SearchMode = 'raw' | 'wildcard' | 'regex' | 'similar';

export function buildSearchRegex(
  query: string,
  mode: SearchMode,
  caseSensitive: boolean,
): RegExp | null {
  if (!query || mode === 'similar') return null;
  try {
    let pattern: string;
    if (mode === 'raw') {
      pattern = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    } else if (mode === 'wildcard') {
      pattern = query
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.');
    } else {
      pattern = query;
    }
    return new RegExp(pattern, caseSensitive ? 'g' : 'gi');
  } catch {
    return null;
  }
}
