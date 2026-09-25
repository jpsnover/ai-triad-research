// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Public read-only inquiry share view (t/3628, sibling of PublicOpEdView / t/2728).
//
// Renders a shared "Ask a Question" answer for a FULLY LOGGED-OUT visitor at
// `/inquiries/:shareId` — no login prompt, no App/loadAll mount, no `/ws` socket.
// Path shape matches what ServerAPI's mint route already ships (t/3626, PR #2405:
// `-> { shareId, url: '/inquiries/{shareId}' }`) — conforming to the already-landed
// server contract rather than the ticket's original `/share/inquiry/` guess.
//
// Binding invariant (same as PublicPovView/PublicOpEdView, TL t/1787#2): NO session/cookie
// is minted on this path. The fetch below is a RAW `fetch` — NOT a web-bridge helper —
// because bridge helpers route through `fetchWithSessionRecovery`, which POSTs
// `/api/auth/anonymous` on a `no_session` 401 and would silently mint a session.
// `credentials: 'omit'` guarantees no cookie is sent or stored. Registered as an approved
// bare-fetch exception in taxonomy-editor/AGENTS.md § Client Network Resilience.
//
// Renders `PublicInquiryShare` (@lib/inquiry, t/3648 part 2) — a SEPARATE, strict-schema
// projection of InquiryResult, never the full result and never `parseInquiryResult`
// (Server Auth, t/3628#2). Must-include per SO review (t/3628#2, e/201#2): singleRunCaveat,
// TrustState.reason (not just the verdict badge), and fidelity/model/rounds provenance —
// omitting these would let a reader unfamiliar with the Ask screen misread the answer.

import { useEffect, useState } from 'react';
import { getGlobalRecorder } from '@lib/flight-recorder/index';
import type { PublicInquiryShare } from '@lib/inquiry';
import { PublicInquiryShareContent } from './PublicInquiryShareContent';
import './PublicInquiryView.css';

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; doc: PublicInquiryShare }
  | { status: 'missing' }
  | { status: 'error' };

/**
 * Extract the shareId from an `/inquiries/<shareId>` pathname. Pure — shareIds are
 * randomUUIDs (`[A-Za-z0-9-]+`), so no decode/throw is needed; anything else returns
 * null and the view shows the not-found state.
 */
export function shareIdFromInquiryPath(pathname: string): string | null {
  const m = pathname.match(/^\/inquiries\/([A-Za-z0-9-]+)\/?$/);
  return m ? m[1] : null;
}

export function PublicInquiryView() {
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  useEffect(() => {
    const shareId = shareIdFromInquiryPath(window.location.pathname);
    if (!shareId) {
      setState({ status: 'missing' });
      return;
    }

    let cancelled = false;
    // Raw fetch bypasses the bridge's timeout layer, so guard it ourselves
    // (Network Resilience rule #1: every request has a timeout).
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    void (async () => {
      try {
        const res = await fetch(
          `/api/public/inquiry/${encodeURIComponent(shareId)}`,
          { method: 'GET', credentials: 'omit', cache: 'no-store', signal: controller.signal },
        );
        if (cancelled) return;
        if (res.status === 404) { setState({ status: 'missing' }); return; }
        if (!res.ok) { setState({ status: 'error' }); return; }
        const doc = await res.json() as PublicInquiryShare;
        if (cancelled) return;
        setState({ status: 'ready', doc });
      } catch (err) {
        if (cancelled) return;
        getGlobalRecorder()?.record({
          type: 'system.error',
          component: 'PublicInquiryView',
          level: 'error',
          message: 'Failed to load public inquiry share',
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
      <div className="pov-inquiry-root">
        <div className="pov-inquiry-card pov-inquiry-status">Loading…</div>
      </div>
    );
  }

  if (state.status === 'missing') {
    return (
      <div className="pov-inquiry-root">
        <div className="pov-inquiry-card pov-inquiry-status">
          <h1 className="pov-inquiry-status-title">Not available</h1>
          <p className="pov-inquiry-status-body">This shared question could not be found, or it isn’t publicly viewable.</p>
        </div>
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="pov-inquiry-root">
        <div className="pov-inquiry-card pov-inquiry-status">
          <h1 className="pov-inquiry-status-title">Couldn’t load this question</h1>
          <p className="pov-inquiry-status-body">Something went wrong loading this shared question. Please try again later.</p>
        </div>
      </div>
    );
  }

  const { doc } = state;

  return (
    <div className="pov-inquiry-root">
      <PublicInquiryShareContent doc={doc} />
    </div>
  );
}
