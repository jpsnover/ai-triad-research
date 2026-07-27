// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Public read-only POV share view (t/1790, child C of t/1787).
//
// Renders a single POV node for a FULLY LOGGED-OUT visitor at `/share/pov/:id`
// — no login prompt, no MainApp/loadAll mount, no `/ws` socket.
//
// Binding invariant (TL, t/1787#2): NO session/cookie is minted on this path.
// This is why the fetch below is a RAW `fetch` and NOT one of the web-bridge
// `get`/`post` helpers — those route through `fetchWithSessionRecovery`
// (web-bridge.ts:128-142), which POSTs `/api/auth/anonymous` on a `no_session`
// 401 and would silently mint an anonymous session. `credentials: 'omit'`
// guarantees no cookie is sent or stored. Registered as an approved bare-fetch
// exception in taxonomy-editor/AGENTS.md § Client Network Resilience.

import { useEffect, useState } from 'react';
import { getGlobalRecorder } from '@lib/flight-recorder/index';
import { POV_META, povKeyFromNodeId } from '@lib/electron-shared/povMeta';
import './PublicPovView.css';

/**
 * Public projection of a single POV node — MUST mirror the server-side
 * `PublicPovNode` positive allowlist (t/1788). Exactly these six fields are
 * public; no other node fields (`_edit_meta`, authorship, `graph_attributes`,
 * timestamps, moderation) are ever exposed.
 */
export interface PublicPovNode {
  nodeId: string;
  pov: string;
  category: string;
  label: string;
  description: string;
  aphorism: string;
}

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; node: PublicPovNode }
  | { status: 'missing' }
  | { status: 'error' };

/**
 * Extract the node id from a `/share/pov/<nodeId>` pathname. Pure — valid node
 * ids are `[A-Za-z0-9_-]+`, so no decode/throw is needed; anything else returns
 * null and the view shows the not-found state.
 */
export function nodeIdFromSharePath(pathname: string): string | null {
  const m = pathname.match(/^\/share\/pov\/([A-Za-z0-9_-]+)\/?$/);
  return m ? m[1] : null;
}

export function PublicPovView() {
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  useEffect(() => {
    const nodeId = nodeIdFromSharePath(window.location.pathname);
    // v1 is POV-only (t/1787 scope): reject non-POV ids (situations/policy/etc.).
    const povKey = nodeId ? povKeyFromNodeId(nodeId) : undefined;
    if (!nodeId || !povKey || povKey === 'situations') {
      setState({ status: 'missing' });
      return;
    }

    let cancelled = false;
    // Raw fetch bypasses the bridge's timeout layer, so guard it ourselves
    // (Network Resilience rule #1: every request has a timeout) — a hung public
    // endpoint must not leave the view spinning on "Loading…".
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    void (async () => {
      try {
        const res = await fetch(
          `/api/public/pov/${encodeURIComponent(povKey)}/node/${encodeURIComponent(nodeId)}`,
          { method: 'GET', credentials: 'omit', cache: 'no-store', signal: controller.signal },
        );
        if (cancelled) return;
        if (res.status === 404) { setState({ status: 'missing' }); return; }
        if (!res.ok) { setState({ status: 'error' }); return; }
        const node = await res.json() as PublicPovNode;
        if (cancelled) return;
        setState({ status: 'ready', node });
      } catch (err) {
        if (cancelled) return;
        getGlobalRecorder()?.record({
          type: 'system.error',
          component: 'PublicPovView',
          level: 'error',
          message: 'Failed to load public POV node',
          error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
        });
        setState({ status: 'error' });
      } finally {
        clearTimeout(timeout);
      }
    })();
    return () => { cancelled = true; clearTimeout(timeout); };
  }, []);

  if (state.status === 'loading') {
    return (
      <div className="ppv-root">
        <div className="ppv-card ppv-status">Loading…</div>
      </div>
    );
  }

  if (state.status === 'missing') {
    return (
      <div className="ppv-root">
        <div className="ppv-card ppv-status">
          <h1 className="ppv-status-title">Not available</h1>
          <p className="ppv-status-body">This shared item could not be found, or it isn’t publicly viewable.</p>
        </div>
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="ppv-root">
        <div className="ppv-card ppv-status">
          <h1 className="ppv-status-title">Couldn’t load this item</h1>
          <p className="ppv-status-body">Something went wrong loading this shared item. Please try again later.</p>
        </div>
      </div>
    );
  }

  const { node } = state;
  const meta = povKeyFromNodeId(node.nodeId);
  const povClass = meta ? `ppv-pov-${POV_META[meta].shortLabel.toLowerCase()}` : '';
  const povLabel = meta ? POV_META[meta].label : node.pov;

  return (
    <div className={`ppv-root ${povClass}`}>
      <article className="ppv-card" aria-label="Shared POV item">
        <div className="ppv-badges">
          <span className="ppv-badge ppv-badge-pov">{povLabel}</span>
          {node.category ? <span className="ppv-badge ppv-badge-category">{node.category}</span> : null}
        </div>
        <h1 className="ppv-label">{node.label}</h1>
        {node.aphorism ? <p className="ppv-aphorism">“{node.aphorism}”</p> : null}
        {node.description ? <p className="ppv-description">{node.description}</p> : null}
        <footer className="ppv-footer">
          <span className="ppv-node-id">{node.nodeId}</span>
          <span className="ppv-brand">AI Triad Research</span>
        </footer>
      </article>
    </div>
  );
}
