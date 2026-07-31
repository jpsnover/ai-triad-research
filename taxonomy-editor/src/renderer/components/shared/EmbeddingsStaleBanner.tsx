// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useTaxonomyStore } from '../../hooks/useTaxonomyStore';
import './EmbeddingsStaleBanner.css';

/**
 * Coarse, non-blocking degradation banner for t/2064. When a post-save embedding
 * refresh reports stale nodes (or the refresh call rejects), the store sets
 * `embeddingsStale` — the save itself succeeded durably, but similarity / related-node
 * results may be temporarily out of date. This surfaces that honestly instead of the
 * old fire-and-forget swallow, without blocking the save. Per-node badging is a
 * fast-follow; this coarse "any stale → one banner" indicator is the TL-scoped v1.
 */
export function EmbeddingsStaleBanner() {
  const embeddingsStale = useTaxonomyStore((s) => s.embeddingsStale);
  const dismiss = useTaxonomyStore((s) => s.dismissEmbeddingsStale);

  if (!embeddingsStale) return null;

  return (
    <div className="embeddings-stale-banner" role="status" aria-live="polite">
      <svg className="embeddings-stale-banner-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M8 1l7 14H1L8 1z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
        <line x1="8" y1="6" x2="8" y2="9.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        <circle cx="8" cy="12" r="0.6" fill="currentColor" />
      </svg>
      <span className="embeddings-stale-banner-text">
        Embeddings stale — similarity results may be outdated until the next successful save.
      </span>
      <button
        className="embeddings-stale-banner-dismiss"
        onClick={dismiss}
        aria-label="Dismiss stale-embeddings notice"
      >
        &times;
      </button>
    </div>
  );
}
