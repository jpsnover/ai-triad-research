// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useRef, useEffect, useCallback, useMemo, Fragment } from 'react';
import { api } from '@bridge';
import { useDebateStore } from '../../hooks/useDebateStore';
import { useShallow } from 'zustand/react/shallow';
import { useTaxonomyStore } from '../../hooks/useTaxonomyStore';
import { DEBATE_AUDIENCES } from '../../types/debate';
import type { SpeakerId } from '../../types/debate';
import { DebateSourceViewer } from '../debate/DebateSourceViewer';
import { NeutralEvaluationPanel } from '../analysis/NeutralEvaluationPanel';
import { ParameterHistoryPanel } from '../analysis/ParameterHistoryPanel';
import { computeCoverageMap, computeStrengthWeightedCoverage } from '@lib/debate/coverageTracker';
import type { CoverageMap, StrengthWeightedCoverage } from '@lib/debate/coverageTracker';
import {
  speakerLabel, speakerColor, nodeIdToTab, focusMainWindowNode, countOccurrences, renderedOffsetOf,
  META_TIERS, TIER_LABELS,
} from './utils';
import type { AdaptivePhase } from './utils';
import { CommentCreationPopover } from '../chat/CommentCreationPopover';
import type { CommentPopoverState } from '../chat/CommentCreationPopover';
import { CommentSidebar } from '../chat/CommentSidebar';
import { DetailPane } from '../shared/DetailPane';
import { useCommentStore } from '../../hooks/useCommentStore';
import type { DetailTier } from '@lib/debate/comments';
import { UsernamePromptDialog } from '../shared/UsernamePromptDialog';
import { DiagnosticsChatSidebar } from '../debate-diagnostics/chat';
import type { NavigateCommand } from '../debate-diagnostics/chat';
import { getGlobalRecorder } from '@lib/flight-recorder/index';
import { initDebatePopoutCloseHandler } from '../../hooks/useDebateStore/shared/guards';
import { useCommunityStore } from '../../hooks/useCommunityStore';
import { useUserProfile } from '../../hooks/useAuthStatus';
import { CommunityShareBanner } from '../shared/CommunityShareBanner';
import { CoverageBadge } from './TaxonomyRefs';
import { StatementCard, ProbingCard, FactCheckCard, EntryDeleteControls, HighlightedText, PhaseHairline } from './StatementCard';
import { PhaseProgressBar, SessionPhaseStepper, UnifiedPhaseIndicator, DebaterToggles, DebateActions } from './DebateActionBar';
import { useFlag } from '../../hooks/useFeatureFlags';
import { StatementProgressIndicator } from './StatementProgressIndicator';
import { ClarificationActions, ClaimsEditor, RefinedTopicEditor, TopicScoreComparison } from './ClarificationPanel';
import { OpeningActions } from './OpeningPanel';
import { ExplorationSummaryCard } from './ExplorationSummaryCard';
import { EmptyState } from '../shared/EmptyState';
import './DebateWorkspace.css';

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

function ShareToCommunityButton({ debate }: { debate: { id: string; topic: string; transcript: unknown[] } }) {
  const [shareState, setShareState] = useState<'idle' | 'sharing' | 'success' | 'error'>('idle');
  const [shareError, setShareError] = useState<string | null>(null);
  const submitItem = useCommunityStore(s => s.submitItem);
  const communityUrl = useTaxonomyStore(s => s.communityServerUrl);
  const profile = useUserProfile();

  const handleShare = async () => {
    setShareState('sharing');
    setShareError(null);
    try {
      const submissionId = await submitItem('debate', debate);
      setShareState('success');
      getGlobalRecorder()?.record({
        type: 'lifecycle',
        component: 'debate-workspace',
        level: 'info',
        message: 'community.submit.ok',
        data: { debateId: debate.id, submissionId },
      });
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'debate-workspace',
        level: 'error',
        message: 'Failed to submit debate to community',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
      const raw = (err as Error).message;
      const reason = raw.replace(/^(Error:\s*)+/i, '').replace(/^Error invoking remote method '[^']+': /i, '');
      setShareError(reason || 'Unknown error');
      setShareState('error');
      setTimeout(() => { setShareState('idle'); setShareError(null); }, 4000);
    }
  };

  const configured = !isElectronLike() || !!communityUrl;

  return (
    <span style={{ position: 'relative', display: 'inline-block' }}>
      <button
        className="btn btn-sm"
        onClick={handleShare}
        disabled={shareState !== 'idle' || !configured}
        title={!configured ? 'Set Community Server URL in Settings first' : 'Submit this debate for community review'}
      >
        {shareState === 'sharing' ? 'Sharing...' : 'Share'}
      </button>
      {shareState === 'success' && (
        <CommunityShareBanner
          itemType="debate"
          onDismiss={() => setShareState('idle')}
        />
      )}
      {shareState === 'error' && shareError && (
        <span
          className="debate-toolbar-status"
          style={{ color: 'var(--red, #ef4444)', marginLeft: 4, fontSize: '0.75rem' }}
          title={shareError}
        >
          {'Failed: ' + shareError}
        </span>
      )}
    </span>
  );
}

