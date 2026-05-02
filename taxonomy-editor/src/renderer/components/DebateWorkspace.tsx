// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useRef, useEffect, useCallback, useMemo, type ReactNode } from 'react';
import { api } from '@bridge';
import { useDebateStore } from '../hooks/useDebateStore';
import { useShallow } from 'zustand/react/shallow';
import { useTaxonomyStore } from '../hooks/useTaxonomyStore';
import { POVER_INFO, DEBATE_AUDIENCES } from '../types/debate';
import type { PoverId, TranscriptEntry, TaxonomyRef, DebateAudience, DocumentINode } from '../types/debate';
import type { TabId } from '../types/taxonomy';
import { DebateSourceViewer } from './DebateSourceViewer';
import { HarvestDialog } from './HarvestDialog';
import { ReflectionsPanel } from './ReflectionsPanel';
// DiagnosticsPanel removed — diagnostics always uses popup window
import { NeutralEvaluationPanel } from './NeutralEvaluationPanel';
import { nodePovFromId } from '@lib/debate/nodeIdUtils';
import { AI_POVERS } from '@lib/debate/types';
import { computeCoverageMap, computeStrengthWeightedCoverage } from '@lib/debate/coverageTracker';
import type { CoverageMap, StrengthWeightedCoverage } from '@lib/debate/coverageTracker';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// ── Phase 7: Context menu state ──────────────────────────
interface ContextMenuState {
  x: number;
  y: number;
  selectedText: string;
  entryId: string;
  isPoverStatement: boolean;
}

const PHASE_TITLES: Record<string, string> = {
  setup: 'Setting up...',
  clarification: 'Topic Refinement',
  opening: 'Opening Statements',
  debate: 'Debate',
  closed: 'Debate Closed',
};

type AdaptivePhase = 'thesis-antithesis' | 'exploration' | 'synthesis';

const ADAPTIVE_PHASE_LABELS: Record<AdaptivePhase, string> = {
  'thesis-antithesis': 'Thesis-Antithesis',
  'exploration': 'Exploration',
  'synthesis': 'Synthesis',
};

const ADAPTIVE_PHASE_COLORS: Record<AdaptivePhase, string> = {
  'thesis-antithesis': '#f59e0b',
  'exploration': '#3b82f6',
  'synthesis': '#10b981',
};

const ADAPTIVE_PHASES: AdaptivePhase[] = ['thesis-antithesis', 'exploration', 'synthesis'];

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


function speakerLabel(speaker: PoverId | 'system' | 'document' | 'moderator'): string {
  if (speaker === 'system') return 'System';
  if (speaker === 'moderator') return 'Moderator';
  if (speaker === 'user') return 'You';
  if (speaker === 'document') return 'Document';
  const info = POVER_INFO[speaker as Exclude<PoverId, 'user'>];
  return info ? info.label : speaker;
}

function speakerColor(speaker: PoverId | 'system' | 'document' | 'moderator'): string | undefined {
  if (speaker === 'system' || speaker === 'user' || speaker === 'document') return undefined;
  if (speaker === 'moderator') return 'var(--color-moderator, #8b5cf6)';
  const info = POVER_INFO[speaker as Exclude<PoverId, 'user'>];
  return info?.color;
}

// ── Phase 6: Taxonomy cross-navigation helpers ──────────

const POV_COLOR_VAR: Record<string, string> = {
  accelerationist: 'var(--color-acc)',
  safetyist: 'var(--color-saf)',
  skeptic: 'var(--color-skp)',
  situations: 'var(--color-sit)',
};

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

/** Clickable taxonomy pill that opens the node in pane 3 */
function TaxonomyPill({ taxRef }: { taxRef: TaxonomyRef }) {
  const { colorVar } = nodeIdToTab(taxRef.node_id);
  const label = getNodeLabel(taxRef.node_id);
  const inspectNode = useDebateStore((s) => s.inspectNode);

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    inspectNode(taxRef.node_id);
  };

  return (
    <span
      className="debate-taxonomy-pill debate-taxonomy-pill-clickable"
      style={{ borderColor: colorVar, color: colorVar }}
      title={`${label}\n${taxRef.relevance}`}
      onClick={handleClick}
    >
      {taxRef.node_id}
    </span>
  );
}

