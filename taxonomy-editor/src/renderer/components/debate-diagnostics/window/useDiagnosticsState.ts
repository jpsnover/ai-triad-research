// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useEffect, useMemo, useRef, useCallback, type RefObject } from 'react';
import { api } from '@bridge';
import { getGlobalRecorder } from '@lib/flight-recorder/index';
import type { DebateSession, EntryDiagnostics, ArgumentNetworkNode, CommitmentStore, TurnValidationTrail } from '../../../types/debate';
import { computeQbafStrengths } from '@lib/debate/qbaf';
import type { QbafNode, QbafEdge } from '@lib/debate/qbaf';
import type { NavigateCommand } from '../chat';
import type { TaxRefEdge } from '../../taxonomy/TaxonomyRefDetail';
import { countMatches } from './helpers';
import type { OverviewTab, EntryTab, UtilitySnapshot } from './types';
import { UTILITY_WEIGHTS } from './types';
import { parseHashParams } from '../../../lib/parseHash';

function countMatchesInValue(value: unknown, term: string): number {
  if (typeof value === 'string') return countMatches(value, term);
  if (Array.isArray(value)) {
    let n = 0;
    for (const item of value) n += countMatchesInValue(item, term);
    return n;
  }
  if (value && typeof value === 'object') {
    let n = 0;
    for (const v of Object.values(value as Record<string, unknown>)) n += countMatchesInValue(v, term);
    return n;
  }
  return 0;
}

type TranscriptEntry = DebateSession['transcript'][number];
type ArgumentNetwork = NonNullable<DebateSession['argument_network']>;

// --- Taxonomy data loading (extracted from loadTaxonomyData for complexity) ---
async function loadTaxNodesData(
  signal: { cancelled: boolean },
): Promise<{ nodeMap: Map<string, Record<string, unknown>>; labels: Map<string, string> } | null> {
  try {
    const files = await Promise.all([
      api.loadTaxonomyFile('accelerationist').catch((err) => { getGlobalRecorder()?.record({ type: 'system.error', component: 'diagnostics-window', level: 'warn', message: 'Failed to load accelerationist taxonomy', error: { name: (err as Error).name ?? 'Error', message: String(err) } }); return null; }),
      api.loadTaxonomyFile('safetyist').catch((err) => { getGlobalRecorder()?.record({ type: 'system.error', component: 'diagnostics-window', level: 'warn', message: 'Failed to load safetyist taxonomy', error: { name: (err as Error).name ?? 'Error', message: String(err) } }); return null; }),
      api.loadTaxonomyFile('skeptic').catch((err) => { getGlobalRecorder()?.record({ type: 'system.error', component: 'diagnostics-window', level: 'warn', message: 'Failed to load skeptic taxonomy', error: { name: (err as Error).name ?? 'Error', message: String(err) } }); return null; }),
      api.loadTaxonomyFile('situations').catch((err) => { getGlobalRecorder()?.record({ type: 'system.error', component: 'diagnostics-window', level: 'warn', message: 'Failed to load situations taxonomy', error: { name: (err as Error).name ?? 'Error', message: String(err) } }); return null; }),
    ]);
    if (signal.cancelled) return null;
    const m = new Map<string, Record<string, unknown>>();
    for (const f of files) {
      const nodes = (f as { nodes?: Record<string, unknown>[] } | null)?.nodes;
      if (!Array.isArray(nodes)) continue;
      for (const n of nodes) {
        const id = (n as { id?: string }).id;
        if (typeof id === 'string') m.set(id, n);
      }
    }
    const labels = new Map<string, string>();
    for (const [id, n] of m) {
      const label = (n as { label?: string }).label;
      if (typeof label === 'string') labels.set(id, label);
    }
    return { nodeMap: m, labels };
  } catch (err) {
    getGlobalRecorder()?.record({
      type: 'system.error', component: 'diagnostics-window', level: 'warn',
      message: 'Failed to load taxonomy files for node lookup',
      error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
    });
    return null;
  }
}

