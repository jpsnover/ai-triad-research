// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Shared detail-pane primitives (t/1882, TL decision 1 / option C). Extracted from
// OrganizationDetail so BOTH OrganizationDetail (feature) and EntityDetail (shared)
// import them from one neutral home — `shared/` must not depend on a sibling feature
// folder. Class names keep the `od-*` prefix so OrganizationDetail's markup is
// untouched by the move; the CSS rules relocate here alongside the components.

import { useState } from 'react';
import { api } from '@bridge';
import { getGlobalRecorder } from '@lib/flight-recorder/index';
import './DetailPrimitives.css';

/** hostname of a URL, or `null` for an unparseable value (expected data, not an error). */
export function extractDomain(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch { /* telemetry — silent by design: invalid URLs are expected data, not errors */
    return null;
  }
}

/** Human-readable "host / first-segment" label for a URL; falls back to the raw url. */
export function humanizeUrl(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    const seg = u.pathname.split('/').filter(Boolean)[0];
    return seg ? `${host} / ${decodeURIComponent(seg)}` : host;
  } catch { /* telemetry — silent by design */
    return url;
  }
}

/** Small pill for a record's type/category. Reused by Organization + Entity detail. */
export function TypeBadge({ type }: { type?: string }) {
  if (!type) return null;
  return (
    <span className="od-type-badge">
      {type.replace(/_/g, ' ')}
    </span>
  );
}

/**
 * External reference as a favicon + label + domain row that opens in the system
 * browser via the bridge (never a bare window.open). Reused by Organization +
 * Entity detail for their `external_refs` / links sections.
 */
export function ExternalLinkRow({ url, title, type, orgUrl }: { url: string; title?: string; type?: string; orgUrl?: string }) {
  const [faviconFailed, setFaviconFailed] = useState(false);
  const domain = extractDomain(url);
  const hostClean = domain?.replace(/^www\./, '') ?? null;
  const faviconSrc = domain && !faviconFailed
    ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=32`
    : null;
  const label = title || humanizeUrl(url);
  const labelIsHostname = !title;
  const isOrgOwn = orgUrl ? extractDomain(orgUrl) === domain : false;
  const showType = type && !(type === 'website' && isOrgOwn);
  const showDomain = !labelIsHostname && hostClean;
  const isValid = domain !== null;

  return (
    <button
      className="btn-ghost od-ext-link-btn"
      /* eslint-disable-next-line local/no-inline-style -- cursor/opacity depend on isValid, passed as CSS custom properties */
      style={{ '--cursor': isValid ? 'pointer' : 'default', '--opacity': isValid ? 1 : 0.6 } as React.CSSProperties}
      title={url}
      aria-label={`${label}, opens ${hostClean ?? 'link'} in browser`}
      disabled={!isValid}
      onClick={() => {
        if (!isValid) return;
        void api.openExternal(url).catch((err: unknown) => {
          getGlobalRecorder()?.record({
            type: 'system.error', component: 'detail-primitives', level: 'error',
            message: 'Failed to open external link',
            error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
          });
        });
      }}
    >
      {faviconSrc ? (
        <img src={faviconSrc} alt="" width={16} height={16} className="od-ext-favicon-img" onError={() => setFaviconFailed(true)} />
      ) : (
        <span className="od-ext-favicon-placeholder">{'○'}</span>
      )}
      <span
        className="od-ext-label"
        style={{ '--label-color': isValid ? 'var(--info, #3b82f6)' : 'var(--text-muted)' } as React.CSSProperties}
      >
        {label}
      </span>
      {showType && (
        <span className="od-ext-type-badge">
          {type!.replace(/_/g, ' ')}
        </span>
      )}
      {showDomain ? (
        <span className="od-ext-domain">{hostClean} {'↗'}</span>
      ) : isValid ? (
        <span className="od-ext-domain">{'↗'}</span>
      ) : null}
    </button>
  );
}
