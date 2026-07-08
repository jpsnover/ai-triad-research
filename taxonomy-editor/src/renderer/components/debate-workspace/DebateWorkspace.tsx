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
  speakerLabel, speakerColor, nodeIdToTab, focusMainWindowNode, countOccurrences,
} from './utils';
import type { AdaptivePhase } from './utils';
import { CommentCreationPopover } from '../chat/CommentCreationPopover';
import type { CommentPopoverState } from '../chat/CommentCreationPopover';
import { CommentSidebar } from '../chat/CommentSidebar';
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
import { PhaseProgressBar, SessionPhaseStepper, ProgressIndicator, DebaterToggles, DebateActions } from './DebateActionBar';
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
    explorationSummary, extractExplorationSummary, extractAndSeedFromDebate,
  } = useDebateStore(
    useShallow(s => ({
      activeDebate: s.activeDebate, debateLoading: s.debateLoading, debateError: s.debateError, debateGenerating: s.debateGenerating,
      runClarification: s.runClarification, runOpeningStatements: s.runOpeningStatements, saveDebate: s.saveDebate, compressOldTranscript: s.compressOldTranscript,
      diagnosticsEnabled: s.diagnosticsEnabled, toggleDiagnostics: s.toggleDiagnostics, selectedDiagEntry: s.selectedDiagEntry, selectDiagEntry: s.selectDiagEntry,
      diagPopoutOpen: s.diagPopoutOpen, setDiagPopoutOpen: s.setDiagPopoutOpen,
      defaultTier: s.responseLength, setDefaultTier: s.setResponseLength,
      driverIsRemote: s.driverIsRemote,
      explorationSummary: s.explorationSummary,
      extractExplorationSummary: s.extractExplorationSummary,
      extractAndSeedFromDebate: s.extractAndSeedFromDebate,
    }))
  );
  const { runSemanticSearch, setFindQuery: setStoreFindQuery, setFindMode: setStoreFindMode, setToolbarPanel } = useTaxonomyStore();
  const transcriptEndRef = useRef<HTMLDivElement>(null);
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
  const explorationExtracted = useRef<string | null>(null);
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
  const isExploration = activeDebate.protocol_id === 'exploration';
  const isExplorationClosed = isExploration && activeDebate.phase === 'closed';
  const showRemoteOverlay = driverIsRemote && !!activeDebate;

  return (
    <div className="debate-workspace-row">
    <div className="debate-workspace">
      {/* Fixed toolbar — always visible */}
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
            onClick={() => setShowCCDetails(true)}
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
        <ShareToCommunityButton debate={activeDebate} />
        <button
          className={`btn btn-sm debate-diag-btn${diagnosticsEnabled ? ' active' : ''}`}
          onClick={toggleDiagnostics}
          title={diagnosticsEnabled ? 'Disable diagnostics mode' : 'Enable diagnostics mode — click entries to inspect'}
        >
          {diagnosticsEnabled ? 'Diagnostics ON' : 'Diagnostics'}
        </button>
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
              <button className="debate-inspect-close" onClick={() => setShowCCDetails(false)} title="Close">&times;</button>
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

      {/* Remote driver overlay — popout window is driving this debate */}
      {showRemoteOverlay && (
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
            <code style={{ fontSize: '0.6rem', color: 'var(--text-muted)', userSelect: 'all', cursor: 'text' }} title="Debate ID — click to select">{activeDebate.id}</code>
            {coverageMap && <CoverageBadge coverageMap={coverageMap} strengthWeighted={strengthWeighted} />}
          </div>
          <span className="debate-topic-text">{activeDebate.topic.final}</span>
        </div>

        {/* Session phase stepper — always visible once debate has started */}
        {activeDebate.phase !== 'setup' && activeDebate.phase !== 'closed' && (
          <SessionPhaseStepper
            phase={activeDebate.phase}
            roundCount={activeDebate.transcript.filter(e => e.type === 'statement' || e.type === 'opening').length}
          />
        )}

        {/* Adaptive phase progress bar — shown during debate phase when adaptive staging is enabled */}
        {isDebatePhase && activeDebate.phase !== 'closed' && (activeDebate as any).adaptive_staging?.enabled && (() => {
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
        <div className="debate-transcript-column">
        {activeDebate.transcript.length === 0 && !debateGenerating && (
          <EmptyState
            headline="The debate is ready to begin"
            direction="Clarification questions will appear here."
          />
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

          // Phase transition hairlines — detect phase boundaries in the transcript
          const prevVisibleIdx = activeDebate.transcript.slice(0, idx).findLastIndex(e => e.type !== 'clarification');
          const prevType = prevVisibleIdx >= 0 ? activeDebate.transcript[prevVisibleIdx].type : null;
          let hairline: React.ReactNode = null;
          if (entry.type === 'opening' && prevType !== 'opening') {
            hairline = <PhaseHairline key={`hairline-opening-${idx}`} label="Opening Statements" />;
          } else if ((entry.type === 'statement' || entry.type === 'cross_respond') && prevType !== 'statement' && prevType !== 'cross_respond' && prevType !== 'probing' && prevType !== 'fact-check' && prevType !== 'system' && prevType !== 'question') {
            hairline = <PhaseHairline key={`hairline-debate-${idx}`} label="Cross-Examination" />;
          } else if ((entry.type === 'synthesis' || entry.type === 'concluding') && prevType !== 'synthesis' && prevType !== 'concluding') {
            hairline = <PhaseHairline key={`hairline-synthesis-${idx}`} label="Synthesis" />;
          }

          const isStatement = entry.type !== 'probing' && entry.type !== 'fact-check';
          const card = entry.type === 'probing'
            ? <ProbingCard key={entry.id} entry={entry} statementId={statementId} />
            : entry.type === 'fact-check'
            ? <FactCheckCard key={entry.id} entry={entry} statementId={statementId} findQuery={findQuery} matchOffset={matchOffset} findCurrentIndex={findCurrentIndex} />
            : <StatementCard key={entry.id} entry={entry} statementId={statementId} findQuery={findQuery} matchOffset={matchOffset} findCurrentIndex={findCurrentIndex} entryIndex={idx} totalEntries={activeDebate.transcript.length} />;
          return (
            <Fragment key={entry.id}>
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
        })}
        </div>
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

      {/* Exploration summary card — shown when exploration debate closes */}
      {isExplorationClosed && explorationSummary && <ExplorationSummaryCard />}

      {/* "Rerun with Insights" — on non-exploration closed debates */}
      {!isExploration && activeDebate.phase === 'closed' && !explorationSummary && (
        <div className="debate-rerun-insights">
          <button
            className="btn btn-explore"
            onClick={() => void extractAndSeedFromDebate(activeDebate.id)}
            title="Extract insights from this debate and use them to seed a new, better debate"
          >
            Rerun with Insights
          </button>
        </div>
      )}

      {/* Phase-aware action bar (fixed at bottom) — hidden when popout is driving */}
      {!showRemoteOverlay && isClarificationPhase && !activeDebate.transcript.some(e => e.type === 'opening' || e.type === 'statement') && <ClarificationActions />}
      {!showRemoteOverlay && isEditClaimsPhase && <ClaimsEditor />}
      {!showRemoteOverlay && isOpeningPhase && <OpeningActions />}

      {!showRemoteOverlay && isDebatePhase && !isExplorationClosed && <DebateActions showParamHistory={showParamHistory} setShowParamHistory={setShowParamHistory} showEvaluation={showEvaluation} setShowEvaluation={setShowEvaluation} />}

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
      {debateChatOpen ? '✕' : '💬'}
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
