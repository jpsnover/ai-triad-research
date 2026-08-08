// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import type { ReactNode } from 'react';
import { useDebateStore } from '../../hooks/useDebateStore';
import { DEBATE_AUDIENCES, POVER_INFO } from '../../types/debate';
import { AI_POVERS } from '@lib/debate/types';
import type { CoverageMap, StrengthWeightedCoverage } from '@lib/debate/coverageTracker';
import { CoverageBadge } from './TaxonomyRefs';
import './DebateHeader.css';

type DWStore = ReturnType<typeof useDebateStore.getState>;
type ActiveDebateSession = NonNullable<DWStore['activeDebate']>;

// Substantive transcript entry types counted as a speaker's "turns" in the DEBATERS
// strip — openings + statements + cross-responses, matching the set the transcript
// renders as that speaker's cards (t/2293 spec §Band 3).
const TURN_ENTRY_TYPES = new Set(['opening', 'statement', 'cross_respond']);

function poverTurnCount(activeDebate: ActiveDebateSession, pover: string): number {
  return activeDebate.transcript.filter(e => e.speaker === pover && TURN_ENTRY_TYPES.has(e.type)).length;
}

/** Redesigned debate window header (t/2293) — three bands: title+source, status+
 *  metadata, and a per-POV DEBATERS strip. Rendered in the fixed header slot so the
 *  action controls stay always-visible (no scroll regression). The action cluster and
 *  resolved phase label are passed in to keep this component free of the toolbar/
 *  PHASE_TITLES dependency (no import cycle with DebateWorkspace.tsx). */
export function DebateHeader({
  activeDebate, coverageMap, strengthWeighted, phaseLabel, actions,
}: {
  activeDebate: ActiveDebateSession;
  coverageMap: CoverageMap | null;
  strengthWeighted: StrengthWeightedCoverage | null;
  phaseLabel: string;
  actions: ReactNode;
}) {
  // POVs actually present, in canonical acc → saf → skp order; falls back to all three
  // if the session doesn't declare active_povers (spec §edge cases).
  const presentPovers = AI_POVERS.filter(p => (activeDebate.active_povers ?? AI_POVERS).includes(p));
  const created = new Date(activeDebate.created_at);
  const audienceLabel = activeDebate.audience
    ? (DEBATE_AUDIENCES.find(a => a.id === activeDebate.audience)?.label ?? activeDebate.audience)
    : null;

  return (
    <div className="debate-hdr">
      {/* Band 1 — title + source, action controls right */}
      <div className="debate-hdr-band debate-hdr-band1">
        <div className="debate-hdr-title-block">
          <h2 className="debate-hdr-title" title={activeDebate.topic.final}>{activeDebate.topic.final}</h2>
          {activeDebate.source_ref && (
            <span className="debate-hdr-source" title={activeDebate.source_ref}>{activeDebate.source_ref}</span>
          )}
        </div>
        {actions}
      </div>

      {/* Band 2 — status pills left, muted metadata right */}
      <div className="debate-hdr-band debate-hdr-band2">
        <div className="debate-hdr-status">
          <span className="debate-phase-indicator">
            <span className="debate-hdr-status-dot" aria-hidden="true" />
            {phaseLabel}
          </span>
          {coverageMap && <CoverageBadge coverageMap={coverageMap} strengthWeighted={strengthWeighted} />}
        </div>
        <div className="debate-hdr-meta">
          <span className="debate-timestamp" title={activeDebate.created_at}>
            {created.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
            {' · '}
            {created.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
          </span>
          {audienceLabel && <span className="debate-audience-badge">{audienceLabel}</span>}
          {activeDebate.debate_model && (
            <span className="debate-model-badge">{activeDebate.debate_model}</span>
          )}
          <code className="debate-hdr-id" title="Debate ID — click to select">{activeDebate.id}</code>
        </div>
      </div>

      {/* Band 3 — DEBATERS strip, one cell per POV with a per-POV colored accent bar */}
      <div className="debate-hdr-band debate-hdr-band3">
        <div className="debate-hdr-debaters-summary">
          <span className="debate-hdr-debaters-label">DEBATERS</span>
          <span className="debate-hdr-debaters-count">{presentPovers.length} position{presentPovers.length === 1 ? '' : 's'}</span>
        </div>
        {presentPovers.map(pover => {
          const info = POVER_INFO[pover];
          const turns = poverTurnCount(activeDebate, pover);
          return (
            <div className="debate-hdr-pov-cell" key={pover}>
              <span className="debate-hdr-pov-accent" aria-hidden="true" style={{ background: info.color }} />
              <span className="debate-hdr-pov-name">{info.label}</span>
              <span className="debate-hdr-pov-turns">{turns} turn{turns === 1 ? '' : 's'}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
