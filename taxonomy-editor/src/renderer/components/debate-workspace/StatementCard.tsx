// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useCallback, useMemo, useEffect, useRef, useLayoutEffect, type ReactNode } from 'react';
import { useDebateStore } from '../../hooks/useDebateStore';
import { useShallow } from 'zustand/react/shallow';
import { useFlag } from '../../hooks/useFeatureFlags';
import { POVER_INFO } from '../../types/debate';
import type { SpeakerId, TranscriptEntry, TaxonomyRef, ConvergenceSignals } from '../../types/debate';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { remarkColorizePov } from '../../utils/colorizePovPlugin';
import { lineageMarkdownComponents, extractLineageNames } from '../../utils/lineageMatcher';
import { getDebateMarkdownComponents, type VocabResolution } from '../../utils/vocabularyAnnotations';
import {
  speakerLabel, speakerColor, pctFmt, focusMainWindowNode,
  fixMarkdownLinks, stripLeadingHeadings,
} from './utils';
import type { AnchorHTMLAttributes, HTMLAttributes } from 'react';
import { parseEntityRef } from '@lib/entities/types';
import type { FactVerdict, FactDiscrepancy } from '@lib/debate/types';
import { remarkLinkifyRefs, REF_LINK_CLASS } from './refLinkifyPlugin';
import { ClaimsView } from './ClaimsView';
import { CampGlyph, povToCamp } from '../shared/CampGlyph';
import './StatementCard.css';

