// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useRef, useEffect, useCallback, useMemo, type ReactNode } from 'react';
import { api } from '@bridge';
import { useDebateStore } from '../hooks/useDebateStore';
import { useShallow } from 'zustand/react/shallow';
import { useTaxonomyStore } from '../hooks/useTaxonomyStore';
import { POVER_INFO, DEBATE_AUDIENCES } from '../types/debate';
import { humanizeSpeakerIds } from '../utils/humanizeSpeakers';
import type { SpeakerId, TranscriptEntry, TaxonomyRef, DebateAudience, DocumentINode, ArgumentNetworkNode, ArgumentNetworkEdge, ConvergenceSignals } from '../types/debate';
import { computeQbafStrengths } from '@lib/debate/qbaf';
import type { QbafNode, QbafEdge } from '@lib/debate/qbaf';
import type { TopicCritique, StructuralScore, FrameScore } from '@lib/debate/topicCritique';
import type { TabId } from '../types/taxonomy';
import { DebateSourceViewer } from './DebateSourceViewer';
import { HarvestDialog } from './HarvestDialog';
import { ReflectionsPanel } from './ReflectionsPanel';
import { NewsReportModal } from './NewsReportModal';
// DiagnosticsPanel removed — diagnostics always uses popup window
import { NeutralEvaluationPanel } from './NeutralEvaluationPanel';
import { ParameterHistoryPanel } from './ParameterHistoryPanel';
import { nodePovFromId } from '@lib/debate/nodeIdUtils';
import { AI_POVERS } from '@lib/debate/types';
import { computeCoverageMap, computeStrengthWeightedCoverage } from '@lib/debate/coverageTracker';
import type { CoverageMap, StrengthWeightedCoverage } from '@lib/debate/coverageTracker';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { lineageMarkdownComponents, extractLineageNames } from '../utils/lineageMatcher';
import { getDebateMarkdownComponents, type VocabResolution } from '../utils/vocabularyAnnotations';
import { getLineageInfo } from '../data/lineageLookup';
import { CommentCreationPopover } from './CommentCreationPopover';
import type { CommentPopoverState } from './CommentCreationPopover';
import { CommentSidebar } from './CommentSidebar';
import { CommentHighlightedText, useEntryCommentCount, useHasCommentHighlights } from './CommentHighlights';
import { useCommentStore, COMMENT_TYPE_META } from '../hooks/useCommentStore';
import type { Comment, DetailTier } from '@lib/debate/comments';
import { UsernamePromptDialog } from './UsernamePromptDialog';
import { DiagnosticsChatSidebar } from './DiagnosticsChatSidebar';
import type { NavigateCommand } from './DiagnosticsChatSidebar';
import { triggerManualDump } from '../lib/flightRecorderInit';
import { getGlobalRecorder } from '@lib/flight-recorder/index';

// ── Phase 7: Context menu state ──────────────────────────
interface ContextMenuState {
  x: number;
  y: number;
  selectedText: string;
  entryId: string;
  isPoverStatement: boolean;
  tier: DetailTier;
  startOffset: number;
  endOffset: number;
}

const PHASE_TITLES: Record<string, string> = {
  setup: 'Setting up...',
  clarification: 'Topic Refinement',
  opening: 'Opening Statements',
  debate: 'Debate',
  closed: 'Debate Closed',
};

type AdaptivePhase = 'confrontation' | 'argumentation' | 'concluding';

const ADAPTIVE_PHASE_LABELS: Record<AdaptivePhase, string> = {
  'confrontation': 'Confrontation',
  'argumentation': 'Argumentation',
  'concluding': 'Concluding',
};

const ADAPTIVE_PHASE_COLORS: Record<AdaptivePhase, string> = {
  'confrontation': '#f59e0b',
  'argumentation': '#3b82f6',
  'concluding': '#10b981',
};

const ADAPTIVE_PHASES: AdaptivePhase[] = ['confrontation', 'argumentation', 'concluding'];

function PhaseProgressBar({ currentPhase, phaseProgress, roundsInPhase, approachingTransition, rationale }: {
  currentPhase: AdaptivePhase;
  phaseProgress: number;
  roundsInPhase: number;
  approachingTransition: boolean;
  rationale?: string;
}) {
  const currentIdx = ADAPTIVE_PHASES.indexOf(currentPhase);

  return (
    <div className="adaptive-phase-bar" title={rationale || `${ADAPTIVE_PHASE_LABELS[currentPhase]} phase, round ${roundsInPhase}`}>
      <div className="adaptive-phase-segments">
        {ADAPTIVE_PHASES.map((phase, idx) => {
          const isActive = idx === currentIdx;
          const isCompleted = idx < currentIdx;
          const color = ADAPTIVE_PHASE_COLORS[phase];
          const fillPct = isCompleted ? 100 : isActive ? Math.min(100, phaseProgress * 100) : 0;

          return (
            <div
              key={phase}
              className={`adaptive-phase-segment${isActive ? ' active' : ''}${isCompleted ? ' completed' : ''}`}
              title={`${ADAPTIVE_PHASE_LABELS[phase]}${isActive ? ` — ${Math.round(phaseProgress * 100)}% (round ${roundsInPhase})` : ''}`}
            >
              <div
                className="adaptive-phase-fill"
                style={{ width: `${fillPct}%`, background: color }}
              />
              <span className="adaptive-phase-label">
                {ADAPTIVE_PHASE_LABELS[phase]}
              </span>
            </div>
          );
        })}
      </div>
      {approachingTransition && (
        <span className="adaptive-phase-transition-hint">
          Approaching transition
        </span>
      )}
      {rationale && (
        <span className="adaptive-phase-rationale" title={rationale}>
          {rationale.length > 80 ? rationale.slice(0, 77) + '...' : rationale}
        </span>
      )}
    </div>
  );
}

function PhaseTransitionCard({ type, content }: {
  type: 'TRANSITION_SUMMARY' | 'REGRESSION_NOTICE' | 'FINAL_COMMIT';
  content: string;
}) {
  const icon = type === 'TRANSITION_SUMMARY' ? '>>>' : type === 'REGRESSION_NOTICE' ? '<<<' : '|||';
  const label = type === 'TRANSITION_SUMMARY' ? 'Entering Synthesis'
    : type === 'REGRESSION_NOTICE' ? 'Returning to Exploration'
    : 'Final Positions';
  const colorClass = type === 'TRANSITION_SUMMARY' ? 'phase-transition-synthesis'
    : type === 'REGRESSION_NOTICE' ? 'phase-transition-regression'
    : 'phase-transition-commit';

  return (
    <div className={`phase-transition-card ${colorClass}`}>
      <div className="phase-transition-header">
        <span className="phase-transition-icon">{icon}</span>
        <span className="phase-transition-label">{label}</span>
      </div>
      <div className="phase-transition-content">{content}</div>
    </div>
  );
}

function getPolicyAction(polId: string): string {
  const registry = useTaxonomyStore.getState().policyRegistry;
  if (!registry) return polId;
  const entry = registry.find(p => p.id === polId);
  return entry ? entry.action : polId;
}


function speakerLabel(speaker: SpeakerId | 'system' | 'document' | 'moderator'): string {
  if (speaker === 'system') return 'System';
  if (speaker === 'moderator') return 'Moderator';
  if (speaker === 'user') return 'You';
  if (speaker === 'document') return 'Document';
  const info = POVER_INFO[speaker as Exclude<SpeakerId, 'user'>];
  return info ? info.label : speaker;
}

function speakerColor(speaker: SpeakerId | 'system' | 'document' | 'moderator'): string | undefined {
  if (speaker === 'system' || speaker === 'user' || speaker === 'document') return undefined;
  if (speaker === 'moderator') return 'var(--color-moderator, #8b5cf6)';
  const info = POVER_INFO[speaker as Exclude<SpeakerId, 'user'>];
  return info?.color;
}

// ── Claims View (t/52) — arg net subgraph per entry ─────

const STRENGTH_BAND = (v: number) =>
  v >= 0.8 ? { label: 'Strong', color: '#22c55e' }
  : v >= 0.5 ? { label: 'Moderate', color: '#3b82f6' }
  : v >= 0.3 ? { label: 'Weak', color: '#f59e0b' }
  : { label: 'Very Weak', color: '#ef4444' };

// ── Inline convergence diagnostics card for a single entry ──

function pctFmt(v: number): string { return `${(v * 100).toFixed(0)}%`; }

function ConvergenceInlineCard({ signal }: { signal: ConvergenceSignals | undefined }) {
  if (!signal) {
    return <div style={{ padding: 8, color: 'var(--text-muted)', fontSize: '0.8rem' }}>No convergence data for this turn.</div>;
  }
  const md = signal.move_polarity;
  const ed = signal.dialectical_engagement;
  const rr = signal.argument_redundancy;
  const so = signal.dominant_counterargument;
  const co = signal.concession_opportunity;
  const pd = signal.position_drift;
  const cr = signal.crux_engagement_rate;
  const lbl: React.CSSProperties = { color: 'var(--text-muted)', fontSize: '0.62rem', textTransform: 'uppercase', letterSpacing: '0.03em' };
  const val: React.CSSProperties = { color: 'var(--text-primary)', fontSize: '0.72rem' };
  const cell: React.CSSProperties = { padding: '4px 6px', borderRadius: 3, background: 'var(--bg-tertiary, rgba(255,255,255,0.03))' };
  const badge = (text: string, color: string) => (
    <span style={{ color, marginLeft: 4, fontSize: '0.62rem' }}>{text}</span>
  );
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4, padding: '4px 0' }}>
      <div style={cell}>
        <div style={lbl}>Polarity</div>
        <div style={val}>
          <span style={{ color: '#ef4444' }}>{md?.confrontational ?? 0}C</span>{' / '}
          <span style={{ color: '#22c55e' }}>{md?.collaborative ?? 0}S</span>
          {' = '}<strong>{pctFmt(md?.ratio ?? 0)}</strong>
          {(md?.ratio ?? 0) >= 0.5 ? badge('cooperative', '#22c55e') : badge('confrontational', '#ef4444')}
        </div>
      </div>
      <div style={cell}>
        <div style={lbl}>Dialectical Engagement</div>
        <div style={val}>
          {ed?.targeted ?? 0}/{(ed?.targeted ?? 0) + (ed?.standalone ?? 0)} targeted = <strong>{pctFmt(ed?.ratio ?? 0)}</strong>
          {(ed?.ratio ?? 0) >= 0.7 ? badge('deep', '#22c55e') : (ed?.ratio ?? 0) >= 0.4 ? badge('moderate', '#f59e0b') : badge('standalone', '#ef4444')}
        </div>
      </div>
      <div style={cell}>
        <div style={lbl}>Argument Redundancy</div>
        <div style={val}>
          avg <strong>{pctFmt(rr?.avg_self_overlap ?? 0)}</strong>, max <strong>{pctFmt(rr?.max_self_overlap ?? 0)}</strong>
          {rr?.semantic_max_similarity != null && <>, sem <strong>{pctFmt(rr.semantic_max_similarity)}</strong></>}
          {rr?.semantically_recycled ? badge('semantic repeat', '#ef4444')
            : (rr?.max_self_overlap ?? 0) >= 0.5 ? badge('repeating', '#f59e0b')
            : badge('fresh', '#22c55e')}
        </div>
      </div>
      <div style={cell}>
        <div style={lbl}>Dominant Counterargument</div>
        <div style={val}>
          {so ? (
            <>{so.node_id} str={so.strength?.toFixed(2)}
              {(so.strength ?? 0) >= 0.7 ? badge('strong', '#ef4444') : (so.strength ?? 0) >= 0.5 ? badge('moderate', '#f59e0b') : badge('weak', '#22c55e')}
            </>
          ) : <span style={{ color: 'var(--text-muted)' }}>none</span>}
        </div>
      </div>
      <div style={cell}>
        <div style={lbl}>Concession</div>
        <div style={val}>
          {co?.strong_attacks_faced ?? 0} attacks, used: {co?.concession_used ? 'Y' : 'N'} —{' '}
          <span style={{
            padding: '1px 6px', borderRadius: 3, fontSize: '0.6rem', fontWeight: 700,
            background: co?.outcome === 'taken' ? 'rgba(34,197,94,0.15)' : co?.outcome === 'missed' ? 'rgba(239,68,68,0.15)' : 'rgba(148,163,184,0.15)',
            color: co?.outcome === 'taken' ? '#22c55e' : co?.outcome === 'missed' ? '#ef4444' : '#94a3b8',
          }}>{co?.outcome === 'taken' ? 'Taken' : co?.outcome === 'missed' ? 'Missed' : 'N/A'}</span>
        </div>
      </div>
      <div style={cell}>
        <div style={lbl}>Position Drift</div>
        <div style={val}>
          opening: <strong>{pctFmt(pd?.overlap_with_opening ?? 0)}</strong>, drift: <strong>{pctFmt(pd?.drift ?? 0)}</strong>
          {(pd?.overlap_with_opening ?? 0) >= 0.6 ? badge('anchored', '#f59e0b')
            : (pd?.overlap_with_opening ?? 0) < 0.3 ? badge('shifted', '#3b82f6')
            : badge('evolved', '#22c55e')}
        </div>
      </div>
      <div style={{ ...cell, gridColumn: '1 / -1' }}>
        <div style={lbl}>Crux Engagement</div>
        <div style={val}>
          this turn: {cr?.used_this_turn ? 'Yes' : 'No'} | cumulative: {cr?.cumulative_count ?? 0} | follow-through: {cr?.cumulative_follow_through ?? 0}
          {(cr?.cumulative_count ?? 0) > 0 && (cr?.cumulative_follow_through ?? 0) === 0 && badge('no follow-through', '#f59e0b')}
          {(cr?.cumulative_count ?? 0) > 0 && (cr?.cumulative_follow_through ?? 0) > 0 && badge('resolving', '#22c55e')}
        </div>
      </div>
    </div>
  );
}

function groundingLabel(baseStrength: number | undefined): string {
  if (baseStrength === undefined) return '';
  if (baseStrength >= 0.65) return 'Grounded';
  if (baseStrength >= 0.35) return 'Reasoned';
  return 'Asserted';
}

const GROUNDING_COLORS: Record<string, string | undefined> = {
  Grounded: '#22c55e',
  Asserted: '#f59e0b',
};

