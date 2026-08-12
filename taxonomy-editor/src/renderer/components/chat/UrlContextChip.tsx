// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import type { UrlContextMetadata, UrlContextEntry } from '@lib/ai-client/index';
import './UrlContextChip.css';

type UrlContextEntryExt = UrlContextEntry & { source?: 'provider' | 'app-fetch'; truncated?: boolean };

function hostnameFrom(url: string): string {
  try {
    return new URL(url).hostname;
  } catch { /* telemetry — silent by design */
    return url;
  }
}

export function UrlContextChip({ metadata }: { metadata: UrlContextMetadata }) {
  const entries = metadata.urlMetadata;
  if (!entries || entries.length === 0) return null;

  return (
    <div className="url-context-chips" aria-label="URL context">
      {entries.map((entry, i) => {
        const e = entry as UrlContextEntryExt;
        const success = e.urlRetrievalStatus === 'SUCCESS';
        const isAppFetch = e.source === 'app-fetch';
        const host = hostnameFrom(e.retrievedUrl);
        const tooltip = isAppFetch
          ? (success ? `Fetched by app: ${e.retrievedUrl}` : `Couldn't fetch: ${e.retrievedUrl}`)
          : (success ? `Read: ${e.retrievedUrl}` : `Couldn't read: ${e.retrievedUrl}`);
        return (
          <span
            key={i}
            className={[
              'url-context-chip',
              success ? '' : 'url-context-chip--failed',
              isAppFetch ? 'url-context-chip--app-fetch' : '',
            ].filter(Boolean).join(' ')}
            title={tooltip}
          >
            {success ? `read: ${host}` : `couldn't read: ${host}`}
            {e.truncated && <span className="url-context-chip-truncated">[truncated]</span>}
          </span>
        );
      })}
    </div>
  );
}
