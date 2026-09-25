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
import { CAMP_LABELS, FIDELITY_LABELS, trustVerdictLabel } from './inquiry/inquiryDisplay';
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

/** ADR-001 graceful-empty: a terminal share with no substantive content needs its own
 *  treatment, not a blank page that reads as broken (mirrors InquiryAnswerPanel's
 *  isZeroResult, adapted to the narrower public projection). */
function isZeroShare(doc: PublicInquiryShare): boolean {
  return doc.campVerdicts.length === 0 && doc.convergences.length === 0 && doc.evidenceLayers.length === 0;
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
      <div className="pov-inquiry-card" aria-label="Shared question">
        <span className="pov-inquiry-eyebrow">Question</span>
        <h1 className="pov-inquiry-question">{doc.request.question}</h1>

        {/* Provenance — must-include per SO review (t/3628#2): a reader unfamiliar with the
            Ask screen must be able to see how this answer was produced. */}
        <div className="pov-inquiry-prov mono">
          <span>fidelity <b>{FIDELITY_LABELS[doc.request.fidelity]}</b></span>
          {Object.entries(doc.derivation.models).map(([role, model]) => (
            <span key={role}>{role} <b>{model}</b></span>
          ))}
          <span><b>{doc.derivation.rounds}</b> rounds</span>
        </div>

        {isZeroShare(doc) ? (
          <div className="pov-inquiry-banner pov-inquiry-banner-zero">
            <span className="pov-inquiry-bi">NO RESULT</span>
            <p>This run completed without producing camp verdicts, convergences, or evidence.</p>
          </div>
        ) : (
          <>
            {doc.campVerdicts.length > 0 && (
              <section className="pov-inquiry-sect">
                <span className="pov-inquiry-eyebrow">How each camp draws the line</span>
                <div className="pov-inquiry-camps">
                  {doc.campVerdicts.map((cv) => (
                    <div className={`pov-inquiry-camp pov-inquiry-camp-${cv.camp}`} key={cv.camp}>
                      <div className="pov-inquiry-who">{CAMP_LABELS[cv.camp]}</div>
                      <p>{cv.verdict}</p>
                      {cv.nodes.length > 0 && (
                        <div className="pov-inquiry-nodes mono">{cv.nodes.map((n) => n.label).join(' · ')}</div>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {doc.convergences.map((conv, i) => (
              <section className="pov-inquiry-conv" key={i}>
                <span className="pov-inquiry-eyebrow">Where they converged</span>
                <p>{conv.claim}</p>
                {conv.nodes.length > 0 && <div className="pov-inquiry-nodes mono">{conv.nodes.map((n) => n.label).join(' · ')}</div>}
              </section>
            ))}

            {doc.evidenceLayers.length > 0 && (
              <section className="pov-inquiry-sect">
                <span className="pov-inquiry-eyebrow">The layered answer the debate produced</span>
                <div className="pov-inquiry-layers">
                  {doc.evidenceLayers.map((layer, i) => (
                    <div className="pov-inquiry-layer" key={i}>
                      <span className="pov-inquiry-ln">L{i + 1}</span>
                      <div>
                        <h5>{layer.title}</h5>
                        <p>{layer.role} — {layer.solves}</p>
                        {layer.sources.length > 0 && <div className="pov-inquiry-src mono">{layer.sources.join(' · ')}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {doc.unresolvedGaps.length > 0 && (
              <section className="pov-inquiry-sect">
                <span className="pov-inquiry-eyebrow">Unresolved</span>
                <ul className="pov-inquiry-gaps">
                  {doc.unresolvedGaps.map((g, i) => <li key={i}>{g.description} <span className="pov-inquiry-faint">({g.confidence})</span></li>)}
                </ul>
              </section>
            )}

            {doc.calibration.length > 0 && (
              <section className="pov-inquiry-sect">
                <span className="pov-inquiry-eyebrow">Calibration — every badge generated from the run</span>
                <div className="pov-inquiry-metrics">
                  {doc.calibration.map((entry, i) => (
                    <div className="pov-inquiry-metric" data-t={entry.trust.verdict === 'censored' ? 'bad' : 'ok'} key={i}>
                      <div className="pov-inquiry-mt">
                        <span className="pov-inquiry-mn mono">{entry.metric}</span>
                        <span className={`pov-inquiry-pill ${entry.trust.verdict === 'censored' ? 'bad' : 'ok'}`}>{trustVerdictLabel(entry.trust.verdict)}</span>
                      </div>
                      <div className="pov-inquiry-mv mono">{entry.displayValue ?? entry.value}</div>
                      {/* Renders TrustState.reason verbatim — must-include per SO review (t/3628#2),
                          never re-derives whether a metric is trustworthy. */}
                      <div className="pov-inquiry-mr">{entry.trust.reason}</div>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </>
        )}

        {/* Must-include per SO review (t/3628#2): "one run, not a finding" caveat. */}
        <div className="pov-inquiry-caveat"><b>One run, not a finding.</b> {doc.singleRunCaveat}</div>

        <footer className="pov-inquiry-footer">
          <span className="pov-inquiry-brand">AI Triad Research</span>
        </footer>
      </div>
    </div>
  );
}