async function loadPolicyData(
  signal: { cancelled: boolean },
): Promise<Map<string, { id: string; action: string; source_povs: string[]; member_count: number }> | null> {
  try {
    const registryRaw = await api.loadPolicyRegistry() as { policies?: { id: string; action: string; source_povs: string[]; member_count: number }[] } | null;
    const policies = registryRaw?.policies;
    if (!signal.cancelled && Array.isArray(policies)) {
      const pm = new Map<string, { id: string; action: string; source_povs: string[]; member_count: number }>();
      for (const p of policies) pm.set(p.id, p);
      return pm;
    }
    return null;
  } catch (err) {
    getGlobalRecorder()?.record({
      type: 'system.error', component: 'diagnostics-window', level: 'warn',
      message: 'Failed to load policy registry',
      error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
    });
    return null;
  }
}

async function loadEdgesData(signal: { cancelled: boolean }): Promise<TaxRefEdge[] | null> {
  try {
    const raw = await api.loadEdges() as { edges?: TaxRefEdge[] } | null;
    if (signal.cancelled) return null;
    if (raw && Array.isArray(raw.edges)) return raw.edges;
    return null;
  } catch (err) {
    getGlobalRecorder()?.record({
      type: 'system.error', component: 'diagnostics-window', level: 'warn',
      message: 'Failed to load edges data',
      error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
    });
    return null;
  }
}

// --- Deep-link application (extracted from the deep-link effect for complexity) ---
interface DeepLinkSetters {
  setDebate: (d: DebateSession | null) => void;
  setDeepLinkError: (s: string | null) => void;
  setSelectedEntry: (s: string | null) => void;
  setLocalOverride: (b: boolean) => void;
  setOverviewTab: (t: OverviewTab) => void;
  setEntryTab: (t: EntryTab) => void;
}

function applyDeepLinkEntry(session: DebateSession, entryParam: string | null, setters: DeepLinkSetters): void {
  if (entryParam == null) return;
  const idx = parseInt(entryParam, 10);
  if (!isNaN(idx) && idx >= 0 && idx < session.transcript.length) {
    setters.setSelectedEntry(session.transcript[idx].id);
    setters.setLocalOverride(true);
    setters.setOverviewTab('transcript');
  } else {
    getGlobalRecorder()?.record({
      type: 'system.error', component: 'diagnostics-deep-link', level: 'warn',
      message: `Deep-link entry index out of range: ${entryParam} (transcript has ${session.transcript.length} entries)`,
    });
  }
}

function applyDeepLinkTab(params: URLSearchParams, setEntryTab: (t: EntryTab) => void): void {
  const tabParam = params.get('tab');
  if (!tabParam) return;
  const VALID_ENTRY_TABS: string[] = ['tax-refs', 'details', 'claims', 'evidence', 'citations', 'brief', 'plan', 'draft', 'lookahead', 'cite', 'moderator', 'exclusion', 'affect'];
  if (VALID_ENTRY_TABS.includes(tabParam)) {
    setEntryTab(tabParam as EntryTab);
  }
}

function applyDeepLinkOverview(params: URLSearchParams, entryParam: string | null, setOverviewTab: (t: OverviewTab) => void): void {
  const overviewParam = params.get('overviewTab');
  if (overviewParam && !entryParam) {
    const VALID_OVERVIEW_TABS: string[] = ['topic-scope', 'extraction', 'argument-network', 'commitments', 'transcript', 'convergence', 'reflections', 'gaps', 'grounding', 'lineage', 'adaptive', 'pov-progression', 'fr-context', 'prompt-diff', 'utility', 'exclusion-overview', 'emotional-register'];
    if (VALID_OVERVIEW_TABS.includes(overviewParam)) {
      setOverviewTab(overviewParam as OverviewTab);
    }
  }
}