function isElectronLike(): boolean {
  return typeof window !== 'undefined' && 'electronAPI' in window;
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

// ── Find bar ─────────────────────────────────────────────

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

// ── Context menu ─────────────────────────────────────────

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

// ── Extracted render regions (ADR-007 verbatim line-slice, t/1876) ───────
// The blocks below were lifted verbatim out of DebateWorkspace's render tree to
// drop its cyclomatic complexity; each guard is preserved exactly (moved inside
// the region where that removes a parent decision point). No behavioral change.

type DWStore = ReturnType<typeof useDebateStore.getState>;
type CommentStoreState = ReturnType<typeof useCommentStore.getState>;
type ActiveDebateSession = NonNullable<DWStore['activeDebate']>;
type ActiveTranscriptEntry = ActiveDebateSession['transcript'][number];

type GlobalTextTier = 'brief' | 'medium' | 'detailed';
type GlobalAnalysisTier = 'reasoning' | 'claims' | 'convergence';
const GLOBAL_TEXT_TIERS: GlobalTextTier[] = ['brief', 'medium', 'detailed'];
const GLOBAL_ANALYSIS_TIERS: GlobalAnalysisTier[] = ['reasoning', 'claims', 'convergence'];
const GLOBAL_TIER_TITLES: Record<string, string> = {
  brief: 'Set all turns to brief (2–3 sentences)', medium: 'Set all turns to medium (key points)',
  detailed: 'Set all turns to full content', reasoning: 'Show brief, plan & BDI (replaces text)',
  claims: 'Show argument network claims', convergence: 'Show convergence diagnostics',
};
const GLOBAL_MODE_IDS = [{ id: 'text', label: 'Text' }, { id: 'analysis', label: 'Analysis' }] as const;

function GlobalModeControl({ defaultTier, setDefaultTier }: {
  defaultTier: DWStore['responseLength'];
  setDefaultTier: DWStore['setResponseLength'];
}) {
  const activeMode = META_TIERS.has(defaultTier) ? 'analysis' : 'text';
  const [lastText, setLastText] = useState<GlobalTextTier>(
    activeMode === 'text' ? (defaultTier as GlobalTextTier) : 'detailed'
  );
  const [lastAnalysis, setLastAnalysis] = useState<GlobalAnalysisTier>(
    activeMode === 'analysis' ? (defaultTier as GlobalAnalysisTier) : 'reasoning'
  );

  useEffect(() => {
    if (META_TIERS.has(defaultTier)) setLastAnalysis(defaultTier as GlobalAnalysisTier);
    else setLastText(defaultTier as GlobalTextTier);
  }, [defaultTier]);

  const subTiers = activeMode === 'text' ? GLOBAL_TEXT_TIERS : GLOBAL_ANALYSIS_TIERS;
  const modeRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const subRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const handleModeSelect = useCallback((mode: 'text' | 'analysis') => {
    if (mode === activeMode) return;
    setDefaultTier(mode === 'text' ? lastText : lastAnalysis);
  }, [activeMode, lastText, lastAnalysis, setDefaultTier]);

  const handleSubSelect = useCallback((tier: string) => {
    setDefaultTier(tier as GlobalTextTier | GlobalAnalysisTier);
    if (activeMode === 'text') setLastText(tier as GlobalTextTier);
    else setLastAnalysis(tier as GlobalAnalysisTier);
  }, [activeMode, setDefaultTier]);

  const handleModeKey = useCallback((e: { key: string; preventDefault(): void }, idx: number) => {
    let next = idx;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (idx + 1) % 2;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (idx - 1 + 2) % 2;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = 1;
    else return;
    e.preventDefault();
    handleModeSelect(GLOBAL_MODE_IDS[next].id);
    requestAnimationFrame(() => modeRefs.current[next]?.focus());
  }, [handleModeSelect]);

  const handleSubKey = useCallback((e: { key: string; preventDefault(): void }, idx: number) => {
    const len = subTiers.length;
    let next = idx;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (idx + 1) % len;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (idx - 1 + len) % len;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = len - 1;
    else return;
    e.preventDefault();
    handleSubSelect(subTiers[next]);
    requestAnimationFrame(() => subRefs.current[next]?.focus());
  }, [subTiers, handleSubSelect]);

  return (
    <span className="debate-tier-global" style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center' }}>
      <span role="radiogroup" aria-label="View mode" className="debate-mode-group">
        {GLOBAL_MODE_IDS.map(({ id, label }, i) => (
          <button
            key={id}
            ref={el => { modeRefs.current[i] = el; }}
            type="button"
            role="radio"
            aria-checked={activeMode === id}
            tabIndex={activeMode === id ? 0 : -1}
            className={`debate-mode-seg${activeMode === id ? ' debate-mode-seg-active' : ''}`}
            onClick={() => handleModeSelect(id)}
            onKeyDown={(e) => handleModeKey(e, i)}
          >
            {label}
          </button>
        ))}
      </span>
      <span className="debate-mode-separator" aria-hidden="true" />
      <span
        role="radiogroup"
        aria-label={activeMode === 'text' ? 'Text detail level' : 'Analysis view'}
        className="debate-mode-group"
      >
        {subTiers.map((tier, i) => {
          const isActive = defaultTier === tier;
          return (
            <button
              key={tier}
              ref={el => { subRefs.current[i] = el; }}
              type="button"
              role="radio"
              aria-checked={isActive}
              tabIndex={isActive ? 0 : -1}
              className={`debate-mode-seg${isActive ? ' debate-mode-seg-active' : ''}`}
              onClick={() => handleSubSelect(tier)}
              onKeyDown={(e) => handleSubKey(e, i)}
              title={GLOBAL_TIER_TITLES[tier]}
            >
              {TIER_LABELS[tier]}
            </button>
          );
        })}
      </span>
    </span>
  );
}

function DebateToolbar({
  activeDebate, isExploration, isCrossCutting, onShowCCDetails,
  commentSidebarOpen, toggleCommentSidebar, commentsFile,
  exportStatus, onExport, diagnosticsEnabled, toggleDiagnostics,
  defaultTier, setDefaultTier,
}: {
  activeDebate: ActiveDebateSession;
  isExploration: boolean;
  isCrossCutting: boolean;
  onShowCCDetails: () => void;
  commentSidebarOpen: boolean;
  toggleCommentSidebar: () => void;
  commentsFile: CommentStoreState['commentsFile'];
  exportStatus?: string | null;
  onExport?: (format: string) => void;
  diagnosticsEnabled: boolean;
  toggleDiagnostics: () => void;
  defaultTier: DWStore['responseLength'];
  setDefaultTier: DWStore['setResponseLength'];
}) {
  return (
    <div className="debate-toolbar">
      <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-primary)', userSelect: 'all', marginRight: 8, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 300 }} title={`${activeDebate.title} — ${activeDebate.id}`}>
        {activeDebate.title || activeDebate.id.slice(0, 12)}
      </span>
      {isExploration && (
        <span className="debate-exploration-badge" title="Exploration run — quick discovery with a cheap model">
          Exploration
        </span>
      )}
      {isCrossCutting && (
        <button
          className="btn btn-sm debate-cc-details-btn"
          onClick={onShowCCDetails}
          title="View situation context used for this debate"
        >
          Details
        </button>
      )}
      <button
        className={`btn btn-sm${commentSidebarOpen ? ' active' : ''}`}
        onClick={toggleCommentSidebar}
        title={commentSidebarOpen ? 'Hide comments sidebar' : 'Show comments sidebar'}
      >
        Comments ({commentsFile?.comments?.length ?? 0})
      </button>
      {exportStatus && (
        <span className="debate-toolbar-status">{exportStatus}</span>
      )}
      {onExport && (
        <ExportButtonInline onExport={onExport} />
      )}
      <ShareToCommunityButton debate={activeDebate as unknown as { id: string; topic: string; transcript: unknown[] }} />
      <button
        className={`btn btn-sm debate-diag-btn${diagnosticsEnabled ? ' active' : ''}`}
        onClick={toggleDiagnostics}
        title={diagnosticsEnabled ? 'Disable diagnostics mode' : 'Enable diagnostics mode — click entries to inspect'}
      >
        {diagnosticsEnabled ? 'Diagnostics ON' : 'Diagnostics'}
      </button>
      <GlobalModeControl defaultTier={defaultTier} setDefaultTier={setDefaultTier} />
    </div>
  );
}

