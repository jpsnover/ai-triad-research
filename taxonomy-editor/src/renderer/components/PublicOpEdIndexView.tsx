// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Public op-ed index — lists every shared op-ed set for a FULLY LOGGED-OUT visitor at
// `/share/opeds`, each entry linking to its `/share/oped/:shareId` page (t/3482, sibling of
// PublicOpEdView / t/2728).
//
// Binding invariant (same as PublicOpEdView, TL t/1787#2): NO session/cookie is minted on
// this path — raw `fetch`, not a web-bridge helper (those route through
// `fetchWithSessionRecovery`, which POSTs `/api/auth/anonymous` on a `no_session` 401).
// `credentials: 'omit'` guarantees no cookie is sent or stored. Registered as an approved
// bare-fetch exception in taxonomy-editor/AGENTS.md § Client Network Resilience.

import { useEffect, useState } from 'react';
import { getGlobalRecorder } from '@lib/flight-recorder/index';
import { resolvePovMeta } from './opeds/povResolve';
import './PublicOpEdIndexView.css';

/** Contract owned by t/3481 (`GET /api/public/opeds`) — build to this interface. */
export interface PublicOpEdIndexEntry {
  shareId: string;
  title: string;
  outlet: string;
  camps: string[];
  wordCounts?: number[];
  sharedAt?: string;
}
interface PublicOpEdIndex {
  opeds: PublicOpEdIndexEntry[];
}

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; entries: PublicOpEdIndexEntry[] }
  | { status: 'error' };

function OpEdIndexEntryRow({ entry }: { entry: PublicOpEdIndexEntry }) {
  const campLine = entry.camps.map(pov => resolvePovMeta(pov).label).join(' · ');
  const href = `/share/oped/${encodeURIComponent(entry.shareId)}`;
  return (
    <li className="pov-oped-index-entry">
      <a className="pov-oped-index-link" href={href}>
        <span className="pov-oped-index-title">{entry.title}</span>
        <span className="pov-oped-index-meta">
          {[entry.outlet || null, campLine || null].filter(Boolean).join(' · ')}
        </span>
      </a>
    </li>
  );
}

export function PublicOpEdIndexView() {
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    // Raw fetch bypasses the bridge's timeout layer, so guard it ourselves
    // (Network Resilience rule #1: every request has a timeout).
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    void (async () => {
      try {
        const res = await fetch(
          '/api/public/opeds',
          { method: 'GET', credentials: 'omit', cache: 'no-store', signal: controller.signal },
        );
        if (cancelled) return;
        if (!res.ok) { setState({ status: 'error' }); return; }
        const doc = await res.json() as PublicOpEdIndex;
        if (cancelled) return;
        setState({ status: 'ready', entries: doc.opeds });
      } catch (err) {
        if (cancelled) return;
        getGlobalRecorder()?.record({
          type: 'system.error',
          component: 'PublicOpEdIndexView',
          level: 'error',
          message: 'Failed to load public op-ed index',
          error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
        });
        setState({ status: 'error' });
      } finally {
        clearTimeout(timeout);
      }
    })();
    return () => { cancelled = true; clearTimeout(timeout); controller.abort(); };
  }, []);

  if (state.status === 'loading') {
    return (
      <div className="pov-oped-index-root">
        <div className="pov-oped-index-card pov-oped-index-status">Loading…</div>
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="pov-oped-index-root">
        <div className="pov-oped-index-card pov-oped-index-status">
          <h1 className="pov-oped-index-status-title">Couldn’t load shared op-eds</h1>
          <p className="pov-oped-index-status-body">Something went wrong loading this list. Please try again later.</p>
        </div>
      </div>
    );
  }

  const { entries } = state;
  return (
    <div className="pov-oped-index-root">
      <div className="pov-oped-index-card" aria-label="Shared op-eds">
        <header className="pov-oped-index-head">
          <h1 className="pov-oped-index-title">Shared Op-Eds</h1>
        </header>
        {entries.length === 0 ? (
          // ADR-001 graceful-empty: an explicit state, never a blank page.
          <p className="pov-oped-index-empty">No op-eds have been shared yet.</p>
        ) : (
          <ul className="pov-oped-index-list">
            {entries.map(entry => <OpEdIndexEntryRow key={entry.shareId} entry={entry} />)}
          </ul>
        )}
        <footer className="pov-oped-index-footer">
          <span className="pov-oped-index-brand">AI Triad Research</span>
        </footer>
      </div>
    </div>
  );
}