async function applyDeepLink(
  debateId: string,
  params: URLSearchParams,
  getCancelled: () => boolean,
  setters: DeepLinkSetters,
): Promise<void> {
  const { setDebate, setDeepLinkError } = setters;
  try {
    const raw = await api.loadDebateSession(debateId);
    if (getCancelled()) return;
    if (!raw) {
      setDebate(null);
      setDeepLinkError(`Debate not found: ${debateId}`);
      getGlobalRecorder()?.record({
        type: 'system.error', component: 'diagnostics-deep-link', level: 'warn',
        message: `Deep-link debate not found: ${debateId}`,
      });
      return;
    }
    const session = raw as DebateSession;
    setDebate(session);

    const entryParam = params.get('entry');
    applyDeepLinkEntry(session, entryParam, setters);
    applyDeepLinkTab(params, setters.setEntryTab);
    applyDeepLinkOverview(params, entryParam, setters.setOverviewTab);
  } catch (err) {
    if (getCancelled()) return;
    setDeepLinkError(`Failed to load debate: ${String(err)}`);
    getGlobalRecorder()?.record({
      type: 'system.error', component: 'diagnostics-deep-link', level: 'error',
      message: `Failed to load deep-linked debate: ${debateId}`,
      error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
    });
  }
}

// --- Search match counting (extracted from matchCount for complexity) ---
function countAnMatches(an: ArgumentNetwork, sq: string): number {
  let count = 0;
  for (const n of an.nodes) count += countMatches(n.id, sq) + countMatches(n.text, sq) + countMatches(n.speaker, sq);
  for (const e of an.edges) count += countMatches(e.source, sq) + countMatches(e.warrant || '', sq) + countMatches(e.scheme || '', sq);
  return count;
}

function countDiagMatches(diag: EntryDiagnostics, sq: string): number {
  let count = 0;
  count += countMatches(diag.prompt || '', sq);
  count += countMatches(diag.raw_response || '', sq);
  count += countMatches(diag.taxonomy_context || '', sq);
  count += countMatches(diag.commitment_context || '', sq);
  if (diag.extracted_claims) {
    for (const c of diag.extracted_claims.accepted) count += countMatches(c.text, sq);
    for (const c of diag.extracted_claims.rejected) count += countMatches(c.text, sq);
  }
  const stages = (diag as unknown as Record<string, unknown>).stage_diagnostics as { work_product?: Record<string, unknown> }[] | undefined;
  if (stages) {
    for (const stage of stages) {
      if (!stage.work_product) continue;
      count += countMatchesInValue(stage.work_product, sq);
    }
  }
  return count;
}

function computeMatchCount(
  sq: string,
  debate: DebateSession | null,
  an: DebateSession['argument_network'],
  diag: EntryDiagnostics | undefined,
): number {
  if (!sq || !debate) return 0;
  let count = 0;
  if (an) count += countAnMatches(an, sq);
  for (const e of debate.transcript) count += countMatches(e.content, sq);
  if (diag) count += countDiagMatches(diag, sq);
  return count;
}

// --- Keyboard navigation (extracted from the keydown effect for complexity) ---
interface KeydownCtx {
  searchInputRef: RefObject<HTMLInputElement | null>;
  entry: TranscriptEntry | null;
  entryTab: EntryTab;
  overviewTab: OverviewTab;
  effectiveOverviewTab: OverviewTab;
  debate: DebateSession | null;
  an: DebateSession['argument_network'];
  commitments: DebateSession['commitments'];
  focusedNodeId: string | null;
  setEntryTab: (t: EntryTab) => void;
  setOverviewTab: (t: OverviewTab) => void;
  setSelectedEntry: (id: string | null) => void;
  setLocalOverride: (b: boolean) => void;
  setFocusedNodeId: (id: string | null) => void;
}

function hasGaps(debate: DebateSession): boolean {
  return !!(debate.taxonomy_gap_analysis || (debate.gap_injections && debate.gap_injections.length > 0) || (debate.cross_cutting_proposals && debate.cross_cutting_proposals.length > 0));
}