function CrossCuttingDialog({ activeDebate, show, onClose }: {
  activeDebate: ActiveDebateSession;
  show: boolean;
  onClose: () => void;
}) {
  if (!show || !activeDebate.source_content) return null;
  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog debate-cc-details-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="debate-cc-details-header">
          <h3>Cross-Cutting Context</h3>
          {activeDebate.source_ref && (
            <span className="debate-source-ref">{activeDebate.source_ref}</span>
          )}
          <button className="debate-inspect-close" onClick={onClose} title="Close" aria-label="Close">&times;</button>
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
  );
}

function RemoteDriverOverlay({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <div className="debate-remote-overlay" style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
      padding: '12px 16px', margin: '0 8px 8px',
      background: 'var(--warning-bg, rgba(234,179,8,0.12))',
      border: '1px solid var(--warning-border, rgba(234,179,8,0.3))',
      borderRadius: 6, fontSize: '0.85rem', color: 'var(--text-primary)',
    }}>
      <span style={{ fontSize: '1.1rem' }}>&#8599;</span>
      <span>Debate running in popout window. Controls are disabled here until the popout is closed.</span>
    </div>
  );
}

function DebateTopicInfo({ activeDebate, coverageMap, strengthWeighted }: {
  activeDebate: ActiveDebateSession;
  coverageMap: CoverageMap | null;
  strengthWeighted: StrengthWeightedCoverage | null;
}) {
  return (
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
        <code style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)', userSelect: 'all', cursor: 'text' }} title="Debate ID — click to select">{activeDebate.id}</code>
        {coverageMap && <CoverageBadge coverageMap={coverageMap} strengthWeighted={strengthWeighted} />}
      </div>
      <span className="debate-topic-text">{activeDebate.topic.final}</span>
    </div>
  );
}

function DebatePhaseHeader({ activeDebate, isDebatePhase, isOpeningPhase }: {
  activeDebate: ActiveDebateSession;
  isDebatePhase: boolean;
  isOpeningPhase: boolean;
}) {
  const chatRedesign = useFlag('DEBATE_CHAT_REDESIGN');
  const staging = (activeDebate as any).adaptive_staging as {
    enabled: boolean;
    current_phase: AdaptivePhase;
    phase_progress: number;
    rounds_in_phase: number;
    approaching_transition: boolean;
    rationale?: string;
  } | undefined;
  const showSessionPhase = activeDebate.phase !== 'setup' && activeDebate.phase !== 'closed';
  const showAdaptivePhase = isDebatePhase && activeDebate.phase !== 'closed' && !!staging?.enabled;
  const roundCount = activeDebate.transcript.filter(e => e.type === 'statement' || e.type === 'opening').length;

  return (
    <>
      {chatRedesign ? (
        /* Unified indicator (t/2238): session stepper with the adaptive sub-phase nested in the Debate step. */
        showSessionPhase && (
          <UnifiedPhaseIndicator
            phase={activeDebate.phase}
            roundCount={roundCount}
            adaptive={showAdaptivePhase && staging ? {
              currentPhase: staging.current_phase || 'confrontation',
              phaseProgress: staging.phase_progress || 0,
              roundsInPhase: staging.rounds_in_phase || 0,
              approachingTransition: staging.approaching_transition || false,
              rationale: staging.rationale,
            } : undefined}
          />
        )
      ) : (
        <>
          {/* Session phase stepper — always visible once debate has started */}
          {showSessionPhase && (
            <SessionPhaseStepper
              phase={activeDebate.phase}
              roundCount={roundCount}
            />
          )}

          {/* Adaptive phase progress bar — shown during debate phase when adaptive staging is enabled */}
          {showAdaptivePhase && staging && (
            <PhaseProgressBar
              currentPhase={staging.current_phase || 'confrontation'}
              phaseProgress={staging.phase_progress || 0}
              roundsInPhase={staging.rounds_in_phase || 0}
              approachingTransition={staging.approaching_transition || false}
              rationale={staging.rationale}
            />
          )}
        </>
      )}

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
    </>
  );
}

