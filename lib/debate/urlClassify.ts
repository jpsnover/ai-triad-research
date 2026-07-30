/**
 * Classify a resolved URL into a source type for citation pipeline tracing.
 * Uses proper URL parsing (not substring matching) to prevent typosquatting.
 */
export function classifyUrl(
  url: string,
): 'doi' | 'arxiv' | 'ssrn' | 'scholar_fallback' | 'google_fallback' | 'direct' | 'none' {
  if (!url) return 'none';
  try {
    const { hostname, pathname } = new URL(url);
    if (hostname === 'doi.org' || hostname.endsWith('.doi.org')) return 'doi';
    if (hostname === 'arxiv.org' || hostname.endsWith('.arxiv.org')) return 'arxiv';
    if (hostname === 'ssrn.com' || hostname.endsWith('.ssrn.com')) return 'ssrn';
    if (hostname === 'scholar.google.com' || hostname.endsWith('.scholar.google.com')) return 'scholar_fallback';
    if (
      (hostname === 'google.com' || hostname === 'www.google.com') &&
      pathname.startsWith('/search')
    )
      return 'google_fallback';
  } catch {
    /* invalid URL — treat as direct */
  }
  return 'direct';
}