const SafeLink = ({ node: _, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { node?: unknown }) => (
  <a {...props} target="_blank" rel="noopener noreferrer" />
);
import { LineageTermsView, VocabTermsView } from './VocabularyPanel';
import { CommentOverlay, useEntryCommentCount } from '../chat/CommentHighlights';
import { useCommentStore } from '../../hooks/useCommentStore';
import type { DetailTier } from '@lib/debate/comments';
import { TaxonomyRefsSection } from './TaxonomyRefs';

/** Remark pipeline for debate transcript text: GFM + POV colorization + ID-token ref links (t/1776). */
const DEBATE_REMARK_PLUGINS = [remarkGfm, remarkColorizePov, remarkLinkifyRefs];

/** Human-readable labels for the fact-check verdict taxonomy (t/1701 / t/1716). */
const FACT_VERDICT_LABEL: Record<FactVerdict, string> = {
  supported: 'Supported',
  partially_accurate: 'Partially Accurate',
  disputed: 'Disputed',
  false: 'False',
  unverifiable: 'Unverifiable',
};

const DISCREPANCY_DIMENSION_LABEL: Record<FactDiscrepancy['dimension'], string> = {
  magnitude: 'Magnitude', temporal: 'Timing', attribution: 'Attribution', scope: 'Scope', existence: 'Existence',
};

/**
 * `span` md-component: renders a `scanRefs`-detected ID token (marked `ref-link` by
 * the remark plugin) as a selectable button that opens the shared DetailPane; every
 * other span (e.g. pov-name colorization) passes through unchanged. For node/sit/pol
 * the displayed token IS the id, so parseEntityRef(children) recovers the ref without
 * a data round-trip; a non-parsing token falls through to a plain span. (t/1776)
 */
function RefLinkSpan({ node: _node, className, children, ...props }: HTMLAttributes<HTMLSpanElement> & { node?: unknown }) {
  if ((className ?? '').split(/\s+/).includes(REF_LINK_CLASS) && typeof children === 'string') {
    const ref = parseEntityRef(children);
    if (ref) {
      return (
        <button
          type="button"
          className={REF_LINK_CLASS}
          title={`Show details for ${children}`}
          onClick={(e) => { e.stopPropagation(); useDebateStore.getState().setSelectedRef(ref); }}
        >
          {children}
        </button>
      );
    }
  }
  return <span className={className} {...props}>{children}</span>;
}

// ── Small helper components ─────────────────────────────

export function PhaseTransitionCard({ type }: {
  type: 'TRANSITION_SUMMARY' | 'REGRESSION_NOTICE' | 'FINAL_COMMIT';
  content?: string;
}) {
  const label = type === 'TRANSITION_SUMMARY' ? 'Entering Synthesis'
    : type === 'REGRESSION_NOTICE' ? 'Returning to Exploration'
    : 'Final Positions';

  return (
    <div className="phase-hairline">
      <span className="phase-hairline-label">{label}</span>
    </div>
  );
}

export function PhaseHairline({ label }: { label: string }) {
  return (
    <div className="phase-hairline">
      <span className="phase-hairline-label">{label}</span>
    </div>
  );
}

function ConvBadge({ text, color }: { text: string; color: string }) {
  return <span className="convergence-badge" style={{ color }}>{text}</span>;
}

function bandBadge(value: number, bands: [number, string, string][]): ReactNode {
  for (const [threshold, label, color] of bands) {
    if (value >= threshold) return <ConvBadge text={label} color={color} />;
  }
  const fallback = bands[bands.length - 1];
  return <ConvBadge text={fallback[1]} color={fallback[2]} />;
}

function ConvCell({ label, span, children }: { label: string; span?: boolean; children: ReactNode }) {
  return (
    <div className={span ? 'convergence-cell-span' : 'convergence-cell'}>
      <div className="convergence-label">{label}</div>
      <div className="convergence-value">{children}</div>
    </div>
  );
}

const CONCESSION_STYLES: Record<string, { bg: string; fg: string; label: string }> = {
  taken: { bg: 'rgba(34,197,94,0.15)', fg: '#22c55e', label: 'Taken' },
  missed: { bg: 'rgba(239,68,68,0.15)', fg: '#ef4444', label: 'Missed' },
};
const CONCESSION_DEFAULT = { bg: 'rgba(148,163,184,0.15)', fg: '#94a3b8', label: 'N/A' };

export function ConvergenceInlineCard({ signal }: { signal: ConvergenceSignals | undefined }) {
  if (!signal) {
    return <div className="convergence-empty">No convergence data for this turn.</div>;
  }
  const { move_polarity: md, dialectical_engagement: ed, argument_redundancy: rr,
    dominant_counterargument: so, concession_opportunity: co, position_drift: pd, crux_engagement_rate: cr } = signal;

  const edTargeted = ed?.targeted ?? 0;
  const edTotal = edTargeted + (ed?.standalone ?? 0);
  const rrMaxOverlap = rr?.max_self_overlap ?? 0;
  const coStyle = CONCESSION_STYLES[co?.outcome ?? ''] ?? CONCESSION_DEFAULT;
  const pdOverlap = pd?.overlap_with_opening ?? 0;
  const crCount = cr?.cumulative_count ?? 0;
  const crFollow = cr?.cumulative_follow_through ?? 0;

  return (
    <div className="convergence-grid">
      <ConvCell label="Polarity">
        <span style={{ color: '#ef4444' }}>{md?.confrontational ?? 0}C</span>{' / '}
        <span style={{ color: '#22c55e' }}>{md?.collaborative ?? 0}S</span>
        {' = '}<strong>{pctFmt(md?.ratio ?? 0)}</strong>
        {bandBadge(md?.ratio ?? 0, [[0.5, 'cooperative', '#22c55e'], [0, 'confrontational', '#ef4444']])}
      </ConvCell>
      <ConvCell label="Dialectical Engagement">
        {edTargeted}/{edTotal} targeted = <strong>{pctFmt(ed?.ratio ?? 0)}</strong>
        {bandBadge(ed?.ratio ?? 0, [[0.7, 'deep', '#22c55e'], [0.4, 'moderate', '#f59e0b'], [0, 'standalone', '#ef4444']])}
      </ConvCell>
      <ConvCell label="Argument Redundancy">
        avg <strong>{pctFmt(rr?.avg_self_overlap ?? 0)}</strong>, max <strong>{pctFmt(rrMaxOverlap)}</strong>
        {rr?.semantic_max_similarity != null && <>, sem <strong>{pctFmt(rr.semantic_max_similarity)}</strong></>}
        {rr?.semantically_recycled ? <ConvBadge text="semantic repeat" color="#ef4444" />
          : bandBadge(rrMaxOverlap, [[0.5, 'repeating', '#f59e0b'], [0, 'fresh', '#22c55e']])}
      </ConvCell>
      <ConvCell label="Dominant Counterargument">
        {so ? (
          <>{so.node_id} str={so.strength?.toFixed(2)}
            {bandBadge(so.strength ?? 0, [[0.7, 'strong', '#ef4444'], [0.5, 'moderate', '#f59e0b'], [0, 'weak', '#22c55e']])}
          </>
        ) : <span style={{ color: 'var(--text-muted)' }}>none</span>}
      </ConvCell>
      <ConvCell label="Concession">
        {co?.strong_attacks_faced ?? 0} attacks, used: {co?.concession_used ? 'Y' : 'N'} —{' '}
        <span className="concession-badge" style={{ background: coStyle.bg, color: coStyle.fg }}>
          {coStyle.label}
        </span>
      </ConvCell>
      <ConvCell label="Position Drift">
        opening: <strong>{pctFmt(pdOverlap)}</strong>, drift: <strong>{pctFmt(pd?.drift ?? 0)}</strong>
        {bandBadge(pdOverlap, [[0.6, 'anchored', '#f59e0b'], [0.3, 'evolved', '#22c55e'], [0, 'shifted', '#3b82f6']])}
      </ConvCell>
      <ConvCell label="Crux Engagement" span>
        this turn: {cr?.used_this_turn ? 'Yes' : 'No'} | cumulative: {crCount} | follow-through: {crFollow}
        {crCount > 0 && crFollow === 0 && <ConvBadge text="no follow-through" color="#f59e0b" />}
        {crCount > 0 && crFollow > 0 && <ConvBadge text="resolving" color="#22c55e" />}
      </ConvCell>
    </div>
  );
}

export function HighlightedText({ text, query, matchOffset, currentIndex }: {
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

export function EntryDeleteControls({ entry, totalEntries, entryIndex }: {
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

export function EntryCommentBadge({ entryId }: { entryId: string }) {
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

// ── Collapsible sections for concluding statements ──────

const FULLY_COLLAPSED_SECTIONS = new Set(['Argument Map']);
const SUB_COLLAPSED_SECTIONS = new Set(['Areas of Disagreement', 'Cruxes', 'Resolution Analysis']);

interface ParsedSection { heading: string; body: string }

function splitByHeadings(content: string): ParsedSection[] {
  const parts = content.split(/\n(?=## )/);
  const sections: ParsedSection[] = [];
  for (const part of parts) {
    const match = part.match(/^## (.+)\n([\s\S]*)$/);
    if (match) {
      sections.push({ heading: match[1].trim(), body: match[2].trim() });
    } else if (part.trim()) {
      sections.push({ heading: '', body: part.trim() });
    }
  }
  return sections;
}

function parseBullets(body: string): { top: string; subs: string[] }[] {
  const lines = body.split('\n');
  const groups: { top: string; subs: string[] }[] = [];
  for (const line of lines) {
    if (line.startsWith('- ')) {
      groups.push({ top: line, subs: [] });
    } else if (line.startsWith('  - ') && groups.length > 0) {
      groups[groups.length - 1].subs.push(line);
    } else if (line.startsWith('  ') && groups.length > 0 && groups[groups.length - 1].subs.length > 0) {
      groups[groups.length - 1].subs[groups[groups.length - 1].subs.length - 1] += '\n' + line;
    }
  }
  return groups;
}

function CollapsibleBulletItem({ top, subs, mdComponents }: { top: string; subs: string[]; mdComponents: object }) {
  const [expanded, setExpanded] = useState(false);
  if (subs.length === 0) {
    return <Markdown remarkPlugins={DEBATE_REMARK_PLUGINS} components={mdComponents}>{fixMarkdownLinks(top)}</Markdown>;
  }
  return (
    <div className="concluding-collapsible-bullet">
      <div className="concluding-bullet-top" onClick={() => setExpanded(e => !e)} style={{ cursor: 'pointer' }}>
        <span className="concluding-toggle-arrow">{expanded ? '▼' : '▶'}</span>
        <Markdown remarkPlugins={DEBATE_REMARK_PLUGINS} components={mdComponents}>{fixMarkdownLinks(top)}</Markdown>
      </div>
      {expanded && (
        <div className="concluding-bullet-subs">
          <Markdown remarkPlugins={DEBATE_REMARK_PLUGINS} components={mdComponents}>{fixMarkdownLinks(subs.join('\n'))}</Markdown>
        </div>
      )}
    </div>
  );
}

function ConcludingSections({ content, mdComponents }: { content: string; mdComponents: object }) {
  const sections = splitByHeadings(content);
  return (
    <>
      {sections.map((section, i) => {
        if (!section.heading) {
          return <Markdown key={i} remarkPlugins={DEBATE_REMARK_PLUGINS} components={mdComponents}>{fixMarkdownLinks(section.body)}</Markdown>;
        }
        if (FULLY_COLLAPSED_SECTIONS.has(section.heading)) {
          return (
            <details key={i} className="concluding-collapsed-section">
              <summary className="concluding-section-summary"><h2>{section.heading}</h2></summary>
              <Markdown remarkPlugins={DEBATE_REMARK_PLUGINS} components={mdComponents}>{fixMarkdownLinks(section.body)}</Markdown>
            </details>
          );
        }
        if (SUB_COLLAPSED_SECTIONS.has(section.heading)) {
          const bullets = parseBullets(section.body);
          return (
            <div key={i}>
              <h2>{section.heading}</h2>
              {bullets.map((b, j) => (
                <CollapsibleBulletItem key={j} top={b.top} subs={b.subs} mdComponents={mdComponents} />
              ))}
            </div>
          );
        }
        return <Markdown key={i} remarkPlugins={DEBATE_REMARK_PLUGINS} components={mdComponents}>{fixMarkdownLinks(`## ${section.heading}\n${section.body}`)}</Markdown>;
      })}
    </>
  );
}

// ── Tier display content resolution ─────────────────────

const SUBSTANTIVE_TYPES = new Set(['opening', 'statement', 'fact-check', 'cross_respond']);

function resolveDisplayContent(entry: TranscriptEntry, activeTier: string, isSubstantive: boolean): { displayContent: string; isTruncated: boolean } {
  const hasSummaries = entry.summaries != null;
  if (hasSummaries && activeTier === 'brief') return { displayContent: stripLeadingHeadings(entry.summaries!.brief), isTruncated: false };
  if (hasSummaries && activeTier === 'medium') return { displayContent: stripLeadingHeadings(entry.summaries!.medium), isTruncated: false };
  if (!hasSummaries && activeTier === 'brief' && isSubstantive) {
    const sentences = entry.content.split(/(?<=[.!?])\s+/);
    return { displayContent: stripLeadingHeadings(sentences.slice(0, 2).join(' ')), isTruncated: sentences.length > 2 };
  }
  if (!hasSummaries && activeTier === 'medium' && isSubstantive) {
    const paraBreak = entry.content.indexOf('\n\n');
    const text = (paraBreak > 0 && paraBreak < 500) ? entry.content.slice(0, paraBreak) : entry.content.slice(0, 500);
    return { displayContent: stripLeadingHeadings(text), isTruncated: text.length < entry.content.length };
  }
  return { displayContent: stripLeadingHeadings(entry.content), isTruncated: false };
}

const META_TIERS = new Set(['reasoning', 'terms', 'lineage', 'claims', 'convergence']);

const TIER_LABELS: Record<string, string> = {
  brief: 'Brief', medium: 'Med', detailed: 'Detail', reasoning: 'Plan',
  claims: 'Claims', terms: 'Terms', lineage: 'Lineage', convergence: 'Conv',
};
const TIER_TITLES: Record<string, string> = {
  brief: '2-3 sentences', medium: '1-2 paragraphs', detailed: 'Full response',
  reasoning: 'Brief, plan & BDI (replaces text)', claims: 'Argument network claims',
  terms: 'Vocabulary disambiguation', lineage: 'Intellectual lineage references',
  convergence: 'Convergence diagnostics',
};

// ── Main cards ──────────────────────────────────────────

export function StatementCard({ entry, statementId, findQuery = '', matchOffset = 0, findCurrentIndex = -1, entryIndex, totalEntries }: {
  entry: TranscriptEntry; statementId?: string; findQuery?: string; matchOffset?: number; findCurrentIndex?: number; entryIndex?: number; totalEntries?: number;
}) {
  const color = speakerColor(entry.speaker);
  const isPover = entry.speaker !== 'system' && entry.speaker !== 'user';
  const camp = isPover ? povToCamp(entry.speaker) : undefined;
  const activeDebate = useDebateStore(s => s.activeDebate);
  const defaultTier = useDebateStore(s => s.responseLength);
  const setEntryDisplayTier = useDebateStore(s => s.setEntryDisplayTier);
  const askQuestion = useDebateStore(s => s.askQuestion);
  const debateGenerating = useDebateStore(s => s.debateGenerating);
  const diagnosticsEnabled = useDebateStore(s => s.diagnosticsEnabled);
  const toggleDiagnostics = useDebateStore(s => s.toggleDiagnostics);
  const selectDiagEntry = useDebateStore(s => s.selectDiagEntry);
  const deleteTranscriptEntries = useDebateStore(s => s.deleteTranscriptEntries);
  const qbafEnabled = useFlag('release-qbaf-analysis');
  const detailDropdown = useFlag('debate-detail-dropdown');
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
  const hasLineageRefs = useMemo(() => extractLineageNames(entry.content).length > 0, [entry.content]);
  const mdComponents = useMemo(
    () => ({ ...getDebateMarkdownComponents(vocabResolutions, vocabResolutions?.length ? showTerms : undefined, showLineage), a: SafeLink, span: RefLinkSpan }),
    [vocabResolutions, showTerms, showLineage],
  );

  const isSubstantive = SUBSTANTIVE_TYPES.has(entry.type);
  const activeTier = isSubstantive ? (entry.display_tier ?? defaultTier) : 'detailed';
  const showTierPills = isSubstantive;

  // Flip animation: displayedTier lags activeTier — content swaps at the midpoint of the rotateY flip
  const [displayedTier, setDisplayedTier] = useState(activeTier);
  const [flipKey, setFlipKey] = useState(0);
  const [flipping, setFlipping] = useState(false);
  const prevTierRef = useRef(activeTier);
  const midpointTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const bodyRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (prevTierRef.current === activeTier) return;
    const prevTier = prevTierRef.current;
    prevTierRef.current = activeTier;

    clearTimeout(midpointTimerRef.current);

    const isTextToText = !META_TIERS.has(prevTier) && !META_TIERS.has(activeTier);
    if (isTextToText || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setDisplayedTier(activeTier);
      return;
    }

    if (bodyRef.current) {
      bodyRef.current.style.height = `${bodyRef.current.offsetHeight}px`;
    }

    setFlipping(true);
    setFlipKey(k => k + 1);

    midpointTimerRef.current = setTimeout(() => {
      setDisplayedTier(activeTier);
    }, 175);

    return () => clearTimeout(midpointTimerRef.current);
  }, [activeTier]);

  useLayoutEffect(() => {
    if (!flipping || !bodyRef.current || !innerRef.current) return;
    const naturalHeight = innerRef.current.scrollHeight;
    bodyRef.current.style.height = `${naturalHeight}px`;
  }, [displayedTier, flipping]);

  const handleFlipEnd = useCallback(() => {
    setFlipping(false);
    if (bodyRef.current) bodyRef.current.style.height = '';
  }, []);

  const isMetaView = META_TIERS.has(displayedTier);
  const { displayContent, isTruncated } = resolveDisplayContent(entry, displayedTier, isSubstantive);

  // Memoize the rendered statement body into a reconciliation-stable subtree so
  // CommentOverlay's imperatively-injected [data-comment-highlight] spans survive
  // comment-only re-renders (HLD t/1683#1, Decision 2 — t/1694). A stable element
  // ref makes React bail on re-diffing this subtree, so the injected spans aren't
  // clobbered. Deps cover everything that changes the rendered TEXT (content,
  // tier, find-highlight state, md components); comment state is deliberately
  // EXCLUDED — registering a comment must not re-diff (and wipe) the wrapped nodes.
  // CommentOverlay's sweep/normalize is only safe because of this memoization.
  const renderedStatementBody = useMemo(() => {
    if (findQuery) {
      return <HighlightedText text={displayContent} query={findQuery} matchOffset={matchOffset} currentIndex={findCurrentIndex} />;
    }
    if (entry.type === 'concluding') {
      return <ConcludingSections content={displayContent} mdComponents={mdComponents} />;
    }
    return <Markdown remarkPlugins={DEBATE_REMARK_PLUGINS} components={mdComponents}>{fixMarkdownLinks(displayContent)}</Markdown>;
  }, [findQuery, matchOffset, findCurrentIndex, entry.type, displayContent, displayedTier, mdComponents]);

  return (
    <div
      className={`debate-statement debate-speaker-${entry.speaker} debate-type-${entry.type}`}
      data-entry-id={entry.id}
      data-is-pover={isPover ? 'true' : 'false'}
    >
      <div className="debate-statement-header">
        {camp && <CampGlyph camp={camp} size={16} />}
        <span className="debate-statement-speaker" style={color ? { color } : undefined}>
          {speakerLabel(entry.speaker)}
        </span>
        {statementId && (
          <span
            className="debate-statement-id"
            title={`Statement ${statementId} — stable position in transcript`}
            id={`stmt-${statementId}`}
          >
            {statementId}
          </span>
        )}
        {(() => {
          const modelId = entry.model ?? activeDebate?.speaker_models?.[entry.speaker];
          if (!modelId) return null;
          const short = modelId.replace(/^(gemini-|claude-|groq-|openai-|deepseek-|ollama-)/, '');
          return (
            <span className="debate-model-badge" title={modelId}>
              {short}
            </span>
          );
        })()}
        <span className="debate-statement-type">
          {entry.type}
          {anNodeId && <span className="debate-an-id"> · {anNodeId}</span>}
        </span>
        {showTierPills && (
          <span className="debate-tier-pills">
            {detailDropdown ? (
              <select
                className="debate-detail-dropdown"
                value={(['brief', 'medium', 'detailed'] as const).includes(activeTier as 'brief' | 'medium' | 'detailed') ? activeTier : 'detailed'}
                onChange={(e) => { e.stopPropagation(); setEntryDisplayTier(entry.id, e.target.value as 'brief' | 'medium' | 'detailed'); }}
              >
                <option value="brief">Brief</option>
                <option value="medium">Medium</option>
                <option value="detailed">Full</option>
              </select>
            ) : (
              (['brief', 'medium', 'detailed'] as const).map(tier => (
                <button
                  key={tier}
                  className={`debate-tier-pill${activeTier === tier ? ' debate-tier-pill-active' : ''}`}
                  onClick={(e) => { e.stopPropagation(); setEntryDisplayTier(entry.id, tier); }}
                  title={TIER_TITLES[tier]}
                >
                  {TIER_LABELS[tier]}
                </button>
              ))
            )}
            {(['reasoning', 'terms', 'lineage', 'claims', 'convergence'] as const).map(tier => {
              if (tier === 'terms' && !(vocabResolutions && vocabResolutions.length > 0)) return null;
              if (tier === 'lineage' && !hasLineageRefs) return null;
              const isSpecial = (tier === 'terms' || tier === 'lineage') && activeTier !== tier;
              return (
                <button
                  key={tier}
                  className={`debate-tier-pill${activeTier === tier ? ' debate-tier-pill-active' : ''}`}
                  onClick={(e) => { e.stopPropagation(); setEntryDisplayTier(entry.id, tier); }}
                  title={TIER_TITLES[tier]}
                  style={isSpecial ? { color: 'rgb(168, 85, 247)' } : undefined}
                >
                  {TIER_LABELS[tier]}
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
              aria-label="Delete this entry"
            >&times;</button>
            {entryIndex < totalEntries - 1 && (
              <button
                className="debate-entry-delete-btn"
                onClick={(e) => { e.stopPropagation(); setDeleteConfirm('after'); }}
                title="Delete this and all entries after it"
                aria-label="Delete this and all entries after it"
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
            <div className="debate-turn-symbol-tooltips">
              {turnSymbols.map((s, i) => (
                <div key={i}>{s.symbol} — {s.tooltip}</div>
              ))}
            </div>
          )}
        </>
      )}
      <div className={`debate-statement-body${isMetaView ? ' meta-view' : ''}`} ref={bodyRef}>
        <div key={flipKey} ref={innerRef} className={`debate-flip-inner${flipping ? ' flipping' : ''}`} onAnimationEnd={handleFlipEnd}>
      {isMetaView && <div className="debate-meta-mode-label">{TIER_LABELS[displayedTier]?.toUpperCase()}</div>}
      {displayedTier === 'terms' && vocabResolutions && vocabResolutions.length > 0 ? (
        <div className="debate-statement-content">
          <VocabTermsView resolutions={vocabResolutions} ambiguities={meta?.vocabulary_ambiguities as { colloquial: string; offset?: number }[] | undefined} statementText={entry.content} />
        </div>
      ) : displayedTier === 'lineage' ? (
        <div className="debate-statement-content">
          <LineageTermsView content={entry.content} />
        </div>
      ) : displayedTier === 'claims' ? (
        <div className="debate-statement-content">
          <ClaimsView entryId={entry.id} debate={activeDebate!} />
        </div>
      ) : displayedTier === 'convergence' ? (
        <div className="debate-statement-content">
          <ConvergenceInlineCard signal={activeDebate?.convergence_signals?.find(s => s.entry_id === entry.id)} />
        </div>
      ) : displayedTier === 'reasoning' ? (
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
          {/* Always render the markdown — never suppress it when a comment exists
              (the t/1694 root cause). CommentOverlay decorates this same container
              in-place with highlight spans; it degrades gracefully (full markdown
              stays intact) when a comment's selectedText can't be resolved. */}
          <div className="debate-statement-content markdown-body prose" ref={contentRef}>
            {renderedStatementBody}
            {isTruncated && (
              <span
                className="debate-tier-truncated"
                onClick={(e) => { e.stopPropagation(); setEntryDisplayTier(entry.id, 'detailed'); }}
                title="Click to show full content"
              >... show full</span>
            )}
          </div>
          <CommentOverlay containerRef={contentRef} entryId={entry.id} activeTier={displayedTier as DetailTier} />
        </>
      )}
        </div>
      </div>
      {activeTier !== 'reasoning' && (
        <>
          <EntryCommentBadge entryId={entry.id} />
          {entry.speaker === 'system' && entry.type === 'system' && entry.content.includes('Consider exploring:') && (() => {
            const match = entry.content.match(/Consider exploring:\s*(.+)/s);
            const topic = match?.[1]?.trim();
            if (!topic) return null;
            return (
              <div className="debate-explore-suggestion">
                <span className="debate-explore-suggestion-text">
                  Redirect the debate to explore this topic?
                </span>
                <button
                  className="debate-explore-btn"
                  disabled={!!debateGenerating}
                  onClick={(e) => { e.stopPropagation(); void askQuestion(`Explore this: ${topic}`); }}
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

export function ProbingCard({ entry, statementId }: { entry: TranscriptEntry; statementId?: string }) {
  const { askQuestion, debateGenerating } = useDebateStore(
    useShallow(s => ({ askQuestion: s.askQuestion, debateGenerating: s.debateGenerating }))
  );
  const questions = (entry.metadata?.probing_questions as { text: string; targets: string[]; threatens?: string; type?: string }[]) || [];

  const handleAsk = async (q: { text: string; targets: string[] }) => {
    if (debateGenerating) return;
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

export function FactCheckCard({ entry, statementId, findQuery = '', matchOffset = 0, findCurrentIndex = -1 }: {
  entry: TranscriptEntry; statementId?: string; findQuery?: string; matchOffset?: number; findCurrentIndex?: number;
}) {
  const activeDebate = useDebateStore(s => s.activeDebate);
  const [showWebEvidence, setShowWebEvidence] = useState(false);
  const factCheck = entry.metadata?.fact_check as {
    verdict: FactVerdict;
    discrepancy?: FactDiscrepancy;
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
          {factCheck ? FACT_VERDICT_LABEL[factCheck.verdict] ?? factCheck.verdict : 'unknown'}
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
      {factCheck?.verdict === 'partially_accurate' && factCheck.discrepancy && (
        <div
          className={`debate-fact-check-discrepancy debate-fact-check-severity-${factCheck.discrepancy.severity}`}
          title={factCheck.discrepancy.source ? `Source: ${factCheck.discrepancy.source}` : undefined}
        >
          <span className="debate-fact-check-discrepancy-severity">
            {factCheck.discrepancy.severity === 'major' ? '⚠ Major discrepancy' : 'Minor discrepancy'}
          </span>
          <span className="debate-fact-check-discrepancy-dimension">
            {DISCREPANCY_DIMENSION_LABEL[factCheck.discrepancy.dimension] ?? factCheck.discrepancy.dimension}
          </span>
          <span className="debate-fact-check-discrepancy-delta">
            <span className="debate-fact-check-discrepancy-claimed">{factCheck.discrepancy.claimed}</span>
            <span className="debate-fact-check-discrepancy-arrow"> → </span>
            <span className="debate-fact-check-discrepancy-actual">{factCheck.discrepancy.actual}</span>
          </span>
        </div>
      )}
      <div className="debate-statement-content markdown-body">
        {(() => {
          // Retroactive fix: older auto fact-checks truncated the claim in entry.content.
          // Use the full checked_text from metadata when available.
          let displayContent = entry.content;
          if (factCheck?.checked_text) {
            const quoteStart = displayContent.indexOf('"');
            const quoteEnd = quoteStart >= 0 ? displayContent.indexOf('"', quoteStart + 1) : -1;
            if (quoteStart >= 0 && quoteEnd > quoteStart) {
              const embedded = displayContent.slice(quoteStart + 1, quoteEnd);
              if (embedded.endsWith('...') && factCheck.checked_text.length > embedded.length) {
                displayContent = displayContent.slice(0, quoteStart + 1) + factCheck.checked_text + displayContent.slice(quoteEnd);
              }
            }
          }
          return findQuery
            ? <HighlightedText text={displayContent} query={findQuery} matchOffset={matchOffset} currentIndex={findCurrentIndex} />
            : <Markdown remarkPlugins={DEBATE_REMARK_PLUGINS} components={{ ...lineageMarkdownComponents, a: SafeLink, span: RefLinkSpan }}>{fixMarkdownLinks(displayContent)}</Markdown>;
        })()}
      </div>
      {showWebEvidence && (
        <div className="debate-fact-check-web-evidence">
          <div className="debate-fact-check-web-evidence-header">Web Search Evidence</div>
          <div className="debate-fact-check-web-evidence-body markdown-body">
            {factCheck?.web_search_evidence ? (
              <Markdown remarkPlugins={DEBATE_REMARK_PLUGINS} components={{ a: SafeLink, span: RefLinkSpan }}>{fixMarkdownLinks(factCheck.web_search_evidence)}</Markdown>
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