function isOpeningStart(type: string, prevType: string | null): boolean {
  return type === 'opening' && prevType !== 'opening';
}

function isDebateStart(type: string, prevType: string | null): boolean {
  return (type === 'statement' || type === 'cross_respond') && prevType !== 'statement' && prevType !== 'cross_respond' && prevType !== 'probing' && prevType !== 'fact-check' && prevType !== 'system' && prevType !== 'question';
}

function isSynthesisStart(type: string, prevType: string | null): boolean {
  return (type === 'synthesis' || type === 'concluding') && prevType !== 'synthesis' && prevType !== 'concluding';
}

/** Phase-transition hairline for a transcript position, or null. Extracted verbatim (t/1876). */
function computeTranscriptHairline(entry: ActiveTranscriptEntry, idx: number, transcript: ActiveTranscriptEntry[]): React.ReactNode {
  let prevVisibleIdx = -1;
  for (let i = idx - 1; i >= 0; i--) {
    if (transcript[i].type !== 'clarification') { prevVisibleIdx = i; break; }
  }
  const prevType: string | null = prevVisibleIdx >= 0 ? transcript[prevVisibleIdx].type : null;
  const type = entry.type as string;
  if (isOpeningStart(type, prevType)) {
    return <PhaseHairline key={`hairline-opening-${idx}`} label="Opening Statements" />;
  }
  if (isDebateStart(type, prevType)) {
    return <PhaseHairline key={`hairline-debate-${idx}`} label="Cross-Examination" />;
  }
  if (isSynthesisStart(type, prevType)) {
    return <PhaseHairline key={`hairline-synthesis-${idx}`} label="Synthesis" />;
  }
  return null;
}

function TranscriptEntryRow({
  entry, idx, activeDebate, findOffsets, findQuery, findCurrentIndex,
  diagnosticsEnabled, selectedDiagEntry, selectDiagEntry,
}: {
  entry: ActiveTranscriptEntry;
  idx: number;
  activeDebate: ActiveDebateSession;
  findOffsets: Map<string, number>;
  findQuery: string;
  findCurrentIndex: number;
  diagnosticsEnabled: boolean;
  selectedDiagEntry: DWStore['selectedDiagEntry'];
  selectDiagEntry: DWStore['selectDiagEntry'];
}) {
  const matchOffset = findOffsets.get(entry.id) ?? 0;
  // Statement ID — stable human-readable label for this transcript position.
  // Matches ClaimExtractionTrace.round (transcript index + 1) so cross-panel
  // references line up (e.g. Extraction Timeline "S12" == this card's "S12").
  const statementId = `S${idx + 1}`;
  // Skip the clarification transcript card — the interactive ClarificationActions panel
  // below the transcript already shows the questions as clickable pills.
  if (entry.type === 'clarification') return null;

  const hairline = computeTranscriptHairline(entry, idx, activeDebate.transcript);

  const isStatement = entry.type !== 'probing' && entry.type !== 'fact-check';
  const card = entry.type === 'probing'
    ? <ProbingCard key={entry.id} entry={entry} statementId={statementId} />
    : entry.type === 'fact-check'
    ? <FactCheckCard key={entry.id} entry={entry} statementId={statementId} findQuery={findQuery} matchOffset={matchOffset} findCurrentIndex={findCurrentIndex} />
    : <StatementCard key={entry.id} entry={entry} statementId={statementId} findQuery={findQuery} matchOffset={matchOffset} findCurrentIndex={findCurrentIndex} entryIndex={idx} totalEntries={activeDebate.transcript.length} />;
  return (
    <Fragment>
      {hairline}
      <div
        className={`debate-entry-wrapper${diagnosticsEnabled && selectedDiagEntry === entry.id ? ' diag-selected' : ''}`}
        onClick={diagnosticsEnabled ? () => selectDiagEntry(entry.id) : undefined}
      >
        {card}
        {!isStatement && <EntryDeleteControls entry={entry} totalEntries={activeDebate.transcript.length} entryIndex={idx} />}
      </div>
    </Fragment>
  );
}

