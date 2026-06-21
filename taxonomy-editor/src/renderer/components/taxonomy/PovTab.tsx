// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { getGlobalRecorder } from '@lib/flight-recorder/index';
import { useBreakpoint } from '../../hooks/useBreakpoint';
import { useMobileNav } from '../../hooks/useMobileNav';
import type { Pov, Category, PovNode } from '../../types/taxonomy';
import { PROMPT_CATALOG, type PromptCatalogEntry } from '../../data/promptCatalog';
import { useTaxonomyStore } from '../../hooks/useTaxonomyStore';
import { useKeyboardNav } from '../../hooks/useKeyboardNav';
import { useResizablePanel, useResizableRightPanel } from '../../hooks/useResizablePanel';
import { NodeTree, getOrderedNodeIds } from './NodeTree';
import type { SortMode } from './NodeTree';
import { NodeDetail } from './NodeDetail';
import { SituationDetail } from '../debate/SituationDetail';
import { NewNodeDialog } from '../shared/NewNodeDialog';
import { PinnedPanel } from '../shared/PinnedPanel';
import { SearchPreview } from '../edge-browser/SearchPreview';
import { AnalysisPanel } from '../analysis/AnalysisPanel';
import { EdgeDetailPanel } from '../edge-browser/EdgeDetailPanel';
import { PromptDetailPanel } from '../chat/PromptsPanel';
import { FallacyDetailPanel } from '../analysis/FallacyPanel';
import { CruxDetail } from '../debate/CruxesTab';
import { ToolbarPaneRenderer, isFullWidthPanel, PhoneToolClose } from '../shared/ToolbarPaneRenderer';
import { LineageDetailView } from '../shared/LineageDetailView';
import { POVER_INFO } from '@lib/debate/types';
import type { SpeakerId } from '@lib/debate/types';

/** Map taxonomy POV name → POVER_INFO speaker key (identity map after speaker rename) */
const POV_TO_SPEAKER: Record<string, Exclude<SpeakerId, 'user'>> = {
  accelerationist: 'accelerationist',
  safetyist: 'safetyist',
  skeptic: 'skeptic',
};
import { api } from '@bridge';
import { useNodeConflicts } from '../conflict/edit-conflicts';
import { useSyncStatus } from '../../hooks/useSyncStatus';

interface PovTabProps {
  pov: Pov;
}

