import type { SearchMode } from '../types/types';

export function buildSearchRegex(
  query: string,
  mode: SearchMode,
  caseSensitive: boolean,
): RegExp | null {
  if (!query) return null;
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