function DebateTranscriptColumn({
  activeDebate, debateGenerating, findOffsets, findQuery, findCurrentIndex,
  diagnosticsEnabled, selectedDiagEntry, selectDiagEntry, transcriptEndRef,
}: {
  activeDebate: ActiveDebateSession;
  debateGenerating: DWStore['debateGenerating'];
  findOffsets: Map<string, number>;
  findQuery: string;
  findCurrentIndex: number;
  diagnosticsEnabled: boolean;
  selectedDiagEntry: DWStore['selectedDiagEntry'];
  selectDiagEntry: DWStore['selectDiagEntry'];
  transcriptEndRef: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <>
      {/* Transcript */}
      <div className="debate-transcript-column">
      {activeDebate.transcript.length === 0 && !debateGenerating && (
        <EmptyState
          headline="The debate is ready to begin"
          direction="Clarification questions will appear here."
        />
      )}
      {activeDebate.transcript.map((entry, idx) => (
        <TranscriptEntryRow
          key={entry.id}
          entry={entry}
          idx={idx}
          activeDebate={activeDebate}
          findOffsets={findOffsets}
          findQuery={findQuery}
          findCurrentIndex={findCurrentIndex}
          diagnosticsEnabled={diagnosticsEnabled}
          selectedDiagEntry={selectedDiagEntry}
          selectDiagEntry={selectDiagEntry}
        />
      ))}
      </div>
      {debateGenerating && (
        <div className="debate-statement debate-generating">
          <div className="debate-statement-header">
            <span className="debate-statement-speaker" style={{ color: speakerColor(debateGenerating) || undefined }}>
              {speakerLabel(debateGenerating)}
            </span>
            <span className="debate-statement-type">thinking...</span>
          </div>
          <StatementProgressIndicator />
        </div>
      )}
      <div ref={transcriptEndRef} />
    </>
  );
}

function RerunInsightsSlot({ isExploration, activeDebate, explorationSummary, extractAndSeedFromDebate }: {
  isExploration: boolean;
  activeDebate: ActiveDebateSession;
  explorationSummary: DWStore['explorationSummary'];
  extractAndSeedFromDebate: DWStore['extractAndSeedFromDebate'];
}) {
  if (isExploration || activeDebate.phase !== 'closed' || explorationSummary) return null;
  return (
    <div className="debate-rerun-insights">
      <button
        className="btn btn-explore"
        onClick={() => void extractAndSeedFromDebate(activeDebate.id)}
        title="Extract insights from this debate and use them to seed a new, better debate"
      >
        Rerun with Insights
      </button>
    </div>
  );
}

function PhaseActionBar({
  showRemoteOverlay, activeDebate, isClarificationPhase, isEditClaimsPhase, isOpeningPhase, isDebatePhase, isExplorationClosed,
  showParamHistory, setShowParamHistory, showEvaluation, setShowEvaluation,
}: {
  showRemoteOverlay: boolean;
  activeDebate: ActiveDebateSession;
  isClarificationPhase: boolean;
  isEditClaimsPhase: boolean;
  isOpeningPhase: boolean;
  isDebatePhase: boolean;
  isExplorationClosed: boolean;
  showParamHistory: boolean;
  setShowParamHistory: React.Dispatch<React.SetStateAction<boolean>>;
  showEvaluation: boolean;
  setShowEvaluation: React.Dispatch<React.SetStateAction<boolean>>;
}) {
  // Phase-aware action bar (fixed at bottom) — hidden when popout is driving
  if (showRemoteOverlay) return null;
  return (
    <>
      {isClarificationPhase && !activeDebate.transcript.some(e => e.type === 'opening' || e.type === 'statement') && <ClarificationActions />}
      {isEditClaimsPhase && <ClaimsEditor />}
      {isOpeningPhase && <OpeningActions />}
      {isDebatePhase && !isExplorationClosed && <DebateActions showParamHistory={showParamHistory} setShowParamHistory={setShowParamHistory} showEvaluation={showEvaluation} setShowEvaluation={setShowEvaluation} />}
    </>
  );
}

function NeutralEvalSlot({ showEvaluation, activeDebate }: { showEvaluation: boolean; activeDebate: ActiveDebateSession }) {
  if (!showEvaluation || !activeDebate.neutral_evaluations || activeDebate.neutral_evaluations.length === 0) return null;
  return (
    <NeutralEvaluationPanel
      evaluations={activeDebate.neutral_evaluations}
      speakerMapping={activeDebate.neutral_speaker_mapping}
    />
  );
}

function DebateActionRegion({
  activeDebate, isExploration, isExplorationClosed, explorationSummary, extractAndSeedFromDebate,
  showRemoteOverlay, isClarificationPhase, isEditClaimsPhase, isOpeningPhase, isDebatePhase,
  showParamHistory, setShowParamHistory, showEvaluation, setShowEvaluation,
}: {
  activeDebate: ActiveDebateSession;
  isExploration: boolean;
  isExplorationClosed: boolean;
  explorationSummary: DWStore['explorationSummary'];
  extractAndSeedFromDebate: DWStore['extractAndSeedFromDebate'];
  showRemoteOverlay: boolean;
  isClarificationPhase: boolean;
  isEditClaimsPhase: boolean;
  isOpeningPhase: boolean;
  isDebatePhase: boolean;
  showParamHistory: boolean;
  setShowParamHistory: React.Dispatch<React.SetStateAction<boolean>>;
  showEvaluation: boolean;
  setShowEvaluation: React.Dispatch<React.SetStateAction<boolean>>;
}) {
  return (
    <>
      {/* Exploration summary card — shown when exploration debate closes */}
      {isExplorationClosed && explorationSummary && <ExplorationSummaryCard />}

      <RerunInsightsSlot
        isExploration={isExploration}
        activeDebate={activeDebate}
        explorationSummary={explorationSummary}
        extractAndSeedFromDebate={extractAndSeedFromDebate}
      />

      <PhaseActionBar
        showRemoteOverlay={showRemoteOverlay}
        activeDebate={activeDebate}
        isClarificationPhase={isClarificationPhase}
        isEditClaimsPhase={isEditClaimsPhase}
        isOpeningPhase={isOpeningPhase}
        isDebatePhase={isDebatePhase}
        isExplorationClosed={isExplorationClosed}
        showParamHistory={showParamHistory}
        setShowParamHistory={setShowParamHistory}
        showEvaluation={showEvaluation}
        setShowEvaluation={setShowEvaluation}
      />

      {/* Neutral evaluation panel — toggled via Evaluation button */}
      <NeutralEvalSlot showEvaluation={showEvaluation} activeDebate={activeDebate} />

      {/* Parameter calibration history */}
      {showParamHistory && (
        <ParameterHistoryPanel onClose={() => setShowParamHistory(false)} />
      )}
    </>
  );
}

