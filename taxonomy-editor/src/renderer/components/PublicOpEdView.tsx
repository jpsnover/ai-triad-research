// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Public read-only op-ed share view (t/2728, sibling of PublicPovView / t/1790).
//
// Renders a shared op-ed SET for a FULLY LOGGED-OUT visitor at `/share/oped/:shareId`
// — no login prompt, no App/loadAll mount, no `/ws` socket.
//
// Binding invariant (same as PublicPovView, TL t/1787#2): NO session/cookie is
// minted on this path. The fetch below is a RAW `fetch` — NOT a web-bridge helper —
// because those route through `fetchWithSessionRecovery`, which POSTs
// `/api/auth/anonymous` on a `no_session` 401 and would silently mint a session.
// `credentials: 'omit'` guarantees no cookie is sent or stored. Registered as an
// approved bare-fetch exception in taxonomy-editor/AGENTS.md § Client Network Resilience.

import { useEffect, useState, useCallback, useRef } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { getGlobalRecorder } from '@lib/flight-recorder/index';
import { resolvePovMeta } from './opeds/povResolve';
import './PublicOpEdView.css';

/**
 * Public projection of a shared op-ed set — MUST mirror the server-side
 * `PublicOpEd` / `PublicOpEdMember` positive allowlist (opedShareStore.ts). Exactly
 * these fields are public; generation params (model/prompts/thesis/authorBio),
 * grounding internals, userId and the storage set_id are never exposed.
 */
export interface PublicOpEdMember {
  pov: string;
  status: string;
  headline: string;
  subtitle: string;
  body: string;
  wordCount: number;
}
export interface PublicOpEd {
  schema_version: 1;
  shareId: string;
  topic: string;
  outlet: string | null;
  created_at: string;
  opeds: PublicOpEdMember[];
}

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; doc: PublicOpEd }
  | { status: 'missing' }
  | { status: 'error' };

/**
 * Extract the shareId from a `/share/oped/<shareId>` pathname. Pure — shareIds are
 * randomUUIDs (`[A-Za-z0-9-]+`), so no decode/throw is needed; anything else returns
 * null and the view shows the not-found state.
 */
export function shareIdFromOpEdPath(pathname: string): string | null {
  const m = pathname.match(/^\/share\/oped\/([A-Za-z0-9-]+)\/?$/);
  return m ? m[1] : null;
}

function OpEdArticle({ member, outlet }: { member: PublicOpEdMember; outlet: string | null }) {
  const meta = resolvePovMeta(member.pov);
  const metaLine = [meta.label.toUpperCase(), outlet || null, `${member.wordCount} words`]
    .filter(Boolean).join(' · ');

  return (
    <article className="pov-oped-article">
      <div
        className="pov-oped-strip"
        // eslint-disable-next-line local/no-inline-style -- dynamic: camp accent color from POV_META cssVar (theme-aware)
        style={{ borderLeftColor: `var(${meta.cssVar})` }}
      >
        {metaLine}
      </div>
      {member.status !== 'complete' ? (
        <div className="pov-oped-notice" role="status">
          This voice {member.status === 'failed' ? 'failed to generate' : 'was cancelled'} — no essay is available for it.
        </div>
      ) : (
        <>
          <h2 className="pov-oped-headline">{member.headline}</h2>
          {member.subtitle && <p className="pov-oped-subtitle">{member.subtitle}</p>}
          <div className="pov-oped-body">
            <Markdown remarkPlugins={[remarkGfm]}>{member.body}</Markdown>
          </div>
        </>
      )}
    </article>
  );
}

