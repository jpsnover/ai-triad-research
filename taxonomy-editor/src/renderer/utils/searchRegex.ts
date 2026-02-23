import type { SearchMode } from '../hooks/useTaxonomyStore';

export function buildSearchRegex(
  query: string,
  mode: SearchMode,
  caseSensitive: boolean,
): RegExp | null {
  if (!query || mode === 'semantic') return null;
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
