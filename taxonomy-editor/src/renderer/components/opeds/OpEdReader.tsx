// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// OpEdReader — renders one op-ed SET as an article (t/2576 PR#1, §6). A multi-voice
// set gets a camp-tab strip (roving-tabindex tablist); a single-voice set renders the
// one article directly with no tab strip (TL ruling t/2576#3). Each article is a
// landmark <article> whose headline is the region's sole <h1>. Grounding ids are real
// <button aria-expanded> disclosures that expand an inline taxonomy-element card.

import { useState, useCallback, useRef, useEffect } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { OpEdSet, OpEdMember, OpEdGroundingRef, PovKey } from '../../../../../lib/oped/types';
import { resolvePovMeta } from './povResolve';
import { POV_KEYS } from '@lib/debate/types';
import { useTaxonomyStore } from '../../hooks/useTaxonomyStore';
import { NodeDetail } from '../taxonomy/NodeDetail';
import { SituationDetail } from '../debate/SituationDetail';
import './OpEdReader.css';

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function groundingType(nodeId: string | undefined): string {
  // Legacy/foreign grounding rows may lack node_id (persisted PascalCase shape) — don't
  // crash the reader; classify a missing id as BDI (t/2605 follow-up: real-data smoke).
  return nodeId?.startsWith('sit-') ? 'Situation' : 'BDI';
}

// ──────────────────────────────────────────────
// Inline grounding-element detail card (§6 clickable grounding)
// ──────────────────────────────────────────────

