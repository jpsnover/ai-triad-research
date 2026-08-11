// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import type { UrlContextMetadata } from '@lib/ai-client/index';
import './UrlContextChip.css';

function hostnameFrom(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

export function UrlContextChip({ metadata }: { metadata: UrlContextMetadata }) {
  const entries = metadata.urlMetadata;
  if (!entries || entries.length === 0) return null;

  return (
    <div className="url-context-chips" aria-label="URL context">
      {entries.map((entry, i) => {
        const success = entry.urlRetrievalStatus === 'SUCCESS';
        const host = hostnameFrom(entry.retrievedUrl);
        return (
          <span
            key={i}
            className={`url-context-chip${success ? '' : ' url-context-chip--failed'}`}
            title={success
              ? `Read: ${entry.retrievedUrl}`
              : `Couldn't read: ${entry.retrievedUrl}`}
          >
            {success ? `read: ${host}` : `couldn't read: ${host}`}
          </span>
        );
      })}
    </div>
  );
}
