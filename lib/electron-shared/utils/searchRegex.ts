// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Core search modes supported by the shared utility.
 * Apps can extend with app-specific modes (e.g. 'similar', 'semantic')
 * by passing a wider string type to buildSearchRegex.
 */
export type CoreSearchMode = 'raw' | 'wildcard' | 'regex';

/**
 * Build a RegExp from a user query and search mode.
 *
 * For the three core modes (raw, wildcard, regex) the function returns a
 * compiled RegExp.  For any other mode string (app-specific modes like
 * 'similar' or 'semantic') it returns null so the caller can handle those
 * modes with custom logic.
 */
export function buildSearchRegex(
  query: string,
  mode: string,
  caseSensitive: boolean,
): RegExp | null {
  if (!query) return null;
  // App-specific modes that don't produce a regex
  if (mode !== 'raw' && mode !== 'wildcard' && mode !== 'regex') return null;
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
