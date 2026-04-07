// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Neutral Evaluation Panel — displays persona-free evaluator output
 * alongside the existing synthesis. Shows three checkpoints as tabs,
 * cruxes with status badges, filterable claims, and a divergence view
 * comparing the neutral evaluation against the persona synthesis.
 */

import React, { useState, useMemo } from 'react';

// ── Types (mirrored from lib/debate/neutralEvaluator.ts) ──

interface Crux {
  id: string;
  description: string;
  disagreement_type: 'empirical' | 'values' | 'definitional';
  speakers_involved: string[];
  status: 'addressed' | 'partially_addressed' | 'unaddressed';
  confidence: 'high' | 'medium' | 'low';
}

interface EvaluatedClaim {
  id: string;
  speaker: string;
  claim_text: string;
  neutral_assessment:
    | 'well_supported'
    | 'plausible_but_underdefended'
    | 'contested_unresolved'
    | 'refuted'
    | 'off_topic';
  reasoning: string;
  confidence: 'high' | 'medium' | 'low';
}

interface NeutralEvaluation {
  checkpoint: 'baseline' | 'midpoint' | 'final';
  timestamp: string;
  cruxes: Crux[];
  claims: EvaluatedClaim[];
  overall_assessment: {
    strongest_unaddressed_claim_id: string | null;
    debate_is_engaging_real_disagreement: boolean;
    notes: string;
  };
  diagnostics_prompt?: string;
  diagnostics_raw_response?: string;
  diagnostics_response_time_ms?: number;
}

interface DivergenceItem {
  type: 'claim_assessment_mismatch' | 'crux_omitted' | 'crux_status_mismatch';
  description: string;
  neutral_view: string;
  synthesis_view: string;
  severity: 'high' | 'medium' | 'low';
}

interface SpeakerMapping {
  forward: Record<string, string>;
  reverse: Record<string, string>;
}

// ── Props ─────────────────────────────────────────────────

interface NeutralEvaluationPanelProps {
  evaluations: NeutralEvaluation[];
  speakerMapping?: SpeakerMapping;
  divergenceItems?: DivergenceItem[];
  onClose?: () => void;
}

// ── Helpers ───────────────────────────────────────────────

const STATUS_BADGE_COLORS: Record<string, string> = {
  addressed: '#4caf50',
  partially_addressed: '#ff9800',
  unaddressed: '#f44336',
};

const ASSESSMENT_BADGE_COLORS: Record<string, string> = {
  well_supported: '#4caf50',
  plausible_but_underdefended: '#ff9800',
  contested_unresolved: '#9c27b0',
  refuted: '#f44336',
  off_topic: '#9e9e9e',
};

const CONFIDENCE_OPACITY: Record<string, number> = {
  high: 1.0,
  medium: 0.7,
  low: 0.45,
};

function formatAssessment(assessment: string): string {
  return assessment.replace(/_/g, ' ');
}

const CHECKPOINT_LABELS: Record<string, string> = {
  baseline: 'Baseline',
  midpoint: 'Midpoint',
  final: 'Final',
};

// ── Diagnostics sub-component ──────────────────────────────

function DiagnosticsSection({ eval: ev }: { eval: NeutralEvaluation }) {
  const [showPrompt, setShowPrompt] = useState(false);
  const [showRaw, setShowRaw] = useState(false);

  return (
    <div className="neutral-eval-section">
      <h4>
        Diagnostics
        {ev.diagnostics_response_time_ms != null && (
          <span style={{ fontWeight: 'normal', fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: 8 }}>
            {(ev.diagnostics_response_time_ms / 1000).toFixed(1)}s
          </span>
        )}
      </h4>
      <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
        <button
          className={`btn btn-sm ${showPrompt ? 'btn-active' : ''}`}
          onClick={() => { setShowPrompt(!showPrompt); setShowRaw(false); }}
          style={{ fontSize: '0.65rem' }}
        >
          {showPrompt ? 'Hide Prompt' : 'Show Prompt'}
        </button>
        <button
          className={`btn btn-sm ${showRaw ? 'btn-active' : ''}`}
          onClick={() => { setShowRaw(!showRaw); setShowPrompt(false); }}
          style={{ fontSize: '0.65rem' }}
        >
          {showRaw ? 'Hide Raw Response' : 'Show Raw Response'}
        </button>
      </div>
      {showPrompt && ev.diagnostics_prompt && (
        <pre className="neutral-eval-diagnostics-pre">{ev.diagnostics_prompt}</pre>
      )}
      {showRaw && ev.diagnostics_raw_response && (
        <pre className="neutral-eval-diagnostics-pre">{ev.diagnostics_raw_response}</pre>
      )}
    </div>
  );
}