function GroundingDetailCard({ ref, onClose }: { ref: OpEdGroundingRef; onClose: () => void }) {
  const cardRef = useRef<HTMLDivElement>(null);
  const state = useTaxonomyStore.getState();

  useEffect(() => {
    const el = cardRef.current;
    if (el) el.scrollIntoView({ block: 'nearest', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  }, []);

  const openInTaxonomy = useCallback((tab: string, id: string) => {
    // navigateToNode swaps the app to the taxonomy tab and selects the node.
    (useTaxonomyStore.getState().navigateToNode as (t: string, id: string) => void)(tab, id);
  }, []);

  // Resolve the node exactly like SearchPreview: situations first, then each POV set.
  let body: React.ReactNode = <div className="oped-grounding-card-empty">Element not found in the loaded taxonomy.</div>;
  let openTab: string | null = null;

  if (ref.node_id?.startsWith('sit-')) {
    const node = state.situations?.nodes.find(n => n.id === ref.node_id);
    if (node) { body = <SituationDetail node={node} readOnly chipDepth={0} />; openTab = 'situations'; }
  } else {
    for (const p of POV_KEYS) {
      const node = state[p]?.nodes.find(n => n.id === ref.node_id);
      if (node) { body = <NodeDetail pov={p} node={node} readOnly chipDepth={0} />; openTab = p; break; }
    }
  }

  return (
    <div ref={cardRef} className="oped-grounding-card">
      <div className="oped-grounding-card-head">
        <span className="oped-grounding-card-id">{ref.node_id}</span>
        <div className="oped-grounding-card-head-actions">
          {openTab && (
            <button
              type="button"
              className="oped-grounding-card-open"
              onClick={() => openInTaxonomy(openTab!, ref.node_id)}
              title="Open this element in the taxonomy tree"
            >
              Open in Taxonomy →
            </button>
          )}
          <button type="button" className="oped-grounding-card-close" onClick={onClose} aria-label="Close element detail" title="Close">×</button>
        </div>
      </div>
      {ref.how_reflected && (
        <div className="oped-grounding-card-reflected">
          <span className="oped-grounding-card-reflected-label">Reflected in this op-ed:</span> {ref.how_reflected}
        </div>
      )}
      {body}
    </div>
  );
}

// ──────────────────────────────────────────────
// Grounding section (collapsible table + inline expand)
// ──────────────────────────────────────────────

function GroundingSection({ grounding }: { grounding: OpEdGroundingRef[] }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    if (!expandedId) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setExpandedId(null); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [expandedId]);

  if (grounding.length === 0) {
    return <p className="oped-voice-only">Written from voice alone (no taxonomy grounding).</p>;
  }

  const expandedRef = grounding.find(g => g.node_id === expandedId) ?? null;

  return (
    <details className="oped-grounding" open>
      <summary className="oped-grounding-summary">Taxonomy grounding ({grounding.length} element{grounding.length !== 1 ? 's' : ''})</summary>
      <div className="oped-grounding-table-wrap">
        <table className="oped-grounding-table">
          <caption className="sr-only">Taxonomy grounding for this op-ed</caption>
          <thead>
            <tr>
              <th scope="col">Element</th>
              <th scope="col">Type</th>
              <th scope="col">Relevance</th>
              <th scope="col">Reflected in the op-ed</th>
            </tr>
          </thead>
          <tbody>
            {grounding.map(g => {
              const isOpen = g.node_id === expandedId;
              return (
                <tr key={g.node_id} className={isOpen ? 'oped-grounding-row-active' : ''}>
                  <td>
                    <button
                      type="button"
                      className="oped-grounding-id-btn"
                      aria-expanded={isOpen}
                      title={g.label}
                      onClick={() => setExpandedId(isOpen ? null : g.node_id)}
                    >
                      {g.node_id}
                    </button>
                  </td>
                  <td>{groundingType(g.node_id)}</td>
                  <td>{g.relevance || '—'}</td>
                  <td>{g.how_reflected || '(not reported)'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {expandedRef && <GroundingDetailCard ref={expandedRef} onClose={() => setExpandedId(null)} />}
    </details>
  );
}

// ──────────────────────────────────────────────
// One article (a single voice)
// ──────────────────────────────────────────────

function OpEdArticle({ member, outlet }: { member: OpEdMember; outlet?: string }) {
  const meta = resolvePovMeta(member.pov);
  const metaLine = [meta.label.toUpperCase(), outlet || null, `${member.wordCount} words`]
    .filter(Boolean).join(' · ');

  return (
    <article className="oped-article">
      {/* Camp-accent strip — label text carries the identity, never color alone */}
      <div
        className="oped-article-strip"
        // eslint-disable-next-line local/no-inline-style -- dynamic: camp accent color from POV_META cssVar (theme-aware)
        style={{ borderLeftColor: `var(${meta.cssVar})` }}
      >
        {metaLine}
      </div>

      {member.status !== 'complete' ? (
        <div className="oped-article-notice" role="status">
          This voice {member.status === 'failed' ? 'failed to generate' : 'was cancelled'} — no essay is available for it.
        </div>
      ) : (
        <>
          <h1 className="oped-article-headline">{member.headline}</h1>
          {member.subtitle && <p className="oped-article-subtitle">{member.subtitle}</p>}

          <div className="oped-reader-body">
            <Markdown remarkPlugins={[remarkGfm]}>{member.body}</Markdown>
          </div>

          {member.pitch && (
            <details className="oped-pitch">
              <summary className="oped-pitch-summary">Pitch cover email</summary>
              <div className="oped-reader-body oped-pitch-body">
                <Markdown remarkPlugins={[remarkGfm]}>{member.pitch}</Markdown>
              </div>
            </details>
          )}

          <GroundingSection grounding={member.grounding} />
        </>
      )}
    </article>
  );
}

// ──────────────────────────────────────────────
// Reader (tab strip for multi-voice sets)
// ──────────────────────────────────────────────

export function OpEdReader({ set }: { set: OpEdSet }) {
  const members = set.opeds;
  const [activeIdx, setActiveIdx] = useState(0);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const active = members[Math.min(activeIdx, members.length - 1)];

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
    return <div className="oped-reader oped-reader-empty">This op-ed set has no voices.</div>;
  }

  // Single-voice set: no tab strip, render the article directly (TL ruling t/2576#3).
  if (members.length === 1) {
    return (
      <div className="oped-reader">
        <OpEdArticle member={members[0]} outlet={set.params.outlet} />
      </div>
    );
  }

  return (
    <div className="oped-reader">
      <div className="oped-tabstrip" role="tablist" aria-label="Op-ed voices">
        {members.map((m, i) => {
          const meta = resolvePovMeta(m.pov);
          const isActive = i === activeIdx;
          return (
            <button
              key={`${m.pov}-${i}`}
              ref={el => { tabRefs.current[i] = el; }}
              role="tab"
              id={`oped-tab-${i}`}
              aria-selected={isActive}
              aria-controls="oped-panel"
              tabIndex={isActive ? 0 : -1}
              className={`oped-tab${isActive ? ' oped-tab-active' : ''}`}
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
      <div role="tabpanel" id="oped-panel" aria-labelledby={`oped-tab-${activeIdx}`}>
        <OpEdArticle member={active} outlet={set.params.outlet} />
      </div>
    </div>
  );
}