function DebateModals({
  contextMenu, setContextMenu, commentPopover, setCommentPopover,
  onSimilarPovSearch, commentSidebarOpen, commentsFile,
}: {
  contextMenu: ContextMenuState | null;
  setContextMenu: React.Dispatch<React.SetStateAction<ContextMenuState | null>>;
  commentPopover: CommentPopoverState | null;
  setCommentPopover: React.Dispatch<React.SetStateAction<CommentPopoverState | null>>;
  onSimilarPovSearch: (query: string) => void;
  commentSidebarOpen: boolean;
  commentsFile: CommentStoreState['commentsFile'];
}) {
  return (
    <>
      {/* Phase 7: Context menu */}
      {contextMenu && (
        <DebateContextMenu
          menu={contextMenu}
          onClose={() => setContextMenu(null)}
          onSimilarPovSearch={onSimilarPovSearch}
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
    </>
  );
}

function DebateSideRail({
  debateChatOpen, setDebateChatOpen, activeDebate, onChatNavigate, selectedRef, setSelectedRef,
}: {
  debateChatOpen: boolean;
  setDebateChatOpen: React.Dispatch<React.SetStateAction<boolean>>;
  activeDebate: ActiveDebateSession;
  onChatNavigate: (cmd: NavigateCommand) => void;
  selectedRef: DWStore['selectedRef'];
  setSelectedRef: DWStore['setSelectedRef'];
}) {
  return (
    <>
      {/* Debate Chat FAB — bottom-right floating button */}
      <button
        className={`debate-chat-fab${debateChatOpen ? ' active' : ''}`}
        onClick={() => setDebateChatOpen(v => !v)}
        title={debateChatOpen ? 'Hide Debate Chat' : 'Open Debate Chat — ask questions about the debate'}
        aria-label="Debate Chat"
      >
        {debateChatOpen ? '✕' : '💬'}
      </button>
      {/* Debate Chat sidebar — outside workspace column, inside row */}
      {debateChatOpen && (
        <DiagnosticsChatSidebar
          debate={activeDebate}
          selectedEntry={null}
          currentTab="transcript"
          onNavigate={onChatNavigate}
          embedded
          onClose={() => setDebateChatOpen(false)}
        />
      )}
      {/* Reference detail pane — opens when a transcript ID-ref link is selected (t/1776) */}
      {selectedRef && (
        <DetailPane
          className="debate-detail-pane"
          selectedRef={selectedRef}
          onSelectRef={setSelectedRef}
          onClose={() => setSelectedRef(null)}
        />
      )}
    </>
  );
}

// ── Extracted effect / memo hooks (ADR-007, t/1876) ──────────────────────
// Side-effect and derived-state logic lifted verbatim out of DebateWorkspace.
// Purely a relocation — the effects, memos, and their dependency arrays are
// unchanged, which is what drops the parent's cyclomatic count (each `?.` in a
// dependency array is a decision point in whichever function owns it).

function useDebateWorkspaceEffects({
  activeDebate, setDiagPopoutOpen, extractExplorationSummary,
  loadDebateComments, unloadComments, saveDebate, debateGenerating, compressOldTranscript,
}: {
  activeDebate: DWStore['activeDebate'];
  setDiagPopoutOpen: DWStore['setDiagPopoutOpen'];
  extractExplorationSummary: DWStore['extractExplorationSummary'];
  loadDebateComments: CommentStoreState['loadComments'];
  unloadComments: CommentStoreState['unloadComments'];
  saveDebate: DWStore['saveDebate'];
  debateGenerating: DWStore['debateGenerating'];
  compressOldTranscript: DWStore['compressOldTranscript'];
}) {
  const explorationExtracted = useRef<string | null>(null);
  const hasTriggeredOpening = useRef(false);
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const compressionCooldownRef = useRef<number>(0);

  // Listen for diagnostics popout window closing
  useEffect(() => {
    const unsub = api.onDiagnosticsPopoutClosed(() => {
      setDiagPopoutOpen(false);
    });
    return unsub;
  }, [setDiagPopoutOpen]);

  // Listen for debate popout window closing — release driver lock and reload state
  useEffect(() => {
    return initDebatePopoutCloseHandler(api);
  }, []);

  // Listen for re-extract claims requests from popout (t/226)
  useEffect(() => {
    const unsub = api.onReExtractClaims((entryId: string) => {
      void useDebateStore.getState().reExtractClaims(entryId);
    });
    return unsub;
  }, []);

  // Auto-extract exploration summary when an exploration debate closes
  useEffect(() => {
    if (
      activeDebate?.protocol_id === 'exploration'
      && activeDebate.phase === 'closed'
      && explorationExtracted.current !== activeDebate.id
    ) {
      explorationExtracted.current = activeDebate.id;
      extractExplorationSummary();
    }
  }, [activeDebate?.id, activeDebate?.phase, activeDebate?.protocol_id, extractExplorationSummary]);

  // Load comments when debate changes
  useEffect(() => {
    if (activeDebate) {
      void loadDebateComments(activeDebate.id);
    }
    return () => unloadComments();
  }, [activeDebate?.id, loadDebateComments, unloadComments]);

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
    if (Date.now() < compressionCooldownRef.current) return;
    if (activeDebate.transcript.length >= 16) {
      const lastSummaryIdx = activeDebate.context_summaries.length > 0
        ? activeDebate.transcript.findIndex(
            (e) => e.id === activeDebate.context_summaries[activeDebate.context_summaries.length - 1].up_to_entry_id,
          )
        : -1;
      const uncompressed = activeDebate.transcript.length - (lastSummaryIdx + 1) - 8;
      if (uncompressed >= 8) {
        compressionCooldownRef.current = Date.now() + 60_000;
        void compressOldTranscript();
      }
    }
  }, [activeDebate?.transcript.length, debateGenerating]);

  // Reset trigger flags when debate changes
  useEffect(() => {
    hasTriggeredOpening.current = false;
  }, [activeDebate?.id]);
}