function ClaimNodeRow({ node, attacks, supports, allNodes, strengthMap }: {
  node: ArgumentNetworkNode;
  attacks: ArgumentNetworkEdge[];
  supports: ArgumentNetworkEdge[];
  allNodes: ArgumentNetworkNode[];
  strengthMap: Map<string, number>;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasEdges = attacks.length > 0 || supports.length > 0;
  const base = node.base_strength ?? 0.5;
  const computed = strengthMap.get(node.id) ?? node.computed_strength ?? base;
  const delta = computed - base;
  const band = STRENGTH_BAND(computed);

  const bandColor = computed >= 0.8 ? '#22c55e' : computed >= 0.5 ? '#3b82f6' : computed >= 0.3 ? '#f59e0b' : '#ef4444';
  const attr = node.claim_taxonomy_attribution;

  return (
    <div style={{ margin: '4px 0', paddingBottom: 4, borderBottom: '1px solid var(--border)', fontSize: '0.85rem' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 4 }}>
        {hasEdges ? (
          <button
            onClick={() => setExpanded(!expanded)}
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 0, lineHeight: 1, marginTop: 2, flexShrink: 0 }}
          >{expanded ? '\u25BC' : '\u25B6'}</button>
        ) : <span style={{ width: 10, flexShrink: 0 }} />}
        <div style={{ flex: 1, display: 'grid', gridTemplateColumns: node.political_salience ? '84px 110px 72px 180px 200px 60px 80px' : '84px 110px 72px 180px 200px 60px 1fr', gap: '4px', alignItems: 'center' }}>
          {/* Col 1: AN ID */}
          <strong style={{ color: 'var(--accent)' }}>{node.id}</strong>
          {/* Col 2: Speaker */}
          <span>{speakerLabel(node.speaker)}</span>
          {/* Col 3: BDI category */}
          <span>{node.bdi_category === 'belief' ? 'Belief' : node.bdi_category === 'desire' ? 'Desire' : node.bdi_category === 'intention' ? 'Intention' : ''}</span>
          {/* Col 4: Attribution */}
          <span>
            {attr && (() => {
              if (attr.unattributed_reason) {
                const reasonLabel = attr.unattributed_reason === 'novel_argument' ? 'novel' : 'no embedding';
                return <span style={{ fontWeight: 700, padding: '1px 5px', borderRadius: 3, color: 'var(--text-secondary)' }}><span style={{ color: '#ef4444', fontSize: '0.9rem', marginRight: 3 }}>●</span>{reasonLabel}</span>;
              }
              const conf = attr.attribution_confidence;
              const confColor = conf >= 0.7 ? '#22c55e' : conf >= 0.5 ? '#3b82f6' : '#f59e0b';
              return <span style={{ fontWeight: 700, padding: '1px 5px', borderRadius: 3, color: 'var(--text-secondary)' }}><span style={{ color: confColor, fontSize: '0.9rem', marginRight: 3 }}>●</span>{attr.primary_ref} {conf.toFixed(2)}</span>;
            })()}
          </span>
          {/* Col 5: Strength */}
          <span style={{ fontWeight: 700, padding: '1px 5px', borderRadius: 3, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }} title={`Strength: ${computed.toFixed(2)} (base: ${base.toFixed(2)})`}>
            <span style={{ color: bandColor, fontSize: '0.9rem', marginRight: 3 }}>●</span>{band.label} {computed.toFixed(2)}
            {Math.abs(delta) > 0.01 && <span style={{ color: 'var(--text-muted)', marginLeft: 3 }}>{delta > 0 ? '+' : ''}{delta.toFixed(2)}</span>}
          </span>
          {/* Col 6: Edge count */}
          <span style={{ color: 'var(--text-muted)' }}>
            {hasEdges ? `${attacks.length + supports.length} edge${attacks.length + supports.length !== 1 ? 's' : ''}` : ''}
          </span>
          {/* Col 7: Political salience (policymaker debates only) */}
          {node.political_salience && (
            <span style={{ fontWeight: 700, fontSize: '0.75rem', padding: '1px 6px', borderRadius: 3 }}>
              <span style={{ marginRight: 3 }}>
                {node.political_salience === 'high' ? '🔴' : node.political_salience === 'medium' ? '🟡' : '⚪'}
              </span>
              {node.political_salience}
            </span>
          )}
        </div>
      </div>
      <div style={{ paddingLeft: 18, marginTop: 2 }}>{node.text}</div>
      {expanded && (
        <div style={{ paddingLeft: 18, marginTop: 4 }}>
          {attacks.map(e => {
            const src = allNodes.find(n => n.id === e.source);
            return (
              <div key={`a-${e.source}`} style={{ color: '#ef4444', marginBottom: 2 }}>
                ← <strong>{e.source}</strong> {e.attack_type ?? 'rebut'} ({speakerLabel(src?.speaker ?? 'system')}): {src?.text?.slice(0, 100)}{(src?.text?.length ?? 0) > 100 ? '…' : ''}
              </div>
            );
          })}
          {supports.map(e => {
            const src = allNodes.find(n => n.id === e.source);
            return (
              <div key={`s-${e.source}`} style={{ color: '#22c55e', marginBottom: 2 }}>
                ← <strong>{e.source}</strong> support ({speakerLabel(src?.speaker ?? 'system')}): {src?.text?.slice(0, 100)}{(src?.text?.length ?? 0) > 100 ? '…' : ''}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const POV_COLOR_VAR: Record<string, string> = {
  accelerationist: 'var(--color-acc)',
  safetyist: 'var(--color-saf)',
  skeptic: 'var(--color-skp)',
  situations: 'var(--color-sit)',
};

function LineageTermsView({ content }: { content: string }) {
  const names = useMemo(() => extractLineageNames(content), [content]);
  if (names.length === 0) return <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', padding: '4px 0' }}>No lineage references found</div>;
  return (
    <div style={{ fontSize: '0.8rem', padding: '4px 0' }}>
      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: 6 }}>
        {names.length} lineage reference{names.length !== 1 ? 's' : ''}
      </div>
      {names.map((name, i) => {
        const info = getLineageInfo(name);
        return (
          <div key={i} style={{ marginBottom: 10, padding: '4px 8px' }}>
            <div style={{ fontWeight: 700, fontSize: '0.85rem' }}>{name}</div>
            {info?.summary && (
              <div style={{ marginLeft: 16, marginTop: 2, fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                {info.summary}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function VocabTermCard({ bare, dict, resolved, defLookup, navigateToLineage }: {
  bare: string;
  dict?: { resolves_to: { standardized_term: string; when: string; default_for_camp?: string }[]; ambiguous_when?: string[] };
  resolved?: string;
  defLookup?: Map<string, { display: string; definition: string }>;
  navigateToLineage: (value: string) => void;
}) {
  return (
    <div style={{ marginBottom: 10, padding: '4px 8px' }}>
      <div style={{ fontWeight: 700, fontSize: '0.85rem' }}>{bare}</div>
      {dict?.resolves_to.map((rt, j) => {
        const isHighlighted = resolved != null && rt.standardized_term === resolved;
        const def = defLookup?.get(rt.standardized_term);
        return (
          <div key={j} style={{ marginLeft: 16, marginTop: 4 }}>
            <div style={{ fontSize: '0.78rem', display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
              <a
                href="#"
                style={{
                  fontWeight: 600,
                  textDecoration: 'underline',
                  textUnderlineOffset: '2px',
                  color: isHighlighted ? 'var(--text-primary)' : 'var(--text-muted)',
                  cursor: 'pointer',
                  flexShrink: 0,
                }}
                title={`Go to "${def?.display ?? rt.standardized_term}" in Lineage Panel`}
                onClick={(ev) => { ev.preventDefault(); navigateToLineage(rt.standardized_term); }}
              >
                {def?.display ?? rt.standardized_term}
              </a>
              {rt.when && <span style={{ color: 'var(--text-muted)' }}>{rt.when}</span>}
              {rt.default_for_camp && (
                <span style={{ color: POV_COLOR_VAR[rt.default_for_camp] ?? 'var(--text-muted)', fontWeight: 600, fontSize: '0.72rem', flexShrink: 0 }}>
                  {rt.default_for_camp}
                </span>
              )}
            </div>
            {def?.definition && (
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 2, lineHeight: 1.4 }}>
                {def.definition}
              </div>
            )}
          </div>
        );
      })}
      {!dict && resolved && (
        <div style={{ marginLeft: 16, marginTop: 2 }}>
          <div style={{ fontSize: '0.78rem' }}>
            <a
              href="#"
              style={{ textDecoration: 'underline dotted', textUnderlineOffset: '2px', color: 'var(--text-secondary)', cursor: 'pointer' }}
              onClick={(ev) => { ev.preventDefault(); navigateToLineage(resolved); }}
            >
              {defLookup?.get(resolved)?.display ?? resolved}
            </a>
          </div>
          {defLookup?.get(resolved)?.definition && (
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 2, marginLeft: 16, lineHeight: 1.4 }}>
              {defLookup.get(resolved)!.definition}
            </div>
          )}
        </div>
      )}
      {dict?.ambiguous_when && dict.ambiguous_when.length > 0 && (
        <div style={{ marginLeft: 16, marginTop: 3, fontSize: '0.72rem', fontStyle: 'italic', color: 'var(--text-muted)' }}>
          Ambiguous when: {dict.ambiguous_when.join('; ')}
        </div>
      )}
    </div>
  );
}

function VocabTermsView({ resolutions, ambiguities }: {
  resolutions: VocabResolution[];
  ambiguities?: { colloquial: string; offset?: number }[];
}) {
  const vocabTerms = useDebateStore(s => s.vocabularyTerms?.colloquial);
  const stdTerms = useDebateStore(s => s.vocabularyTerms?.standardized);
  const navigateToLineage = useTaxonomyStore(s => s.navigateToLineage);

  // Build lookup from full dictionary (shared between entries and ambiguities)
  const dictLookup = useMemo(() => {
    const lookup = new Map<string, { resolves_to: { standardized_term: string; when: string; default_for_camp?: string }[]; ambiguous_when?: string[] }>();
    if (vocabTerms) {
      for (const ct of vocabTerms) {
        const entry = ct as { colloquial_term: string; resolves_to: { standardized_term: string; when: string; default_for_camp?: string }[]; translation_ambiguous_when?: string[] };
        lookup.set(entry.colloquial_term.toLowerCase(), { resolves_to: entry.resolves_to, ambiguous_when: entry.translation_ambiguous_when });
      }
    }
    return lookup;
  }, [vocabTerms]);

  // Build canonical_form → definition lookup from standardized terms
  const defLookup = useMemo(() => {
    const lookup = new Map<string, { display: string; definition: string }>();
    if (stdTerms) {
      for (const st of stdTerms) {
        const entry = st as { canonical_form: string; display_form: string; definition: string };
        if (entry.canonical_form && entry.definition) {
          lookup.set(entry.canonical_form, { display: entry.display_form, definition: entry.definition });
        }
      }
    }
    return lookup;
  }, [stdTerms]);

  // Build unique colloquial terms from this entry's resolutions, then enrich with full dictionary data
  const entries = useMemo(() => {
    const seen = new Set<string>();
    const bareTerms: string[] = [];
    for (const r of resolutions) {
      const key = r.colloquial.toLowerCase();
      if (!seen.has(key)) { seen.add(key); bareTerms.push(r.colloquial); }
    }
    bareTerms.sort((a, b) => a.localeCompare(b));

    return bareTerms.map(term => ({
      bare: term,
      dict: dictLookup.get(term.toLowerCase()),
      resolved: resolutions.find(r => r.colloquial.toLowerCase() === term.toLowerCase())?.canonical,
    }));
  }, [resolutions, dictLookup]);

  return (
    <div style={{ fontSize: '0.8rem', padding: '4px 0' }}>
      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: 6 }}>
        {entries.length} term{entries.length !== 1 ? 's' : ''} resolved
        {ambiguities && ambiguities.length > 0 && (
          <span style={{ color: '#d97706', marginLeft: 6 }}> · {new Set(ambiguities.map(a => a.colloquial)).size} ambiguous</span>
        )}
      </div>
      {entries.map((e, i) => (
        <VocabTermCard key={i} bare={e.bare} dict={e.dict} resolved={e.resolved} defLookup={defLookup} navigateToLineage={navigateToLineage} />
      ))}
      {ambiguities && ambiguities.length > 0 && (() => {
        const uniqueTerms = [...new Set(ambiguities.map(a => a.colloquial))].sort((a, b) => a.localeCompare(b));
        return (
          <div style={{ marginTop: 8, padding: '4px 8px', background: 'rgba(217,119,6,0.06)', borderLeft: '3px solid #d97706', borderRadius: 4 }}>
            <div style={{ fontWeight: 600, color: '#d97706', marginBottom: 4, fontSize: '0.72rem' }}>Ambiguous meaning — could be any of these:</div>
            {uniqueTerms.map((term, i) => (
              <VocabTermCard key={i} bare={term} dict={dictLookup.get(term.toLowerCase())} defLookup={defLookup} navigateToLineage={navigateToLineage} />
            ))}
          </div>
        );
      })()}
    </div>
  );
}

function ClaimsView({ entryId, debate }: { entryId?: string; debate: { argument_network?: { nodes: ArgumentNetworkNode[]; edges: ArgumentNetworkEdge[] }; transcript: TranscriptEntry[] } }) {
  const an = debate.argument_network;
  if (!an || an.nodes.length === 0) return <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', padding: '4px 0' }}>No argument network yet</div>;

  const entryNodes = entryId ? an.nodes.filter(n => n.source_entry_id === entryId) : an.nodes;
  if (entryNodes.length === 0) return <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', padding: '4px 0' }}>No claims extracted for this statement</div>;

  const qbafNodes: QbafNode[] = an.nodes.map(n => ({ id: n.id, base_strength: n.base_strength ?? 0.5 }));
  const qbafEdges: QbafEdge[] = an.edges.map(e => ({
    source: e.source, target: e.target,
    type: e.type as 'attacks' | 'supports',
    weight: e.weight ?? 0.5,
    attack_type: e.attack_type,
  }));
  const { strengths: strengthMap } = computeQbafStrengths(qbafNodes, qbafEdges);

  const caCount = an.edges.filter(e => entryNodes.some(n => n.id === e.target) && e.type === 'attacks').length;
  const raCount = an.edges.filter(e => entryNodes.some(n => n.id === e.target) && e.type === 'supports').length;

  // Political salience histogram (policymaker debates only)
  const salienceCounts = (() => {
    const high = entryNodes.filter(n => n.political_salience === 'high').length;
    const medium = entryNodes.filter(n => n.political_salience === 'medium').length;
    const low = entryNodes.filter(n => n.political_salience === 'low').length;
    return (high + medium + low > 0) ? { high, medium, low } : null;
  })();

  return (
    <div className="claims-view" style={{ fontSize: '0.8rem' }}>
      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 4 }}>
        {entryNodes.length} claim{entryNodes.length !== 1 ? 's' : ''} · {caCount} attack{caCount !== 1 ? 's' : ''} · {raCount} support{raCount !== 1 ? 's' : ''}
      </div>
      {salienceCounts && (
        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: 6, display: 'flex', gap: 10, alignItems: 'center' }}>
          <span style={{ fontWeight: 600 }}>Salience:</span>
          <span>🔴 {salienceCounts.high} high</span>
          <span>🟡 {salienceCounts.medium} med</span>
          <span>⚪ {salienceCounts.low} low</span>
        </div>
      )}
      {entryNodes.map(node => {
        const attacks = an.edges.filter(e => e.target === node.id && e.type === 'attacks');
        const supports = an.edges.filter(e => e.target === node.id && e.type === 'supports');
        return <ClaimNodeRow key={node.id} node={node} attacks={attacks} supports={supports} allNodes={an.nodes} strengthMap={strengthMap} />;
      })}
    </div>
  );
}

// ── Phase 6: Taxonomy cross-navigation helpers ──────────

/** Map node_id prefix to the taxonomy tab and CSS color */
function nodeIdToTab(nodeId: string): { tab: TabId; colorVar: string } {
  const pov = nodePovFromId(nodeId);
  if (pov) return { tab: pov as TabId, colorVar: POV_COLOR_VAR[pov] || 'var(--text-muted)' };
  return { tab: 'situations', colorVar: 'var(--text-muted)' };
}

/** Resolve a node_id to its label from the taxonomy store */
function getNodeLabel(nodeId: string): string {
  const state = useTaxonomyStore.getState();
  const { tab } = nodeIdToTab(nodeId);

  if (tab === 'situations') {
    const node = state.situations?.nodes?.find((n: { id: string }) => n.id === nodeId);
    if (node) return node.label;
  } else {
    const povFile = state[tab as 'accelerationist' | 'safetyist' | 'skeptic'];
    const node = povFile?.nodes?.find((n: { id: string }) => n.id === nodeId);
    if (node) return node.label;
  }
  return nodeId;
}

function getNodeWeight(nodeId: string): { category?: string; confidence?: number; priority?: number; operationality?: number } | null {
  const state = useTaxonomyStore.getState();
  const { tab } = nodeIdToTab(nodeId);
  if (tab === 'situations') return null;
  const povFile = state[tab as 'accelerationist' | 'safetyist' | 'skeptic'];
  const node = povFile?.nodes?.find((n: { id: string }) => n.id === nodeId);
  if (!node) return null;
  return { category: node.category, confidence: node.confidence, priority: node.priority, operationality: node.operationality };
}

/** Navigate the main application window to a taxonomy node and focus it. */
function focusMainWindowNode(nodeId: string): void {
  api.focusNodeInMainWindow(nodeId);
}

/** Grounding badge for the debate header (CT-2). Color-coded by grounding %. */
function CoverageBadge({ coverageMap, strengthWeighted }: { coverageMap: CoverageMap; strengthWeighted?: StrengthWeightedCoverage | null }) {
  const { stats } = coverageMap;
  const pct = Math.round(stats.coveragePercentage);
  const colorClass = pct > 75 ? 'coverage-badge-green' : pct >= 40 ? 'coverage-badge-yellow' : 'coverage-badge-red';
  const covered = stats.coveredCount + stats.partiallyCoveredCount;
  const swPct = strengthWeighted ? Math.round(strengthWeighted.strength_weighted_coverage) : null;
  const titleParts = [
    `TAXONOMY GROUNDING`,
    `Measures how many of this debate's claims are grounded in taxonomy nodes.`,
    ``,
    `Current: ${covered}/${stats.totalClaims} claims grounded (${pct}%)`,
    `  ${stats.coveredCount} fully grounded (claim maps to 1+ taxonomy nodes)`,
    `  ${stats.partiallyCoveredCount} partially grounded (weak or indirect mapping)`,
    `  ${stats.uncoveredCount} ungrounded (no taxonomy connection)`,
  ];
  if (swPct !== null) {
    titleParts.push(``);
    titleParts.push(`Strength-weighted: ${swPct}%`);
    titleParts.push(`Weights each claim by its QBAF argumentation strength,`);
    titleParts.push(`so strongly-supported claims count more than weak ones.`);
  }
  titleParts.push(``);
  titleParts.push(`Color bands: green >75% | yellow 40-75% | red <40%`);
  titleParts.push(`Higher grounding = debate is well-anchored in the taxonomy.`);

  return (
    <span className={`coverage-badge ${colorClass}`} title={titleParts.join('\n')}>
      Grounding: {covered}/{stats.totalClaims} ({pct}%){swPct !== null && swPct !== pct ? ` · str: ${swPct}%` : ''}
    </span>
  );
}

/** Clickable taxonomy pill — navigates the main window to this node */
function TaxonomyPill({ taxRef }: { taxRef: TaxonomyRef }) {
  const { colorVar } = nodeIdToTab(taxRef.node_id);
  const label = getNodeLabel(taxRef.node_id);

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    focusMainWindowNode(taxRef.node_id);
  };

  const scoreLabel = taxRef.relevance_score != null
    ? ` (${taxRef.relevance_score.toFixed(2)})`
    : '';
  const primaryMarker = taxRef.primary ? '★ ' : '';

  return (
    <span
      className={`debate-taxonomy-pill debate-taxonomy-pill-clickable${taxRef.primary ? ' debate-taxonomy-pill-primary' : ''}`}
      style={{ borderColor: colorVar, color: colorVar }}
      title={`${primaryMarker}${label}${scoreLabel}\n${taxRef.relevance}`}
      onClick={handleClick}
    >
      {primaryMarker}{taxRef.node_id}{scoreLabel}
    </span>
  );
}

/** Combined taxonomy + policy refs with single "Show reasoning" toggle */
type PolicyRefEntry = string | { policy_id: string; relevance: string };

function resolvePolRef(ref: PolicyRefEntry): { id: string; relevance: string | null } {
  if (typeof ref === 'string') return { id: ref, relevance: null };
  return { id: ref.policy_id, relevance: ref.relevance };
}

function TaxonomyRefsSection({ refs, policyRefs, metaPolicyRefs, entry, stageDiagnostics, forceExpanded }: {
  refs: TaxonomyRef[];
  policyRefs?: PolicyRefEntry[];
  metaPolicyRefs?: PolicyRefEntry[];
  entry?: TranscriptEntry;
  stageDiagnostics?: { stage: string; raw_response: string; work_product: Record<string, unknown> }[];
  forceExpanded?: boolean;
}) {
  const [caveatsExpanded, setCaveatsExpanded] = useState(false);
  const [explainCopied, setExplainCopied] = useState(false);
  const polRefs = metaPolicyRefs || policyRefs || [];

  const handleExplain = () => {
    if (!entry) return;
    handleExplainEntry(entry);
    setExplainCopied(true);
    setTimeout(() => setExplainCopied(false), 3000);
  };

  const briefStage = stageDiagnostics?.find(s => s.stage === 'brief');
  const planStage = stageDiagnostics?.find(s => s.stage === 'plan');
  const hasDiagSections = !!(briefStage || planStage);
  const hasReasoning = refs.length > 0 || polRefs.length > 0 || hasDiagSections;

  if (!hasReasoning && !entry) return null;

  return (
    <div className="debate-taxonomy-refs-section">
      <div className="debate-taxonomy-refs">
        {entry && (
          explainCopied
            ? <span className="debate-reasoning-toggle" style={{ color: '#22c55e', cursor: 'default' }}>✓ Explain prompt copied to clipboard</span>
            : <button className="debate-reasoning-toggle" onClick={handleExplain} title="Copy an explain prompt to clipboard and open Gemini">Explain</button>
        )}
        {entry?.caveats && entry.caveats.length > 0 && (
          <button
            className="debate-reasoning-toggle"
            onClick={() => setCaveatsExpanded(e => !e)}
            title="Unresolved argument limitations identified by the judge"
            style={{ color: '#d97706' }}
          >
            Caveats ({entry.caveats.length})
          </button>
        )}
      </div>
      {caveatsExpanded && entry?.caveats && entry.caveats.length > 0 && (() => {
        const qualityCaveats = entry.caveats.filter(c => !c.startsWith('[Ungrounded]'));
        const ungroundedCaveats = entry.caveats.filter(c => c.startsWith('[Ungrounded]'));
        return (
          <div style={{
            margin: '4px 0 8px', padding: '8px 12px', borderRadius: 6,
            background: 'rgba(217,119,6,0.08)', borderLeft: '3px solid #d97706',
            fontSize: '0.75rem', lineHeight: 1.5,
          }}>
            {qualityCaveats.length > 0 && (
              <>
                <div style={{ fontWeight: 600, color: '#d97706', marginBottom: 4, fontSize: '0.7rem' }}>
                  Argument Caveats — limitations a critical reader would challenge:
                </div>
                <ul style={{ margin: '0 0 8px', paddingLeft: 18 }}>
                  {qualityCaveats.map((c, i) => (
                    <li key={i} style={{ marginBottom: 3 }}>{humanizeSpeakerIds(c)}</li>
                  ))}
                </ul>
              </>
            )}
            {ungroundedCaveats.length > 0 && (
              <>
                <div style={{ fontWeight: 600, color: '#6366f1', marginBottom: 4, fontSize: '0.7rem' }}>
                  Ungrounded Claims — from model knowledge, not the source corpus:
                </div>
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {ungroundedCaveats.map((c, i) => (
                    <li key={i} style={{ marginBottom: 3, color: '#6366f1' }}>
                      {humanizeSpeakerIds(c.replace('[Ungrounded] ', ''))}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        );
      })()}
      {forceExpanded && (
        <div className="debate-reasoning-list">
          {briefStage && (
            <details open className="debate-reasoning-section">
              <summary className="debate-reasoning-section-title" style={{ color: '#3b82f6' }}>BRIEF</summary>
              <div className="debate-reasoning-section-body">
                {(briefStage.work_product as Record<string, unknown>).situation_assessment
                  ? <p style={{ margin: '4px 0', fontSize: '0.78rem' }}>{String((briefStage.work_product as Record<string, unknown>).situation_assessment)}</p>
                  : <p style={{ margin: '4px 0', fontSize: '0.75rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>No situation assessment captured.</p>}
              </div>
            </details>
          )}
          {planStage && (
            <details open className="debate-reasoning-section">
              <summary className="debate-reasoning-section-title" style={{ color: '#a855f7' }}>PLAN</summary>
              <div className="debate-reasoning-section-body">
                {(() => {
                  const wp = planStage.work_product as Record<string, unknown>;
                  if (!wp || Object.keys(wp).length === 0) {
                    return <Markdown remarkPlugins={[remarkGfm]}>{fixMarkdownLinks(planStage.raw_response)}</Markdown>;
                  }
                  return (
                    <>
                      {(() => {
                        const drp = wp.directive_response_plan as string | undefined;
                        const dr = wp.directive_response as { directive: string; how_addressed: string } | undefined;
                        if (!drp && !dr) return null;
                        return (
                          <div style={{ padding: 6, margin: '4px 0', borderLeft: '3px solid rgba(245,158,11,0.6)', background: 'rgba(245,158,11,0.08)', borderRadius: 4, fontSize: '0.72rem' }}>
                            <span style={{ padding: '1px 5px', borderRadius: 3, background: 'rgba(245,158,11,0.2)', color: '#d97706', fontWeight: 600, fontSize: '0.65rem' }}>MODERATOR DIRECTIVE</span>
                            {dr && (
                              <>
                                <div style={{ marginTop: 4 }}><strong>Directive:</strong> {dr.directive}</div>
                                <div><strong>How addressed:</strong> {dr.how_addressed}</div>
                              </>
                            )}
                            {drp && !dr && <div style={{ marginTop: 4 }}>{String(drp)}</div>}
                          </div>
                        );
                      })()}
                      {!!wp.strategic_goal && (
                        <div style={{ padding: 6, margin: '4px 0', borderLeft: '3px solid rgba(168,85,247,0.4)', background: 'rgba(168,85,247,0.05)', fontSize: '0.75rem', fontWeight: 600 }}>
                          {String(wp.strategic_goal)}
                        </div>
                      )}
                      {!!wp.core_thesis && (
                        <div style={{ padding: 6, margin: '4px 0', borderLeft: '3px solid rgba(168,85,247,0.4)', background: 'rgba(168,85,247,0.05)', fontSize: '0.72rem' }}>
                          <span style={{ fontWeight: 600, fontSize: '0.68rem' }}>Core Thesis: </span>
                          {String(wp.core_thesis)}
                        </div>
                      )}
                      {!!wp.framing_choices && (
                        <div style={{ padding: 6, margin: '4px 0', borderLeft: '3px solid rgba(168,85,247,0.3)', fontSize: '0.7rem' }}>
                          <span style={{ fontWeight: 600, fontSize: '0.68rem' }}>Framing: </span>
                          {Array.isArray(wp.framing_choices)
                            ? (wp.framing_choices as { frame: string; why: string }[]).map((fc, i) => (
                              <div key={i} style={{ marginTop: i > 0 ? 4 : 2 }}>
                                <strong>{fc.frame}</strong>
                                {fc.why && <span style={{ opacity: 0.7 }}> — {fc.why}</span>}
                              </div>
                            ))
                            : <span>{String(wp.framing_choices)}</span>
                          }
                        </div>
                      )}
                      {Array.isArray(wp.planned_moves) && (wp.planned_moves as unknown[]).length > 0 && (
                        <details open style={{ margin: '4px 0' }}><summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '0.7rem' }}>Planned Moves</summary>
                          {(wp.planned_moves as { move: string; target?: string; detail: string }[]).map((m, i) => (
                            <div key={i} style={{ margin: '3px 0', paddingLeft: 6, borderLeft: '2px solid rgba(168,85,247,0.3)' }}>
                              <span style={{ display: 'inline-block', padding: '1px 5px', borderRadius: 3, background: 'rgba(168,85,247,0.2)', color: '#a855f7', fontSize: '0.65rem', fontWeight: 600 }}>{m.move}</span>
                              {m.target && <span style={{ marginLeft: 4, fontSize: '0.62rem', color: 'var(--text-muted)' }}>{'→'} {m.target}</span>}
                              {m.detail && <div style={{ fontSize: '0.68rem', marginTop: 1 }}>{m.detail}</div>}
                            </div>
                          ))}
                        </details>
                      )}
                      {Array.isArray(wp.argument_structure) && (wp.argument_structure as unknown[]).length > 0 && (
                        <details open style={{ margin: '4px 0' }}><summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '0.7rem' }}>Argumentation Structure</summary>
                          {(wp.argument_structure as { point: string; evidence: string; taxonomy_anchor: string }[]).map((s, i) => (
                            <div key={i} style={{ margin: '3px 0', padding: '4px 6px', borderLeft: '2px solid rgba(168,85,247,0.3)', background: 'rgba(168,85,247,0.03)', borderRadius: '0 4px 4px 0' }}>
                              <div style={{ fontSize: '0.7rem', fontWeight: 600 }}>{s.point}</div>
                              {s.evidence && <div style={{ fontSize: '0.68rem', marginTop: 1 }}>{s.evidence}</div>}
                              {s.taxonomy_anchor && (
                                <div style={{ marginTop: 2 }}>
                                  <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>Anchor: </span>
                                  <button
                                    onClick={() => focusMainWindowNode(s.taxonomy_anchor)}
                                    style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--accent)', textDecoration: 'underline', fontFamily: 'monospace', fontSize: '0.62rem' }}
                                  >{s.taxonomy_anchor}</button>
                                </div>
                              )}
                            </div>
                          ))}
                        </details>
                      )}
                      {!!wp.argument_sketch && (
                        <details open style={{ margin: '4px 0' }}><summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '0.7rem' }}>Argument Sketch</summary>
                          <div style={{ fontSize: '0.7rem', padding: 4, background: 'rgba(128,128,128,0.05)', borderRadius: 4 }}>
                            {String(wp.argument_sketch)}
                          </div>
                        </details>
                      )}
                      {Array.isArray(wp.anticipated_responses) && (wp.anticipated_responses as string[]).length > 0 && (
                        <details style={{ margin: '4px 0' }}><summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '0.7rem' }}>Anticipated Responses</summary>
                          <ul style={{ fontSize: '0.7rem', margin: '2px 0', paddingLeft: 14 }}>
                            {(wp.anticipated_responses as string[]).map((r, i) => (
                              <li key={i}>{r}</li>
                            ))}
                          </ul>
                        </details>
                      )}
                      {Array.isArray(wp.anticipated_challenges) && (wp.anticipated_challenges as string[]).length > 0 && (
                        <details style={{ margin: '4px 0' }}><summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '0.7rem' }}>Anticipated Challenges</summary>
                          <ul style={{ fontSize: '0.7rem', margin: '2px 0', paddingLeft: 14 }}>
                            {(wp.anticipated_challenges as string[]).map((r, i) => (
                              <li key={i}>{r}</li>
                            ))}
                          </ul>
                        </details>
                      )}
                    </>
                  );
                })()}
              </div>
            </details>
          )}
          {(refs.length > 0 || polRefs.length > 0) && (
            <details className="debate-reasoning-section">
              <summary className="debate-reasoning-section-title" style={{ color: '#f59e0b' }}>BDI</summary>
              <div className="debate-reasoning-section-body">
                <div className="debate-taxonomy-refs" style={{ marginBottom: 6 }}>
                  {[...refs].sort((a, b) => (b.relevance_score ?? 0) - (a.relevance_score ?? 0)).map((taxRef) => (
                    <TaxonomyPill key={taxRef.node_id} taxRef={taxRef} />
                  ))}
                  {polRefs.map((polRef, i) => {
                    const { id } = resolvePolRef(polRef);
                    return (
                      <span
                        key={`${id}-${i}`}
                        className="debate-taxonomy-pill debate-taxonomy-pill-clickable"
                        style={{ borderColor: 'var(--color-sit)', color: 'var(--color-sit)' }}
                        title={getPolicyAction(id)}
                        onClick={(e) => { e.stopPropagation(); focusMainWindowNode(id); }}
                      >
                        {id}
                      </span>
                    );
                  })}
                </div>
                {[...refs].sort((a, b) => (b.relevance_score ?? 0) - (a.relevance_score ?? 0)).map((taxRef) => {
                  const label = getNodeLabel(taxRef.node_id);
                  const { colorVar } = nodeIdToTab(taxRef.node_id);
                  const tw = getNodeWeight(taxRef.node_id);
                  const weightLabel = tw?.category === 'Beliefs' ? 'Confidence'
                    : tw?.category === 'Desires' ? 'Priority'
                    : tw?.category === 'Intentions' ? 'Operationality' : null;
                  const weightValue = tw?.category === 'Beliefs' ? tw.confidence
                    : tw?.category === 'Desires' ? tw.priority
                    : tw?.category === 'Intentions' ? tw.operationality : undefined;
                  return (
                    <div key={taxRef.node_id} className="debate-reasoning-item">
                      <button
                        className="debate-reasoning-node"
                        style={{ color: colorVar }}
                        onClick={() => focusMainWindowNode(taxRef.node_id)}
                      >
                        {taxRef.node_id}
                      </button>
                      <span className="debate-reasoning-label">{label}</span>
                      <span className="debate-reasoning-weight" style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                        ({taxRef.relevance_score != null && <>Relevance {taxRef.relevance_score.toFixed(2)}</>}
                        {taxRef.relevance_score != null && weightLabel && weightValue != null && ' ; '}
                        {weightLabel && weightValue != null && <>{weightLabel} {weightLabel === 'Confidence' ? weightValue.toFixed(2) : `${weightValue}/5`}</>})
                      </span>
                      <span className="debate-reasoning-text">{taxRef.relevance}</span>
                    </div>
                  );
                })}
                {polRefs.map((polRef, i) => {
                  const { id, relevance } = resolvePolRef(polRef);
                  return (
                    <div key={`${id}-${i}`} className="debate-reasoning-item">
                      <button
                        className="debate-reasoning-node"
                        style={{ color: 'var(--color-sit)' }}
                        onClick={() => focusMainWindowNode(id)}
                      >
                        {id}
                      </button>
                      <span className="debate-reasoning-label">{getPolicyAction(id)}</span>
                      <span className="debate-reasoning-text">{relevance ?? "Policy action referenced by this debater's argument"}</span>
                    </div>
                  );
                })}
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

/** Shows LLM activity, model, and retry info during generation */
function ProgressIndicator() {
  const { debateActivity, debateProgress } = useDebateStore(
    useShallow(s => ({ debateActivity: s.debateActivity, debateProgress: s.debateProgress }))
  );

  if (!debateActivity) return null;

  return (
    <div className="debate-progress-indicator">
      <span className="debate-progress-activity">{debateActivity}</span>
      {debateProgress && (debateProgress.attempt > 1 || debateProgress.phase === 'retry') && (
        <span className="debate-progress-retry">
          Retry {debateProgress.attempt}/{debateProgress.maxRetries}
          {debateProgress.backoffSeconds ? ` (waiting ${debateProgress.backoffSeconds}s)` : ''}
        </span>
      )}
      {debateProgress?.limitMessage && (
        <span className="debate-progress-limit">{debateProgress.limitMessage}</span>
      )}
    </div>
  );
}

const EXPORT_FORMATS_INLINE = [
  { id: 'json', label: 'JSON' },
  { id: 'markdown', label: 'Markdown' },
  { id: 'text', label: 'Plain Text' },
  { id: 'pdf', label: 'PDF' },
  { id: 'package', label: 'Package (ZIP)' },
];

function ExportButtonInline({ onExport }: { onExport: (format: string) => void }) {
  const [showMenu, setShowMenu] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showMenu) return;
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setShowMenu(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showMenu]);

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block', marginLeft: 'auto' }}>
      <button className="btn btn-sm" onClick={() => setShowMenu(!showMenu)} title="Export debate">
        Export &#9662;
      </button>
      {showMenu && (
        <div className="export-format-menu">
          {EXPORT_FORMATS_INLINE.map(f => (
            <button
              key={f.id}
              className="export-format-item"
              onClick={() => { onExport(f.id); setShowMenu(false); }}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Similar POVs panel ───────────────────────────────────

function DebateSimilarPovPanel({ query, onClose }: { query: string; onClose: () => void }) {
  const { semanticResults, getLabelForId } = useTaxonomyStore();
  const [searching, setSearching] = useState(true);
  const isFirstRender = useRef(true);

  // Don't mark done on the initial mount (semanticResults may be stale from a previous search);
  // only react to genuine updates that arrive after this component mounts.
  useEffect(() => {
    if (isFirstRender.current) { isFirstRender.current = false; return; }
    setSearching(false);
  }, [semanticResults]);

  const rows = semanticResults.filter(r => r.score >= 0.4).slice(0, 20);
  const truncatedQuery = query.length > 70 ? query.slice(0, 67) + '…' : query;

  return (
    <div className="debate-similar-pov-panel">
      <div className="debate-similar-pov-header">
        <span className="debate-similar-pov-title">Similar Perspectives</span>
        <span className="debate-similar-pov-query" title={query}>&ldquo;{truncatedQuery}&rdquo;</span>
        <button className="debate-find-close" onClick={onClose} title="Close">×</button>
      </div>
      {searching ? (
        <div className="debate-similar-pov-status">Searching…</div>
      ) : rows.length === 0 ? (
        <div className="debate-similar-pov-status">No similar POVs found.</div>
      ) : (
        <div className="debate-similar-pov-rows">
          {rows.map(r => {
            const label = getLabelForId(r.id);
            const { colorVar } = nodeIdToTab(r.id);
            return (
              <button
                key={r.id}
                className="debate-similar-pov-row"
                onClick={() => focusMainWindowNode(r.id)}
                title={label}
              >
                <span className="debate-similar-pov-score">{Math.round(r.score * 100)}%</span>
                <span className="debate-similar-pov-id" style={{ color: colorVar }}>{r.id}</span>
                <span className="debate-similar-pov-label">{label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Find-in-debate helpers ────────────────────────────────

function countOccurrences(text: string, query: string): number {
  if (!query) return 0;
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  let count = 0, pos = 0;
  while ((pos = lower.indexOf(q, pos)) !== -1) { count++; pos += q.length; }
  return count;
}

function HighlightedText({ text, query, matchOffset, currentIndex }: {
  text: string; query: string; matchOffset: number; currentIndex: number;
}) {
  if (!query) return <>{text}</>;
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  const parts: React.ReactNode[] = [];
  let pos = 0, n = 0;
  while (pos <= text.length) {
    const idx = lower.indexOf(q, pos);
    if (idx === -1) { if (pos < text.length) parts.push(text.slice(pos)); break; }
    if (idx > pos) parts.push(text.slice(pos, idx));
    const gi = matchOffset + n;
    parts.push(
      <mark
        key={gi}
        className={`debate-find-match${gi === currentIndex ? ' debate-find-match-current' : ''}`}
        data-find-index={gi}
      >
        {text.slice(idx, idx + query.length)}
      </mark>
    );
    n++; pos = idx + query.length;
  }
  return <>{parts}</>;
}

function FindBar({ query, onQueryChange, current, total, onPrev, onNext, onClose }: {
  query: string; onQueryChange: (q: string) => void;
  current: number; total: number;
  onPrev: () => void; onNext: () => void; onClose: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);

  return (
    <div className="debate-find-bar">
      <input
        ref={inputRef}
        className="debate-find-input"
        type="text"
        placeholder="Find in debate…"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
          else if (e.key === 'Enter') { e.preventDefault(); e.shiftKey ? onPrev() : onNext(); }
        }}
      />
      <span className="debate-find-count">
        {total === 0 ? (query ? 'No results' : '') : `${current + 1} / ${total}`}
      </span>
      <button className="debate-find-nav" onClick={onPrev} disabled={total === 0} title="Previous (Shift+Enter)">▲</button>
      <button className="debate-find-nav" onClick={onNext} disabled={total === 0} title="Next (Enter)">▼</button>
      <button className="debate-find-close" onClick={onClose} title="Close (Esc)">×</button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────

function buildExplainPrompt(entry: TranscriptEntry): string {
  const speaker = speakerLabel(entry.speaker);
  const refs = entry.taxonomy_refs || [];
  let prompt = `Explain this section of a debate between the Accelerationist, the Safetyist, and the Skeptic:\n\n`;
  prompt += `[${speaker} — ${entry.type}]\n${entry.content}\n`;
  if (refs.length > 0) {
    prompt += `\nTaxonomy references cited:\n`;
    for (const ref of refs) {
      const label = getNodeLabel(ref.node_id);
      prompt += `- ${ref.node_id} (${label}): ${ref.relevance}\n`;
    }
  }
  return prompt;
}

function handleExplainEntry(entry: TranscriptEntry) {
  const prompt = buildExplainPrompt(entry);
  void api.clipboardWriteText(prompt);
  void api.openExternal('https://gemini.google.com/app');
}

/** Wrapper that adds delete controls to any transcript entry */
function EntryDeleteControls({ entry, totalEntries, entryIndex }: {
  entry: TranscriptEntry; totalEntries: number; entryIndex: number;
}) {
  const { deleteTranscriptEntries, activeDebate } = useDebateStore(
    useShallow(s => ({ deleteTranscriptEntries: s.deleteTranscriptEntries, activeDebate: s.activeDebate }))
  );
  const [confirmMode, setConfirmMode] = useState<'single' | 'after' | null>(null);

  const handleDeleteSingle = async () => {
    await deleteTranscriptEntries([entry.id]);
    setConfirmMode(null);
  };

  const handleDeleteThisAndAfter = async () => {
    if (!activeDebate) return;
    const idx = activeDebate.transcript.findIndex(e => e.id === entry.id);
    if (idx < 0) return;
    const idsToRemove = activeDebate.transcript.slice(idx).map(e => e.id);
    await deleteTranscriptEntries(idsToRemove);
    setConfirmMode(null);
  };

  if (confirmMode) {
    return (
      <div className="debate-entry-delete-confirm">
        <span>{confirmMode === 'single' ? 'Delete this entry?' : `Delete this and ${totalEntries - entryIndex - 1} entries after it?`}</span>
        <button className="btn btn-sm btn-danger" onClick={confirmMode === 'single' ? handleDeleteSingle : handleDeleteThisAndAfter}>Yes</button>
        <button className="btn btn-sm" onClick={() => setConfirmMode(null)}>No</button>
      </div>
    );
  }

  return (
    <div className="debate-entry-delete-actions">
      <button
        className="debate-entry-delete-btn"
        onClick={() => setConfirmMode('single')}
        title="Delete this entry"
      >
        &times;
      </button>
      {entryIndex < totalEntries - 1 && (
        <button
          className="debate-entry-delete-btn debate-entry-delete-after"
          onClick={() => setConfirmMode('after')}
          title="Delete this and all entries after it"
        >
          &times;&darr;
        </button>
      )}
    </div>
  );
}

/** Strip markdown headings the AI sometimes hallucinates at the top of a statement (e.g. "# Engine Thermometer Accelerator"). */
function stripLeadingHeadings(text: string): string {
  return text.replace(/^(?:#{1,3}\s+.*\n*)+/, '').trimStart();
}

/** Fix markdown links broken by newlines inside `[text](url)` — AI models often wrap long URLs.
 *  Also repairs garbled DOI links: if the link text contains a (doi:...) parenthetical, extract
 *  the DOI and use it to reconstruct the correct URL, then clean up the display text. */
function fixMarkdownLinks(text: string): string {
  return text.replace(/\[([^\]]*)\]\(\s*([\s\S]*?)\s*\)/g, (_match, linkText: string, url: string) => {
    let cleanUrl = url.replace(/\s+/g, '');
    let cleanText = linkText;

    // If the link text contains doi:..., extract the FIRST DOI and use it to fix the URL.
    // The AI often omits closing parens, so match flexibly: stop at whitespace, paren, or end.
    const doiMatch = linkText.match(/doi:\s*(10\.\d{4,9}\/\S+?)(?:\s|\)|$)/i);
    if (doiMatch) {
      cleanUrl = `https://doi.org/${doiMatch[1]}`;
      // Strip ALL doi parentheticals (with or without closing paren) and trailing junk
      cleanText = linkText
        .replace(/\s*\(?doi:[^)]*\)?/gi, '')
        .replace(/\s*\([A-Z]{1,5}\d{8,}\)/g, '')
        .replace(/\d+\)\]?$/, '')  // trailing "41)]" junk
        .trim();
    }

    return `[${cleanText || linkText}](${cleanUrl})`;
  });
}

function ClarificationCard({ entry }: { entry: TranscriptEntry }) {
  const meta = entry.metadata as Record<string, unknown> | undefined;
  const questions = meta?.questions as { question: string; options?: string[] }[] | undefined;

  // If structured questions available in metadata, render from those
  if (questions && Array.isArray(questions) && questions.length > 0 && typeof questions[0] === 'object') {
    return (
      <div className="debate-statement debate-speaker-system debate-type-clarification" data-entry-id={entry.id}>
        <div className="debate-statement-header">
          <span className="debate-statement-speaker">{speakerLabel(entry.speaker)}</span>
          <span className="debate-statement-type">{entry.type}</span>
        </div>
        <div className="debate-statement-content markdown-body">
          <ol>
            {questions.map((q, i) => (
              <li key={i}>{typeof q === 'string' ? q : q.question}</li>
            ))}
          </ol>
        </div>
      </div>
    );
  }

  // Fallback: render content as markdown (old format)
  return (
    <div className="debate-statement debate-speaker-system debate-type-clarification" data-entry-id={entry.id}>
      <div className="debate-statement-header">
        <span className="debate-statement-speaker">{speakerLabel(entry.speaker)}</span>
        <span className="debate-statement-type">{entry.type}</span>
      </div>
      <div className="debate-statement-content markdown-body">
        <Markdown remarkPlugins={[remarkGfm]} components={lineageMarkdownComponents}>{fixMarkdownLinks(entry.content)}</Markdown>
      </div>
    </div>
  );
}

function StatementCard({ entry, statementId, findQuery = '', matchOffset = 0, findCurrentIndex = -1, entryIndex, totalEntries }: {
  entry: TranscriptEntry; statementId?: string; findQuery?: string; matchOffset?: number; findCurrentIndex?: number; entryIndex?: number; totalEntries?: number;
}) {
  const color = speakerColor(entry.speaker);
  const isPover = entry.speaker !== 'system' && entry.speaker !== 'user';
  const activeDebate = useDebateStore(s => s.activeDebate);
  const defaultTier = useDebateStore(s => s.responseLength);
  const setEntryDisplayTier = useDebateStore(s => s.setEntryDisplayTier);
  const askQuestion = useDebateStore(s => s.askQuestion);
  const debateGenerating = useDebateStore(s => s.debateGenerating);
  const diagnosticsEnabled = useDebateStore(s => s.diagnosticsEnabled);
  const toggleDiagnostics = useDebateStore(s => s.toggleDiagnostics);
  const selectDiagEntry = useDebateStore(s => s.selectDiagEntry);
  const deleteTranscriptEntries = useDebateStore(s => s.deleteTranscriptEntries);
  const qbafEnabled = useTaxonomyStore(s => s.qbafEnabled);
  const [deleteConfirm, setDeleteConfirm] = useState<'single' | 'after' | null>(null);
  const [showSymbolTooltips, setShowSymbolTooltips] = useState(false);
  const anNodeId = activeDebate?.argument_network?.nodes?.find(
    n => n.source_entry_id === entry.id
  )?.id ?? null;
  const meta = entry.metadata as Record<string, unknown> | undefined;
  const netDelta = meta?.qbaf_net_delta as number | undefined;
  const turnSymbols = meta?.turn_symbols as { symbol: string; tooltip: string }[] | undefined;
  const vocabResolutions = meta?.vocabulary_resolutions as VocabResolution[] | undefined;
  const showTerms = useCallback(() => { setEntryDisplayTier(entry.id, 'terms'); }, [entry.id, setEntryDisplayTier]);
  const showLineage = useCallback(() => { setEntryDisplayTier(entry.id, 'lineage'); }, [entry.id, setEntryDisplayTier]);
  const mdComponents = useMemo(
    () => getDebateMarkdownComponents(vocabResolutions, vocabResolutions?.length ? showTerms : undefined, showLineage),
    [vocabResolutions, showTerms, showLineage],
  );

  // Tier display logic (DT-3)
  const hasSummaries = entry.summaries != null;
  const isSubstantive = ['opening', 'statement', 'fact-check', 'cross_respond'].includes(entry.type);
  // Moderator interventions and system steps always show full content
  const activeTier = isSubstantive ? (entry.display_tier ?? defaultTier) : 'detailed';
  const showTierPills = isSubstantive;
  // When comment highlights are active, hide the markdown to avoid text duplication
  const hasHighlights = useHasCommentHighlights(entry.id, activeTier as DetailTier);
  let displayContent: string;
  let isTruncated = false;
  if (hasSummaries && activeTier === 'brief') {
    displayContent = entry.summaries!.brief;
  } else if (hasSummaries && activeTier === 'medium') {
    displayContent = entry.summaries!.medium;
  } else if (!hasSummaries && activeTier === 'brief' && isSubstantive) {
    // Fallback: truncate to first 2 sentences
    const sentences = entry.content.split(/(?<=[.!?])\s+/);
    displayContent = sentences.slice(0, 2).join(' ');
    isTruncated = sentences.length > 2;
  } else if (!hasSummaries && activeTier === 'medium' && isSubstantive) {
    // Fallback: truncate to first paragraph or ~500 chars
    const paraBreak = entry.content.indexOf('\n\n');
    if (paraBreak > 0 && paraBreak < 500) {
      displayContent = entry.content.slice(0, paraBreak);
    } else {
      displayContent = entry.content.slice(0, 500);
    }
    isTruncated = displayContent.length < entry.content.length;
  } else {
    displayContent = entry.content;
  }
  // Strip hallucinated markdown headings (AI sometimes prepends "# Keyword Soup")
  displayContent = stripLeadingHeadings(displayContent);

  return (
    <div
      className={`debate-statement debate-speaker-${entry.speaker} debate-type-${entry.type}`}
      data-entry-id={entry.id}
      data-is-pover={isPover ? 'true' : 'false'}
    >
      <div className="debate-statement-header">
        {statementId && (
          <span
            className="debate-statement-id"
            title={`Statement ${statementId} — stable position in transcript`}
            id={`stmt-${statementId}`}
          >
            {statementId}
          </span>
        )}
        <span className="debate-statement-speaker" style={color ? { color } : undefined}>
          {speakerLabel(entry.speaker)}
        </span>
        <span className="debate-statement-type">
          {entry.type}
          {anNodeId && <span className="debate-an-id"> · {anNodeId}</span>}
        </span>
        {showTierPills && (
          <span className="debate-tier-pills">
            {(['brief', 'medium', 'detailed', 'reasoning', 'terms', 'lineage', 'claims', 'convergence'] as const).map(tier => {
              if (tier === 'terms' && !(vocabResolutions && vocabResolutions.length > 0)) return null;
              return (
                <button
                  key={tier}
                  className={`debate-tier-pill${activeTier === tier ? ' debate-tier-pill-active' : ''}`}
                  onClick={(e) => { e.stopPropagation(); setEntryDisplayTier(entry.id, tier); }}
                  title={tier === 'brief' ? '2-3 sentences' : tier === 'medium' ? '1-2 paragraphs' : tier === 'detailed' ? 'Full response' : tier === 'reasoning' ? 'Brief, plan & BDI (replaces text)' : tier === 'claims' ? 'Argument network claims' : tier === 'terms' ? 'Vocabulary disambiguation' : tier === 'lineage' ? 'Intellectual lineage references' : 'Convergence diagnostics'}
                  style={(tier === 'terms' && activeTier !== 'terms') || (tier === 'lineage' && activeTier !== 'lineage') ? { color: 'rgb(168, 85, 247)' } : undefined}
                >
                  {tier === 'brief' ? 'Brief' : tier === 'medium' ? 'Med' : tier === 'detailed' ? 'Detail' : tier === 'reasoning' ? 'Plan' : tier === 'claims' ? 'Claims' : tier === 'terms' ? 'Terms' : tier === 'lineage' ? 'Lineage' : 'Conv'}
                </button>
              );
            })}
          </span>
        )}
        {qbafEnabled && netDelta != null && Math.abs(netDelta) > 0.01 && (
          <span
            className={`qbaf-net-delta ${netDelta > 0 ? 'qbaf-delta-up' : 'qbaf-delta-down'}`}
            title={`Net QBAF strength change this turn: ${netDelta > 0 ? '+' : ''}${netDelta.toFixed(2)}`}
          >
            {netDelta > 0 ? '▲' : '▼'} {netDelta > 0 ? '+' : ''}{netDelta.toFixed(2)} net
          </span>
        )}
        {isPover && (
          <button
            className="debate-diagnose-btn"
            onClick={(e) => {
              e.stopPropagation();
              if (!diagnosticsEnabled) toggleDiagnostics();
              // Small delay to let the diagnostics window open before selecting
              setTimeout(() => selectDiagEntry(entry.id, true), diagnosticsEnabled ? 0 : 1200);
            }}
            title="Open diagnostics for this turn"
          >
            Diagnose
          </button>
        )}
        {entryIndex != null && totalEntries != null && !deleteConfirm && (
          <span className="debate-entry-delete-actions">
            <button
              className="debate-entry-delete-btn"
              onClick={(e) => { e.stopPropagation(); setDeleteConfirm('single'); }}
              title="Delete this entry"
            >&times;</button>
            {entryIndex < totalEntries - 1 && (
              <button
                className="debate-entry-delete-btn"
                onClick={(e) => { e.stopPropagation(); setDeleteConfirm('after'); }}
                title="Delete this and all entries after it"
              >&times;&darr;</button>
            )}
          </span>
        )}
      </div>
      {deleteConfirm && (
        <div className="debate-entry-delete-confirm">
          <span>{deleteConfirm === 'single' ? 'Delete this entry?' : `Delete this and ${totalEntries! - entryIndex! - 1} entries after it?`}</span>
          <button className="btn btn-sm btn-danger" onClick={async (e) => {
            e.stopPropagation();
            if (deleteConfirm === 'single') {
              await deleteTranscriptEntries([entry.id]);
            } else if (activeDebate) {
              const idx = activeDebate.transcript.findIndex(e => e.id === entry.id);
              if (idx >= 0) await deleteTranscriptEntries(activeDebate.transcript.slice(idx).map(e => e.id));
            }
            setDeleteConfirm(null);
          }}>Yes</button>
          <button className="btn btn-sm" onClick={(e) => { e.stopPropagation(); setDeleteConfirm(null); }}>No</button>
        </div>
      )}
      {turnSymbols && turnSymbols.length > 0 && (
        <>
          <div className="debate-turn-symbols">
            {turnSymbols.map((s, i) => (
              <span
                key={i}
                className="debate-turn-symbol"
                title={s.tooltip}
                style={{ cursor: 'pointer' }}
                onClick={() => setShowSymbolTooltips(v => !v)}
              >
                {s.symbol}
              </span>
            ))}
          </div>
          {showSymbolTooltips && (
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', padding: '2px 8px 4px', lineHeight: 1.5 }}>
              {turnSymbols.map((s, i) => (
                <div key={i}>{s.symbol} — {s.tooltip}</div>
              ))}
            </div>
          )}
        </>
      )}
      {activeTier === 'terms' && vocabResolutions && vocabResolutions.length > 0 ? (
        <div className="debate-statement-content">
          <VocabTermsView resolutions={vocabResolutions} ambiguities={meta?.vocabulary_ambiguities as { colloquial: string; offset?: number }[] | undefined} />
        </div>
      ) : activeTier === 'lineage' ? (
        <div className="debate-statement-content">
          <LineageTermsView content={entry.content} />
        </div>
      ) : activeTier === 'claims' ? (
        <div className="debate-statement-content">
          <ClaimsView entryId={entry.id} debate={activeDebate!} />
        </div>
      ) : activeTier === 'convergence' ? (
        <div className="debate-statement-content">
          <ConvergenceInlineCard signal={activeDebate?.convergence_signals?.find(s => s.entry_id === entry.id)} />
        </div>
      ) : activeTier === 'reasoning' ? (
        /* Plan tier: show only the brief/plan/BDI sections, replacing the statement text */
        <TaxonomyRefsSection
          refs={entry.taxonomy_refs}
          policyRefs={entry.policy_refs}
          metaPolicyRefs={(entry.metadata as Record<string, unknown>)?.policy_refs as string[] | undefined}
          entry={entry}
          stageDiagnostics={activeDebate?.diagnostics?.entries[entry.id]?.stage_diagnostics as { stage: string; raw_response: string; work_product: Record<string, unknown> }[] | undefined}
          forceExpanded
        />
      ) : (
        <>
          {!hasHighlights && (
            <div className="debate-statement-content markdown-body">
              {findQuery
                ? <HighlightedText text={displayContent} query={findQuery} matchOffset={matchOffset} currentIndex={findCurrentIndex} />
                : <Markdown remarkPlugins={[remarkGfm]} components={mdComponents}>{fixMarkdownLinks(displayContent)}</Markdown>}
              {isTruncated && (
                <span
                  className="debate-tier-truncated"
                  onClick={(e) => { e.stopPropagation(); setEntryDisplayTier(entry.id, 'detailed'); }}
                  title="Click to show full content"
                >... show full</span>
              )}
            </div>
          )}
          <CommentHighlightedText text={displayContent} entryId={entry.id} activeTier={activeTier as DetailTier} />
        </>
      )}
      {activeTier !== 'reasoning' && (
        <>
          <EntryCommentBadge entryId={entry.id} />
          {entry.speaker === 'system' && entry.type === 'system' && entry.content.includes('Consider exploring:') && (() => {
            const match = entry.content.match(/Consider exploring:\s*(.+)/s);
            const topic = match?.[1]?.trim();
            if (!topic) return null;
            return (
              <div style={{
                marginTop: 10, padding: '8px 12px', borderRadius: 6,
                background: 'rgba(59, 130, 246, 0.08)', border: '1px solid rgba(59, 130, 246, 0.25)',
                display: 'flex', alignItems: 'center', gap: 10,
              }}>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', flex: 1 }}>
                  Redirect the debate to explore this topic?
                </span>
                <button
                  disabled={!!debateGenerating}
                  onClick={(e) => { e.stopPropagation(); void askQuestion(`Explore this: ${topic}`); }}
                  style={{
                    padding: '6px 18px', fontSize: '0.8rem', fontWeight: 700,
                    background: '#3b82f6', color: '#fff', border: 'none',
                    borderRadius: 5, cursor: debateGenerating ? 'not-allowed' : 'pointer',
                    opacity: debateGenerating ? 0.5 : 1, whiteSpace: 'nowrap',
                  }}
                  title={`Ask debaters to explore: ${topic}`}
                >
                  Explore This
                </button>
              </div>
            );
          })()}
          <TaxonomyRefsSection
            refs={entry.taxonomy_refs}
            policyRefs={entry.policy_refs}
            metaPolicyRefs={(entry.metadata as Record<string, unknown>)?.policy_refs as string[] | undefined}
            entry={entry}
            stageDiagnostics={activeDebate?.diagnostics?.entries[entry.id]?.stage_diagnostics as { stage: string; raw_response: string; work_product: Record<string, unknown> }[] | undefined}
            forceExpanded={false}
          />
        </>
      )}
    </div>
  );
}

/** Probing questions card — clicking a question inserts it as the user's next question */
function ProbingCard({ entry, statementId }: { entry: TranscriptEntry; statementId?: string }) {
  const { askQuestion, debateGenerating } = useDebateStore(
    useShallow(s => ({ askQuestion: s.askQuestion, debateGenerating: s.debateGenerating }))
  );
  const questions = (entry.metadata?.probing_questions as { text: string; targets: string[]; threatens?: string; type?: string }[]) || [];

  const handleAsk = async (q: { text: string; targets: string[] }) => {
    if (debateGenerating) return;
    // If the question targets specific debaters, prepend @mentions so askQuestion routes to them
    const validTargets = (q.targets || []).filter(t => POVER_INFO[t as Exclude<SpeakerId, 'user'>]);
    if (validTargets.length > 0 && validTargets.length < 3) {
      const mentions = validTargets.map(t => `@${POVER_INFO[t as Exclude<SpeakerId, 'user'>]?.label}`).join(' ');
      await askQuestion(`${mentions} ${q.text}`);
      return;
    }
    await askQuestion(q.text);
  };

  return (
    <div className="debate-statement debate-type-probing debate-speaker-system">
      <div className="debate-statement-header">
        {statementId && (
          <span className="debate-statement-id" title={`Statement ${statementId}`} id={`stmt-${statementId}`}>
            {statementId}
          </span>
        )}
        <span className="debate-statement-speaker">Facilitator</span>
        <span className="debate-statement-type">probing questions</span>
      </div>
      <div className="debate-probing-questions">
        {questions.map((q, i) => {
          const validTargets = (q.targets || []).filter(t => POVER_INFO[t as Exclude<SpeakerId, 'user'>]);
          const hasTargets = validTargets.length > 0 && validTargets.length < 3;
          return (
            <button
              key={i}
              className="debate-probing-question-btn"
              onClick={() => void handleAsk(q)}
              disabled={!!debateGenerating}
              title={[
                q.targets?.length > 0 ? `Directed at: ${q.targets.map((t) => POVER_INFO[t as Exclude<SpeakerId, 'user'>]?.label || t).join(', ')}` : null,
                q.threatens ? `Threatens: ${q.threatens}` : null,
                q.type ? `Type: ${q.type}` : null,
              ].filter(Boolean).join('\n') || 'Ask this question to all debaters'}
            >
              {hasTargets && validTargets.map(t => {
                const info = POVER_INFO[t as Exclude<SpeakerId, 'user'>];
                return (
                  <span key={t} className="debate-probing-target" style={info?.color ? { color: info.color } : undefined}>
                    @{info?.label}
                  </span>
                );
              })}
              {q.text}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Custom context menu for debate text selection */
function DebateContextMenu({
  menu,
  onClose,
  onSimilarPovSearch,
  onComment,
}: {
  menu: ContextMenuState;
  onClose: () => void;
  onSimilarPovSearch: (query: string) => void;
  onComment: () => void;
}) {
  const { factCheckSelection, debateGenerating } = useDebateStore(
    useShallow(s => ({ factCheckSelection: s.factCheckSelection, debateGenerating: s.debateGenerating }))
  );
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onClose]);

  const handleCopy = () => {
    void api.clipboardWriteText(menu.selectedText);
    onClose();
  };

  const handleSearchGoogle = () => {
    const query = encodeURIComponent(menu.selectedText.slice(0, 200));
    void api.openExternal(`https://www.google.com/search?q=${query}`);
    onClose();
  };

  const handleSimilarPovs = () => {
    onSimilarPovSearch(menu.selectedText);
    onClose();
  };

  const handleFactCheck = async () => {
    onClose();
    await factCheckSelection(menu.selectedText, menu.entryId);
  };

  const truncatedText = menu.selectedText.length > 40
    ? menu.selectedText.slice(0, 37) + '...'
    : menu.selectedText;

  return (
    <div
      ref={menuRef}
      className="debate-context-menu"
      style={{ left: menu.x, top: menu.y }}
    >
      <button className="debate-context-menu-item" onClick={handleCopy}>
        Copy
      </button>
      <button className="debate-context-menu-item" onClick={handleSearchGoogle}>
        Search Google for &lsquo;{truncatedText}&rsquo;
      </button>
      <button className="debate-context-menu-item" onClick={handleSimilarPovs}>
        Similar Perspectives for &lsquo;{truncatedText}&rsquo;
      </button>
      <button className="debate-context-menu-item" onClick={() => {
        void api.clipboardWriteText(`EXPLAIN: ${menu.selectedText}`);
        void api.openExternal('https://gemini.google.com/app');
        onClose();
      }}>
        Explain&hellip;
      </button>
      {menu.isPoverStatement && (
        <button
          className="debate-context-menu-item debate-context-menu-fact-check"
          onClick={handleFactCheck}
          disabled={!!debateGenerating}
        >
          Fact check
        </button>
      )}
      {menu.entryId && (
        <button className="debate-context-menu-item" onClick={onComment}>
          Add Comment
        </button>
      )}
    </div>
  );
}

/** Small badge showing comment count on a debate entry */
function EntryCommentBadge({ entryId }: { entryId: string }) {
  const count = useEntryCommentCount(entryId);
  const toggleSidebar = useCommentStore(s => s.toggleSidebar);
  if (count === 0) return null;
  return (
    <button
      className="entry-comment-badge"
      onClick={(e) => { e.stopPropagation(); toggleSidebar(); }}
      title={`${count} comment(s) — click to open sidebar`}
    >
      {count}
    </button>
  );
}

/** Fact-check result card */
function FactCheckCard({ entry, statementId, findQuery = '', matchOffset = 0, findCurrentIndex = -1 }: {
  entry: TranscriptEntry; statementId?: string; findQuery?: string; matchOffset?: number; findCurrentIndex?: number;
}) {
  const activeDebate = useDebateStore(s => s.activeDebate);
  const [showWebEvidence, setShowWebEvidence] = useState(false);
  const factCheck = entry.metadata?.fact_check as {
    verdict: string;
    explanation: string;
    checked_text: string;
    web_search_used?: boolean;
    web_search_queries?: string[];
    web_search_evidence?: string;
    web_search_citations?: {
      uri: string;
      title: string;
      segments: { startIndex: number; endIndex: number; text?: string; confidence?: number }[];
    }[];
  } | undefined;

  const verdictClass = factCheck?.verdict
    ? `debate-fact-check-${factCheck.verdict}`
    : '';

  const citations = factCheck?.web_search_citations ?? [];
  const hasWebEvidence = factCheck?.web_search_used || factCheck?.web_search_evidence || citations.length > 0;

  // Build a plain-text view of web_search_evidence annotated with inline [n] markers
  // at the end of each grounded segment. Segments index into the raw evidence text
  // by UTF-16 offsets as returned by Gemini groundingMetadata.groundingSupports.
  const annotatedEvidence = (() => {
    const raw = factCheck?.web_search_evidence;
    if (!raw || citations.length === 0) return null;

    type Marker = { pos: number; citationIndex: number; confidence?: number };
    const markers: Marker[] = [];
    citations.forEach((c, ci) => {
      for (const seg of c.segments) {
        if (typeof seg.endIndex === 'number' && seg.endIndex <= raw.length) {
          markers.push({ pos: seg.endIndex, citationIndex: ci, confidence: seg.confidence });
        }
      }
    });
    if (markers.length === 0) return null;
    markers.sort((a, b) => a.pos - b.pos);

    const parts: ReactNode[] = [];
    let cursor = 0;
    markers.forEach((m, i) => {
      if (m.pos > cursor) parts.push(raw.slice(cursor, m.pos));
      parts.push(
        <sup key={`cite-${i}`} className="debate-fact-check-citation-marker">
          <a
            href={`#fact-check-source-${m.citationIndex + 1}`}
            title={citations[m.citationIndex]?.title + (m.confidence != null ? ` (confidence ${m.confidence.toFixed(2)})` : '')}
          >
            [{m.citationIndex + 1}]
          </a>
        </sup>,
      );
      cursor = m.pos;
    });
    if (cursor < raw.length) parts.push(raw.slice(cursor));
    return parts;
  })();

  return (
    <div className={`debate-statement debate-type-fact-check debate-speaker-system ${verdictClass}`}>
      <div className="debate-statement-header">
        {statementId && (
          <span className="debate-statement-id" title={`Statement ${statementId}`} id={`stmt-${statementId}`}>
            {statementId}
          </span>
        )}
        <span className="debate-statement-speaker">Fact Check</span>
        <span className={`debate-fact-check-verdict ${verdictClass}`}>
          {factCheck?.verdict || 'unknown'}
        </span>
        {citations.length > 0 && (
          <span className="debate-fact-check-sources-inline" aria-label="External sources">
            <span className="debate-fact-check-sources-inline-label">Sources:</span>
            {citations.map((c, i) => (
              c.uri ? (
                <a
                  key={c.uri || i}
                  href={c.uri}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="debate-fact-check-sources-inline-link"
                  title={c.title || c.uri}
                >
                  [{i + 1}]
                </a>
              ) : (
                <span
                  key={i}
                  className="debate-fact-check-sources-inline-link debate-fact-check-sources-inline-link-disabled"
                  title={c.title}
                >
                  [{i + 1}]
                </span>
              )
            ))}
          </span>
        )}
        {hasWebEvidence && (
          <button
            className="btn btn-sm debate-fact-check-web-toggle"
            onClick={() => setShowWebEvidence(!showWebEvidence)}
            title={showWebEvidence ? 'Hide web evidence' : 'Show web search evidence'}
          >
            {showWebEvidence ? 'Hide Web Evidence' : 'Show Web Evidence'}
          </button>
        )}
      </div>
      <div className="debate-statement-content markdown-body">
        {findQuery
          ? <HighlightedText text={entry.content} query={findQuery} matchOffset={matchOffset} currentIndex={findCurrentIndex} />
          : <Markdown remarkPlugins={[remarkGfm]} components={lineageMarkdownComponents}>{fixMarkdownLinks(entry.content)}</Markdown>}
      </div>
      {showWebEvidence && (
        <div className="debate-fact-check-web-evidence">
          <div className="debate-fact-check-web-evidence-header">Web Search Evidence</div>
          <div className="debate-fact-check-web-evidence-body markdown-body">
            {annotatedEvidence ? (
              <div className="debate-fact-check-evidence-text">{annotatedEvidence}</div>
            ) : factCheck?.web_search_evidence ? (
              <Markdown remarkPlugins={[remarkGfm]}>{fixMarkdownLinks(factCheck.web_search_evidence)}</Markdown>
            ) : (
              <p style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>
                {factCheck?.web_search_used
                  ? 'Web search was performed but the grounding response did not include extractable evidence text. The search results were still used to inform the verdict above.'
                  : 'Web search was not available for this fact check. Verdict is based on internal taxonomy data and conflict database only.'}
              </p>
            )}
            {citations.length > 0 && (
              <ol className="debate-fact-check-sources">
                {citations.map((c, i) => (
                  <li key={c.uri || i} id={`fact-check-source-${i + 1}`}>
                    {c.uri ? (
                      <a href={c.uri} target="_blank" rel="noreferrer noopener">{c.title}</a>
                    ) : (
                      <span>{c.title}</span>
                    )}
                    {c.segments.length > 0 && (
                      <span className="debate-fact-check-source-meta">
                        {' '}
                        — {c.segments.length} grounded span{c.segments.length === 1 ? '' : 's'}
                        {(() => {
                          const withConf = c.segments.filter(s => typeof s.confidence === 'number');
                          if (withConf.length === 0) return null;
                          const max = Math.max(...withConf.map(s => s.confidence as number));
                          return `, max confidence ${max.toFixed(2)}`;
                        })()}
                      </span>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      )}
      <TaxonomyRefsSection
        refs={entry.taxonomy_refs}
        policyRefs={entry.policy_refs}
        metaPolicyRefs={(entry.metadata as Record<string, unknown>)?.policy_refs as string[] | undefined}
        entry={entry}
        stageDiagnostics={activeDebate?.diagnostics?.entries[entry.id]?.stage_diagnostics as { stage: string; raw_response: string; work_product: Record<string, unknown> }[] | undefined}
      />
    </div>
  );
}

/** Edit Claims phase — review extracted document claims before debating */
function ClaimsEditor() {
  const { activeDebate, updateClaim, deleteClaim, proceedToOpening } = useDebateStore(
    useShallow(s => ({ activeDebate: s.activeDebate, updateClaim: s.updateClaim, deleteClaim: s.deleteClaim, proceedToOpening: s.proceedToOpening }))
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');

  if (!activeDebate?.document_analysis) return null;

  const claims = activeDebate.document_analysis.i_nodes;
  const tensions = activeDebate.document_analysis.tension_points;

  const startEdit = (claim: DocumentINode) => {
    setEditingId(claim.id);
    setEditText(claim.text);
  };

  const saveEdit = () => {
    if (editingId && editText.trim()) {
      updateClaim(editingId, editText.trim());
    }
    setEditingId(null);
    setEditText('');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditText('');
  };

  const typeColors: Record<string, string> = {
    empirical: '#4a9eff',
    normative: '#e67e22',
    definitional: '#9b59b6',
    assumption: '#95a5a6',
    evidence: '#27ae60',
  };

  return (
    <div className="debate-claims-editor">
      <div className="claims-editor-header">
        <h3>Review Extracted Claims</h3>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: '4px 0 0' }}>
          {claims.length} claim{claims.length !== 1 ? 's' : ''} extracted from the source document.
          Edit or remove claims to focus the debate. Deleted claims won't be used in opening statements or moderator analysis.
        </p>
      </div>

      <div className="claims-editor-list">
        {claims.map((claim, i) => (
          <div key={claim.id} className="claims-editor-item">
            <div className="claims-editor-item-header">
              <span className="claims-editor-number">{i + 1}</span>
              <span
                className="claims-editor-type"
                style={{ background: typeColors[claim.type] ?? '#666', color: '#fff', padding: '1px 6px', borderRadius: 3, fontSize: '0.7rem', textTransform: 'uppercase' }}
              >
                {claim.type}
              </span>
              <span className="claims-editor-id" style={{ color: 'var(--text-muted)', fontSize: '0.7rem', marginLeft: 'auto' }}>
                {claim.id}
              </span>
            </div>

            {editingId === claim.id ? (
              <div className="claims-editor-edit">
                <textarea
                  value={editText}
                  onChange={e => setEditText(e.target.value)}
                  rows={3}
                  style={{ width: '100%', resize: 'vertical', padding: 8, borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--text)', fontFamily: 'inherit', fontSize: '0.85rem' }}
                  autoFocus
                  onKeyDown={e => {
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) saveEdit();
                    if (e.key === 'Escape') cancelEdit();
                  }}
                />
                <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                  <button className="btn btn-sm btn-primary" onClick={saveEdit}>Save</button>
                  <button className="btn btn-sm" onClick={cancelEdit}>Cancel</button>
                </div>
              </div>
            ) : (
              <div className="claims-editor-text" style={{ fontSize: '0.85rem', lineHeight: 1.5 }}>
                {claim.text}
              </div>
            )}

            {editingId !== claim.id && (
              <div className="claims-editor-actions">
                <button className="btn btn-sm" onClick={() => startEdit(claim)} title="Edit this claim">
                  Edit
                </button>
                <button
                  className="btn btn-sm btn-danger"
                  onClick={() => deleteClaim(claim.id)}
                  title="Remove this claim from the debate"
                >
                  Delete
                </button>
              </div>
            )}
          </div>
        ))}

        {claims.length === 0 && (
          <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)' }}>
            All claims have been removed. The debate will proceed without document-grounded claims.
          </div>
        )}
      </div>

      {tensions.length > 0 && (
        <div className="claims-editor-tensions">
          <h4 style={{ fontSize: '0.85rem', margin: '12px 0 6px' }}>Tension Points</h4>
          {tensions.map((t, i) => (
            <div key={i} style={{ fontSize: '0.8rem', color: 'var(--text-muted)', padding: '4px 0', borderBottom: '1px solid var(--border)' }}>
              {t.description}
              <span style={{ marginLeft: 8, fontSize: '0.7rem' }}>
                ({t.i_node_ids.filter(id => claims.some(c => c.id === id)).length}/{t.i_node_ids.length} claims active)
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="claims-editor-footer">
        <button
          className="btn btn-primary"
          onClick={proceedToOpening}
        >
          Proceed to Opening Statements ({claims.length} claim{claims.length !== 1 ? 's' : ''})
        </button>
      </div>
    </div>
  );
}

// ── Topic Critique Card ──────────────────────────────────

const DIMENSION_LABELS: Record<string, string> = {
  crux_density: 'Crux Density',
  evidence_coverage: 'Evidence',
  bdi_heterogeneity: 'BDI Balance',
  abstraction_level: 'Abstraction',
  situation_activation: 'Situations',
  conditionality: 'Conditionality',
  mechanism: 'Mechanism',
  stakeholder: 'Stakeholders',
  tension: 'Tension',
  scope: 'Scope',
  actor_specificity: 'Actors',
  decision_proximity: 'Decision Prox.',
  constituency_impact: 'Constituency',
};

const DIMENSION_TOOLTIPS: Record<string, string> = {
  crux_density: 'POV balance — do all three perspectives (accelerationist, safetyist, skeptic) have nodes activated by this topic?\n\nGood: "Should AI development require mandatory safety audits before deployment?" activates nodes across all three POVs evenly.',
  evidence_coverage: 'Evidence richness — do the activated taxonomy nodes have supporting evidence entries (citations, data)?\n\nGood: "What does the empirical record show about algorithmic bias in hiring?" maps to well-evidenced nodes with real studies.',
  bdi_heterogeneity: 'BDI category spread — does the topic engage Beliefs, Desires, and Intentions, not just one category?\n\nGood: "How should regulators balance innovation incentives with safety mandates?" touches beliefs about risk, desires for growth, and concrete policy intentions.',
  abstraction_level: 'Goldilocks granularity — is the topic neither too broad (activating hundreds of nodes) nor too narrow (activating only a handful)?\n\nGood: "Should foundation model developers be liable for downstream harms?" — specific enough to focus debate, broad enough to sustain multiple rounds.',
  situation_activation: 'Situational grounding — does the topic activate shared cross-cutting or situation nodes that anchor the debate in concrete contexts?\n\nGood: "In the wake of deepfake election interference, what guardrails should platforms adopt?" activates situation nodes about elections and misinformation.',
  conditionality: 'Conditional framing — does the topic specify conditions under which different answers apply, rather than asking a binary yes/no question?\n\nGood: "Under what conditions should open-source AI models require licensing?" vs. bad: "Should AI be regulated?"',
  mechanism: 'Mechanism focus — does the topic ask about causal pathways and processes rather than just outcomes?\n\nGood: "Through what institutional mechanisms can international AI governance achieve compliance?" vs. bad: "Will AI governance work?"',
  stakeholder: 'Stakeholder breadth — does the topic name multiple actors with distinct roles and distributed responsibility?\n\nGood: "How should developers, regulators, and civil society actors share responsibility for AI safety?" vs. bad: "Should tech companies self-regulate?"',
  tension: 'Tension acknowledgment — does the topic explicitly name a trade-off or invite meta-level disagreement?\n\nGood: "How should policymakers navigate the tension between AI innovation speed and precautionary safety requirements?" surfaces a genuine dilemma.',
  scope: 'Scope boundedness — does the topic specify concrete artifacts, timeframes, or domains rather than remaining open-ended?\n\nGood: "Should the EU AI Act\'s risk classification framework be adopted as a global standard by 2030?" vs. bad: "What should AI policy look like?"',
  actor_specificity: 'Actor specificity (policymaker) — does the topic name specific actors, agencies, or institutions rather than abstract entities?\n\n0 = abstract ("stakeholders"), 1 = general types ("regulators"), 2 = named actors ("the FTC")',
  decision_proximity: 'Decision proximity (policymaker) — how close is the topic to a pending policy decision or action?\n\n0 = theoretical, 1 = general governance, 2 = pending action (named bill, rulemaking)',
  constituency_impact: 'Constituency impact (policymaker) — does the topic identify specific affected groups?\n\n0 = no groups named, 1 = general population, 2 = specific constituencies',
};

const RATING_COLORS: Record<string, string> = {
  strong: '#16a34a',
  fair: '#d97706',
  weak: '#dc2626',
};

function RadarChart({ structural, frame }: { structural: StructuralScore; frame: FrameScore | null }) {
  const dimensions = [
    { key: 'crux_density', value: structural.crux_density },
    { key: 'evidence_coverage', value: structural.evidence_coverage },
    { key: 'bdi_heterogeneity', value: structural.bdi_heterogeneity },
    { key: 'abstraction_level', value: structural.abstraction_level },
    { key: 'situation_activation', value: structural.situation_activation },
    { key: 'conditionality', value: frame?.conditionality ?? 0 },
    { key: 'mechanism', value: frame?.mechanism ?? 0 },
    { key: 'stakeholder', value: frame?.stakeholder ?? 0 },
    { key: 'tension', value: frame?.tension ?? 0 },
    { key: 'scope', value: frame?.scope ?? 0 },
  ];

  const cx = 100, cy = 100, r = 75;
  const n = dimensions.length;
  const angleStep = (2 * Math.PI) / n;
  const maxVal = 2;

  const pointAt = (i: number, val: number) => {
    const angle = -Math.PI / 2 + i * angleStep;
    const dist = (val / maxVal) * r;
    return { x: cx + dist * Math.cos(angle), y: cy + dist * Math.sin(angle) };
  };

  // Grid rings at 1 and 2
  const ringPaths = [1, 2].map(ring => {
    const pts = Array.from({ length: n }, (_, i) => pointAt(i, ring));
    return pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ') + ' Z';
  });

  // Data polygon
  const dataPts = dimensions.map((d, i) => pointAt(i, d.value));
  const dataPath = dataPts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ') + ' Z';

  // Axis lines
  const axes = Array.from({ length: n }, (_, i) => pointAt(i, maxVal));

  return (
    <svg viewBox="0 0 200 200" style={{ width: 200, height: 200 }}>
      {/* Grid rings */}
      {ringPaths.map((d, i) => (
        <path key={i} d={d} fill="none" stroke="var(--border-color, #555)" strokeWidth={0.5} opacity={0.4} />
      ))}
      {/* Axis lines */}
      {axes.map((p, i) => (
        <line key={i} x1={cx} y1={cy} x2={p.x} y2={p.y} stroke="var(--border-color, #555)" strokeWidth={0.3} opacity={0.3} />
      ))}
      {/* Data polygon */}
      <path d={dataPath} fill="var(--accent-color, #3b82f6)" fillOpacity={0.2} stroke="var(--accent-color, #3b82f6)" strokeWidth={1.5} />
      {/* Data points */}
      {dataPts.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={2.5}
          fill={dimensions[i].value === 0 ? '#dc2626' : dimensions[i].value === 1 ? '#d97706' : '#16a34a'}
        />
      ))}
      {/* Labels */}
      {axes.map((p, i) => {
        const label = DIMENSION_LABELS[dimensions[i].key] ?? dimensions[i].key;
        const dx = p.x - cx, dy = p.y - cy;
        const labelDist = 14;
        const lx = p.x + (dx / r) * labelDist;
        const ly = p.y + (dy / r) * labelDist;
        const anchor = Math.abs(dx) < 5 ? 'middle' : dx > 0 ? 'start' : 'end';
        return (
          <text key={i} x={lx} y={ly} textAnchor={anchor} dominantBaseline="central"
            style={{ fontSize: 7.5, fill: 'var(--text-secondary, #999)' }}>
            {label}
          </text>
        );
      })}
    </svg>
  );
}

/** Single-column critique breakdown (used in both left and right columns) */
function CritiqueColumn({ critique, label, topicText, accentColor, action }: {
  critique: TopicCritique;
  label: string;
  topicText?: string;
  accentColor: string;
  action?: React.ReactNode;
}) {
  const highIssues = critique.issues.filter(i => i.severity === 'high');
  const mediumIssues = critique.issues.filter(i => i.severity === 'medium');

  return (
    <div style={{ flex: 1, minWidth: 260 }}>
      {/* Column header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</span>
        <span style={{
          background: accentColor, color: '#fff', padding: '1px 8px', borderRadius: 4,
          fontWeight: 600, fontSize: '0.7rem', textTransform: 'uppercase',
        }}>
          {critique.rating}
        </span>
        <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)' }}>
          {critique.composite_score}/20
        </span>
      </div>

      {/* Topic text */}
      {topicText && (
        <div style={{
          fontSize: '0.78rem', fontStyle: 'italic', padding: '6px 10px', marginBottom: 8,
          background: 'var(--bg-secondary)', borderRadius: 6, lineHeight: 1.5,
          borderLeft: `3px solid ${accentColor}40`,
        }}>
          {topicText}
        </div>
      )}

      {action && <div style={{ marginBottom: 8 }}>{action}</div>}

      {/* Radar chart + scores */}
      <RadarChart structural={critique.structural_score} frame={critique.frame_score} />

      <div style={{ fontSize: '0.75rem', fontWeight: 600, marginTop: 8, marginBottom: 4, color: 'var(--text-secondary)' }}>
        Structural ({critique.structural_score.total}/10)
      </div>
      {(['crux_density', 'evidence_coverage', 'bdi_heterogeneity', 'abstraction_level', 'situation_activation'] as const).map(key => {
        const val = critique.structural_score[key] as number;
        return (
          <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2, fontSize: '0.78rem' }} title={DIMENSION_TOOLTIPS[key]}>
            <span style={{ width: 90, color: 'var(--text-secondary)', cursor: 'help', borderBottom: '1px dotted var(--text-muted, #999)' }}>{DIMENSION_LABELS[key]}</span>
            <span style={{ color: val === 0 ? '#dc2626' : val === 1 ? '#d97706' : '#16a34a', fontWeight: 600, width: 16 }}>{val}</span>
            <span style={{ color: 'var(--text-tertiary, #777)', fontSize: '0.7rem' }}>/2</span>
          </div>
        );
      })}

      {critique.frame_score && (
        <>
          <div style={{ fontSize: '0.75rem', fontWeight: 600, marginTop: 8, marginBottom: 4, color: 'var(--text-secondary)' }}>
            Frame ({critique.frame_score.total}/10)
          </div>
          {(['conditionality', 'mechanism', 'stakeholder', 'tension', 'scope'] as const).map(key => {
            const val = critique.frame_score![key] as number;
            return (
              <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2, fontSize: '0.78rem' }} title={DIMENSION_TOOLTIPS[key]}>
                <span style={{ width: 90, color: 'var(--text-secondary)', cursor: 'help', borderBottom: '1px dotted var(--text-muted, #999)' }}>{DIMENSION_LABELS[key]}</span>
                <span style={{ color: val === 0 ? '#dc2626' : val === 1 ? '#d97706' : '#16a34a', fontWeight: 600, width: 16 }}>{val}</span>
                <span style={{ color: 'var(--text-tertiary, #777)', fontSize: '0.7rem' }}>/2</span>
              </div>
            );
          })}
        </>
      )}

      {/* Policymaker political operationality sub-scores (t/251) */}
      {critique.frame_score?.actor_specificity != null && (
        <>
          <div style={{ fontSize: '0.75rem', fontWeight: 600, marginTop: 8, marginBottom: 4, color: '#ef4444' }}>
            Political Operationality ({((critique.frame_score.actor_specificity ?? 0) + (critique.frame_score.decision_proximity ?? 0) + (critique.frame_score.constituency_impact ?? 0))}/6)
          </div>
          {(['actor_specificity', 'decision_proximity', 'constituency_impact'] as const).map(key => {
            const val = critique.frame_score![key] as number | undefined;
            if (val == null) return null;
            return (
              <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2, fontSize: '0.78rem' }} title={DIMENSION_TOOLTIPS[key]}>
                <span style={{ width: 90, color: 'var(--text-secondary)', cursor: 'help', borderBottom: '1px dotted var(--text-muted, #999)' }}>{DIMENSION_LABELS[key]}</span>
                <span style={{ color: val === 0 ? '#dc2626' : val === 1 ? '#d97706' : '#16a34a', fontWeight: 600, width: 16 }}>{val}</span>
                <span style={{ color: 'var(--text-tertiary, #777)', fontSize: '0.7rem' }}>/2</span>
              </div>
            );
          })}
        </>
      )}

      {/* Issues */}
      {(highIssues.length > 0 || mediumIssues.length > 0) && (
        <div style={{ marginTop: 8, fontSize: '0.75rem' }}>
          {highIssues.length > 0 && (
            <div style={{ color: '#dc2626', marginBottom: 2 }}>
              {highIssues.length} critical: {highIssues.map(i => DIMENSION_LABELS[i.dimension] ?? i.dimension).join(', ')}
            </div>
          )}
          {mediumIssues.length > 0 && (
            <div style={{ color: '#d97706' }}>
              {mediumIssues.length} warning{mediumIssues.length !== 1 ? 's' : ''}: {mediumIssues.map(i => DIMENSION_LABELS[i.dimension] ?? i.dimension).join(', ')}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TopicCritiqueCard({ critique, suggestedCritique, currentTopicText, onUseSuggested, onReEvaluateSuggested, isLoading }: {
  critique: TopicCritique;
  suggestedCritique?: TopicCritique;
  currentTopicText: string;
  onUseSuggested: (topic: string) => void;
  onReEvaluateSuggested: (editedTopic: string) => void;
  isLoading?: boolean;
}) {
  const [showDetails, setShowDetails] = useState(false);
  const [editingSuggested, setEditingSuggested] = useState(false);
  const [editedSuggested, setEditedSuggested] = useState(critique.rewritten_topic ?? '');
  const ratingColor = RATING_COLORS[critique.rating] ?? '#888';
  const suggestedColor = suggestedCritique ? (RATING_COLORS[suggestedCritique.rating] ?? '#888') : '#888';
  const hasSuggestion = !!critique.rewritten_topic && critique.rating !== 'strong';
  const delta = suggestedCritique ? suggestedCritique.composite_score - critique.composite_score : 0;
  const hasEdits = editedSuggested.trim() !== (critique.rewritten_topic ?? '').trim();

  return (
    <div className="topic-critique-card" style={{
      borderRadius: 8,
      padding: '12px 16px',
      marginBottom: 12,
      border: '1px solid var(--border-color)',
      background: 'var(--bg-primary)',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' }}>Topic Quality</span>
        <span style={{
          background: ratingColor, color: '#fff', padding: '1px 8px', borderRadius: 4,
          fontWeight: 600, fontSize: '0.7rem', textTransform: 'uppercase',
        }}>
          {critique.composite_score}/20
        </span>
        {suggestedCritique && (
          <>
            <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>→</span>
            <span style={{
              background: suggestedColor, color: '#fff', padding: '1px 8px', borderRadius: 4,
              fontWeight: 600, fontSize: '0.7rem', textTransform: 'uppercase',
            }}>
              {suggestedCritique.composite_score}/20
            </span>
            {delta !== 0 && (
              <span style={{ fontSize: '0.75rem', fontWeight: 700, color: delta > 0 ? '#16a34a' : '#dc2626' }}>
                ({delta > 0 ? '+' : ''}{delta})
              </span>
            )}
          </>
        )}
        <button
          className="btn btn-sm"
          onClick={() => setShowDetails(d => !d)}
          style={{ marginLeft: 'auto', fontSize: '0.75rem', padding: '2px 8px' }}
        >
          {showDetails ? 'Hide Details' : 'Show Details'}
        </button>
      </div>

      {/* Expanded 2-column details */}
      {showDetails && (
        <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap', marginTop: 8, maxHeight: 420, overflowY: 'auto' }}>
          {/* Left: Current topic */}
          <CritiqueColumn
            critique={critique}
            label="Current Topic"
            topicText={currentTopicText}
            accentColor={ratingColor}
          />

          {/* Right: Suggested topic */}
          {hasSuggestion && (
            <CritiqueColumn
              critique={suggestedCritique ?? critique}
              label={suggestedCritique ? 'Suggested Topic' : 'Suggested Topic (scoring...)'}
              topicText={editingSuggested ? undefined : (critique.rewritten_topic)}
              accentColor={suggestedCritique ? suggestedColor : '#6b7280'}
              action={
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {editingSuggested ? (
                    <>
                      <textarea
                        value={editedSuggested}
                        onChange={(e) => setEditedSuggested(e.target.value)}
                        style={{
                          width: '100%', minHeight: 80, fontSize: '0.78rem', lineHeight: 1.5,
                          padding: '6px 10px', borderRadius: 6,
                          border: '1px solid var(--border-color)',
                          background: 'var(--bg-secondary)', color: 'var(--text-primary)',
                          fontFamily: 'inherit', resize: 'vertical',
                        }}
                      />
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          className="btn btn-sm btn-primary"
                          disabled={!editedSuggested.trim() || isLoading}
                          onClick={() => {
                            setEditingSuggested(false);
                            onReEvaluateSuggested(editedSuggested.trim());
                          }}
                          style={{ fontSize: '0.75rem', padding: '3px 10px' }}
                        >
                          {isLoading ? 'Evaluating...' : hasEdits ? 'Re-evaluate' : 'Re-evaluate'}
                        </button>
                        <button
                          className="btn btn-sm"
                          onClick={() => { setEditingSuggested(false); setEditedSuggested(critique.rewritten_topic ?? ''); }}
                          style={{ fontSize: '0.75rem', padding: '3px 10px' }}
                        >
                          Cancel
                        </button>
                      </div>
                    </>
                  ) : (
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        className="btn btn-sm btn-primary"
                        onClick={() => onUseSuggested(critique.rewritten_topic)}
                        style={{ fontSize: '0.75rem', padding: '3px 10px' }}
                      >
                        Use Suggested Topic
                      </button>
                      <button
                        className="btn btn-sm"
                        onClick={() => setEditingSuggested(true)}
                        style={{ fontSize: '0.75rem', padding: '3px 10px' }}
                        title="Edit the suggested topic and re-evaluate its score"
                      >
                        Edit
                      </button>
                    </div>
                  )}
                </div>
              }
            />
          )}
        </div>
      )}
    </div>
  );
}

/** Clarification phase action bar */
interface StructuredQuestion {
  question: string;
  options: string[];
}

function ClarificationActions() {
  const {
    activeDebate, debateGenerating, debateError,
    runClarification, submitAnswersAndSynthesize, beginDebate, runOpeningStatements,
    initialCrossRespondRounds, setInitialCrossRespondRounds,
    openingOrder, setOpeningOrder,
    runTopicCritique, reEvaluateSuggestedTopic, topicCritiqueLoading, updateTopic,
  } = useDebateStore(
    useShallow(s => ({
      activeDebate: s.activeDebate, debateGenerating: s.debateGenerating, debateError: s.debateError,
      runClarification: s.runClarification, submitAnswersAndSynthesize: s.submitAnswersAndSynthesize, beginDebate: s.beginDebate, runOpeningStatements: s.runOpeningStatements,
      initialCrossRespondRounds: s.initialCrossRespondRounds, setInitialCrossRespondRounds: s.setInitialCrossRespondRounds,
      openingOrder: s.openingOrder, setOpeningOrder: s.setOpeningOrder,
      runTopicCritique: s.runTopicCritique, reEvaluateSuggestedTopic: s.reEvaluateSuggestedTopic, topicCritiqueLoading: s.topicCritiqueLoading, updateTopic: s.updateTopic,
    }))
  );

  // Auto-trigger topic critique for free-form topics on first render
  const critiqueTriggered = useRef(false);
  useEffect(() => {
    if (activeDebate?.source_type === 'topic' && !activeDebate.topic.critique && !critiqueTriggered.current && !topicCritiqueLoading) {
      critiqueTriggered.current = true;
      void runTopicCritique();
    }
  }, [activeDebate?.id]); // intentionally limited deps — only re-run on debate change
  const [answer, setAnswer] = useState('');
  const [selections, setSelections] = useState<Record<number, string>>({});
  const [otherTexts, setOtherTexts] = useState<Record<number, string>>({});
  const [submitting, setSubmitting] = useState(false);

  if (!activeDebate) return null;

  const hasClarifications = activeDebate.transcript.some((e) => e.type === 'clarification');
  const hasAnswers = activeDebate.transcript.some((e) => e.type === 'answer');
  const hasRefinedTopic = activeDebate.topic.refined !== null;

  // Extract structured questions from clarification transcript entries
  const clarificationEntry = activeDebate.transcript.find(e => e.type === 'clarification');
  const rawQuestions = (clarificationEntry?.metadata as Record<string, unknown>)?.questions;
  const structuredQuestions: StructuredQuestion[] | null =
    Array.isArray(rawQuestions) && rawQuestions.length > 0 && typeof rawQuestions[0] === 'object' && rawQuestions[0] !== null && 'options' in (rawQuestions[0] as Record<string, unknown>)
      ? (rawQuestions as StructuredQuestion[]).filter(q => q.options && q.options.length > 0)
      : null;

  const anyAnswered = structuredQuestions
    ? structuredQuestions.some((_, i) => {
        const sel = selections[i];
        return sel === '__other__' ? (otherTexts[i] ?? '').trim().length > 0 : !!sel;
      })
    : answer.trim().length > 0;

  const handlePillSelect = (qIdx: number, option: string) => {
    setSelections(prev => ({ ...prev, [qIdx]: prev[qIdx] === option ? '' : option }));
  };

  const handleSubmitAnswers = async () => {
    if (submitting) return;
    setSubmitting(true);
    if (structuredQuestions) {
      const qaText = structuredQuestions
        .map((q, i) => {
          const sel = selections[i];
          if (!sel) return null;
          const answerText = sel === '__other__' ? (otherTexts[i] ?? '').trim() : sel;
          return answerText ? `Q: ${q.question}\nA: ${answerText}` : null;
        })
        .filter(Boolean)
        .join('\n\n');
      await submitAnswersAndSynthesize(qaText);
    } else {
      await submitAnswersAndSynthesize(answer.trim());
    }
    setAnswer('');
    setSelections({});
    setOtherTexts({});
    setSubmitting(false);
  };

  const handleBeginDebate = async () => {
    await beginDebate();
    // Automatically start opening statements after setup completes
    await runOpeningStatements();
  };

  const moveUp = (index: number) => {
    if (index <= 0) return;
    const next = [...openingOrder];
    [next[index - 1], next[index]] = [next[index], next[index - 1]];
    setOpeningOrder(next);
  };

  const moveDown = (index: number) => {
    if (index >= openingOrder.length - 1) return;
    const next = [...openingOrder];
    [next[index], next[index + 1]] = [next[index + 1], next[index]];
    setOpeningOrder(next);
  };

  const isGenerating = !!debateGenerating;

  return (
    <div className="debate-action-bar">
      {debateError && <div className="debate-error">{debateError}</div>}

      {/* Topic critique card — shows for free-form topic debates */}
      {topicCritiqueLoading && (
        <div className="debate-action-hint" style={{ fontStyle: 'italic' }}>Evaluating topic quality...</div>
      )}
      {activeDebate.topic.critique && (
        <TopicCritiqueCard
          critique={activeDebate.topic.critique as TopicCritique}
          suggestedCritique={activeDebate.topic.suggested_critique as TopicCritique | undefined}
          currentTopicText={activeDebate.topic.final}
          isLoading={topicCritiqueLoading}
          onUseSuggested={(suggested) => {
            updateTopic({ final: suggested });
            // Reset critique so it can be re-evaluated with new topic
            updateTopic({ critique: undefined } as any);
            critiqueTriggered.current = false;
            void runTopicCritique();
          }}
          onReEvaluateSuggested={(editedTopic) => {
            void reEvaluateSuggestedTopic(editedTopic);
          }}
        />
      )}

      {!hasClarifications && !isGenerating && (
        <div className="debate-clarification-choice">
          <div className="debate-action-hint">
            Configure the debate, then refine the topic or begin.
          </div>
          {openingOrder.length > 0 && (
            <div className="debate-opening-order">
              <span className="debate-opening-order-label">Speaking order:</span>
              <ol className="debate-opening-order-list">
                {openingOrder.map((poverId, idx) => {
                  const info = POVER_INFO[poverId];
                  return (
                    <li key={poverId} className="debate-opening-order-item">
                      <span className="debate-opening-order-name" style={{ color: info.color }}>{info.label}</span>
                      <span className="debate-opening-order-btns">
                        <button
                          className="debate-opening-order-btn"
                          onClick={() => moveUp(idx)}
                          disabled={idx === 0}
                          title="Move left"
                        >&#9664;</button>
                        <button
                          className="debate-opening-order-btn"
                          onClick={() => moveDown(idx)}
                          disabled={idx === openingOrder.length - 1}
                          title="Move right"
                        >&#9654;</button>
                      </span>
                    </li>
                  );
                })}
              </ol>
            </div>
          )}
          <div className="debate-initial-rounds">
            {activeDebate.adaptive_staging?.enabled ? (
              <span className="debate-initial-rounds-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ background: '#f59e0b', color: '#000', padding: '2px 8px', borderRadius: 4, fontWeight: 600, fontSize: '0.75rem' }}>
                  Adaptive
                </span>
                <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                  Signal-driven phase transitions ({activeDebate.adaptive_staging.pacing} pacing)
                </span>
              </span>
            ) : (
              <label className="debate-initial-rounds-label">
                Cross-respond rounds after openings:
                <select
                  className="debate-turns-select"
                  value={initialCrossRespondRounds}
                  onChange={(e) => setInitialCrossRespondRounds(parseInt(e.target.value, 10))}
                  title="Number of cross-respond rounds to run automatically after opening statements"
                >
                  {[1, 2, 3, 6, 9, 12, 15, 18, 21].map(n => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <div className="debate-clarification-buttons">
            <button
              className="btn"
              onClick={() => void runClarification()}
            >
              Refine Topic
            </button>
            <button
              className="btn btn-primary"
              onClick={handleBeginDebate}
            >
              Begin Debate
            </button>
          </div>
        </div>
      )}

      {!hasClarifications && isGenerating && (
        <div className="debate-action-hint">Generating clarifying questions...</div>
      )}

      {hasClarifications && !hasAnswers && !hasRefinedTopic && (
        <>
          <div className="debate-action-hint">Answer their questions to sharpen the topic, or skip ahead.</div>
          {structuredQuestions ? (
            <div className="cq-questions">
              {structuredQuestions.map((q, qIdx) => (
                <div key={qIdx} className="cq-question-card">
                  <div className="cq-question-text">{q.question}</div>
                  <div className="cq-options">
                    {q.options.map((opt, oIdx) => (
                      <button
                        key={oIdx}
                        className={`cq-option-pill ${selections[qIdx] === opt ? 'selected' : ''}`}
                        onClick={() => handlePillSelect(qIdx, opt)}
                        disabled={isGenerating || submitting}
                      >
                        {selections[qIdx] === opt && <span className="cq-check">{'\u2713'} </span>}
                        {opt}
                      </button>
                    ))}
                    <button
                      className={`cq-option-pill cq-option-pill-other ${selections[qIdx] === '__other__' ? 'selected' : ''}`}
                      onClick={() => handlePillSelect(qIdx, '__other__')}
                      disabled={isGenerating || submitting}
                    >
                      Other...
                    </button>
                  </div>
                  {selections[qIdx] === '__other__' && (
                    <input
                      className="cq-option-other-input"
                      type="text"
                      placeholder="Type your answer..."
                      value={otherTexts[qIdx] ?? ''}
                      onChange={e => setOtherTexts(prev => ({ ...prev, [qIdx]: e.target.value }))}
                      disabled={isGenerating || submitting}
                      autoFocus
                    />
                  )}
                </div>
              ))}
              <div className="debate-clarification-buttons">
                <button
                  className="btn btn-primary"
                  onClick={handleSubmitAnswers}
                  disabled={!anyAnswered || isGenerating || submitting}
                >
                  {submitting ? 'Synthesizing...' : 'Continue'}
                </button>
                <button
                  className="btn"
                  onClick={handleBeginDebate}
                  disabled={isGenerating || submitting}
                >
                  Skip — Start Debating
                </button>
              </div>
            </div>
          ) : (
            <div className="debate-clarification-input">
              <textarea
                className="debate-answer-textarea"
                placeholder="Your answers..."
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                rows={3}
                disabled={isGenerating || submitting}
              />
              <div className="debate-clarification-buttons">
                <button
                  className="btn btn-primary"
                  onClick={handleSubmitAnswers}
                  disabled={!answer.trim() || isGenerating || submitting}
                >
                  {submitting ? 'Synthesizing...' : 'Submit Answers'}
                </button>
                <button
                  className="btn"
                  onClick={handleBeginDebate}
                  disabled={isGenerating || submitting}
                >
                  Skip — Start Debating
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {hasClarifications && hasAnswers && activeDebate.phase === 'clarification' && (
        <div className="debate-action-hint">
          {isGenerating ? 'Synthesizing topic and starting debate...' : 'Starting debate...'}
        </div>
      )}
    </div>
  );
}

/** Opening phase action bar — shows user opening input if user is a POVer */
function OpeningActions() {
  const { activeDebate, debateGenerating, debateError, submitUserOpening, runOpeningStatements } = useDebateStore(
    useShallow(s => ({ activeDebate: s.activeDebate, debateGenerating: s.debateGenerating, debateError: s.debateError, submitUserOpening: s.submitUserOpening, runOpeningStatements: s.runOpeningStatements }))
  );
  const [statement, setStatement] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (!activeDebate) return null;

  const isGenerating = !!debateGenerating;
  const userIsPover = activeDebate.user_is_pover;
  const hasUserOpening = activeDebate.transcript.some(
    (e) => e.type === 'opening' && e.speaker === 'user',
  );

  // AI POVers still generating
  if (isGenerating) {
    return (
      <div className="debate-action-bar">
        {debateError && <div className="debate-error">{debateError}</div>}
        <div className="debate-action-hint">Delivering opening statements...</div>
      </div>
    );
  }

  // User needs to deliver their opening statement
  if (userIsPover && !hasUserOpening) {
    const handleSubmit = async () => {
      if (!statement.trim() || submitting) return;
      setSubmitting(true);
      await submitUserOpening(statement.trim());
      setStatement('');
      setSubmitting(false);
    };

    return (
      <div className="debate-action-bar">
        {debateError && <div className="debate-error">{debateError}</div>}
        <div className="debate-action-hint">It's your turn. Deliver your opening statement.</div>
        <div className="debate-clarification-input">
          <textarea
            className="debate-answer-textarea"
            placeholder="Your opening statement..."
            value={statement}
            onChange={(e) => setStatement(e.target.value)}
            rows={4}
            autoFocus
          />
          <div className="debate-clarification-buttons">
            <button
              className="btn btn-primary"
              onClick={handleSubmit}
              disabled={!statement.trim() || submitting}
            >
              {submitting ? 'Submitting...' : 'Deliver Opening Statement'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Some AI POVers haven't delivered openings yet — allow resuming
  const aiPoversExpected = (activeDebate.active_povers ?? []).filter(p => p !== 'user');
  const aiPoversWithOpening = activeDebate.transcript
    .filter(e => e.type === 'opening' && e.speaker !== 'user')
    .map(e => e.speaker);
  const missingPovers = aiPoversExpected.filter(p => !aiPoversWithOpening.includes(p));

  if (missingPovers.length > 0) {
    return (
      <div className="debate-action-bar">
        {debateError && <div className="debate-error">{debateError}</div>}
        <div className="debate-action-hint">
          {missingPovers.length === 1
            ? `${POVER_INFO[missingPovers[0] as keyof typeof POVER_INFO]?.label ?? missingPovers[0]} still needs to deliver an opening statement.`
            : `${missingPovers.length} debaters still need to deliver opening statements.`}
        </div>
        <div className="debate-action-bar-inner">
          <button className="btn btn-primary" onClick={() => void runOpeningStatements()}>
            Resume Opening Statements
          </button>
        </div>
      </div>
    );
  }

  // Opening phase complete but phase not yet transitioned (shouldn't happen normally)
  return (
    <div className="debate-action-bar">
      <div className="debate-action-hint">Opening statements complete.</div>
    </div>
  );
}

/** Main debate phase action bar */
const AI_MENTION_OPTIONS: { id: string; label: string; color: string }[] = [
  { id: 'accelerationist', label: POVER_INFO.accelerationist.label, color: POVER_INFO.accelerationist.color },
  { id: 'safetyist', label: POVER_INFO.safetyist.label, color: POVER_INFO.safetyist.color },
  { id: 'skeptic', label: POVER_INFO.skeptic.label, color: POVER_INFO.skeptic.color },
];

function DebaterToggles() {
  const { activeDebate, togglePover, debateGenerating } = useDebateStore(
    useShallow(s => ({ activeDebate: s.activeDebate, togglePover: s.togglePover, debateGenerating: s.debateGenerating }))
  );
  if (!activeDebate) return null;

  const allPovers = AI_POVERS;
  const isActive = (p: SpeakerId) => activeDebate.active_povers.includes(p);
  const disabled = !!debateGenerating;

  return (
    <div className="debate-debater-toggles">
      <span className="debate-debater-toggles-label">Debaters:</span>
      {allPovers.map(p => {
        const info = POVER_INFO[p];
        const active = isActive(p);
        const turnCount = activeDebate.transcript.filter(e => e.speaker === p && (e.type === 'statement' || e.type === 'opening')).length;
        return (
          <button
            key={p}
            className={`debate-debater-pill ${active ? 'debate-debater-pill-active' : 'debate-debater-pill-inactive'}`}
            style={active ? { borderColor: info.color, color: info.color } : undefined}
            onClick={() => togglePover(p)}
            disabled={disabled}
            title={active ? `Remove ${info.label} from debate` : `Add ${info.label} to debate`}
          >
            {info.label}{turnCount > 0 ? ` (${turnCount})` : ''}
          </button>
        );
      })}
    </div>
  );
}

function DebateActions({ showParamHistory, setShowParamHistory, showEvaluation, setShowEvaluation }: { showParamHistory: boolean; setShowParamHistory: (v: boolean) => void; showEvaluation: boolean; setShowEvaluation: (v: boolean) => void }) {
  const { activeDebate, debateGenerating, debateError, askQuestion, crossRespond, requestSynthesis, requestProbingQuestions, requestReflections, audience, setAudience } = useDebateStore(
    useShallow(s => ({ activeDebate: s.activeDebate, debateGenerating: s.debateGenerating, debateError: s.debateError, askQuestion: s.askQuestion, crossRespond: s.crossRespond, requestSynthesis: s.requestSynthesis, requestProbingQuestions: s.requestProbingQuestions, requestReflections: s.requestReflections, audience: s.audience, setAudience: s.setAudience }))
  );
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [showHarvest, setShowHarvest] = useState(false);
  const [showReflections, setShowReflections] = useState(false);
  const [showNewsReport, setShowNewsReport] = useState(false);
  const [crossRespondTurns, setCrossRespondTurns] = useState(1);
  const inputRef = useRef<HTMLInputElement>(null);
  const hasSynthesis = activeDebate?.transcript.some(e => e.type === 'concluding') || false;
  const isAdaptive = (activeDebate as any)?.adaptive_staging?.enabled ?? false;
  const adaptivePhase: AdaptivePhase | null = isAdaptive ? ((activeDebate as any).adaptive_staging?.current_phase ?? null) : null;
  const approachingTransition = isAdaptive ? ((activeDebate as any).adaptive_staging?.approaching_transition ?? false) : false;

  if (!activeDebate) return null;

  const isGenerating = !!debateGenerating;
  const isClosed = activeDebate.phase === 'closed';
  const disabled = isGenerating || sending || isClosed;
  const disableAnalysis = isGenerating || sending;  // post-debate actions remain available when closed
  const isSocratic = (activeDebate.active_povers ?? []).filter(p => p !== 'user').length < 2;

  // Filter mention options to active AI povers
  const mentionOptions = AI_MENTION_OPTIONS.filter(o => activeDebate.active_povers.includes(o.id as SpeakerId));

  const insertMention = (label: string) => {
    // Find the last @ in the input and replace from there
    const atIdx = input.lastIndexOf('@');
    const before = atIdx >= 0 ? input.slice(0, atIdx) : input;
    setInput(`${before}@${label} `);
    setMentionOpen(false);
    setMentionIndex(0);
    inputRef.current?.focus();
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setInput(val);
    // Show mention popup when @ is typed at end or after a space
    const atIdx = val.lastIndexOf('@');
    if (atIdx >= 0 && (atIdx === 0 || val[atIdx - 1] === ' ')) {
      const afterAt = val.slice(atIdx + 1).toLowerCase();
      // Only show if there's no space after @  (still typing the name)
      if (!afterAt.includes(' ')) {
        setMentionOpen(true);
        setMentionIndex(0);
        return;
      }
    }
    setMentionOpen(false);
  };

  const handleSend = async () => {
    if (!input.trim() || disableAnalysis) return;
    const text = input;
    setInput('');
    setMentionOpen(false);
    setSending(true);
    await askQuestion(text);
    setSending(false);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (mentionOpen) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setMentionIndex(i => Math.min(i + 1, mentionOptions.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setMentionIndex(i => Math.max(i - 1, 0));
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        insertMention(mentionOptions[mentionIndex].label);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setMentionOpen(false);
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  const handleCrossRespond = async () => {
    if (disableAnalysis) return;
    setSending(true);
    if (isAdaptive) {
      // Adaptive: run to completion (until phase transitions terminate)
      // Safety limit only — actual termination is signal-driven (convergence, saturation, health)
      const maxSafetyRounds = 50;
      const alreadyTerminated = (activeDebate as any)?.adaptive_staging?.phase_state?.current_phase === 'terminated'
        || activeDebate.phase === 'closed';
      if (alreadyTerminated) {
        // Debate already terminated — crossRespond handles the bypass internally
        // (skips moderator, picks missing debaters, runs full pipeline with stage_diagnostics)
        await crossRespond();
      } else {
        let consecutiveNoStatement = 0;
        for (let i = 0; i < maxSafetyRounds; i++) {
          const d = useDebateStore.getState().activeDebate;
          if (!d) break;
          if ((d as any).adaptive_staging?.phase_state?.current_phase === 'terminated') break;
          const preLen = d.transcript.length;
          await crossRespond();
          const post = useDebateStore.getState().activeDebate;
          if (!post) break;
          const hasStatement = post.transcript.slice(preLen).some((e: any) => e.type === 'statement');
          if (hasStatement) {
            consecutiveNoStatement = 0;
          } else {
            consecutiveNoStatement++;
            if (consecutiveNoStatement >= 3) break;
          }
        }
        // Always run synthesis when the adaptive loop exits with enough content
        const final = useDebateStore.getState().activeDebate;
        const finalStatements = final?.transcript.filter((e: any) => e.type === 'statement').length ?? 0;
        if (finalStatements >= 3) {
          await requestSynthesis();
        }
      }
    } else {
      for (let i = 0; i < crossRespondTurns; i++) {
        await crossRespond();
        if (!useDebateStore.getState().activeDebate) break;
      }
    }
    setSending(false);
  };

  return (
    <div className="debate-action-bar">
      {debateError && <div className="debate-error">{debateError}</div>}
      {/* Row 1: Input + Send + Cross-Respond */}
      <div className="debate-action-bar-inner">
        <div className="debate-input-wrapper">
          <input
            ref={inputRef}
            className="debate-input"
            type="text"
            placeholder="Ask a question (@Safetyist to target)..."
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            onBlur={() => setTimeout(() => setMentionOpen(false), 150)}
            disabled={disableAnalysis}
          />
          {mentionOpen && mentionOptions.length > 0 && (
            <div className="debate-mention-dropdown">
              {mentionOptions.map((opt, i) => (
                <div
                  key={opt.id}
                  className={`debate-mention-item${i === mentionIndex ? ' selected' : ''}`}
                  onMouseDown={(e) => { e.preventDefault(); insertMention(opt.label); }}
                >
                  <span style={{ color: opt.color, fontWeight: 600 }}>{opt.label}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <button
          className="btn btn-primary debate-send-btn"
          onClick={handleSend}
          disabled={!input.trim() || disableAnalysis}
        >
          Send
        </button>
        {!isSocratic && (isAdaptive ? (
          /* Adaptive mode: single "Continue" button that lets the engine decide */
          <button
            className="btn debate-continue-btn"
            onClick={handleCrossRespond}
            disabled={disableAnalysis}
            title="Let the debate engine select the next speaker and continue"
          >
            Continue
          </button>
        ) : (
          /* Fixed mode: original cross-respond with turn count */
          <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
            <button
              className="btn debate-cross-btn"
              onClick={handleCrossRespond}
              disabled={disableAnalysis}
              title={`Run ${crossRespondTurns} cross-respond round${crossRespondTurns > 1 ? 's' : ''}`}
              style={{ borderTopRightRadius: 0, borderBottomRightRadius: 0 }}
            >
              Cross-Respond
            </button>
            <select
              className="debate-turns-select"
              value={crossRespondTurns}
              onChange={(e) => setCrossRespondTurns(parseInt(e.target.value, 10))}
              disabled={disableAnalysis}
              title="Number of cross-respond rounds"
            >
              {[1, 2, 3, 6, 9, 12, 15, 18, 21].map(n => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </div>
        ))}
      </div>
      {/* Row 2: Phase overrides (adaptive) + Analysis actions + Audience */}
      <div className="debate-action-bar-secondary">
        {/* Phase override buttons hidden until store actions are implemented.
            See code review UX1 — requires phaseTransitions.ts veto/force API. */}
        <button
          className="btn debate-synthesis-btn"
          onClick={() => void requestSynthesis()}
          disabled={disableAnalysis}
          title="Generate a synthesis of agreements, disagreements, and open questions"
        >
          Synthesize
        </button>
        <button
          className="btn debate-probe-btn"
          onClick={() => void requestProbingQuestions()}
          disabled={disableAnalysis}
          title="Get AI-suggested probing questions to deepen the debate"
        >
          Probe
        </button>
        <button
          className="btn debate-harvest-btn"
          onClick={() => setShowHarvest(true)}
          disabled={disableAnalysis || !hasSynthesis}
          title="Harvest debate findings into the taxonomy"
        >
          Harvest
        </button>
        <button
          className="btn debate-reflections-btn"
          onClick={() => { setShowReflections(true); void requestReflections(); }}
          disabled={disableAnalysis}
          title="Each debater reflects on the debate and proposes taxonomy edits"
        >
          Post-Debate Reflections
        </button>
        <button
          className="btn"
          onClick={() => setShowNewsReport(true)}
          disabled={disableAnalysis || !hasSynthesis}
          title={hasSynthesis ? 'Generate a news-style article from this debate' : 'Synthesis required before generating news report'}
        >
          News Report
        </button>
        <button
          className={`btn${showEvaluation ? ' active' : ''}`}
          onClick={() => setShowEvaluation(!showEvaluation)}
          disabled={!activeDebate?.neutral_evaluations?.length}
          title="Show/hide independent evaluation of claims and cruxes"
        >
          Evaluation
        </button>
        <button
          className="btn"
          onClick={() => setShowParamHistory(!showParamHistory)}
          title="View calibration parameter history and current values"
          style={{ fontSize: '0.65rem' }}
        >
          Calibration
        </button>
        <div style={{ flex: 1 }} />
        <select
          className="debate-audience-select"
          value={audience}
          onChange={(e) => setAudience(e.target.value as DebateAudience)}
          disabled={disabled}
          title="Target audience for debate responses"
        >
          {DEBATE_AUDIENCES.map(a => (
            <option key={a.id} value={a.id}>{a.label}</option>
          ))}
        </select>
      </div>
      {isGenerating && (
        <div className="debate-action-hint">
          {speakerLabel(debateGenerating)} is responding...
        </div>
      )}
      {showHarvest && <HarvestDialog onClose={() => setShowHarvest(false)} />}
      {showReflections && <ReflectionsPanel onClose={() => setShowReflections(false)} />}
      {showNewsReport && <NewsReportModal onClose={() => setShowNewsReport(false)} />}
    </div>
  );
}

/** Editable refined topic display */
function RefinedTopicEditor() {
  const { activeDebate, updateTopic, saveDebate } = useDebateStore(
    useShallow(s => ({ activeDebate: s.activeDebate, updateTopic: s.updateTopic, saveDebate: s.saveDebate }))
  );
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState('');

  if (!activeDebate?.topic.refined) return null;

  const handleStartEdit = () => {
    setEditText(activeDebate.topic.final);
    setEditing(true);
  };

  const handleSave = async () => {
    updateTopic({ final: editText.trim() });
    setEditing(false);
    await saveDebate();
  };

  const handleCancel = () => {
    setEditing(false);
  };

  return (
    <div className="debate-refined-topic">
      <div className="debate-refined-topic-label">Refined Topic</div>
      {editing ? (
        <div className="debate-refined-topic-edit">
          <textarea
            className="debate-answer-textarea"
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            rows={2}
            autoFocus
          />
          <div className="debate-clarification-buttons">
            <button className="btn btn-sm btn-primary" onClick={handleSave}>Save</button>
            <button className="btn btn-sm" onClick={handleCancel}>Cancel</button>
          </div>
        </div>
      ) : (
        <div className="debate-refined-topic-text" onClick={handleStartEdit} title="Click to edit">
          {activeDebate.topic.final}
        </div>
      )}
    </div>
  );
}

/** Side-by-side old vs new topic score comparison */
function TopicScoreComparison() {
  const activeDebate = useDebateStore(s => s.activeDebate);
  const [showDetails, setShowDetails] = useState(false);

  if (!activeDebate?.topic.critique || !activeDebate.topic.refined_critique) return null;

  const old = activeDebate.topic.critique as TopicCritique;
  const neu = activeDebate.topic.refined_critique as TopicCritique;
  const delta = neu.composite_score - old.composite_score;
  const deltaColor = delta > 0 ? '#16a34a' : delta < 0 ? '#dc2626' : 'var(--text-muted)';

  const structuralKeys = ['crux_density', 'evidence_coverage', 'bdi_heterogeneity', 'abstraction_level', 'situation_activation'] as const;
  const frameKeys = ['conditionality', 'mechanism', 'stakeholder', 'tension', 'scope'] as const;

  const scoreCell = (val: number, max: number) => (
    <span style={{ color: val === 0 ? '#dc2626' : val === max ? '#16a34a' : '#d97706', fontWeight: 600 }}>{val}/{max}</span>
  );

  const deltaCell = (oldVal: number, newVal: number) => {
    const d = newVal - oldVal;
    if (d === 0) return <span style={{ color: 'var(--text-muted)' }}>—</span>;
    return <span style={{ color: d > 0 ? '#16a34a' : '#dc2626', fontWeight: 600 }}>{d > 0 ? '+' : ''}{d}</span>;
  };

  return (
    <div style={{
      border: '1px solid var(--border-color)',
      borderRadius: 8,
      padding: '10px 14px',
      marginBottom: 12,
      background: 'var(--bg-secondary)',
    }}>
      {/* Summary row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Topic Score</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{
            padding: '2px 8px', borderRadius: 4, fontSize: '0.75rem', fontWeight: 600,
            background: `${RATING_COLORS[old.rating]}18`, color: RATING_COLORS[old.rating],
          }}>
            Original: {old.composite_score}/20
          </span>
          <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>→</span>
          <span style={{
            padding: '2px 8px', borderRadius: 4, fontSize: '0.75rem', fontWeight: 600,
            background: `${RATING_COLORS[neu.rating]}18`, color: RATING_COLORS[neu.rating],
          }}>
            Refined: {neu.composite_score}/20
          </span>
          <span style={{ fontSize: '0.75rem', fontWeight: 700, color: deltaColor }}>
            ({delta > 0 ? '+' : ''}{delta})
          </span>
        </div>
        <button
          className="btn btn-sm"
          onClick={() => setShowDetails(d => !d)}
          style={{ marginLeft: 'auto', fontSize: '0.7rem', padding: '2px 8px' }}
        >
          {showDetails ? 'Hide' : 'Compare'}
        </button>
      </div>

      {/* Detail comparison */}
      {showDetails && (
        <div style={{ marginTop: 10 }}>
          <table style={{ width: '100%', fontSize: '0.75rem', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                <th style={{ textAlign: 'left', padding: '4px 8px', color: 'var(--text-secondary)', fontWeight: 600 }}>Dimension</th>
                <th style={{ textAlign: 'center', padding: '4px 8px', color: 'var(--text-secondary)', fontWeight: 600 }}>Original</th>
                <th style={{ textAlign: 'center', padding: '4px 8px', color: 'var(--text-secondary)', fontWeight: 600 }}>Refined</th>
                <th style={{ textAlign: 'center', padding: '4px 8px', color: 'var(--text-secondary)', fontWeight: 600 }}>Δ</th>
              </tr>
            </thead>
            <tbody>
              <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                <td colSpan={4} style={{ padding: '6px 8px 2px', fontWeight: 700, fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
                  Structural (taxonomy alignment)
                </td>
              </tr>
              {structuralKeys.map(key => (
                <tr key={key}>
                  <td style={{ padding: '2px 8px', color: 'var(--text-secondary)' }}>{DIMENSION_LABELS[key]}</td>
                  <td style={{ textAlign: 'center', padding: '2px 8px' }}>{scoreCell(old.structural_score[key] as number, 2)}</td>
                  <td style={{ textAlign: 'center', padding: '2px 8px' }}>{scoreCell(neu.structural_score[key] as number, 2)}</td>
                  <td style={{ textAlign: 'center', padding: '2px 8px' }}>{deltaCell(old.structural_score[key] as number, neu.structural_score[key] as number)}</td>
                </tr>
              ))}
              <tr style={{ borderTop: '1px solid var(--border-color)', fontWeight: 600 }}>
                <td style={{ padding: '2px 8px' }}>Subtotal</td>
                <td style={{ textAlign: 'center', padding: '2px 8px' }}>{old.structural_score.total}/10</td>
                <td style={{ textAlign: 'center', padding: '2px 8px' }}>{neu.structural_score.total}/10</td>
                <td style={{ textAlign: 'center', padding: '2px 8px' }}>{deltaCell(old.structural_score.total, neu.structural_score.total)}</td>
              </tr>

              {old.frame_score && neu.frame_score && (
                <>
                  <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                    <td colSpan={4} style={{ padding: '8px 8px 2px', fontWeight: 700, fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
                      Frame (linguistic quality)
                    </td>
                  </tr>
                  {frameKeys.map(key => (
                    <tr key={key}>
                      <td style={{ padding: '2px 8px', color: 'var(--text-secondary)' }}>{DIMENSION_LABELS[key]}</td>
                      <td style={{ textAlign: 'center', padding: '2px 8px' }}>{scoreCell(old.frame_score![key] as number, 2)}</td>
                      <td style={{ textAlign: 'center', padding: '2px 8px' }}>{scoreCell(neu.frame_score![key] as number, 2)}</td>
                      <td style={{ textAlign: 'center', padding: '2px 8px' }}>{deltaCell(old.frame_score![key] as number, neu.frame_score![key] as number)}</td>
                    </tr>
                  ))}
                  <tr style={{ borderTop: '1px solid var(--border-color)', fontWeight: 600 }}>
                    <td style={{ padding: '2px 8px' }}>Subtotal</td>
                    <td style={{ textAlign: 'center', padding: '2px 8px' }}>{old.frame_score.total}/10</td>
                    <td style={{ textAlign: 'center', padding: '2px 8px' }}>{neu.frame_score.total}/10</td>
                    <td style={{ textAlign: 'center', padding: '2px 8px' }}>{deltaCell(old.frame_score.total, neu.frame_score.total)}</td>
                  </tr>
                  {/* Policymaker political operationality sub-scores (t/251) */}
                  {old.frame_score.actor_specificity != null && neu.frame_score.actor_specificity != null && (
                    <>
                      <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                        <td colSpan={4} style={{ padding: '8px 8px 2px', fontWeight: 700, fontSize: '0.7rem', color: '#ef4444' }}>
                          Political Operationality
                        </td>
                      </tr>
                      {(['actor_specificity', 'decision_proximity', 'constituency_impact'] as const).map(key => {
                        const ov = old.frame_score![key] as number | undefined;
                        const nv = neu.frame_score![key] as number | undefined;
                        if (ov == null || nv == null) return null;
                        return (
                          <tr key={key}>
                            <td style={{ padding: '2px 8px', color: 'var(--text-secondary)' }}>{DIMENSION_LABELS[key]}</td>
                            <td style={{ textAlign: 'center', padding: '2px 8px' }}>{scoreCell(ov, 2)}</td>
                            <td style={{ textAlign: 'center', padding: '2px 8px' }}>{scoreCell(nv, 2)}</td>
                            <td style={{ textAlign: 'center', padding: '2px 8px' }}>{deltaCell(ov, nv)}</td>
                          </tr>
                        );
                      })}
                    </>
                  )}
                </>
              )}

              <tr style={{ borderTop: '2px solid var(--border-color)', fontWeight: 700 }}>
                <td style={{ padding: '4px 8px' }}>Composite</td>
                <td style={{ textAlign: 'center', padding: '4px 8px' }}>{old.composite_score}/20</td>
                <td style={{ textAlign: 'center', padding: '4px 8px' }}>{neu.composite_score}/20</td>
                <td style={{ textAlign: 'center', padding: '4px 8px', color: deltaColor }}>{delta > 0 ? '+' : ''}{delta}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function DebateWorkspace({ onExport, exportStatus }: {
  onExport?: (format: string) => void;
  exportStatus?: string | null;
} = {}) {
  const {
    activeDebate, debateLoading, debateError, debateGenerating,
    runClarification, runOpeningStatements, saveDebate, compressOldTranscript,
    diagnosticsEnabled, toggleDiagnostics, selectedDiagEntry, selectDiagEntry,
    diagPopoutOpen, setDiagPopoutOpen, defaultTier, setDefaultTier,
  } = useDebateStore(
    useShallow(s => ({
      activeDebate: s.activeDebate, debateLoading: s.debateLoading, debateError: s.debateError, debateGenerating: s.debateGenerating,
      runClarification: s.runClarification, runOpeningStatements: s.runOpeningStatements, saveDebate: s.saveDebate, compressOldTranscript: s.compressOldTranscript,
      diagnosticsEnabled: s.diagnosticsEnabled, toggleDiagnostics: s.toggleDiagnostics, selectedDiagEntry: s.selectedDiagEntry, selectDiagEntry: s.selectDiagEntry,
      diagPopoutOpen: s.diagPopoutOpen, setDiagPopoutOpen: s.setDiagPopoutOpen,
      defaultTier: s.responseLength, setDefaultTier: s.setResponseLength,
    }))
  );
  const { runSemanticSearch, setFindQuery: setStoreFindQuery, setFindMode: setStoreFindMode, setToolbarPanel } = useTaxonomyStore();
  const transcriptEndRef = useRef<HTMLDivElement>(null);


  // Listen for diagnostics popout window closing
  useEffect(() => {
    const unsub = api.onDiagnosticsPopoutClosed(() => {
      setDiagPopoutOpen(false);
    });
    return unsub;
  }, [setDiagPopoutOpen]);

  // Listen for re-extract claims requests from popout (t/226)
  useEffect(() => {
    const unsub = api.onReExtractClaims((entryId: string) => {
      void useDebateStore.getState().reExtractClaims(entryId);
    });
    return unsub;
  }, []);
  const hasTriggeredOpening = useRef(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [commentPopover, setCommentPopover] = useState<CommentPopoverState | null>(null);
  const [showCCDetails, setShowCCDetails] = useState(false);
  const [showParamHistory, setShowParamHistory] = useState(false);
  const [showEvaluation, setShowEvaluation] = useState(false);
  const [debateChatOpen, setDebateChatOpen] = useState(false);
  const { commentsFile, loadComments: loadDebateComments, unloadComments, sidebarOpen: commentSidebarOpen, toggleSidebar: toggleCommentSidebar } = useCommentStore();

  // Load comments when debate changes
  useEffect(() => {
    if (activeDebate) {
      void loadDebateComments(activeDebate.id);
    }
    return () => unloadComments();
  }, [activeDebate?.id, loadDebateComments, unloadComments]);
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSimilarPovSearch = useCallback((query: string) => {
    setStoreFindQuery(query);
    setStoreFindMode('semantic');
    setToolbarPanel('search');
    void runSemanticSearch(query, new Set(), new Set());
  }, [runSemanticSearch, setStoreFindQuery, setStoreFindMode, setToolbarPanel]);

  const handleChatNavigate = useCallback((cmd: NavigateCommand) => {
    if (cmd.entry) {
      const el = document.getElementById(`debate-entry-${cmd.entry}`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, []);

  // ── Find state ────────────────────────────────────────
  const [findVisible, setFindVisible] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [findCurrentIndex, setFindCurrentIndex] = useState(0);

  const { findTotal, findOffsets } = useMemo(() => {
    if (!findQuery || !activeDebate) return { findTotal: 0, findOffsets: new Map<string, number>() };
    const offsets = new Map<string, number>();
    let total = 0;
    for (const entry of activeDebate.transcript) {
      const count = countOccurrences(entry.content, findQuery);
      if (count > 0) { offsets.set(entry.id, total); total += count; }
    }
    return { findTotal: total, findOffsets: offsets };
  }, [findQuery, activeDebate?.transcript]);

  useEffect(() => { setFindCurrentIndex(0); }, [findQuery, findTotal]);

  // ── Coverage tracking (CT-2) ───────────────────────────
  const coverageMap = useMemo<CoverageMap | null>(() => {
    if (!activeDebate?.document_analysis?.i_nodes?.length) return null;
    const anNodes = activeDebate.argument_network?.nodes ?? [];
    if (anNodes.length === 0) return null;
    const documentClaims = activeDebate.document_analysis.i_nodes.map(n => ({ id: n.id, text: n.text }));
    try {
      return computeCoverageMap(anNodes, documentClaims);
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'debate-workspace',
        level: 'warn',
        message: 'Coverage map computation failed',
        error: { name: (err as Error).name ?? 'Error', message: String(err) },
      });
      return null;
    }
  }, [activeDebate?.argument_network?.nodes, activeDebate?.document_analysis?.i_nodes]);

  const strengthWeighted = useMemo<StrengthWeightedCoverage | null>(() => {
    if (!coverageMap || !activeDebate?.argument_network) return null;
    const { nodes, edges } = activeDebate.argument_network;
    if (nodes.length === 0) return null;
    try {
      return computeStrengthWeightedCoverage(coverageMap, nodes, edges);
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'debate-workspace',
        level: 'warn',
        message: 'Strength-weighted coverage computation failed',
        error: { name: (err as Error).name ?? 'Error', message: String(err) },
      });
      return null;
    }
  }, [coverageMap, activeDebate?.argument_network]);

  useEffect(() => {
    if (!findVisible || findTotal === 0) return;
    document.querySelector(`[data-find-index="${findCurrentIndex}"]`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [findCurrentIndex, findVisible, findQuery, findTotal]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        setFindVisible(true);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  const findNext = useCallback(() => {
    if (findTotal === 0) return;
    setFindCurrentIndex(i => (i + 1) % findTotal);
  }, [findTotal]);

  const findPrev = useCallback(() => {
    if (findTotal === 0) return;
    setFindCurrentIndex(i => (i - 1 + findTotal) % findTotal);
  }, [findTotal]);

  const closeFind = useCallback(() => {
    setFindVisible(false);
    setFindQuery('');
  }, []);

  // Auto-scroll removed — disrupts reading during debate generation

  // Phase 8: Auto-save debounced (2s after last change)
  useEffect(() => {
    if (!activeDebate) return;
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => {
      void saveDebate();
    }, 2000);
    return () => {
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    };
  }, [activeDebate?.transcript.length, activeDebate?.updated_at, saveDebate]);

  // Phase 8: Auto-compress context when transcript grows large
  useEffect(() => {
    if (!activeDebate || debateGenerating) return;
    if (activeDebate.transcript.length >= 16) {
      const lastSummaryIdx = activeDebate.context_summaries.length > 0
        ? activeDebate.transcript.findIndex(
            (e) => e.id === activeDebate.context_summaries[activeDebate.context_summaries.length - 1].up_to_entry_id,
          )
        : -1;
      const uncompressed = activeDebate.transcript.length - (lastSummaryIdx + 1) - 8;
      if (uncompressed >= 8) {
        void compressOldTranscript();
      }
    }
  }, [activeDebate?.transcript.length, debateGenerating]);

  // Phase 7: Context menu handler
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    const selection = window.getSelection();
    const selectedText = selection?.toString().trim() || '';
    if (!selectedText) return; // No selection → use default browser menu

    e.preventDefault();

    // Walk up from the selection's anchor to find the statement card
    let node = selection?.anchorNode as HTMLElement | null;
    let entryId = '';
    let isPoverStatement = false;
    while (node && node !== e.currentTarget) {
      if (node.dataset?.entryId) {
        entryId = node.dataset.entryId;
        isPoverStatement = node.dataset.isPover === 'true';
        break;
      }
      node = node.parentElement;
    }

    // Compute text offsets within the debate-statement-content element
    let startOffset = 0;
    let endOffset = selectedText.length;
    let tier: DetailTier = 'detailed';
    if (entryId && selection && selection.rangeCount > 0) {
      // Find the entry in the transcript to determine the active tier
      const entry = activeDebate?.transcript.find(e => e.id === entryId);
      if (entry) {
        const isSub = ['opening', 'statement', 'fact-check', 'cross_respond'].includes(entry.type);
        tier = isSub ? ((entry as any).display_tier ?? defaultTier ?? 'detailed') : 'detailed';
        const hasSums = entry.summaries != null;
        let displayContent: string;
        if (hasSums && tier === 'brief') displayContent = entry.summaries!.brief;
        else if (hasSums && tier === 'medium') displayContent = entry.summaries!.medium;
        else if (!hasSums && tier === 'brief' && isSub) {
          const sents = entry.content.split(/(?<=[.!?])\s+/);
          displayContent = sents.slice(0, 2).join(' ');
        } else if (!hasSums && tier === 'medium' && isSub) {
          const pb = entry.content.indexOf('\n\n');
          displayContent = pb > 0 && pb < 500 ? entry.content.slice(0, pb) : entry.content.slice(0, 500);
        } else displayContent = entry.content;
        // Find the selectedText within the display content for accurate offsets
        const idx = displayContent.indexOf(selectedText);
        if (idx !== -1) {
          startOffset = idx;
          endOffset = idx + selectedText.length;
        }
      }
    }

    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      selectedText,
      entryId,
      isPoverStatement,
      tier,
      startOffset,
      endOffset,
    });
  }, [activeDebate?.transcript, defaultTier]);

  // Clarification is now user-initiated — no auto-trigger.
  // The ClarificationActions component presents the choice.

  // Opening statements are now manually triggered via the OpeningActions button
  // (no auto-trigger — user picks depth first)

  // Reset trigger flags when debate changes
  useEffect(() => {
    hasTriggeredOpening.current = false;
  }, [activeDebate?.id]);

  if (debateLoading) {
    return <div className="debate-workspace-loading">Loading debate...</div>;
  }

  if (!activeDebate) {
    return <div className="debate-workspace-loading">No debate selected</div>;
  }

  const isClarificationPhase = activeDebate.phase === 'clarification' || activeDebate.phase === 'setup';
  const isEditClaimsPhase = activeDebate.phase === 'edit-claims';
  const isOpeningPhase = activeDebate.phase === 'opening';
  const isDebatePhase = activeDebate.phase === 'debate'
    || activeDebate.phase === 'closed'
    || activeDebate.adaptive_staging?.current_phase != null;
  const isCrossCutting = activeDebate.source_type === 'situations';

  return (
    <div className="debate-workspace-row">
    <div className="debate-workspace">
      {/* Fixed toolbar — always visible */}
      <div className="debate-toolbar">
        <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontFamily: 'monospace', userSelect: 'all', marginRight: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 200 }} title={`${activeDebate.title} — ${activeDebate.id}`}>
          {activeDebate.title || activeDebate.id.slice(0, 12)}
        </span>
        <button
          className={`btn btn-sm debate-diag-btn${diagnosticsEnabled ? ' active' : ''}`}
          onClick={toggleDiagnostics}
          title={diagnosticsEnabled ? 'Disable diagnostics mode' : 'Enable diagnostics mode — click entries to inspect'}
        >
          {diagnosticsEnabled ? 'Debate Diagnostics ON' : 'Debate Diagnostics'}
        </button>
        {isCrossCutting && (
          <button
            className="btn btn-sm debate-cc-details-btn"
            onClick={() => setShowCCDetails(true)}
            title="View situation context used for this debate"
          >
            Details
          </button>
        )}
{/* Debate Chat button moved to FAB at bottom-right */}
        <button
          className={`btn btn-sm${commentSidebarOpen ? ' active' : ''}`}
          onClick={toggleCommentSidebar}
          title={commentSidebarOpen ? 'Hide comments sidebar' : 'Show comments sidebar'}
        >
          Comments{commentsFile?.comments?.length ? ` (${commentsFile.comments.length})` : ''}
        </button>
        {exportStatus && (
          <span className="debate-toolbar-status">{exportStatus}</span>
        )}
        {onExport && (
          <ExportButtonInline onExport={onExport} />
        )}
        <span className="debate-tier-global" style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 2 }}>
          {(['brief', 'medium', 'detailed', 'reasoning', 'claims', 'convergence'] as const).map(tier => (
            <button
              key={tier}
              className={`debate-tier-pill${defaultTier === tier ? ' debate-tier-pill-active' : ''}`}
              onClick={() => setDefaultTier(tier)}
              title={tier === 'brief' ? 'Set all turns to brief (2-3 sentences)' : tier === 'medium' ? 'Set all turns to medium (key points)' : tier === 'detailed' ? 'Set all turns to full content' : tier === 'reasoning' ? 'Show brief, plan & BDI (replaces text)' : tier === 'claims' ? 'Show argument network claims' : 'Show convergence diagnostics'}
            >
              {tier === 'brief' ? 'Brief' : tier === 'medium' ? 'Med' : tier === 'detailed' ? 'Detail' : tier === 'reasoning' ? 'Plan' : tier === 'claims' ? 'Claims' : 'Conv'}
            </button>
          ))}
        </span>
        <button
          className="btn btn-sm"
          onClick={triggerManualDump}
          title="Dump flight recorder (Ctrl+Alt+D)"
        >
          Dump
        </button>
      </div>

      {/* Cross-cutting context dialog */}
      {showCCDetails && activeDebate.source_content && (
        <div className="dialog-overlay" onClick={() => setShowCCDetails(false)}>
          <div className="dialog debate-cc-details-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="debate-cc-details-header">
              <h3>Cross-Cutting Context</h3>
              {activeDebate.source_ref && (
                <span className="debate-source-ref">{activeDebate.source_ref}</span>
              )}
              <button className="debate-inspect-close" onClick={() => setShowCCDetails(false)} title="Close">×</button>
            </div>
            <div className="debate-cc-details-body">
              <DebateSourceViewer
                content={activeDebate.source_content}
                sourceType="document"
                sourceRef={activeDebate.source_ref}
              />
            </div>
          </div>
        </div>
      )}

      {/* Find bar */}
      {findVisible && (
        <FindBar
          query={findQuery}
          onQueryChange={setFindQuery}
          current={findCurrentIndex}
          total={findTotal}
          onPrev={findPrev}
          onNext={findNext}
          onClose={closeFind}
        />
      )}

      {/* Scrollable content: topic, debaters, transcript */}
      <div className="debate-scroll-content" onContextMenu={handleContextMenu}>
        {/* Topic info */}
        <div className="debate-topic-info" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
            <span className="debate-phase-indicator">
              {PHASE_TITLES[activeDebate.phase] || activeDebate.phase}
            </span>
            <span className="debate-timestamp" title={activeDebate.created_at}>
              {new Date(activeDebate.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}{' '}
              {new Date(activeDebate.created_at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
            </span>
            {activeDebate.audience && (
              <span className="debate-audience-badge">
                {DEBATE_AUDIENCES.find(a => a.id === activeDebate.audience)?.label ?? activeDebate.audience}
              </span>
            )}
            {activeDebate.debate_model && (
              <span className="debate-model-badge">{activeDebate.debate_model}</span>
            )}
            {coverageMap && <CoverageBadge coverageMap={coverageMap} strengthWeighted={strengthWeighted} />}
          </div>
          <span className="debate-topic-text">{activeDebate.topic.final}</span>
        </div>

        {/* Adaptive phase progress bar — shown during debate phase when adaptive staging is enabled */}
        {isDebatePhase && (activeDebate as any).adaptive_staging?.enabled && (() => {
          const staging = (activeDebate as any).adaptive_staging as {
            enabled: boolean;
            current_phase: AdaptivePhase;
            phase_progress: number;
            rounds_in_phase: number;
            approaching_transition: boolean;
            rationale?: string;
          };
          return (
            <PhaseProgressBar
              currentPhase={staging.current_phase || 'confrontation'}
              phaseProgress={staging.phase_progress || 0}
              roundsInPhase={staging.rounds_in_phase || 0}
              approachingTransition={staging.approaching_transition || false}
              rationale={staging.rationale}
            />
          );
        })()}

        {/* Debater toggle pills */}
        {(isDebatePhase || isOpeningPhase) && (
          <DebaterToggles />
        )}

        {/* Refined topic editor + score comparison (hidden once debate has substantive entries) */}
        {activeDebate.topic.refined && (activeDebate.phase === 'setup' || activeDebate.phase === 'clarification' || activeDebate.phase === 'edit-claims') && !activeDebate.transcript.some(e => e.type === 'opening' || e.type === 'statement') && (
          <>
            <RefinedTopicEditor />
            <TopicScoreComparison />
          </>
        )}

        {/* Transcript */}
        {activeDebate.transcript.length === 0 && !debateGenerating && (
          <div className="debate-transcript-empty">
            The debate is ready to begin. Clarification questions will appear here.
          </div>
        )}
        {activeDebate.transcript.map((entry, idx) => {
          const matchOffset = findOffsets.get(entry.id) ?? 0;
          // Statement ID — stable human-readable label for this transcript position.
          // Matches ClaimExtractionTrace.round (transcript index + 1) so cross-panel
          // references line up (e.g. Extraction Timeline "S12" == this card's "S12").
          const statementId = `S${idx + 1}`;
          // Skip the clarification transcript card — the interactive ClarificationActions panel
          // below the transcript already shows the questions as clickable pills.
          if (entry.type === 'clarification') return null;
          const isStatement = entry.type !== 'probing' && entry.type !== 'fact-check';
          const card = entry.type === 'probing'
            ? <ProbingCard key={entry.id} entry={entry} statementId={statementId} />
            : entry.type === 'fact-check'
            ? <FactCheckCard key={entry.id} entry={entry} statementId={statementId} findQuery={findQuery} matchOffset={matchOffset} findCurrentIndex={findCurrentIndex} />
            : <StatementCard key={entry.id} entry={entry} statementId={statementId} findQuery={findQuery} matchOffset={matchOffset} findCurrentIndex={findCurrentIndex} entryIndex={idx} totalEntries={activeDebate.transcript.length} />;
          return (
            <div
              key={entry.id}
              className={`debate-entry-wrapper${diagnosticsEnabled && selectedDiagEntry === entry.id ? ' diag-selected' : ''}`}
              onClick={diagnosticsEnabled ? () => selectDiagEntry(entry.id) : undefined}
            >
              {card}
              {!isStatement && <EntryDeleteControls entry={entry} totalEntries={activeDebate.transcript.length} entryIndex={idx} />}
            </div>
          );
        })}
        {debateGenerating && (
          <div className="debate-statement debate-generating">
            <div className="debate-statement-header">
              <span className="debate-statement-speaker" style={{ color: speakerColor(debateGenerating) || undefined }}>
                {speakerLabel(debateGenerating)}
              </span>
              <span className="debate-statement-type">thinking...</span>
            </div>
            <ProgressIndicator />
            <div className="debate-generating-dots">
              <span /><span /><span />
            </div>
          </div>
        )}
        <div ref={transcriptEndRef} />
      </div>

      {/* Phase-aware action bar (fixed at bottom) */}
      {isClarificationPhase && !activeDebate.transcript.some(e => e.type === 'opening' || e.type === 'statement') && <ClarificationActions />}
      {isEditClaimsPhase && <ClaimsEditor />}
      {isOpeningPhase && <OpeningActions />}

      {isDebatePhase && <DebateActions showParamHistory={showParamHistory} setShowParamHistory={setShowParamHistory} showEvaluation={showEvaluation} setShowEvaluation={setShowEvaluation} />}

      {/* Neutral evaluation panel — toggled via Evaluation button */}
      {showEvaluation && activeDebate.neutral_evaluations && activeDebate.neutral_evaluations.length > 0 && (
        <NeutralEvaluationPanel
          evaluations={activeDebate.neutral_evaluations}
          speakerMapping={activeDebate.neutral_speaker_mapping}
        />
      )}

      {/* Parameter calibration history */}
      {showParamHistory && (
        <ParameterHistoryPanel onClose={() => setShowParamHistory(false)} />
      )}

      {/* Diagnostics always uses popup window — no inline panel */}

      {/* Phase 7: Context menu */}
      {contextMenu && (
        <DebateContextMenu
          menu={contextMenu}
          onClose={() => setContextMenu(null)}
          onSimilarPovSearch={handleSimilarPovSearch}
          onComment={() => {
            setCommentPopover({
              x: contextMenu.x,
              y: contextMenu.y,
              selectedText: contextMenu.selectedText,
              entryId: contextMenu.entryId,
              tier: contextMenu.tier,
              startOffset: contextMenu.startOffset,
              endOffset: contextMenu.endOffset,
            });
            setContextMenu(null);
          }}
        />
      )}

      {/* Comment creation popover */}
      {commentPopover && (
        <CommentCreationPopover
          popover={commentPopover}
          onClose={() => setCommentPopover(null)}
        />
      )}

      {/* Comment sidebar */}
      {commentSidebarOpen && commentsFile && (
        <CommentSidebar />
      )}

      {/* Username prompt dialog (mounted once for all comment flows) */}
      <UsernamePromptDialog />
    </div>
    {/* Debate Chat FAB — bottom-right floating button */}
    <button
      className={`debate-chat-fab${debateChatOpen ? ' active' : ''}`}
      onClick={() => setDebateChatOpen(v => !v)}
      title={debateChatOpen ? 'Hide Debate Chat' : 'Open Debate Chat — ask questions about the debate'}
      aria-label="Debate Chat"
    >
      {debateChatOpen ? '\u2715' : '\uD83D\uDCAC'}
    </button>
    {/* Debate Chat sidebar — outside workspace column, inside row */}
    {debateChatOpen && (
      <DiagnosticsChatSidebar
        debate={activeDebate}
        selectedEntry={null}
        currentTab="transcript"
        onNavigate={handleChatNavigate}
        embedded
        onClose={() => setDebateChatOpen(false)}
      />
    )}
    </div>
  );
}