function isOverviewTabVisible(
  id: OverviewTab,
  debate: DebateSession,
  an: DebateSession['argument_network'],
  commitments: DebateSession['commitments'],
): boolean {
  if (id === 'topic-scope') return !!debate.topic?.scope;
  if (id === 'argument-network' || id === 'utility') return !!(an && an.nodes.length > 0);
  if (id === 'commitments') return !!(commitments && Object.keys(commitments).length > 0);
  if (id === 'convergence') return !!(debate.convergence_signals && debate.convergence_signals.length > 0);
  if (id === 'reflections') return debate.transcript.some(e => e.type === 'reflection');
  if (id === 'gaps') return hasGaps(debate);
  if (id === 'grounding') return debate.transcript.some(e => e.taxonomy_refs && e.taxonomy_refs.length > 0);
  return true;
}

function handleTabNav(dir: number, ctx: KeydownCtx): void {
  const { entry, entryTab, debate, an, commitments, setEntryTab, overviewTab, setOverviewTab } = ctx;
  if (entry) {
    const ENTRY_TABS: EntryTab[] = ['moderator', 'details', 'brief', 'plan', 'evidence', 'citations', 'draft', 'lookahead', 'cite', 'claims', 'exclusion', 'affect', 'tax-refs'];
    const idx = ENTRY_TABS.indexOf(entryTab);
    const next = idx + dir;
    if (next >= 0 && next < ENTRY_TABS.length) setEntryTab(ENTRY_TABS[next]);
  } else if (debate) {
    const OVERVIEW_TABS: OverviewTab[] = ['topic-scope', 'argument-network', 'commitments', 'transcript', 'extraction', 'convergence', 'reflections', 'gaps', 'grounding', 'lineage', 'adaptive', 'pov-progression', 'fr-context', 'prompt-diff', 'utility', 'exclusion-overview', 'emotional-register'];
    const visible = OVERVIEW_TABS.filter(id => isOverviewTabVisible(id, debate, an, commitments));
    const idx = visible.indexOf(overviewTab);
    const next = idx + dir;
    if (next >= 0 && next < visible.length) setOverviewTab(visible[next]);
  }
}

function focusAnNode(dir: number, an: ArgumentNetwork, focusedNodeId: string | null, setFocusedNodeId: (id: string | null) => void): void {
  const nodeIds = an.nodes.map(n => n.id);
  const curIdx = focusedNodeId ? nodeIds.indexOf(focusedNodeId) : -1;
  if (curIdx < 0) {
    setFocusedNodeId(nodeIds[dir === 1 ? 0 : nodeIds.length - 1]);
  } else {
    const nextIdx = curIdx + dir;
    if (nextIdx >= 0 && nextIdx < nodeIds.length) setFocusedNodeId(nodeIds[nextIdx]);
  }
}

function handleEntryNav(dir: number, ctx: KeydownCtx): void {
  const { entry, effectiveOverviewTab, an, focusedNodeId, setFocusedNodeId, debate, setSelectedEntry, setLocalOverride } = ctx;
  if (!debate) return;
  if (!entry && effectiveOverviewTab === 'argument-network' && an && an.nodes.length > 0) {
    focusAnNode(dir, an, focusedNodeId, setFocusedNodeId);
    return;
  }

  if (!entry) {
    if (dir === 1 && debate.transcript.length > 0) {
      setSelectedEntry(debate.transcript[0].id);
      setLocalOverride(true);
    }
    return;
  }
  const curIdx = debate.transcript.findIndex(t => t.id === entry.id);
  const nextIdx = curIdx + dir;
  if (nextIdx >= 0 && nextIdx < debate.transcript.length) {
    setSelectedEntry(debate.transcript[nextIdx].id);
    setLocalOverride(true);
  }
}

function isSearchFocusKey(e: KeyboardEvent): boolean {
  return (e.ctrlKey || e.metaKey) && e.key === 'f';
}