function useDebateFind(activeDebate: DWStore['activeDebate']) {
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

  return { findVisible, findQuery, setFindQuery, findCurrentIndex, findTotal, findOffsets, findNext, findPrev, closeFind };
}

function useDebateCoverage(activeDebate: DWStore['activeDebate']) {
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
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
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
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
      return null;
    }
  }, [coverageMap, activeDebate?.argument_network]);

  return { coverageMap, strengthWeighted };
}

// Walk up from the selection's anchor to find the enclosing statement card.
function findSelectedEntry(anchorNode: Node | null | undefined, currentTarget: EventTarget | null): { entryId: string; isPoverStatement: boolean } {
  let node = anchorNode as HTMLElement | null;
  let entryId = '';
  let isPoverStatement = false;
  while (node && node !== currentTarget) {
    if (node.dataset?.entryId) {
      entryId = node.dataset.entryId;
      isPoverStatement = node.dataset.isPover === 'true';
      break;
    }
    node = node.parentElement;
  }
  return { entryId, isPoverStatement };
}

// Rendered-text offset + active tier for a selection within a statement card (t/1694).
function computeSelectionAnchor(
  selection: Selection,
  entry: ActiveTranscriptEntry,
  selectedText: string,
  defaultTier: DWStore['responseLength'],
): { startOffset: number; endOffset: number; tier: DetailTier } {
  const isSub = ['opening', 'statement', 'fact-check', 'cross_respond'].includes(entry.type);
  const tier: DetailTier = isSub ? ((entry as any).display_tier ?? defaultTier ?? 'detailed') : 'detailed';
  let startOffset = 0;
  let endOffset = selectedText.length;
  const range = selection.getRangeAt(0);
  const anchorEl = range.startContainer instanceof Element
    ? range.startContainer
    : range.startContainer.parentElement;
  const container = anchorEl?.closest('.debate-statement-content') as HTMLElement | null;
  if (container) {
    // `selectedText` was trimmed; realign the offset to the trimmed start so
    // it points at the same text CommentOverlay will locate.
    const rawSelected = selection.toString();
    const leadingWs = rawSelected.length - rawSelected.trimStart().length;
    startOffset = renderedOffsetOf(container, range.startContainer, range.startOffset) + leadingWs;
    endOffset = startOffset + selectedText.length;
  }
  return { startOffset, endOffset, tier };
}