/** Extracted from PovTab IIFE to avoid conditional hook calls (React Rules of Hooks). */
function DoctrinalBoundariesSection({ pov }: { pov: string }) {
  const speakerKey = POV_TO_SPEAKER[pov.toLowerCase()];
  const info = speakerKey ? POVER_INFO[speakerKey] : undefined;
  const hardcoded = info?.boundaries?.hardcoded ?? [];
  const softcoded = info?.boundaries?.softcoded ?? [];
  const total = hardcoded.length + softcoded.length;
  const storageKey = `doctrinal-boundaries-collapsed-${pov}`;
  const [collapsed, setCollapsed] = useState(() => {
    const stored = localStorage.getItem(storageKey);
    return stored !== null ? stored === 'true' : true;
  });

  if (total === 0) return null;

  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem(storageKey, String(next));
  };
  const countLabel = `${hardcoded.length} hardcoded, ${softcoded.length} softcoded`;
  return (
    <div className="doctrinal-boundaries">
      <button
        className="doctrinal-boundaries-header"
        onClick={toggleCollapsed}
        aria-expanded={!collapsed}
      >
        <span className="doctrinal-boundaries-arrow">{collapsed ? '\u25B8' : '\u25BE'}</span>
        <span className="doctrinal-boundaries-label">Doctrinal Boundaries ({countLabel})</span>
      </button>
      {!collapsed && (
        <div className="doctrinal-boundaries-items">
          {hardcoded.length > 0 && (
            <div className="doctrinal-boundaries-group">
              <div className="doctrinal-boundaries-group-label hardcoded">Identity (never concede)</div>
              {hardcoded.map((b, i) => (
                <div key={`h-${i}`} className="doctrinal-boundaries-item hardcoded">
                  <span aria-hidden="true" className="boundary-icon hardcoded">{'✕'}</span>
                  <span>{b}</span>
                </div>
              ))}
            </div>
          )}
          {softcoded.length > 0 && (
            <div className="doctrinal-boundaries-group">
              <div className="doctrinal-boundaries-group-label softcoded">Default (can evolve)</div>
              {softcoded.map((b, i) => (
                <div key={`s-${i}`} className="doctrinal-boundaries-item softcoded">
                  <span aria-hidden="true" className="boundary-icon softcoded">~</span>
                  <span>{b}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

type StepStatus = 'pending' | 'running' | 'ok' | 'error' | 'polling';

interface RecoveryStep {
  label: string;
  status: StepStatus;
  detail: string;
  error?: string;
}

const STEP_LABELS = ['Server health', 'Data availability', 'Authentication', 'Load taxonomy'];
const POLL_INTERVAL = 4000;
const MAX_FAILURES = 3;

function DataRecovery({ pov }: { pov: string }) {
  const { loadAll } = useTaxonomyStore();
  const [steps, setSteps] = useState<RecoveryStep[]>(
    STEP_LABELS.map(label => ({ label, status: 'pending', detail: '' })),
  );
  const [activeStep, setActiveStep] = useState(0);
  const [failures, setFailures] = useState(0);
  const [diagnostics, setDiagnostics] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  const updateStep = useCallback((idx: number, patch: Partial<RecoveryStep>) => {
    setSteps(prev => prev.map((s, i) => i === idx ? { ...s, ...patch } : s));
  }, []);

  const runPipeline = useCallback(async (startFrom = 0) => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    const sig = ac.signal;
    let diagLines: string[] = [];

    // In electron mode, steps 0-2 (health, data availability, auth) use HTTP
    // endpoints that only exist on the deployed server — not on the Vite dev
    // server. Skip straight to loadAll() which uses IPC.
    const isElectronMode = import.meta.env.VITE_TARGET !== 'web';
    if (isElectronMode && startFrom < 3) {
      setSteps(prev => prev.map((s, i) => i < 3 ? { ...s, status: 'ok', detail: 'electron' } : { ...s, status: 'pending', detail: '', error: undefined }));
      startFrom = 3;
    }

    setSteps(prev => prev.map((s, i) => i < startFrom ? s : { ...s, status: 'pending', detail: '', error: undefined }));
    setActiveStep(startFrom);

    try {
      // Step 0: Server health (web mode only)
      if (startFrom <= 0) {
        updateStep(0, { status: 'running', detail: 'Checking...' });
        try {
          const res = await fetch('/health', { signal: sig });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = await res.json();
          const cacheCount = data.storage?.cacheFileCount ?? '?';
          const uptime = data.uptime ? `${Math.round(data.uptime)}s` : '?';
          updateStep(0, { status: 'ok', detail: `${data.status} · ${cacheCount} cached · uptime ${uptime}` });
          diagLines.push(`health: ${JSON.stringify(data)}`);
        } catch (err) {
          if (sig.aborted) return;
          const msg = String((err as Error).message);
          updateStep(0, { status: 'error', detail: 'Server unreachable', error: msg });
          diagLines.push(`health: FAILED — ${msg}`);
          setDiagnostics(diagLines.join('\n'));
          setFailures(f => f + 1);
          getGlobalRecorder()?.record({ type: 'system.error', component: 'data-recovery', level: 'error', message: 'Health check failed', error: { name: 'HealthCheckError', message: msg } });
          return;
        }
      }
      if (sig.aborted) return;

      // Step 1: Data availability (may poll)
      if (startFrom <= 1) {
        setActiveStep(1);
        updateStep(1, { status: 'running', detail: 'Checking...' });
        try {
          let available = false;
          let pollCount = 0;
          while (!available && !sig.aborted) {
            const res = await fetch('/api/data/available', { signal: sig });
            available = await res.json();
            if (available) break;
            pollCount++;
            updateStep(1, { status: 'polling', detail: `Server syncing data from GitHub (poll ${pollCount})...` });
            await new Promise(r => setTimeout(r, POLL_INTERVAL));
          }
          if (sig.aborted) return;
          updateStep(1, { status: 'ok', detail: 'Data available' });
          diagLines.push(`data-available: true (polls: ${pollCount})`);
        } catch (err) {
          if (sig.aborted) return;
          const msg = String((err as Error).message);
          updateStep(1, { status: 'error', detail: 'Cannot verify data', error: msg });
          diagLines.push(`data-available: FAILED — ${msg}`);
          setDiagnostics(diagLines.join('\n'));
          setFailures(f => f + 1);
          getGlobalRecorder()?.record({ type: 'system.error', component: 'data-recovery', level: 'error', message: 'Data availability check failed', error: { name: 'DataAvailError', message: msg } });
          return;
        }
      }
      if (sig.aborted) return;

      // Step 2: Authentication
      if (startFrom <= 2) {
        setActiveStep(2);
        updateStep(2, { status: 'running', detail: 'Checking...' });
        try {
          const res = await fetch('/api/auth/me', { signal: sig });
          const data = await res.json();
          const userLabel = data.anonymous ? 'anonymous' : `${data.user} (${data.idp || 'local'})`;
          updateStep(2, { status: 'ok', detail: userLabel });
          diagLines.push(`auth: ${JSON.stringify(data)}`);
        } catch (err) {
          if (sig.aborted) return;
          const msg = String((err as Error).message);
          updateStep(2, { status: 'error', detail: 'Auth check failed', error: msg });
          diagLines.push(`auth: FAILED — ${msg}`);
          setDiagnostics(diagLines.join('\n'));
          setFailures(f => f + 1);
          getGlobalRecorder()?.record({ type: 'system.error', component: 'data-recovery', level: 'error', message: 'Auth check failed', error: { name: 'AuthCheckError', message: msg } });
          return;
        }
      }
      if (sig.aborted) return;

      // Step 3: Load taxonomy data
      setActiveStep(3);
      updateStep(3, { status: 'running', detail: `Loading ${pov}...` });
      try {
        await loadAll();
        updateStep(3, { status: 'ok', detail: 'Loaded' });
        diagLines.push('loadAll: ok');
      } catch (err) {
        if (sig.aborted) return;
        const msg = String((err as Error).message);
        updateStep(3, { status: 'error', detail: 'Load failed', error: msg });
        diagLines.push(`loadAll: FAILED — ${msg}`);
        setDiagnostics(diagLines.join('\n'));
        setFailures(f => f + 1);
        getGlobalRecorder()?.record({ type: 'system.error', component: 'data-recovery', level: 'error', message: 'Taxonomy load failed', error: { name: 'LoadError', message: msg } });
        return;
      }

      setDiagnostics(diagLines.join('\n'));
      setFailures(0);
    } catch (err) {
      if (!sig.aborted) {
        getGlobalRecorder()?.record({ type: 'system.error', component: 'data-recovery', level: 'error', message: 'Recovery pipeline error', error: { name: (err as Error).name ?? 'Error', message: String(err) } });
      }
    }
  }, [loadAll, pov, updateStep]);

  useEffect(() => {
    void runPipeline(0);
    return () => { abortRef.current?.abort(); };
  }, []);

  const failedIdx = steps.findIndex(s => s.status === 'error');
  const completedCount = steps.filter(s => s.status === 'ok').length;
  const showCopyDiag = failures >= MAX_FAILURES;

  const handleCopyDiagnostics = async () => {
    try {
      const { api } = await import('@bridge');
      await api.clipboardWriteText(`Data Recovery Diagnostics (${pov})\n${new Date().toISOString()}\n\n${diagnostics}`);
    } catch { /* telemetry — silent by design */ }
  };

  return (
    <div className="data-load-retry">
      <div className="data-load-retry-icon">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
          <rect x="14" y="14" width="7" height="7" rx="1" />
        </svg>
      </div>
      <div className="data-load-retry-title">Loading Taxonomy Data</div>

      <div className="recovery-steps">
        {steps.map((step, i) => (
          <div key={i} className={`recovery-step recovery-step-${step.status}`}>
            <span className="recovery-step-icon">
              {step.status === 'ok' && '✓'}
              {step.status === 'error' && '✗'}
              {step.status === 'running' && <span className="data-load-retry-spinner" />}
              {step.status === 'polling' && <span className="data-load-retry-spinner" />}
              {step.status === 'pending' && '·'}
            </span>
            <span className="recovery-step-label">{step.label}</span>
            <span className="recovery-step-detail">{step.detail}</span>
          </div>
        ))}
      </div>

      {/* Progress bar */}
      <div className="recovery-progress">
        <div className="recovery-progress-bar" style={{ width: `${(completedCount / steps.length) * 100}%` }} />
      </div>
      <div className="recovery-progress-text">{completedCount} of {steps.length}</div>

      {step2NeedsAuth(steps) && (
        <div className="recovery-auth-inline">
          <a href="/.auth/login/github" className="data-load-retry-btn">Sign in with GitHub</a>
          <a href="/.auth/login/google" className="data-load-retry-btn data-load-retry-btn-sm">Sign in with Google</a>
        </div>
      )}

      {failedIdx >= 0 && (
        <div className="recovery-actions">
          {steps[failedIdx].error && <div className="data-load-retry-error">{steps[failedIdx].error}</div>}
          <button className="data-load-retry-btn" onClick={() => { setFailures(f => f); void runPipeline(failedIdx); }}>
            Retry from {steps[failedIdx].label.toLowerCase()}
          </button>
          <button className="data-load-retry-btn data-load-retry-btn-sm" onClick={() => void runPipeline(0)}>
            Restart
          </button>
          {showCopyDiag && (
            <button className="data-load-retry-btn data-load-retry-btn-sm" onClick={() => void handleCopyDiagnostics()}>
              Copy Diagnostics
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function step2NeedsAuth(steps: RecoveryStep[]): boolean {
  return steps[2]?.status === 'ok' && steps[2]?.detail === 'anonymous' && steps[3]?.status === 'error';
}

export function PovTab({ pov }: PovTabProps) {
  const {
    selectedNodeId, setSelectedNodeId, createPovNode, pinnedStack, pinAtDepth,
    similarResults, similarLoading, similarError,
    runAnalyzeDistinction, analysisResult, analysisLoading, analysisError, clearAnalysis,
    navigateToSearchRelated,
    attributeFilter, attributeInfo,
    clusterView, clusterLoading, clusterError, runClusterView, clearClusterView,
    relatedNodeId, showRelatedEdges, selectedEdge,
    toolbarPanel, setActiveTab,
    cruxDetailId, showCruxDetail,
  } = useTaxonomyStore();
  const file = useTaxonomyStore((s) => s[pov]);
  const { aggregatedCruxes } = useTaxonomyStore();
  const selectedCrux = useMemo(
    () => cruxDetailId ? aggregatedCruxes?.find(c => c.id === cruxDetailId) ?? null : null,
    [cruxDetailId, aggregatedCruxes],
  );
  const nodeConflicts = useNodeConflicts();
  const { status: syncStatus } = useSyncStatus();
  const dirty = useTaxonomyStore((s) => s.dirty);

  // Refresh conflict indicators after save (dirty transitions non-zero → 0)
  const prevDirtyRef = useRef(dirty.size);
  useEffect(() => {
    const prev = prevDirtyRef.current;
    const now = dirty.size;
    prevDirtyRef.current = now;
    if (prev > 0 && now === 0 && nodeConflicts.enabled) {
      const t = setTimeout(() => { void nodeConflicts.refresh(); }, 600);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [dirty.size, nodeConflicts.enabled, nodeConflicts.refresh]);

  // Refresh conflict indicators when upstream main advances
  const prevMainUpdated = useRef(syncStatus.main_updated_available);
  useEffect(() => {
    const prev = prevMainUpdated.current;
    prevMainUpdated.current = syncStatus.main_updated_available;
    if (!prev && syncStatus.main_updated_available && nodeConflicts.enabled) {
      void nodeConflicts.refresh();
    }
  }, [syncStatus.main_updated_available, nodeConflicts.enabled, nodeConflicts.refresh]);

  const [showNewDialog, setShowNewDialog] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>('label');
  const [listCollapsed, setListCollapsed] = useState(false);
  const [detailCollapsed, setDetailCollapsed] = useState(false);
  const [searchPreviewId, setSearchPreviewId] = useState<string | null>(null);
  const [lineagePreviewValue, setLineagePreviewValue] = useState<string | null>(null);
  const [lineageLinkUrl, setLineageLinkUrl] = useState<string | null>(null);
  useEffect(() => { setLineageLinkUrl(null); }, [lineagePreviewValue]);
  const [selectedPromptEntry, setSelectedPromptEntry] = useState<PromptCatalogEntry | null>(PROMPT_CATALOG[0]);
  const [promptInspectorActive, setPromptInspectorActive] = useState(false);
  const handleSelectPrompt = useCallback((entry: PromptCatalogEntry | null) => setSelectedPromptEntry(entry), []);
  const [selectedFallacyKey, setSelectedFallacyKey] = useState<string | null>(null);
  const handleSelectFallacy = useCallback((key: string | null) => setSelectedFallacyKey(key), []);
  const handleFallacyNodeSelect = useCallback((nodeId: string, nodePov: string) => {
    const tabMap: Record<string, string> = {
      accelerationist: 'accelerationist', safetyist: 'safetyist',
      skeptic: 'skeptic', situations: 'situations',
    };
    const tab = tabMap[nodePov];
    if (tab) {
      setActiveTab(tab as any);
      setTimeout(() => setSelectedNodeId(nodeId), 50);
    }
  }, [setActiveTab, setSelectedNodeId]);
  const breakpoint = useBreakpoint();
  const isPhone = breakpoint === 'phone' || breakpoint === 'phone-lg';
  const [mobileListOpen, setMobileListOpen] = useState(false);
  const listPanelRef = useRef<HTMLDivElement>(null);
  const detailPanelRef = useRef<HTMLDivElement>(null);
  const nav = useMobileNav();
  const { width, onMouseDown, onTouchStart } = useResizablePanel();
  const { width: pane3Width, onMouseDown: onPane3Resize } = useResizableRightPanel({
    storageKey: 'taxonomy-editor-analysis-panel-width',
    defaultWidth: 420,
    minWidth: 300,
    maxWidth: 800,
  });
  const { width: edgeDetailWidth, onMouseDown: onEdgeDetailResize } = useResizableRightPanel({
    storageKey: 'taxonomy-editor-edge-detail-width',
    defaultWidth: 480,
    minWidth: 320,
    maxWidth: 700,
  });

  const similarScoresMap = useMemo(() => {
    if (!similarResults || similarResults.length === 0) return null;
    const m = new Map<string, number>();
    for (const r of similarResults) m.set(r.id, r.score);
    return m;
  }, [similarResults]);

  const clusterGroups = clusterView?.clusters ?? null;
  const clusterMisfits = clusterView?.misfits ?? null;

  const orderedIds = useMemo(
    () => (file ? getOrderedNodeIds(file.nodes, sortMode, similarScoresMap, clusterGroups) : []),
    [file, sortMode, similarScoresMap, clusterGroups],
  );

  const [visibleIds, setVisibleIds] = useState<string[]>([]);

  // Trigger clustering when sort mode switches to similarity
  useEffect(() => {
    if (sortMode === 'similarity') {
      void runClusterView(pov);
    } else {
      clearClusterView();
    }
  }, [sortMode, pov]);
  useKeyboardNav(visibleIds, selectedNodeId, setSelectedNodeId, toolbarPanel !== null);

  // Sync nav stack with external selectedNodeId changes
  useEffect(() => {
    if (!nav.isActive) return;
    if (selectedNodeId && nav.current.view !== 'detail') {
      nav.push({ view: 'detail', id: selectedNodeId });
    }
  }, [selectedNodeId]);

  // Close phone list overlay when a node is selected
  useEffect(() => {
    if (isPhone && selectedNodeId) setMobileListOpen(false);
  }, [selectedNodeId]);

  // Close crux detail pane when switching nodes
  useEffect(() => {
    if (cruxDetailId) showCruxDetail(null);
  }, [selectedNodeId]);

  // Swipe-right on detail panel → pop back to list
  useEffect(() => {
    if (!nav.isActive || !selectedNodeId) return;
    const el = detailPanelRef.current;
    if (!el) return;
    let sx = 0, sy = 0;
    const onStart = (e: TouchEvent) => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; };
    const onEnd = (e: TouchEvent) => {
      const dx = e.changedTouches[0].clientX - sx;
      const dy = Math.abs(e.changedTouches[0].clientY - sy);
      if (dx > 50 && dy < 30) {
        const entry = nav.pop();
        setSelectedNodeId(entry.view === 'detail' && entry.id ? entry.id : null);
      }
    };
    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchend', onEnd, { passive: true });
    return () => { el.removeEventListener('touchstart', onStart); el.removeEventListener('touchend', onEnd); };
  }, [nav.isActive, selectedNodeId, nav.pop, setSelectedNodeId]);

  // Swipe left/right on list view → switch POV tab
  useEffect(() => {
    if (!isPhone || selectedNodeId) return;
    const el = listPanelRef.current;
    if (!el) return;
    const povOrder = ['accelerationist', 'safetyist', 'skeptic'] as const;
    const idx = povOrder.indexOf(pov as typeof povOrder[number]);
    if (idx < 0) return;
    let sx = 0, sy = 0;
    const onStart = (e: TouchEvent) => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; };
    const onEnd = (e: TouchEvent) => {
      const dx = e.changedTouches[0].clientX - sx;
      const dy = Math.abs(e.changedTouches[0].clientY - sy);
      if (Math.abs(dx) < 50 || dy > 30) return;
      if (dx < -50 && idx < povOrder.length - 1) {
        setActiveTab(povOrder[idx + 1]);
      } else if (dx > 50 && idx > 0) {
        setActiveTab(povOrder[idx - 1]);
      }
    };
    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchend', onEnd, { passive: true });
    return () => { el.removeEventListener('touchstart', onStart); el.removeEventListener('touchend', onEnd); };
  }, [isPhone, selectedNodeId, pov, setActiveTab]);

  // Swipe-to-dismiss on phone list overlay
  useEffect(() => {
    if (!isPhone || !mobileListOpen) return;
    const el = listPanelRef.current;
    if (!el) return;
    let sx = 0, sy = 0;
    const onStart = (e: TouchEvent) => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; };
    const onEnd = (e: TouchEvent) => {
      const dx = e.changedTouches[0].clientX - sx;
      const dy = Math.abs(e.changedTouches[0].clientY - sy);
      if (dx < -80 && dy < 100) setMobileListOpen(false);
    };
    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchend', onEnd, { passive: true });
    return () => { el.removeEventListener('touchstart', onStart); el.removeEventListener('touchend', onEnd); };
  }, [isPhone, mobileListOpen]);

  // Auto-select first node when tab loads and nothing is selected
  useEffect(() => {
    if (!selectedNodeId && orderedIds.length > 0) {
      setSelectedNodeId(orderedIds[0]);
    }
  }, [pov]);

  const selectedNode = file ? file.nodes.find(n => n.id === selectedNodeId) || null : null;

  const handleCreate = (category: Category) => {
    createPovNode(pov, category);
    setShowNewDialog(false);
  };

  const handlePin = () => {
    if (selectedNode) {
      pinAtDepth(0, {
        type: 'pov',
        pov,
        node: structuredClone(selectedNode),
      });
    }
  };

  const handleSimilarSearch = () => {
    if (selectedNode) {
      navigateToSearchRelated(selectedNode.id);
    }
  };

  const handleRelated = () => {
    if (selectedNode) {
      showRelatedEdges(selectedNode.id);
    }
  };

  const handleAnalyze = (elementB: { label: string; description: string; category: string }) => {
    if (selectedNode) {
      void runAnalyzeDistinction(
        { label: selectedNode.label, description: selectedNode.description, category: selectedNode.category },
        elementB,
      );
    }
  };

  const showSimilarPanel = similarResults !== null || similarLoading || !!similarError;
  const showAnalysisPanel = analysisResult !== null || analysisLoading || !!analysisError;
  const showRelatedPanel = relatedNodeId !== null;
  const showEdgeDetail = selectedEdge !== null && showRelatedPanel;
  const showCruxPane = selectedCrux !== null && !showAnalysisPanel;

  // A promoted panel is active in Pane 1
  const hasToolbarPane = toolbarPanel !== null;

  // Auto-collapse pane 2 when edge detail opens; auto-expand when closed
  // Skip when toolbar=related (edge detail is in pane 2) or when NodeDetail's Related tab is active
  const prevEdgeDetailForCollapse = useRef(false);
  useEffect(() => {
    const was = prevEdgeDetailForCollapse.current;
    prevEdgeDetailForCollapse.current = showEdgeDetail;
    if (toolbarPanel === 'related') return;
    // If relatedNodeId is set but toolbar isn't 'related', NodeDetail's Related tab is handling it
    if (relatedNodeId && !toolbarPanel) return;
    if (showEdgeDetail && !was) setDetailCollapsed(true);
    if (!showEdgeDetail && was) setDetailCollapsed(false);
  }, [showEdgeDetail, toolbarPanel, relatedNodeId]);

  // Grow/shrink window for Analysis panel (child of Similar, still Pane 3)
  const prevShowAnalysis = useRef(false);
  useEffect(() => {
    const wasShowing = prevShowAnalysis.current;
    prevShowAnalysis.current = showAnalysisPanel;
    if (showAnalysisPanel === wasShowing) return;
    const delta = pane3Width + 4;
    void api.isMaximized().then((max) => {
      if (max) return;
      if (showAnalysisPanel) void api.growWindow(delta);
      else void api.shrinkWindow(delta);
    });
  }, [showAnalysisPanel]);

  // Grow/shrink window for Edge Detail panel (only in non-toolbar mode where it's a new Pane 3)
  // Skip when toolbar=related or when NodeDetail's Related tab is handling edges inline
  const prevShowEdgeDetail = useRef(false);
  useEffect(() => {
    const wasShowing = prevShowEdgeDetail.current;
    prevShowEdgeDetail.current = showEdgeDetail;
    if (showEdgeDetail === wasShowing) return;
    if (toolbarPanel === 'related') return;
    if (relatedNodeId && !toolbarPanel) return; // NodeDetail Related tab is active
    const delta = edgeDetailWidth + 4;
    void api.isMaximized().then((max) => {
      if (max) return;
      if (showEdgeDetail) void api.growWindow(delta);
      else void api.shrinkWindow(delta);
    });
  }, [showEdgeDetail, toolbarPanel, relatedNodeId]);

  // Auto-refresh related edges when selection changes while toolbar panel is open
  // Only trigger when the user explicitly opened the toolbar Related panel (not NodeDetail's Related tab)
  useEffect(() => {
    if (toolbarPanel === 'related' && selectedNode) {
      showRelatedEdges(selectedNode.id);
    }
  }, [selectedNodeId]);

  // (Similar search auto-refresh is handled by SearchPanel)

  // Search preview rendered via shared SearchPreview component

  // Lineage detail rendered via shared LineageDetailView component

  if (!file) {
    return <DataRecovery pov={pov} />;
  }

  return (
    <div className={`two-column${isPhone ? ' phone-mode' : ''}${isPhone && selectedNode && !hasToolbarPane ? ' has-selection' : ''}${mobileListOpen ? ' phone-list-open' : ''}`}>
      {/* Pane 1: Node list OR promoted toolbar panel */}
      {isFullWidthPanel(toolbarPanel, promptInspectorActive) ? (
        <div className="list-panel list-panel-full">
            {isPhone && <PhoneToolClose />}
          <ToolbarPaneRenderer
            panel={toolbarPanel}
            onSelectResult={setSearchPreviewId}
            onAnalyze={handleAnalyze}
            onSelectLineageValue={setLineagePreviewValue}
            onSelectFallacy={handleSelectFallacy}
            onSelectPrompt={handleSelectPrompt}
            onInspectorToggle={setPromptInspectorActive}
          />
        </div>
      ) : hasToolbarPane ? (
        <div className="list-panel" style={{ width }}>
            {isPhone && <PhoneToolClose />}
          <ToolbarPaneRenderer
            panel={toolbarPanel}
            onSelectResult={setSearchPreviewId}
            onAnalyze={handleAnalyze}
            onSelectLineageValue={setLineagePreviewValue}
            onSelectFallacy={handleSelectFallacy}
            onSelectPrompt={handleSelectPrompt}
            onInspectorToggle={setPromptInspectorActive}
          />
        </div>
      ) : listCollapsed && !isPhone ? (
        <div className="pane-collapsed pane-collapsed-list" onClick={() => setListCollapsed(false)} title="Expand list">
          <span className="pane-collapsed-label">{pov}</span>
        </div>
      ) : (
        <div className="list-panel" ref={listPanelRef} style={{ width }}>
          <div className="list-panel-header">
            <h2>{pov}</h2>
            <div className="list-panel-header-actions">
              <select
                className="sort-select"
                value={sortMode}
                onChange={(e) => setSortMode(e.target.value as SortMode)}
                title="Sort nodes"
              >
                <option value="id">Sort: ID</option>
                <option value="label">Sort: Label</option>
                <option value="priority">Sort: Priority</option>
                <option value="similarity">Sort: Similarity</option>
              </select>
              <button className="btn btn-sm" onClick={() => setShowNewDialog(true)}>
                + New
              </button>
              <button className="pane-collapse-btn" onClick={() => setListCollapsed(true)} title="Collapse">&lsaquo;</button>
            </div>
          </div>
          {/* Doctrinal Boundaries — collapsible section (t/126) */}
          <DoctrinalBoundariesSection pov={pov} />
          <div className="list-panel-items">
            <NodeTree
              nodes={file.nodes}
              selectedNodeId={selectedNodeId}
              onSelect={(id: string) => { nav.push({ view: 'detail', id }); setSelectedNodeId(id); }}
              sortMode={sortMode}
              similarScores={similarScoresMap}
              clusters={clusterGroups}
              clusterLoading={clusterLoading}
              misfits={clusterMisfits}
              onVisibleIdsChange={setVisibleIds}
              conflicts={nodeConflicts.conflicts}
              resolveUrl={syncStatus.pr_url}
            />
          </div>
        </div>
      )}
      {!isFullWidthPanel(toolbarPanel, promptInspectorActive) && (
        <div className="resize-handle" onMouseDown={onMouseDown} onTouchStart={onTouchStart} />
      )}
      {/* Pane 2: Detail (search preview, lineage, or normal detail) */}
      {toolbarPanel === 'search' ? (
        <div className="detail-panel">
          <SearchPreview searchPreviewId={searchPreviewId} onClear={() => setSearchPreviewId(null)} />
        </div>
      ) : toolbarPanel === 'related' ? (
        <div className="detail-panel">
          {showEdgeDetail ? (
            <EdgeDetailPanel width={0} />
          ) : (
            <div className="detail-panel-empty">Select an edge to view details</div>
          )}
        </div>
      ) : isFullWidthPanel(toolbarPanel, promptInspectorActive) ? null
      : (toolbarPanel === 'prompts' && !promptInspectorActive) ? (
        <div className="detail-panel">
          <PromptDetailPanel entry={selectedPromptEntry} />
        </div>
      ) : toolbarPanel === 'fallacy' ? (
        <div className="detail-panel">
          <FallacyDetailPanel fallacyKey={selectedFallacyKey} onSelectNode={handleFallacyNodeSelect} />
        </div>
      ) : toolbarPanel === 'lineage' ? (
        <>
          <div className="detail-panel">
            <LineageDetailView value={lineagePreviewValue} onSelectValue={setLineagePreviewValue} onOpenLink={setLineageLinkUrl} />
          </div>
          {lineageLinkUrl && (
            <>
              <div className="resize-handle" />
              <div className="webview-pane">
                <div className="webview-pane-header">
                  <span className="webview-pane-url">{lineageLinkUrl}</span>
                  <button className="btn btn-ghost btn-sm" onClick={() => setLineageLinkUrl(null)}>&times;</button>
                </div>
                {import.meta.env.VITE_TARGET === 'web'
                  ? <iframe src={lineageLinkUrl} className="webview-frame" sandbox="allow-scripts allow-same-origin" />
                  : <webview src={lineageLinkUrl} className="webview-frame" />}
              </div>
            </>
          )}
        </>
      ) : (
        <>
          {detailCollapsed && !isPhone ? (
            <div className="pane-collapsed pane-collapsed-detail" onClick={() => setDetailCollapsed(false)} title="Expand detail">
              <span className="pane-collapsed-label">Detail</span>
            </div>
          ) : (
            <div className="detail-panel" ref={detailPanelRef} data-cat={selectedNode?.category}>
              {isPhone && selectedNode ? (
                <div className="phone-detail-header">
                  <button className="phone-detail-back" onClick={() => { const entry = nav.pop(); setSelectedNodeId(entry.view === 'detail' && entry.id ? entry.id : null); }} title="Back to list">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
                    Back
                  </button>
                  <button className="phone-detail-list-toggle" onClick={() => setMobileListOpen(true)} title="Show node list">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></svg>
                  </button>
                </div>
              ) : (
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 0, lineHeight: 1 }}>
                  <button className="pane-collapse-btn" onClick={() => setDetailCollapsed(true)} title="Collapse">&lsaquo;</button>
                </div>
              )}
              {selectedNode ? (
                <NodeDetail pov={pov} node={selectedNode} onPin={handlePin} onSimilarSearch={handleSimilarSearch} onRelated={handleRelated} conflict={nodeConflicts.conflicts.get(selectedNode.id)} resolveUrl={syncStatus.pr_url} />
              ) : (
                <div className="detail-panel-empty">Select a node to edit</div>
              )}
            </div>
          )}
          {pinnedStack.length > 0 && !hasToolbarPane && <PinnedPanel />}
        </>
      )}
      {showAnalysisPanel && (
        <>
          <div className="resize-handle" onMouseDown={onPane3Resize} />
          <AnalysisPanel width={pane3Width} />
        </>
      )}
      {showCruxPane && selectedCrux && (
        <>
          <div className="resize-handle" onMouseDown={onPane3Resize} />
          <div className="pane3-crux-detail" style={{ width: pane3Width, minWidth: 300, overflow: 'auto' }}>
            <div className="pane3-crux-detail-header">
              <span>Crux Detail</span>
              <button className="pane3-close-btn" onClick={() => showCruxDetail(null)} title="Close">✕</button>
            </div>
            <CruxDetail
              crux={selectedCrux}
              onDebateClick={() => {}}
            />
          </div>
        </>
      )}
      {showNewDialog && (
        <NewNodeDialog
          onConfirm={handleCreate}
          onCancel={() => setShowNewDialog(false)}
        />
      )}
      {isPhone && (
        <div
          className={`phone-list-backdrop${mobileListOpen ? ' open' : ''}`}
          onClick={() => setMobileListOpen(false)}
        />
      )}
    </div>
  );
}
