// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
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
    try {
      const files = await Promise.all([
        api.loadTaxonomyFile('accelerationist').catch((err) => { getGlobalRecorder()?.record({ type: 'system.error', component: 'diagnostics-window', level: 'warn', message: 'Failed to load accelerationist taxonomy', error: { name: (err as Error).name ?? 'Error', message: String(err) } }); return null; }),
        api.loadTaxonomyFile('safetyist').catch((err) => { getGlobalRecorder()?.record({ type: 'system.error', component: 'diagnostics-window', level: 'warn', message: 'Failed to load safetyist taxonomy', error: { name: (err as Error).name ?? 'Error', message: String(err) } }); return null; }),
        api.loadTaxonomyFile('skeptic').catch((err) => { getGlobalRecorder()?.record({ type: 'system.error', component: 'diagnostics-window', level: 'warn', message: 'Failed to load skeptic taxonomy', error: { name: (err as Error).name ?? 'Error', message: String(err) } }); return null; }),
        api.loadTaxonomyFile('situations').catch((err) => { getGlobalRecorder()?.record({ type: 'system.error', component: 'diagnostics-window', level: 'warn', message: 'Failed to load situations taxonomy', error: { name: (err as Error).name ?? 'Error', message: String(err) } }); return null; }),
      ]);
      if (signal.cancelled) return;
      const m = new Map<string, Record<string, unknown>>();
      for (const f of files) {
        const nodes = (f as { nodes?: Record<string, unknown>[] } | null)?.nodes;
        if (!Array.isArray(nodes)) continue;
        for (const n of nodes) {
          const id = (n as { id?: string }).id;
          if (typeof id === 'string') m.set(id, n);
        }
      }
      setTaxNodeMap(m);
      const labels = new Map<string, string>();
      for (const [id, n] of m) {
        const label = (n as { label?: string }).label;
        if (typeof label === 'string') labels.set(id, label);
      }
      setNodeLabels(labels);
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error', component: 'diagnostics-window', level: 'warn',
        message: 'Failed to load taxonomy files for node lookup',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
    }
    try {
      const registryRaw = await api.loadPolicyRegistry() as { policies?: { id: string; action: string; source_povs: string[]; member_count: number }[] } | null;
      const policies = registryRaw?.policies;
      if (!signal.cancelled && Array.isArray(policies)) {
        const pm = new Map<string, { id: string; action: string; source_povs: string[]; member_count: number }>();
        for (const p of policies) pm.set(p.id, p);
        setPolicyMap(pm);
      }
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error', component: 'diagnostics-window', level: 'warn',
        message: 'Failed to load policy registry',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
    }
    try {
      const raw = await api.loadEdges() as { edges?: TaxRefEdge[] } | null;
      if (signal.cancelled) return;
      if (raw && Array.isArray(raw.edges)) setAllEdges(raw.edges);
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error', component: 'diagnostics-window', level: 'warn',
        message: 'Failed to load edges data',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
    }
  }, []);

  // Initial load
  const taxLoadedRef = useRef(false);
  useEffect(() => {
    if (taxLoadedRef.current) return;
    taxLoadedRef.current = true;
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

  const matchCount = useMemo(() => {
    if (!sq || !debate) return 0;
    let count = 0;
    if (an) {
      for (const n of an.nodes) count += countMatches(n.id, sq) + countMatches(n.text, sq) + countMatches(n.speaker, sq);
      for (const e of an.edges) count += countMatches(e.source, sq) + countMatches(e.warrant || '', sq) + countMatches(e.scheme || '', sq);
    }
    for (const e of debate.transcript) count += countMatches(e.content, sq);
    if (diag) {
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
    }
    return count;
  }, [sq, debate, an, diag]);

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        return;
      }
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        const dir = e.key === 'ArrowRight' ? 1 : -1;
        if (entry) {
          const ENTRY_TABS: EntryTab[] = ['moderator', 'details', 'brief', 'plan', 'evidence', 'citations', 'draft', 'lookahead', 'cite', 'claims', 'tax-refs'];
          const idx = ENTRY_TABS.indexOf(entryTab);
          const next = idx + dir;
          if (next >= 0 && next < ENTRY_TABS.length) setEntryTab(ENTRY_TABS[next]);
        } else if (debate) {
          const OVERVIEW_TABS: OverviewTab[] = ['topic-scope', 'argument-network', 'commitments', 'transcript', 'extraction', 'convergence', 'reflections', 'gaps', 'grounding', 'lineage', 'adaptive', 'pov-progression', 'fr-context', 'prompt-diff', 'utility', 'exclusion-overview'];
          const visible = OVERVIEW_TABS.filter(id => {
            if (id === 'topic-scope') return !!debate.topic?.scope;
            if (id === 'argument-network' || id === 'utility') return !!(an && an.nodes.length > 0);
            if (id === 'commitments') return !!(commitments && Object.keys(commitments).length > 0);
            if (id === 'convergence') return !!(debate.convergence_signals && debate.convergence_signals.length > 0);
            if (id === 'reflections') return debate.transcript.some(e => e.type === 'reflection');
            if (id === 'gaps') return !!(debate.taxonomy_gap_analysis || (debate.gap_injections && debate.gap_injections.length > 0) || (debate.cross_cutting_proposals && debate.cross_cutting_proposals.length > 0));
            if (id === 'grounding') return debate.transcript.some(e => e.taxonomy_refs && e.taxonomy_refs.length > 0);
            return true;
          });
          const idx = visible.indexOf(overviewTab);
          const next = idx + dir;
          if (next >= 0 && next < visible.length) setOverviewTab(visible[next]);
        }
        return;
      }

      if (e.key === 'ArrowUp' || e.key === 'ArrowDown' ||
          e.key === 'p' || e.key === 'P' || e.key === 'n' || e.key === 'N') {
        if (!debate) return;
        e.preventDefault();
        const dir = (e.key === 'ArrowDown' || e.key === 'n' || e.key === 'N') ? 1 : -1;

        if (!entry && effectiveOverviewTab === 'argument-network' && an && an.nodes.length > 0) {
          const nodeIds = an.nodes.map(n => n.id);
          const curIdx = focusedNodeId ? nodeIds.indexOf(focusedNodeId) : -1;
          if (curIdx < 0) {
            setFocusedNodeId(nodeIds[dir === 1 ? 0 : nodeIds.length - 1]);
          } else {
            const nextIdx = curIdx + dir;
            if (nextIdx >= 0 && nextIdx < nodeIds.length) setFocusedNodeId(nodeIds[nextIdx]);
          }
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
    };
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
  };
}

export type DiagnosticsState = ReturnType<typeof useDiagnosticsState>;