// t/3485: PI feedback on the deployed t/3477 fix — stacking all op-eds sequentially traded one
// burial (situation wall) for another (only the first op-ed visible without scrolling, no
// indication two more exist). Mirrors OpEdReader.tsx's in-app tab pattern exactly (roving-
// tabindex tablist, same keyboard nav, same single-voice-has-no-tabs ruling t/2576#3) so the
// public and in-app experiences stay consistent.
function OpEdTabbedArticles({ members, outlet }: { members: PublicOpEdMember[]; outlet: string | null }) {
  const [activeIdx, setActiveIdx] = useState(0);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const onTabKeyDown = useCallback((e: React.KeyboardEvent, idx: number) => {
    let next = idx;
    if (e.key === 'ArrowRight') next = (idx + 1) % members.length;
    else if (e.key === 'ArrowLeft') next = (idx - 1 + members.length) % members.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = members.length - 1;
    else return;
    e.preventDefault();
    setActiveIdx(next);
    tabRefs.current[next]?.focus();
  }, [members.length]);

  if (members.length === 0) {
    return <p className="pov-oped-empty">This shared op-ed has no voices.</p>;
  }
  if (members.length === 1) {
    return <OpEdArticle member={members[0]} outlet={outlet} />;
  }

  const active = members[Math.min(activeIdx, members.length - 1)];

  return (
    <>
      <div className="pov-oped-tabstrip" role="tablist" aria-label="Op-ed voices">
        {members.map((m, i) => {
          const meta = resolvePovMeta(m.pov);
          const isActive = i === activeIdx;
          return (
            <button
              key={`${m.pov}-${i}`}
              ref={el => { tabRefs.current[i] = el; }}
              type="button"
              role="tab"
              id={`pov-oped-tab-${i}`}
              aria-selected={isActive}
              aria-controls="pov-oped-panel"
              tabIndex={isActive ? 0 : -1}
              className={`pov-oped-tab${isActive ? ' pov-oped-tab-active' : ''}`}
              // eslint-disable-next-line local/no-inline-style -- dynamic: active underline uses the camp's theme color
              style={isActive ? { borderBottomColor: `var(${meta.cssVar})`, color: `var(${meta.cssVar})` } : undefined}
              onClick={() => setActiveIdx(i)}
              onKeyDown={e => onTabKeyDown(e, i)}
            >
              {meta.label}
            </button>
          );
        })}
      </div>
      <div role="tabpanel" id="pov-oped-panel" aria-labelledby={`pov-oped-tab-${activeIdx}`}>
        <OpEdArticle member={active} outlet={outlet} />
      </div>
    </>
  );
}

export function PublicOpEdView() {
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  useEffect(() => {
    const shareId = shareIdFromOpEdPath(window.location.pathname);
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
          `/api/public/oped/${encodeURIComponent(shareId)}`,
          { method: 'GET', credentials: 'omit', cache: 'no-store', signal: controller.signal },
        );
        if (cancelled) return;
        if (res.status === 404) { setState({ status: 'missing' }); return; }
        if (!res.ok) { setState({ status: 'error' }); return; }
        const doc = await res.json() as PublicOpEd;
        if (cancelled) return;
        setState({ status: 'ready', doc });
      } catch (err) {
        if (cancelled) return;
        getGlobalRecorder()?.record({
          type: 'system.error',
          component: 'PublicOpEdView',
          level: 'error',
          message: 'Failed to load public op-ed share',
          error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
        });
        setState({ status: 'error' });
      } finally {
        clearTimeout(timeout);
      }
    })();
    // Abort the in-flight fetch on unmount, not just clear the timer — clearing
    // the timeout alone suppresses the timer-driven abort, so the request would
    // otherwise run to completion after the component is gone. The sibling
    // PublicPovView fix (t/2755) missed this view; same one-line cleanup here.
    return () => { cancelled = true; clearTimeout(timeout); controller.abort(); };
  }, []);

  if (state.status === 'loading') {
    return (
      <div className="pov-oped-root">
        <div className="pov-oped-card pov-oped-status">Loading…</div>
      </div>
    );
  }

  if (state.status === 'missing') {
    return (
      <div className="pov-oped-root">
        <div className="pov-oped-card pov-oped-status">
          <h1 className="pov-oped-status-title">Not available</h1>
          <p className="pov-oped-status-body">This shared op-ed could not be found, or it isn’t publicly viewable.</p>
        </div>
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="pov-oped-root">
        <div className="pov-oped-card pov-oped-status">
          <h1 className="pov-oped-status-title">Couldn’t load this op-ed</h1>
          <p className="pov-oped-status-body">Something went wrong loading this shared op-ed. Please try again later.</p>
        </div>
      </div>
    );
  }

  const { doc } = state;
  return (
    <div className="pov-oped-root">
      <div className="pov-oped-card" aria-label="Shared op-ed">
        {doc.outlet ? (
          <header className="pov-oped-head">
            <p className="pov-oped-outlet">For {doc.outlet}</p>
          </header>
        ) : null}
        <OpEdTabbedArticles members={doc.opeds} outlet={doc.outlet} />
        {/* Situation topic is source context, not the lead content — the op-eds above
            are (t/3477). Clamped to a scrollable box so a long situation narrative
            can't push below-the-fold content further down; no expand control, so the
            public view stays fully read-only (no button/textbox roles). */}
        <section className="pov-oped-context" aria-label="Situation context">
          <h2 className="pov-oped-context-label">Situation</h2>
          <div className="pov-oped-context-body">{doc.topic}</div>
        </section>
        <footer className="pov-oped-footer">
          <span className="pov-oped-brand">AI Triad Research</span>
        </footer>
      </div>
    </div>
  );
}