function useDebateSelectionMenu(activeDebate: DWStore['activeDebate'], defaultTier: DWStore['responseLength']) {
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [commentPopover, setCommentPopover] = useState<CommentPopoverState | null>(null);

  // Phase 7: Context menu handler
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    const selection = window.getSelection();
    const selectedText = selection?.toString().trim() || '';
    if (!selectedText) return; // No selection → use default browser menu

    e.preventDefault();

    const { entryId, isPoverStatement } = findSelectedEntry(selection?.anchorNode, e.currentTarget);

    // Compute text offsets + active tier within the debate-statement-content element
    let startOffset = 0;
    let endOffset = selectedText.length;
    let tier: DetailTier = 'detailed';
    if (entryId && selection && selection.rangeCount > 0) {
      // Find the entry in the transcript to determine the active tier
      const entry = activeDebate?.transcript.find(e2 => e2.id === entryId);
      if (entry) {
        ({ startOffset, endOffset, tier } = computeSelectionAnchor(selection, entry, selectedText, defaultTier));
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

  return { contextMenu, setContextMenu, commentPopover, setCommentPopover, handleContextMenu };
}

// ── Main component ───────────────────────────────────────

export function DebateWorkspace({ onExport, exportStatus }: {
  onExport?: (format: string) => void;
  exportStatus?: string | null;
} = {}) {
  const {
    activeDebate, debateLoading, debateError, debateGenerating,
    runClarification, runOpeningStatements, saveDebate, compressOldTranscript,
    diagnosticsEnabled, toggleDiagnostics, selectedDiagEntry, selectDiagEntry,
    diagPopoutOpen, setDiagPopoutOpen, defaultTier, setDefaultTier,
    driverIsRemote,
    selectedRef, setSelectedRef,
    explorationSummary, extractExplorationSummary, extractAndSeedFromDebate,
  } = useDebateStore(
    useShallow(s => ({
      activeDebate: s.activeDebate, debateLoading: s.debateLoading, debateError: s.debateError, debateGenerating: s.debateGenerating,
      runClarification: s.runClarification, runOpeningStatements: s.runOpeningStatements, saveDebate: s.saveDebate, compressOldTranscript: s.compressOldTranscript,
      diagnosticsEnabled: s.diagnosticsEnabled, toggleDiagnostics: s.toggleDiagnostics, selectedDiagEntry: s.selectedDiagEntry, selectDiagEntry: s.selectDiagEntry,
      diagPopoutOpen: s.diagPopoutOpen, setDiagPopoutOpen: s.setDiagPopoutOpen,
      defaultTier: s.responseLength, setDefaultTier: s.setResponseLength,
      driverIsRemote: s.driverIsRemote,
      selectedRef: s.selectedRef, setSelectedRef: s.setSelectedRef,
      explorationSummary: s.explorationSummary,
      extractExplorationSummary: s.extractExplorationSummary,
      extractAndSeedFromDebate: s.extractAndSeedFromDebate,
    }))
  );
  const { runSemanticSearch, setFindQuery: setStoreFindQuery, setFindMode: setStoreFindMode, setToolbarPanel } = useTaxonomyStore();
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const [showCCDetails, setShowCCDetails] = useState(false);
  const [showParamHistory, setShowParamHistory] = useState(false);
  const [showEvaluation, setShowEvaluation] = useState(false);
  const [debateChatOpen, setDebateChatOpen] = useState(false);
  const { commentsFile, loadComments: loadDebateComments, unloadComments, sidebarOpen: commentSidebarOpen, toggleSidebar: toggleCommentSidebar } = useCommentStore();

  useDebateWorkspaceEffects({
    activeDebate, setDiagPopoutOpen, extractExplorationSummary,
    loadDebateComments, unloadComments, saveDebate, debateGenerating, compressOldTranscript,
  });

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

  const { findVisible, findQuery, setFindQuery, findCurrentIndex, findTotal, findOffsets, findNext, findPrev, closeFind } = useDebateFind(activeDebate);
  const { coverageMap, strengthWeighted } = useDebateCoverage(activeDebate);
  const { contextMenu, setContextMenu, commentPopover, setCommentPopover, handleContextMenu } = useDebateSelectionMenu(activeDebate, defaultTier);

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
    || activeDebate.adaptive_staging?.phase_state?.current_phase != null;
  const isCrossCutting = activeDebate.source_type === 'situations';
  const isExploration = activeDebate.protocol_id === 'exploration';
  const isExplorationClosed = isExploration && activeDebate.phase === 'closed';
  const showRemoteOverlay = driverIsRemote && !!activeDebate;

  return (
    <div className="debate-workspace-row" data-phase={isClarificationPhase ? 'setup' : undefined}>
    <div className="debate-workspace">
      {/* Fixed toolbar — always visible */}
      <DebateToolbar
        activeDebate={activeDebate}
        isExploration={isExploration}
        isCrossCutting={isCrossCutting}
        onShowCCDetails={() => setShowCCDetails(true)}
        commentSidebarOpen={commentSidebarOpen}
        toggleCommentSidebar={toggleCommentSidebar}
        commentsFile={commentsFile}
        exportStatus={exportStatus}
        onExport={onExport}
        diagnosticsEnabled={diagnosticsEnabled}
        toggleDiagnostics={toggleDiagnostics}
        defaultTier={defaultTier}
        setDefaultTier={setDefaultTier}
      />

      {/* Cross-cutting context dialog */}
      <CrossCuttingDialog activeDebate={activeDebate} show={showCCDetails} onClose={() => setShowCCDetails(false)} />

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

      {/* Remote driver overlay — popout window is driving this debate */}
      <RemoteDriverOverlay show={showRemoteOverlay} />

      {/* Scrollable content: topic, debaters, transcript */}
      <div className="debate-scroll-content" onContextMenu={handleContextMenu}>
        <DebateTopicInfo activeDebate={activeDebate} coverageMap={coverageMap} strengthWeighted={strengthWeighted} />
        <DebatePhaseHeader activeDebate={activeDebate} isDebatePhase={isDebatePhase} isOpeningPhase={isOpeningPhase} />
        <DebateTranscriptColumn
          activeDebate={activeDebate}
          debateGenerating={debateGenerating}
          findOffsets={findOffsets}
          findQuery={findQuery}
          findCurrentIndex={findCurrentIndex}
          diagnosticsEnabled={diagnosticsEnabled}
          selectedDiagEntry={selectedDiagEntry}
          selectDiagEntry={selectDiagEntry}
          transcriptEndRef={transcriptEndRef}
        />
      </div>

      <DebateActionRegion
        activeDebate={activeDebate}
        isExploration={isExploration}
        isExplorationClosed={isExplorationClosed}
        explorationSummary={explorationSummary}
        extractAndSeedFromDebate={extractAndSeedFromDebate}
        showRemoteOverlay={showRemoteOverlay}
        isClarificationPhase={isClarificationPhase}
        isEditClaimsPhase={isEditClaimsPhase}
        isOpeningPhase={isOpeningPhase}
        isDebatePhase={isDebatePhase}
        showParamHistory={showParamHistory}
        setShowParamHistory={setShowParamHistory}
        showEvaluation={showEvaluation}
        setShowEvaluation={setShowEvaluation}
      />

      {/* Diagnostics always uses popup window — no inline panel */}

      <DebateModals
        contextMenu={contextMenu}
        setContextMenu={setContextMenu}
        commentPopover={commentPopover}
        setCommentPopover={setCommentPopover}
        onSimilarPovSearch={handleSimilarPovSearch}
        commentSidebarOpen={commentSidebarOpen}
        commentsFile={commentsFile}
      />
    </div>
    <DebateSideRail
      debateChatOpen={debateChatOpen}
      setDebateChatOpen={setDebateChatOpen}
      activeDebate={activeDebate}
      onChatNavigate={handleChatNavigate}
      selectedRef={selectedRef}
      setSelectedRef={setSelectedRef}
    />
    </div>
  );
}