function isTypingTarget(e: KeyboardEvent): boolean {
  const tag = (e.target as HTMLElement)?.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

function isTabNavKey(e: KeyboardEvent): boolean {
  return e.key === 'ArrowLeft' || e.key === 'ArrowRight';
}

function isEntryNavKey(e: KeyboardEvent): boolean {
  return e.key === 'ArrowUp' || e.key === 'ArrowDown' ||
    e.key === 'p' || e.key === 'P' || e.key === 'n' || e.key === 'N';
}

function handleDiagnosticsKeydown(e: KeyboardEvent, ctx: KeydownCtx): void {
  if (isSearchFocusKey(e)) {
    e.preventDefault();
    ctx.searchInputRef.current?.focus();
    ctx.searchInputRef.current?.select();
    return;
  }
  if (isTypingTarget(e)) return;

  if (isTabNavKey(e)) {
    e.preventDefault();
    handleTabNav(e.key === 'ArrowRight' ? 1 : -1, ctx);
    return;
  }

  if (isEntryNavKey(e)) {
    if (!ctx.debate) return;
    e.preventDefault();
    handleEntryNav((e.key === 'ArrowDown' || e.key === 'n' || e.key === 'N') ? 1 : -1, ctx);
  }
}

export function useDiagnosticsState(initialData?: Record<string, unknown>) {
  const [debate, setDebate] = useState<DebateSession | null>(() => {
    if (initialData) {
      const d = initialData as { debate?: DebateSession; selectedEntry?: string };
      return (d.debate as DebateSession) ?? (initialData as unknown as DebateSession);
    }
    return null;
  });
  const [selectedEntry, setSelectedEntry] = useState<string | null>(null);
  const [localOverride, setLocalOverride] = useState(true);
  const [showHelp, setShowHelp] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [deepLinkError, setDeepLinkError] = useState<string | null>(null);
  const [entryTab, setEntryTab] = useState<EntryTab>('details');
  const tabContentRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const sidebarTranscriptRef = useRef<HTMLDivElement>(null);
  useEffect(() => { tabContentRef.current?.focus(); }, [entryTab]);
  useEffect(() => {
    if (!selectedEntry || !sidebarTranscriptRef.current) return;
    const el = sidebarTranscriptRef.current.querySelector(`[data-entry-id="${selectedEntry}"]`) as HTMLElement | null;
    el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [selectedEntry]);
  const [overviewTab, setOverviewTab] = useState<OverviewTab>('argument-network');
  const [transcriptSpeakerFilter, setTranscriptSpeakerFilter] = useState<string | null>(null);
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null);
  const [anFilterNodeId, setAnFilterNodeId] = useState('');
  const [anFilterMode, setAnFilterMode] = useState<'all' | 'unattributed' | 'novel' | 'anchored'>('all');
  const [taxNodeMap, setTaxNodeMap] = useState<Map<string, Record<string, unknown>>>(new Map());
  const [policyMap, setPolicyMap] = useState<Map<string, { id: string; action: string; source_povs: string[]; member_count: number }>>(new Map());
  const [allEdges, setAllEdges] = useState<TaxRefEdge[]>([]);
  const [selectedTaxRefId, setSelectedTaxRefId] = useState<string | null>(null);
  const [selectedPolicyId, setSelectedPolicyId] = useState<string | null>(null);
  const [textCopyMenu, setTextCopyMenu] = useState<{ x: number; y: number; text: string } | null>(null);
  const [nodeLabels, setNodeLabels] = useState<Map<string, string>>(new Map());
  useEffect(() => { setSelectedTaxRefId(null); setSelectedPolicyId(null); }, [selectedEntry]);

  // Dismiss text copy context menu on click-outside or Escape
  useEffect(() => {
    if (!textCopyMenu) return;
    const dismiss = () => setTextCopyMenu(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') dismiss(); };
    document.addEventListener('mousedown', dismiss);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', dismiss); document.removeEventListener('keydown', onKey); };
  }, [textCopyMenu]);

  const handleUpdateSubScore = useCallback((nodeId: string, key: string, value: number) => {
    setDebate(prev => {
      if (!prev?.argument_network) return prev;
      const nodes = prev.argument_network.nodes.map(n => {
        if (n.id !== nodeId || !n.bdi_sub_scores) return n;
        const updated = { ...n.bdi_sub_scores, [key]: value };
        const vals = Object.values(updated).filter((v): v is number => v != null);
        const avg = vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : n.base_strength;
        return { ...n, bdi_sub_scores: updated, base_strength: avg };
      });
      return { ...prev, argument_network: { ...prev.argument_network, nodes } };
    });
  }, []);

  const handleChatNavigate = useCallback((cmd: NavigateCommand) => {
    if (cmd.entry !== undefined) {
      if (cmd.entry === null) {
        setSelectedEntry(null);
        setLocalOverride(true);
      } else {
        setSelectedEntry(cmd.entry);
        setLocalOverride(true);
      }
    }
    if (cmd.tab) setEntryTab(cmd.tab as EntryTab);
    if (cmd.overviewTab) setOverviewTab(cmd.overviewTab as OverviewTab);
  }, []);

  // Load taxonomy, policy registry, and edges for node lookup
  const loadTaxonomyData = useCallback(async (signal: { cancelled: boolean }) => {
    const tax = await loadTaxNodesData(signal);
    if (signal.cancelled) return;
    if (tax) { setTaxNodeMap(tax.nodeMap); setNodeLabels(tax.labels); }
    const pm = await loadPolicyData(signal);
    if (pm) setPolicyMap(pm);
    const edges = await loadEdgesData(signal);
    if (edges) setAllEdges(edges);
  }, []);

  // Initial load — no ref guard; the cancellation signal handles StrictMode double-invocation
  useEffect(() => {
    const signal = { cancelled: false };
    void loadTaxonomyData(signal);
    return () => { signal.cancelled = true; };
  }, [loadTaxonomyData]);

  // Reload when taxonomy data changes (e.g., data download, taxonomy dir switch)
  useEffect(() => {
    return api.onReloadTaxonomy(() => {
      const signal = { cancelled: false };
      void loadTaxonomyData(signal);
    });
  }, [loadTaxonomyData]);

  // Apply theme
  useEffect(() => {
    const root = document.documentElement;
    if (!root.getAttribute('data-theme')) {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      root.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
    }
  }, []);

  // IPC state updates from main window
  useEffect(() => {
    const unsub = api.onDiagnosticsStateUpdate((state) => {
      const s = state as { debate: DebateSession | null; selectedEntry: string | null; forceSelect?: boolean };
      setDebate(s.debate);
      if (s.forceSelect && s.selectedEntry) {
        setSelectedEntry(s.selectedEntry);
        setOverviewTab('transcript');
        setLocalOverride(false);
      } else if (!localOverride) {
        setSelectedEntry(s.selectedEntry);
      }
    });
    return unsub;
  }, [localOverride]);

  // Deep-link: parse URL hash params on mount (debateId, entry, tab, overviewTab)
  const deepLinkApplied = useRef(false);
  useEffect(() => {
    if (deepLinkApplied.current) return;
    deepLinkApplied.current = true;
    const params = parseHashParams(window.location.hash);
    const debateId = params.get('debateId');
    if (!debateId) return;
    let cancelled = false;
    void applyDeepLink(debateId, params, () => cancelled, {
      setDebate, setDeepLinkError, setSelectedEntry, setLocalOverride, setOverviewTab, setEntryTab,
    });
    return () => { cancelled = true; };
  }, []);

  // Hash sync: push history entries when navigation state changes (enables back/forward)
  const hashSyncSkip = useRef(false);
  useEffect(() => {
    if (!debate) return;
    if (hashSyncSkip.current) {
      hashSyncSkip.current = false;
      return;
    }
    const parts: string[] = [`debateId=${encodeURIComponent(debate.id)}`];
    if (selectedEntry) {
      const idx = debate.transcript.findIndex(e => e.id === selectedEntry);
      if (idx >= 0) {
        parts.push(`entry=${idx}`);
        parts.push(`tab=${entryTab}`);
      }
    } else {
      parts.push(`overviewTab=${overviewTab}`);
    }
    const newHash = `#diagnostics-window?${parts.join('&')}`;
    if (window.location.hash !== newHash) {
      history.pushState(null, '', newHash);
    }
  }, [debate, selectedEntry, entryTab, overviewTab]);

  // Popstate: restore state from hash when user presses back/forward
  useEffect(() => {
    const onPopState = () => {
      const params = parseHashParams(window.location.hash);
      const entryParam = params.get('entry');
      const tabParam = params.get('tab');
      const overviewParam = params.get('overviewTab');
      hashSyncSkip.current = true;
      if (entryParam != null && debate) {
        const idx = parseInt(entryParam, 10);
        if (!isNaN(idx) && idx >= 0 && idx < debate.transcript.length) {
          setSelectedEntry(debate.transcript[idx].id);
          setLocalOverride(true);
        }
      } else {
        setSelectedEntry(null);
        setLocalOverride(true);
      }
      if (tabParam) setEntryTab(tabParam as EntryTab);
      if (overviewParam) setOverviewTab(overviewParam as OverviewTab);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [debate]);

  // Derived values
  const entry = selectedEntry ? debate?.transcript.find(e => e.id === selectedEntry) ?? null : null;
  const diag: EntryDiagnostics | undefined = selectedEntry ? debate?.diagnostics?.entries[selectedEntry] : undefined;
  const turnValTrail: TurnValidationTrail | undefined = selectedEntry ? debate?.turn_validations?.[selectedEntry] : undefined;
  const meta = entry?.metadata as Record<string, unknown> | undefined;
  const an = debate?.argument_network;
  const commitments = debate?.commitments;

  const nodeWeights = useMemo(() => {
    const map = new Map<string, { confidence?: number; priority?: number; operationality?: number; category?: string }>();
    for (const [id, n] of taxNodeMap) {
      const rec = n as { confidence?: number; priority?: number; operationality?: number; category?: string };
      map.set(id, { confidence: rec.confidence, priority: rec.priority, operationality: rec.operationality, category: rec.category });
    }
    return map;
  }, [taxNodeMap]);

  const proxiedModeratorTrace = useMemo(() => {
    if (!entry || entry.speaker !== 'system' || meta?.moderator_trace) return null;
    if (!debate?.transcript) return null;
    const idx = debate.transcript.findIndex(e => e.id === entry.id);
    if (idx < 0) return null;
    for (let i = idx + 1; i < debate.transcript.length; i++) {
      const next = debate.transcript[i];
      const nextMeta = next.metadata as Record<string, unknown> | undefined;
      if (nextMeta?.moderator_trace) return nextMeta.moderator_trace as Record<string, unknown>;
      if (next.type === 'statement' || next.type === 'opening') break;
    }
    return null;
  }, [entry, debate?.transcript, meta]);

  const effectiveOverviewTab: OverviewTab = useMemo(() => {
    if (!debate) return overviewTab;
    const hasAn = !!(an && an.nodes.length > 0);
    const hasCommitments = !!(commitments && Object.keys(commitments).length > 0);
    const tabVisibility: Record<OverviewTab, boolean> = {
      'topic-scope': !!debate.topic?.scope,
      'argument-network': hasAn,
      'commitments': hasCommitments,
      'transcript': true,
      'extraction': true,
      'convergence': !!(debate.convergence_signals && debate.convergence_signals.length > 0),
      'reflections': debate.transcript.some(e => e.type === 'reflection'),
      'gaps': !!(debate.taxonomy_gap_analysis || (debate.gap_injections && debate.gap_injections.length > 0) || (debate.cross_cutting_proposals && debate.cross_cutting_proposals.length > 0)),
      'grounding': debate.transcript.some(e => e.taxonomy_refs && e.taxonomy_refs.length > 0),
      'lineage': !!(debate.topic.critique?.lineage_frame && debate.topic.critique.lineage_frame.length > 0),
      'adaptive': !!(debate as unknown as Record<string, unknown>).adaptive_staging_diagnostics,
      'pov-progression': true,
      'prompt-diff': true,
      'utility': hasAn,
      'fr-context': true,
      'exclusion-overview': true,
      'emotional-register': true,
    };
    return tabVisibility[overviewTab] ? overviewTab : 'transcript';
  }, [overviewTab, debate, an, commitments]);

  const perTurnUtilities: UtilitySnapshot[] = useMemo(() => {
    if (!an || an.nodes.length === 0 || !debate) return [];
    const turnNumbers = [...new Set(an.nodes.map(n => n.turn_number))].sort((a, b) => a - b);
    const speakers = [...new Set(an.nodes.filter(n => n.speaker !== 'system' && n.speaker !== 'document').map(n => n.speaker))];
    const cruxes = debate.crux_tracker ?? [];

    return turnNumbers.map(turn => {
      const nodesUpTo = an.nodes.filter(n => n.turn_number <= turn);
      const turnNode = an.nodes.find(n => n.turn_number === turn);

      const byAgent: Record<string, { position_strength: number; attack_effectiveness: number; crux_engagement: number; composite: number }> = {};
      for (const speaker of speakers) {
        const w = UTILITY_WEIGHTS[speaker] ?? { position: 0.33, attack: 0.34, crux: 0.33 };
        const agentNodes = nodesUpTo.filter(n => n.speaker === speaker);
        const undefeated = agentNodes.filter(n => (n.computed_strength ?? n.base_strength ?? 0.5) >= 0.3);
        const position_strength = undefeated.length > 0
          ? undefeated.reduce((s, n) => s + (n.computed_strength ?? n.base_strength ?? 0.5), 0) / undefeated.length : 0;
        const opponentNodes = nodesUpTo.filter(n => n.speaker !== speaker && n.speaker !== 'system' && n.speaker !== 'document');
        const attack_effectiveness = opponentNodes.length > 0
          ? opponentNodes.filter(n => (n.computed_strength ?? n.base_strength ?? 0.5) < 0.3).length / opponentNodes.length : 0;
        let crux_engagement = 0;
        if (cruxes.length > 0) {
          const addressed = cruxes.filter(c =>
            c.speakers_involved.includes(speaker) ||
            c.attacking_claim_ids.some((id: string) => nodesUpTo.some(n => n.id === id && n.speaker === speaker)),
          ).length;
          crux_engagement = addressed / cruxes.length;
        }
        const composite = w.position * position_strength + w.attack * attack_effectiveness + w.crux * crux_engagement;
        byAgent[speaker] = { position_strength, attack_effectiveness, crux_engagement, composite };
      }
      return { turn, entryId: turnNode?.source_entry_id ?? '', speaker: turnNode?.speaker ?? '', byAgent };
    });
  }, [an, debate]);

  const sq = searchQuery.trim();

  const matchCount = useMemo(() => computeMatchCount(sq, debate, an, diag), [sq, debate, an, diag]);

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => handleDiagnosticsKeydown(e, {
      searchInputRef, entry, entryTab, overviewTab, effectiveOverviewTab,
      debate, an, commitments, focusedNodeId,
      setEntryTab, setOverviewTab, setSelectedEntry, setLocalOverride, setFocusedNodeId,
    });
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [debate, entry, entryTab, overviewTab, effectiveOverviewTab, an, commitments, focusedNodeId]);

  return {
    debate, setDebate,
    selectedEntry, setSelectedEntry,
    localOverride, setLocalOverride,
    showHelp, setShowHelp,
    searchQuery, setSearchQuery, sq,
    entryTab, setEntryTab,
    overviewTab, setOverviewTab,
    transcriptSpeakerFilter, setTranscriptSpeakerFilter,
    focusedNodeId, setFocusedNodeId,
    anFilterNodeId, setAnFilterNodeId,
    anFilterMode, setAnFilterMode,
    taxNodeMap, policyMap, allEdges,
    selectedTaxRefId, setSelectedTaxRefId,
    selectedPolicyId, setSelectedPolicyId,
    textCopyMenu, setTextCopyMenu,
    nodeLabels,
    tabContentRef, searchInputRef, sidebarTranscriptRef,
    handleUpdateSubScore, handleChatNavigate,
    entry, diag, turnValTrail, meta,
    an, commitments,
    nodeWeights, proxiedModeratorTrace,
    effectiveOverviewTab, perTurnUtilities, matchCount,
    deepLinkError,
  };
}

export type DiagnosticsState = ReturnType<typeof useDiagnosticsState>;