// ── Component ─────────────────────────────────────────────

export function NeutralEvaluationPanel({
  evaluations,
  speakerMapping,
  divergenceItems = [],
  onClose,
}: NeutralEvaluationPanelProps) {
  const [activeTab, setActiveTab] = useState<string>(
    evaluations.length > 0 ? evaluations[evaluations.length - 1].checkpoint : 'final',
  );
  const [claimFilter, setClaimFilter] = useState<string>('all');
  const [showDivergence, setShowDivergence] = useState(false);

  const activeEval = useMemo(
    () => evaluations.find(e => e.checkpoint === activeTab) ?? null,
    [evaluations, activeTab],
  );

  const filteredClaims = useMemo(() => {
    if (!activeEval) return [];
    if (claimFilter === 'all') return activeEval.claims;
    return activeEval.claims.filter(c => c.neutral_assessment === claimFilter);
  }, [activeEval, claimFilter]);

  if (evaluations.length === 0) {
    return (
      <div className="neutral-eval-panel neutral-eval-empty">
        <div className="neutral-eval-header">
          <h3>Independent Evaluation</h3>
          {onClose && <button className="btn btn-sm" onClick={onClose}>Close</button>}
        </div>
        <p className="neutral-eval-placeholder">
          No neutral evaluations available. Evaluations are generated automatically during debate.
        </p>
      </div>
    );
  }

  return (
    <div className="neutral-eval-panel">
      <div className="neutral-eval-header">
        <h3>Independent Evaluation</h3>
        <span className="neutral-eval-subtitle">Persona-free reading of claims and cruxes</span>
        {onClose && <button className="btn btn-sm" onClick={onClose}>Close</button>}
      </div>

      {/* Checkpoint tabs + divergence toggle */}
      <div className="neutral-eval-tabs">
        {evaluations.map(ev => (
          <button
            key={ev.checkpoint}
            className={`neutral-eval-tab ${activeTab === ev.checkpoint ? 'active' : ''}`}
            onClick={() => { setActiveTab(ev.checkpoint); setShowDivergence(false); }}
          >
            {CHECKPOINT_LABELS[ev.checkpoint] ?? ev.checkpoint}
          </button>
        ))}
        {divergenceItems.length > 0 && (
          <button
            className={`neutral-eval-tab neutral-eval-tab-divergence ${showDivergence ? 'active' : ''}`}
            onClick={() => setShowDivergence(!showDivergence)}
          >
            Divergence ({divergenceItems.length})
          </button>
        )}
      </div>

      {/* Divergence view */}
      {showDivergence && (
        <div className="neutral-eval-divergence">
          <p className="neutral-eval-divergence-intro">
            Cases where the neutral evaluator and the persona synthesis disagree:
          </p>
          {divergenceItems.map((item, idx) => (
            <div key={idx} className={`neutral-eval-divergence-item severity-${item.severity}`}>
              <div className="neutral-eval-divergence-type">
                <span className={`badge badge-severity-${item.severity}`}>
                  {item.severity}
                </span>
                <span className="neutral-eval-divergence-label">
                  {item.type.replace(/_/g, ' ')}
                </span>
              </div>
              <p className="neutral-eval-divergence-desc">{item.description}</p>
              <div className="neutral-eval-divergence-compare">
                <div className="neutral-eval-divergence-side">
                  <strong>Neutral evaluator:</strong> {item.neutral_view}
                </div>
                <div className="neutral-eval-divergence-side">
                  <strong>Persona synthesis:</strong> {item.synthesis_view}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Checkpoint content */}
      {!showDivergence && activeEval && (
        <>
          {/* Overall assessment */}
          <div className="neutral-eval-overall">
            <div className={`neutral-eval-engagement ${activeEval.overall_assessment.debate_is_engaging_real_disagreement ? 'engaging' : 'drifting'}`}>
              {activeEval.overall_assessment.debate_is_engaging_real_disagreement
                ? 'Engaging real disagreement'
                : 'Drifting from core disagreements'}
            </div>
            <p className="neutral-eval-notes">{activeEval.overall_assessment.notes}</p>
          </div>

          {/* Cruxes */}
          <div className="neutral-eval-section">
            <h4>Cruxes ({activeEval.cruxes.length})</h4>
            {activeEval.cruxes.length === 0 ? (
              <p className="neutral-eval-placeholder">No cruxes identified at this checkpoint.</p>
            ) : (
              <div className="neutral-eval-cruxes">
                {activeEval.cruxes.map(crux => (
                  <div key={crux.id} className="neutral-eval-crux">
                    <div className="neutral-eval-crux-header">
                      <span
                        className="badge"
                        style={{
                          backgroundColor: STATUS_BADGE_COLORS[crux.status] ?? '#999',
                          opacity: CONFIDENCE_OPACITY[crux.confidence] ?? 1,
                        }}
                      >
                        {crux.status.replace(/_/g, ' ')}
                      </span>
                      <span className="badge badge-outline">
                        {crux.disagreement_type}
                      </span>
                      <span className="neutral-eval-speakers">
                        {crux.speakers_involved.map(s => `Speaker ${s}`).join(' vs ')}
                      </span>
                    </div>
                    <p className="neutral-eval-crux-desc">{crux.description}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Claims */}
          <div className="neutral-eval-section">
            <div className="neutral-eval-claims-header">
              <h4>Claims ({activeEval.claims.length})</h4>
              <select
                className="neutral-eval-filter"
                value={claimFilter}
                onChange={e => setClaimFilter(e.target.value)}
              >
                <option value="all">All</option>
                <option value="well_supported">Well supported</option>
                <option value="plausible_but_underdefended">Underdefended</option>
                <option value="contested_unresolved">Contested</option>
                <option value="refuted">Refuted</option>
                <option value="off_topic">Off topic</option>
              </select>
            </div>
            {filteredClaims.length === 0 ? (
              <p className="neutral-eval-placeholder">No claims match the current filter.</p>
            ) : (
              <div className="neutral-eval-claims">
                {filteredClaims.map(claim => (
                  <div
                    key={claim.id}
                    className={`neutral-eval-claim ${claim.id === activeEval.overall_assessment.strongest_unaddressed_claim_id ? 'strongest-unaddressed' : ''}`}
                  >
                    <div className="neutral-eval-claim-header">
                      <span className="neutral-eval-claim-speaker">
                        Speaker {claim.speaker}
                      </span>
                      <span
                        className="badge"
                        style={{
                          backgroundColor: ASSESSMENT_BADGE_COLORS[claim.neutral_assessment] ?? '#999',
                          opacity: CONFIDENCE_OPACITY[claim.confidence] ?? 1,
                        }}
                      >
                        {formatAssessment(claim.neutral_assessment)}
                      </span>
                      {claim.id === activeEval.overall_assessment.strongest_unaddressed_claim_id && (
                        <span className="badge badge-strongest">strongest unaddressed</span>
                      )}
                    </div>
                    <p className="neutral-eval-claim-text">{claim.claim_text}</p>
                    <p className="neutral-eval-claim-reasoning">{claim.reasoning}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Diagnostics (prompt + raw response) */}
          {(activeEval.diagnostics_prompt || activeEval.diagnostics_raw_response) && (
            <DiagnosticsSection eval={activeEval} />
          )}
        </>
      )}
    </div>
  );
}