/** Combined taxonomy + policy refs with single "Show reasoning" toggle */
type PolicyRefEntry = string | { policy_id: string; relevance: string };

function resolvePolRef(ref: PolicyRefEntry): { id: string; relevance: string | null } {
  if (typeof ref === 'string') return { id: ref, relevance: null };
  return { id: ref.policy_id, relevance: ref.relevance };
}

function TaxonomyRefsSection({ refs, policyRefs, metaPolicyRefs }: {
  refs: TaxonomyRef[];
  policyRefs?: PolicyRefEntry[];
  metaPolicyRefs?: PolicyRefEntry[];
}) {
  const [expanded, setExpanded] = useState(false);
  const inspectNode = useDebateStore((s) => s.inspectNode);
  const polRefs = metaPolicyRefs || policyRefs || [];

  if (refs.length === 0 && polRefs.length === 0) return null;

  return (
    <div className="debate-taxonomy-refs-section">
      <div className="debate-taxonomy-refs">
        {refs.map((taxRef) => (
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
              onClick={(e) => { e.stopPropagation(); inspectNode(id); }}
            >
              {id}
            </span>
          );
        })}
        {(refs.length > 0 || polRefs.length > 0) && (
          <button
            className="debate-reasoning-toggle"
            onClick={() => setExpanded(e => !e)}
          >
            {expanded ? 'Hide reasoning' : 'Show reasoning'}
          </button>
        )}
      </div>
      {expanded && (
        <div className="debate-reasoning-list">
          {refs.map((taxRef) => {
            const label = getNodeLabel(taxRef.node_id);
            const { colorVar } = nodeIdToTab(taxRef.node_id);
            return (
              <div key={taxRef.node_id} className="debate-reasoning-item">
                <button
                  className="debate-reasoning-node"
                  style={{ color: colorVar }}
                  onClick={() => inspectNode(taxRef.node_id)}
                >
                  {taxRef.node_id}
                </button>
                <span className="debate-reasoning-label">{label}</span>
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
                  onClick={() => inspectNode(id)}
                >
                  {id}
                </button>
                <span className="debate-reasoning-label">{getPolicyAction(id)}</span>
                <span className="debate-reasoning-text">{relevance ?? 'Policy action referenced by this debater\'s argument'}</span>
              </div>
            );
          })}
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
      {debateProgress && debateProgress.attempt > 1 && (
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
  const inspectNode = useDebateStore((s) => s.inspectNode);
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
        <span className="debate-similar-pov-title">Similar POVs</span>
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
                onClick={() => inspectNode(r.id)}
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
  let prompt = `Explain this section of a debate between Prometheus (an AI Accelerationist), Sentinel (an AI Safetyist) and Cassandra (an AI Skeptic):\n\n`;
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
  api.clipboardWriteText(prompt);
  api.openExternal('https://gemini.google.com/app');
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
        className="debate-entry-action-btn debate-entry-explain-btn"
        onClick={() => handleExplainEntry(entry)}
        title="Explain this entry — copies prompt to clipboard and opens Google Gemini"
      >
        Explain
      </button>
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
        <Markdown remarkPlugins={[remarkGfm]}>{entry.content}</Markdown>
      </div>
    </div>
  );
}

function StatementCard({ entry, statementId, findQuery = '', matchOffset = 0, findCurrentIndex = -1 }: {
  entry: TranscriptEntry; statementId?: string; findQuery?: string; matchOffset?: number; findCurrentIndex?: number;
}) {
  const color = speakerColor(entry.speaker);
  const isPover = entry.speaker !== 'system' && entry.speaker !== 'user';
  const activeDebate = useDebateStore(s => s.activeDebate);
  const defaultTier = useDebateStore(s => s.responseLength);
  const setEntryDisplayTier = useDebateStore(s => s.setEntryDisplayTier);
  const askQuestion = useDebateStore(s => s.askQuestion);
  const debateGenerating = useDebateStore(s => s.debateGenerating);
  const qbafEnabled = useTaxonomyStore(s => s.qbafEnabled);
  const anNodeId = activeDebate?.argument_network?.nodes?.find(
    n => n.source_entry_id === entry.id
  )?.id ?? null;
  const netDelta = (entry.metadata as Record<string, unknown> | undefined)?.qbaf_net_delta as number | undefined;
  const turnSymbols = (entry.metadata as Record<string, unknown> | undefined)?.turn_symbols as { symbol: string; tooltip: string }[] | undefined;

  // Tier display logic (DT-3)
  const hasSummaries = entry.summaries != null;
  const activeTier = entry.display_tier ?? defaultTier;
  const displayContent = hasSummaries && activeTier === 'brief' ? entry.summaries!.brief
    : hasSummaries && activeTier === 'medium' ? entry.summaries!.medium
    : entry.content;
  const showTierPills = hasSummaries && ['opening', 'statement', 'fact-check'].includes(entry.type);

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
            {(['brief', 'medium', 'detailed'] as const).map(tier => (
              <button
                key={tier}
                className={`debate-tier-pill${activeTier === tier ? ' debate-tier-pill-active' : ''}`}
                onClick={(e) => { e.stopPropagation(); setEntryDisplayTier(entry.id, tier); }}
                title={tier === 'brief' ? '2-3 sentences' : tier === 'medium' ? '1-2 paragraphs' : 'Full response'}
              >
                {tier === 'brief' ? 'Brief' : tier === 'medium' ? 'Med' : 'Detail'}
              </button>
            ))}
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
      </div>
      {turnSymbols && turnSymbols.length > 0 && (
        <div className="debate-turn-symbols">
          {turnSymbols.map((s, i) => (
            <span key={i} className="debate-turn-symbol" title={s.tooltip}>
              {s.symbol}
            </span>
          ))}
        </div>
      )}
      <div className="debate-statement-content markdown-body">
        {findQuery
          ? <HighlightedText text={displayContent} query={findQuery} matchOffset={matchOffset} currentIndex={findCurrentIndex} />
          : <Markdown remarkPlugins={[remarkGfm]}>{displayContent}</Markdown>}
      </div>
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
              onClick={(e) => { e.stopPropagation(); askQuestion(`Explore this: ${topic}`); }}
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
      />
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
    const validTargets = (q.targets || []).filter(t => POVER_INFO[t as Exclude<PoverId, 'user'>]);
    if (validTargets.length > 0 && validTargets.length < 3) {
      const mentions = validTargets.map(t => `@${POVER_INFO[t as Exclude<PoverId, 'user'>]?.label}`).join(' ');
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
          const validTargets = (q.targets || []).filter(t => POVER_INFO[t as Exclude<PoverId, 'user'>]);
          const hasTargets = validTargets.length > 0 && validTargets.length < 3;
          return (
            <button
              key={i}
              className="debate-probing-question-btn"
              onClick={() => handleAsk(q)}
              disabled={!!debateGenerating}
              title={[
                q.targets?.length > 0 ? `Directed at: ${q.targets.map((t) => POVER_INFO[t as Exclude<PoverId, 'user'>]?.label || t).join(', ')}` : null,
                q.threatens ? `Threatens: ${q.threatens}` : null,
                q.type ? `Type: ${q.type}` : null,
              ].filter(Boolean).join('\n') || 'Ask this question to all debaters'}
            >
              {hasTargets && validTargets.map(t => {
                const info = POVER_INFO[t as Exclude<PoverId, 'user'>];
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
}: {
  menu: ContextMenuState;
  onClose: () => void;
  onSimilarPovSearch: (query: string) => void;
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
    api.clipboardWriteText(menu.selectedText);
    onClose();
  };

  const handleSearchGoogle = () => {
    const query = encodeURIComponent(menu.selectedText.slice(0, 200));
    api.openExternal(`https://www.google.com/search?q=${query}`);
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
        Similar POVs for &lsquo;{truncatedText}&rsquo;
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
    </div>
  );
}

/** Fact-check result card */
function FactCheckCard({ entry, statementId, findQuery = '', matchOffset = 0, findCurrentIndex = -1 }: {
  entry: TranscriptEntry; statementId?: string; findQuery?: string; matchOffset?: number; findCurrentIndex?: number;
}) {
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
          : <Markdown remarkPlugins={[remarkGfm]}>{entry.content}</Markdown>}
      </div>
      {showWebEvidence && (
        <div className="debate-fact-check-web-evidence">
          <div className="debate-fact-check-web-evidence-header">Web Search Evidence</div>
          <div className="debate-fact-check-web-evidence-body markdown-body">
            {annotatedEvidence ? (
              <div className="debate-fact-check-evidence-text">{annotatedEvidence}</div>
            ) : factCheck?.web_search_evidence ? (
              <Markdown remarkPlugins={[remarkGfm]}>{factCheck.web_search_evidence}</Markdown>
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

/** Clarification phase action bar */
interface StructuredQuestion {
  question: string;
  options: string[];
}

function ClarificationActions() {
  const {
    activeDebate, debateGenerating, debateError,
    runClarification, submitAnswersAndSynthesize, beginDebate,
    initialCrossRespondRounds, setInitialCrossRespondRounds,
  } = useDebateStore(
    useShallow(s => ({
      activeDebate: s.activeDebate, debateGenerating: s.debateGenerating, debateError: s.debateError,
      runClarification: s.runClarification, submitAnswersAndSynthesize: s.submitAnswersAndSynthesize, beginDebate: s.beginDebate,
      initialCrossRespondRounds: s.initialCrossRespondRounds, setInitialCrossRespondRounds: s.setInitialCrossRespondRounds,
    }))
  );
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
  };

  const isGenerating = !!debateGenerating;

  return (
    <div className="debate-action-bar">
      {debateError && <div className="debate-error">{debateError}</div>}

      {!hasClarifications && !isGenerating && (
        <div className="debate-clarification-choice">
          <div className="debate-action-hint">
            Would you like to refine the topic with clarifying questions, or jump straight into the debate?
          </div>
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
                Rounds after openings:
                <select
                  className="debate-turns-select"
                  value={initialCrossRespondRounds}
                  onChange={(e) => setInitialCrossRespondRounds(parseInt(e.target.value, 10))}
                  title="Number of cross-respond rounds to run automatically after opening statements"
                >
                  {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15].map(n => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <div className="debate-clarification-buttons">
            <button
              className="btn btn-primary"
              onClick={() => runClarification()}
            >
              Refine Topic
            </button>
            <button
              className="btn"
              onClick={handleBeginDebate}
            >
              Skip to Debate
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
  const { activeDebate, debateGenerating, debateError, submitUserOpening, runOpeningStatements, openingOrder, setOpeningOrder, initialCrossRespondRounds, setInitialCrossRespondRounds } = useDebateStore(
    useShallow(s => ({ activeDebate: s.activeDebate, debateGenerating: s.debateGenerating, debateError: s.debateError, submitUserOpening: s.submitUserOpening, runOpeningStatements: s.runOpeningStatements, openingOrder: s.openingOrder, setOpeningOrder: s.setOpeningOrder, initialCrossRespondRounds: s.initialCrossRespondRounds, setInitialCrossRespondRounds: s.setInitialCrossRespondRounds }))
  );
  const [statement, setStatement] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (!activeDebate) return null;

  const isGenerating = !!debateGenerating;
  const userIsPover = activeDebate.user_is_pover;
  const hasAnyOpening = activeDebate.transcript.some((e) => e.type === 'opening');
  const hasUserOpening = activeDebate.transcript.some(
    (e) => e.type === 'opening' && e.speaker === 'user',
  );

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

  // Before any openings have started — let user pick length, order, and start
  if (!hasAnyOpening && !isGenerating) {
    return (
      <div className="debate-action-bar">
        {debateError && <div className="debate-error">{debateError}</div>}
        <div className="debate-action-hint">Set order and depth for opening statements, then begin.</div>
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
                        title="Move up"
                      >&#9650;</button>
                      <button
                        className="debate-opening-order-btn"
                        onClick={() => moveDown(idx)}
                        disabled={idx === openingOrder.length - 1}
                        title="Move down"
                      >&#9660;</button>
                    </span>
                  </li>
                );
              })}
            </ol>
          </div>
        )}
        <div className="debate-initial-rounds">
          <label className="debate-initial-rounds-label">
            Cross-respond rounds after openings:
            <select
              className="debate-turns-select"
              value={initialCrossRespondRounds}
              onChange={(e) => setInitialCrossRespondRounds(parseInt(e.target.value, 10))}
              title="Number of cross-respond rounds to run automatically after opening statements"
            >
              {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15].map(n => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="debate-action-bar-inner">
          <button className="btn btn-primary" onClick={() => runOpeningStatements()}>
            Begin Opening Statements
          </button>
        </div>
      </div>
    );
  }

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

  // Opening phase complete but phase not yet transitioned (shouldn't happen normally)
  return (
    <div className="debate-action-bar">
      <div className="debate-action-hint">Opening statements complete.</div>
    </div>
  );
}

/** Main debate phase action bar */
const AI_MENTION_OPTIONS: { id: string; label: string; color: string }[] = [
  { id: 'prometheus', label: 'Prometheus', color: POVER_INFO.prometheus.color },
  { id: 'sentinel', label: 'Sentinel', color: POVER_INFO.sentinel.color },
  { id: 'cassandra', label: 'Cassandra', color: POVER_INFO.cassandra.color },
];

function DebaterToggles() {
  const { activeDebate, togglePover, debateGenerating } = useDebateStore(
    useShallow(s => ({ activeDebate: s.activeDebate, togglePover: s.togglePover, debateGenerating: s.debateGenerating }))
  );
  if (!activeDebate) return null;

  const allPovers = AI_POVERS;
  const isActive = (p: PoverId) => activeDebate.active_povers.includes(p);
  const disabled = !!debateGenerating;

  return (
    <div className="debate-debater-toggles">
      <span className="debate-debater-toggles-label">Debaters:</span>
      {allPovers.map(p => {
        const info = POVER_INFO[p];
        const active = isActive(p);
        return (
          <button
            key={p}
            className={`debate-debater-pill ${active ? 'debate-debater-pill-active' : 'debate-debater-pill-inactive'}`}
            style={active ? { borderColor: info.color, color: info.color } : undefined}
            onClick={() => togglePover(p)}
            disabled={disabled}
            title={active ? `Remove ${info.label} from debate` : `Add ${info.label} to debate`}
          >
            {info.label}
          </button>
        );
      })}
    </div>
  );
}

function DebateActions() {
  const { activeDebate, debateGenerating, debateError, askQuestion, crossRespond, requestSynthesis, requestProbingQuestions, requestReflections, audience, setAudience } = useDebateStore(
    useShallow(s => ({ activeDebate: s.activeDebate, debateGenerating: s.debateGenerating, debateError: s.debateError, askQuestion: s.askQuestion, crossRespond: s.crossRespond, requestSynthesis: s.requestSynthesis, requestProbingQuestions: s.requestProbingQuestions, requestReflections: s.requestReflections, audience: s.audience, setAudience: s.setAudience }))
  );
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [showHarvest, setShowHarvest] = useState(false);
  const [showReflections, setShowReflections] = useState(false);
  const [crossRespondTurns, setCrossRespondTurns] = useState(1);
  const inputRef = useRef<HTMLInputElement>(null);
  const hasSynthesis = activeDebate?.transcript.some(e => e.type === 'synthesis') || false;
  const isAdaptive = (activeDebate as any)?.adaptive_staging?.enabled ?? false;
  const adaptivePhase: AdaptivePhase | null = isAdaptive ? ((activeDebate as any).adaptive_staging?.current_phase ?? null) : null;
  const approachingTransition = isAdaptive ? ((activeDebate as any).adaptive_staging?.approaching_transition ?? false) : false;

  if (!activeDebate) return null;

  const isGenerating = !!debateGenerating;
  const disabled = isGenerating || sending || activeDebate.phase === 'closed';

  // Filter mention options to active AI povers
  const mentionOptions = AI_MENTION_OPTIONS.filter(o => activeDebate.active_povers.includes(o.id as PoverId));

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
    if (!input.trim() || disabled) return;
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
      handleSend();
    }
  };

  const handleCrossRespond = async () => {
    if (disabled) return;
    setSending(true);
    for (let i = 0; i < crossRespondTurns; i++) {
      await crossRespond();
      // Check if debate is still active (user might have closed it)
      if (!useDebateStore.getState().activeDebate) break;
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
            placeholder="Ask a question (@Sentinel to target)..."
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            onBlur={() => setTimeout(() => setMentionOpen(false), 150)}
            disabled={disabled}
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
          disabled={!input.trim() || disabled}
        >
          Send
        </button>
        {isAdaptive ? (
          /* Adaptive mode: single "Continue" button that lets the engine decide */
          <button
            className="btn debate-continue-btn"
            onClick={handleCrossRespond}
            disabled={disabled}
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
              disabled={disabled}
              title={`Run ${crossRespondTurns} cross-respond round${crossRespondTurns > 1 ? 's' : ''}`}
              style={{ borderTopRightRadius: 0, borderBottomRightRadius: 0 }}
            >
              Cross-Respond
            </button>
            <select
              className="debate-turns-select"
              value={crossRespondTurns}
              onChange={(e) => setCrossRespondTurns(parseInt(e.target.value, 10))}
              disabled={disabled}
              title="Number of cross-respond rounds"
            >
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].map(n => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </div>
        )}
      </div>
      {/* Row 2: Phase overrides (adaptive) + Analysis actions + Audience */}
      <div className="debate-action-bar-secondary">
        {/* Phase override buttons hidden until store actions are implemented.
            See code review UX1 — requires phaseTransitions.ts veto/force API. */}
        <button
          className="btn debate-synthesis-btn"
          onClick={() => requestSynthesis()}
          disabled={disabled}
          title="Generate a synthesis of agreements, disagreements, and open questions"
        >
          Synthesize
        </button>
        <button
          className="btn debate-probe-btn"
          onClick={() => requestProbingQuestions()}
          disabled={disabled}
          title="Get AI-suggested probing questions to deepen the debate"
        >
          Probe
        </button>
        <button
          className="btn debate-harvest-btn"
          onClick={() => setShowHarvest(true)}
          disabled={disabled || !hasSynthesis}
          title="Harvest debate findings into the taxonomy"
        >
          Harvest
        </button>
        <button
          className="btn debate-reflections-btn"
          onClick={() => { setShowReflections(true); requestReflections(); }}
          disabled={disabled}
          title="Each debater reflects on the debate and proposes taxonomy edits"
        >
          Reflections
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

export function DebateWorkspace({ onExport, exportStatus }: {
  onExport?: (format: string) => void;
  exportStatus?: string | null;
} = {}) {
  const {
    activeDebate, debateLoading, debateError, debateGenerating,
    runClarification, runOpeningStatements, saveDebate, compressOldTranscript,
    diagnosticsEnabled, toggleDiagnostics, selectedDiagEntry, selectDiagEntry,
    diagPopoutOpen, setDiagPopoutOpen,
  } = useDebateStore(
    useShallow(s => ({
      activeDebate: s.activeDebate, debateLoading: s.debateLoading, debateError: s.debateError, debateGenerating: s.debateGenerating,
      runClarification: s.runClarification, runOpeningStatements: s.runOpeningStatements, saveDebate: s.saveDebate, compressOldTranscript: s.compressOldTranscript,
      diagnosticsEnabled: s.diagnosticsEnabled, toggleDiagnostics: s.toggleDiagnostics, selectedDiagEntry: s.selectedDiagEntry, selectDiagEntry: s.selectDiagEntry,
      diagPopoutOpen: s.diagPopoutOpen, setDiagPopoutOpen: s.setDiagPopoutOpen,
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
  const hasTriggeredOpening = useRef(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [showCCDetails, setShowCCDetails] = useState(false);
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSimilarPovSearch = useCallback((query: string) => {
    setStoreFindQuery(query);
    setStoreFindMode('semantic');
    setToolbarPanel('search');
    runSemanticSearch(query, new Set(), new Set());
  }, [runSemanticSearch, setStoreFindQuery, setStoreFindMode, setToolbarPanel]);

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
    } catch {
      return null;
    }
  }, [activeDebate?.argument_network?.nodes, activeDebate?.document_analysis?.i_nodes]);

  const strengthWeighted = useMemo<StrengthWeightedCoverage | null>(() => {
    if (!coverageMap || !activeDebate?.argument_network) return null;
    const { nodes, edges } = activeDebate.argument_network;
    if (nodes.length === 0) return null;
    try {
      return computeStrengthWeightedCoverage(coverageMap, nodes, edges);
    } catch {
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
      saveDebate();
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
        compressOldTranscript();
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

    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      selectedText,
      entryId,
      isPoverStatement,
    });
  }, []);

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
  const isDebatePhase = activeDebate.phase === 'debate';
  const isCrossCutting = activeDebate.source_type === 'situations';

  return (
    <div className="debate-workspace">
      {/* Fixed toolbar — always visible */}
      <div className="debate-toolbar">
        <button
          className={`btn btn-sm debate-diag-btn${diagnosticsEnabled ? ' active' : ''}`}
          onClick={toggleDiagnostics}
          title={diagnosticsEnabled ? 'Disable diagnostics mode' : 'Enable diagnostics mode — click entries to inspect'}
        >
          {diagnosticsEnabled ? 'Diagnostics ON' : 'Diagnostics'}
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
        {exportStatus && (
          <span className="debate-toolbar-status">{exportStatus}</span>
        )}
        {onExport && (
          <ExportButtonInline onExport={onExport} />
        )}
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
        <div className="debate-topic-info">
          <span className="debate-phase-indicator">
            {PHASE_TITLES[activeDebate.phase] || activeDebate.phase}
          </span>
          <span className="debate-topic-text">{activeDebate.topic.final}</span>
          <span className="debate-timestamp" title={activeDebate.created_at}>
            {new Date(activeDebate.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}{' '}
            {new Date(activeDebate.created_at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
          </span>
          {activeDebate.audience && (
            <span className="debate-audience-badge">
              {DEBATE_AUDIENCES.find(a => a.id === activeDebate.audience)?.label ?? activeDebate.audience}
            </span>
          )}
          {coverageMap && <CoverageBadge coverageMap={coverageMap} strengthWeighted={strengthWeighted} />}
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
              currentPhase={staging.current_phase || 'thesis-antithesis'}
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

        {/* Refined topic editor (shown after synthesis, only during clarification) */}
        {activeDebate.topic.refined && activeDebate.phase === 'clarification' && (
          <RefinedTopicEditor />
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
          const card = entry.type === 'probing'
            ? <ProbingCard key={entry.id} entry={entry} statementId={statementId} />
            : entry.type === 'fact-check'
            ? <FactCheckCard key={entry.id} entry={entry} statementId={statementId} findQuery={findQuery} matchOffset={matchOffset} findCurrentIndex={findCurrentIndex} />
            : <StatementCard key={entry.id} entry={entry} statementId={statementId} findQuery={findQuery} matchOffset={matchOffset} findCurrentIndex={findCurrentIndex} />;
          return (
            <div
              key={entry.id}
              className={`debate-entry-wrapper${diagnosticsEnabled && selectedDiagEntry === entry.id ? ' diag-selected' : ''}`}
              onClick={diagnosticsEnabled ? () => selectDiagEntry(entry.id) : undefined}
            >
              {card}
              <EntryDeleteControls entry={entry} totalEntries={activeDebate.transcript.length} entryIndex={idx} />
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
      {isClarificationPhase && <ClarificationActions />}
      {isEditClaimsPhase && <ClaimsEditor />}
      {isOpeningPhase && <OpeningActions />}

      {isDebatePhase && <DebateActions />}

      {/* Neutral evaluation panel — shown when evaluations exist */}
      {activeDebate.neutral_evaluations && activeDebate.neutral_evaluations.length > 0 && (
        <NeutralEvaluationPanel
          evaluations={activeDebate.neutral_evaluations}
          speakerMapping={activeDebate.neutral_speaker_mapping}
        />
      )}

      {/* Diagnostics always uses popup window — no inline panel */}

      {/* Phase 7: Context menu */}
      {contextMenu && (
        <DebateContextMenu
          menu={contextMenu}
          onClose={() => setContextMenu(null)}
          onSimilarPovSearch={handleSimilarPovSearch}
        />
      )}
    </div>
  );
}
