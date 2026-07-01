// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * EntryDetailRouter — renders the entry detail panel for a selected transcript entry.
 *
 * Extracted from DiagnosticsWindow.tsx (lines 3830-8268).
 * Includes: entry header, proxied moderator trace, tab bar, tab content routing,
 * and text copy context menu.
 *
 * Four tabs delegate to extracted components:
 *   - DraftTab, ClaimsTab, EvidenceTab, CitationsTab (from ./entry-tabs)
 *
 * Remaining tabs (moderator, details, brief, plan, lookahead, cite, tax-refs)
 * are rendered inline.
 */

import React, { useMemo } from 'react';
import type {
  DebateSession,
  EntryDiagnostics,
  ArgumentNetworkNode,
  ArgumentNetworkEdge,
  CommitmentStore,
  TurnValidationTrail,
} from '../../../types/debate';
import { getGlobalRecorder, type FlightRecorderEvent } from '@lib/flight-recorder/index';
import { TaxonomyRefDetail, type TaxRefEdge } from '../../taxonomy/TaxonomyRefDetail';
import { speakerLabel } from './helpers';
import { api } from '@bridge';
import { EntryTab, OverviewTab, UtilitySnapshot } from './types';
import { ModeratorTab } from './shared';
import {
  DraftTab, ClaimsTab, EvidenceTab, CitationsTab,
  TaxRefsTab, DetailsTab, BriefTab, PlanTab, LookaheadTab, CiteTab,
  ExclusionGuardTab, AffectTab,
} from './entry-tabs';

// TensionsListDetail, DebateExchangeRich, ModeratorTab → extracted to ./shared/
// ---------------------------------------------------------------------------
// Props interface
// ---------------------------------------------------------------------------

export interface EntryDetailRouterProps {
  debate: DebateSession;
  entry: DebateSession['transcript'][number];
  entryIdx: number;
  diag: EntryDiagnostics | undefined;
  meta: Record<string, unknown> | undefined;
  turnValTrail: TurnValidationTrail | undefined;
  an: { nodes: ArgumentNetworkNode[]; edges: ArgumentNetworkEdge[] } | undefined;
  commitments: CommitmentStore | undefined;
  entryTab: EntryTab;
  setEntryTab: (tab: EntryTab) => void;
  effectiveOverviewTab: OverviewTab;
  selectedEntry: string | null;
  setSelectedEntry: (id: string | null) => void;
  setOverviewTab: (tab: OverviewTab) => void;
  setLocalOverride: (v: boolean) => void;
  proxiedModeratorTrace: Record<string, unknown> | null;
  taxNodeMap: Map<string, Record<string, unknown>>;
  policyMap: Map<string, { id: string; action: string; source_povs: string[]; member_count: number }>;
  allEdges: TaxRefEdge[];
  nodeWeights: Map<string, { confidence?: number; priority?: number; operationality?: number; category?: string }>;
  selectedTaxRefId: string | null;
  setSelectedTaxRefId: (id: string | null) => void;
  selectedPolicyId: string | null;
  setSelectedPolicyId: (id: string | null) => void;
  textCopyMenu: { x: number; y: number; text: string } | null;
  setTextCopyMenu: (menu: { x: number; y: number; text: string } | null) => void;
  tabContentRef: React.RefObject<HTMLDivElement | null>;
  searchQuery: string;
  perTurnUtilities: UtilitySnapshot[];
  nodeLabels: Map<string, string>;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function EntryDetailRouter({
  debate,
  entry,
  entryIdx,
  diag,
  meta,
  turnValTrail,
  an,
  commitments,
  entryTab,
  setEntryTab,
  effectiveOverviewTab,
  selectedEntry,
  setSelectedEntry,
  setOverviewTab,
  setLocalOverride,
  proxiedModeratorTrace,
  taxNodeMap,
  policyMap,
  allEdges,
  nodeWeights,
  selectedTaxRefId,
  setSelectedTaxRefId,
  selectedPolicyId,
  setSelectedPolicyId,
  textCopyMenu,
  setTextCopyMenu,
  tabContentRef,
  searchQuery,
  perTurnUtilities,
  nodeLabels,
}: EntryDetailRouterProps) {
  const totalEntries = debate.transcript.length;
  const stmtId = entryIdx >= 0 ? `S${entryIdx + 1}` : '';
  const goToIdx = (i: number) => {
    if (i < 0 || i >= totalEntries) return;
    setSelectedEntry(debate.transcript[i].id);
    setLocalOverride(true);
  };
  const navBtnStyle = (disabled: boolean): React.CSSProperties => ({
    padding: '2px 8px', fontSize: '0.7rem', fontWeight: 600,
    borderRadius: 4, border: '1px solid var(--border)',
    background: disabled ? 'transparent' : 'rgba(249,115,22,0.1)',
    color: disabled ? 'var(--text-muted)' : '#f97316',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.5 : 1,
  });

  // ── Compute tab data presence ──
  const taxRefCount = entry.taxonomy_refs?.length ?? 0;
  const hasClaims = !!(
    diag?.extracted_claims ||
    (meta?.my_claims && (meta.my_claims as unknown[]).length > 0)
  );
  const evidenceStage = diag?.stage_diagnostics?.find(s => s.stage === 'evidence');
  const evidenceWP = evidenceStage?.work_product as {
    facts?: { claim: string; claim_label: string; doc_id: string; specificity: string; temporal_bound?: string | null; linked_taxonomy_nodes: string[] }[];
    keyPoints?: { stance: string; point: string; doc_id: string; pov: string; verbatim?: string }[];
    nodesCovered?: string[];
    totalCandidates?: number;
  } | undefined;
  const extTrace = diag?.extraction_trace as {
    candidates_proposed: number; candidates_accepted: number; candidates_rejected: number;
    rejection_reasons: Record<string, number>;
    an_node_count_before: number; an_node_count_after: number;
    an_nodes_added_ids: string[];
  } | undefined;
  const evidenceFactCount = (evidenceWP?.facts?.length ?? 0) + (evidenceWP?.keyPoints?.length ?? 0);
  const hasEvidence = !!evidenceStage || !!extTrace;
  const _draftForCitations = (diag?.stage_diagnostics?.filter(s => s.stage === 'draft') ?? []).slice(-1)[0];
  const citationResDiag = _draftForCitations?.citation_resolution as {
    path: 'tool-calling' | 'bank-scrub';
    bank_size: number; bank_sources: string[];
    citations_extracted: number; citations_matched: number; citations_fabricated: number;
    resolution_time_ms: number;
    matches: { citation_text: string; doc_id: string; title: string; similarity: number; match_type: 'exact' | 'fuzzy_title' | 'url' | 'arxiv_id' }[];
    fabrications: { citation_text: string; pattern: string; action: 'removed' | 'hedged'; replacement?: string }[];
    tool_calls?: { query: string; source_type?: string; results_count: number; top_result?: { doc_id: string; title: string; relevance: number }; time_ms: number; empty: boolean }[];
    scrub_diff?: { lines_removed: number; lines_modified: number; original_length: number; cleaned_length: number };
    scrub_original?: string;
    warnings: string[];
  } | undefined;
  const hasExclusionData = !!(
    (diag?.extraction_trace as Record<string, unknown> | undefined)?.exclusion_guard ||
    (diag?.extraction_trace as Record<string, unknown> | undefined)?.exclusion_violations ||
    (diag as Record<string, unknown> | undefined)?.scope_drift_check ||
    (diag as Record<string, unknown> | undefined)?.scope_drift_warnings ||
    (diag?.extraction_trace && entry.type === 'statement')
  );
  const hasCitations = !!citationResDiag;
  const citationsCount = citationResDiag?.citations_extracted ?? 0;
  const hasPrecedingIntervention = (() => {
    if (!debate?.transcript || entryIdx <= 0) return false;
    for (let i = entryIdx - 1; i >= 0; i--) {
      const t = debate.transcript[i];
      if (t.type === 'intervention' && t.speaker === 'moderator') return true;
      if (t.type === 'statement' || t.type === 'opening') return false;
    }
    return false;
  })();
  const hasSuppressedIntervention = !!(
    (meta?.moderator_trace as Record<string, unknown> | undefined)?.intervention_recommended
    && !(meta?.moderator_trace as Record<string, unknown> | undefined)?.intervention_validated
  );
  const hasDetails = !!(
    hasPrecedingIntervention || hasSuppressedIntervention ||
    (meta?.key_assumptions && (meta.key_assumptions as unknown[]).length > 0) ||
    (meta?.policy_refs as string[])?.length || (entry.policy_refs?.length ?? 0) > 0 ||
    diag?.model ||
    diag?.commitment_context ||
    diag?.edge_tensions ||
    diag?.argument_network_context ||
    (meta?.move_types && (meta.move_types as unknown[]).length > 0) ||
    (entry.type === 'statement' && diag && (diag.stage_diagnostics?.length ?? 0) > 0 && !diag.extracted_claims && !extTrace)
  );
  const claimsCopy = [
    ...(diag?.extracted_claims ? [...diag.extracted_claims.accepted.map(c => { const anN = debate?.argument_network?.nodes?.find(n => n.id === c.id); return `✓ ${c.id} (${c.overlap_pct}%): ${c.text}${anN?.attribution_text_genus ? `\n  [Attribution: ${anN.attribution_text_genus}]` : ''}`; }), ...diag.extracted_claims.rejected.map(c => `✗ (${c.overlap_pct}%): ${c.text} — ${c.reason}`)] : []),
    ...((meta?.my_claims as { claim: string; targets: string[] }[])?.map((c, i) => `${i + 1}. ${c.claim}${c.targets?.length > 0 ? ` → ${c.targets.join(', ')}` : ''}`) ?? []),
  ].join('\n');
  const stages = diag?.stage_diagnostics;
  const briefAttempts = stages?.filter(s => s.stage === 'brief') ?? [];
  const planAttempts = stages?.filter(s => s.stage === 'plan') ?? [];
  const draftAttempts = stages?.filter(s => s.stage === 'draft') ?? [];
  const citeAttempts = stages?.filter(s => s.stage === 'cite') ?? [];
  const postDraftStage = stages?.find(s => s.stage === 'postDraft');
  const draftQualityStage = stages?.find(s => s.stage === 'draft_quality');
  const briefStage = briefAttempts.length > 0 ? briefAttempts[briefAttempts.length - 1] : undefined;
  const planStage = planAttempts.length > 0 ? planAttempts[planAttempts.length - 1] : undefined;
  const draftStage = draftAttempts.length > 0 ? draftAttempts[draftAttempts.length - 1] : undefined;
  const citeStage = citeAttempts.length > 0 ? citeAttempts[citeAttempts.length - 1] : undefined;
  const pipelineError = entry.type === 'statement' && !!diag && (stages?.length ?? 0) > 0 && !diag.extracted_claims && !extTrace;

  const entryErrors = useMemo(() => {
    const recorder = getGlobalRecorder();
    if (!recorder || entryIdx < 0) return [];
    const snap = recorder.snapshot();
    return snap.events.filter((e): e is FlightRecorderEvent & { error: NonNullable<FlightRecorderEvent['error']> } =>
      e.type === 'system.error' &&
      e.level === 'error' &&
      e.debate_id === debate.id &&
      !!(e.data as Record<string, unknown> | undefined)?.transcript_length &&
      (e.data as Record<string, unknown>).transcript_length === entryIdx + 1
    );
  }, [debate.id, entryIdx]);

  const lookaheadDiag = (diag as Record<string, unknown> | undefined)?.lookahead as {
    stage: 'lookahead';
    first_attempt: { pass: boolean; utility_before: { position_strength: number; attack_effectiveness: number; crux_engagement: number; composite: number; concession_asymmetry: number }; utility_after: { position_strength: number; attack_effectiveness: number; crux_engagement: number; composite: number; concession_asymmetry: number }; utility_delta: number; threshold: number; tentative_claims: { text: string; strength: number }[]; tentative_network_size: { nodes: number; edges: number } };
    regen_triggered: boolean;
    regen_attempt?: { pass: boolean; utility_before: { composite: number }; utility_after: { composite: number }; utility_delta: number; threshold: number; tentative_claims: { text: string; strength: number }[]; tentative_network_size: { nodes: number; edges: number } };
    regen_attempts?: { pass: boolean; utility_before: { composite: number }; utility_after: { composite: number }; utility_delta: number; threshold: number; tentative_claims: { text: string; strength: number }[]; tentative_network_size: { nodes: number; edges: number } }[];
    per_claim_analysis?: { perClaim: { index: number; text: string; base_strength: number; marginal_delta: number; classification: 'STRONG' | 'WEAK'; dominant_component: string }[]; analysis: { strongFoundations: { text: string; base_strength: number; marginal_delta: number; reason: string }[]; avoidClaims: { text: string; base_strength: number; marginal_delta: number; reason: string }[] } }[];
    final_pass: boolean;
    elapsed_ms: number;
  } | undefined;

  // Build all draft stages across ALL orchestration attempts (t/504).
  type DraftAttemptEntry = typeof draftAttempts[number] & {
    orchestrationRun: number;
    stageRetryIndex: number;
    stageRetryCount: number;
  };
  const orchAttempts = turnValTrail?.attempts ?? [];
  const allDraftAttempts: DraftAttemptEntry[] = orchAttempts.length > 0
    ? orchAttempts.flatMap((a, runIdx) => {
        const drafts = (a.stage_diagnostics ?? []).filter(s => s.stage === 'draft');
        return drafts.map((s, di) => ({
          ...s, orchestrationRun: runIdx, stageRetryIndex: di, stageRetryCount: drafts.length,
        }));
      })
    : [];
  const hasMultipleOrchRuns = orchAttempts.length > 1;
  const effectiveDraftAttempts: (typeof draftAttempts[number] & {
    orchestrationRun?: number; stageRetryIndex?: number; stageRetryCount?: number;
  })[] =
    allDraftAttempts.length > 0
      ? allDraftAttempts
      : draftAttempts.map((s, i, arr) => ({
          ...s, orchestrationRun: undefined, stageRetryIndex: i, stageRetryCount: arr.length,
        }));

  // Find preceding moderator intervention for this entry
  const precedingIntervention = (() => {
    if (!debate?.transcript || entryIdx <= 0) return null;
    for (let i = entryIdx - 1; i >= 0; i--) {
      const t = debate.transcript[i];
      if (t.type === 'intervention' && t.speaker === 'moderator') return t;
      if (t.type === 'statement' || t.type === 'opening') break;
    }
    return null;
  })();
  const citeWorkProduct = citeStage?.work_product as Record<string, unknown> | undefined;
  const pinResponse = citeWorkProduct?.pin_response as {
    position?: string; condition?: string; brief_reason?: string;
  } | undefined;
  const interventionResponseField = (() => {
    if (!precedingIntervention) return null;
    const intMove = (precedingIntervention.intervention_metadata as { move?: string } | undefined)?.move;
    const fieldMap: Record<string, string> = {
      PIN: 'pin_response', PROBE: 'probe_response', CHALLENGE: 'challenge_response',
      CLARIFY: 'clarification', CHECK: 'check_response', REVOICE: 'revoice_response',
      'META-REFLECT': 'reflection', COMPRESS: 'compressed_thesis', COMMIT: 'commitment',
    };
    const field = intMove ? fieldMap[intMove] : undefined;
    if (field) {
      const citeVal = citeWorkProduct?.[field] as Record<string, unknown> | string | undefined;
      if (citeVal) return citeVal;
      const draftWP = draftStage?.work_product as Record<string, unknown> | undefined;
      const draftVal = draftWP?.[field] as Record<string, unknown> | string | undefined;
      if (draftVal) return draftVal;
    }
    const planWP = planStage?.work_product as Record<string, unknown> | undefined;
    const dr = planWP?.directive_response as { directive?: string; how_addressed?: string } | undefined;
    if (dr?.how_addressed) return { from_plan: true, how_addressed: dr.how_addressed, directive: dr.directive } as unknown as Record<string, unknown>;
    return null;
  })();

  const modTrace = (meta?.moderator_trace ?? proxiedModeratorTrace) as {
    selected?: string; focus_point?: string; selection_reason?: string;
    excluded_last_speaker?: string | null; recent_scheme?: string | null;
    convergence_score?: number | null; convergence_triggered?: boolean;
    candidates?: { debater: string; computed_strength: number | null; rank: number }[];
    commitment_snapshot?: Record<string, { asserted: number; conceded: number; challenged: number }>;
    selection_prompt?: string; selection_response?: string;
    intervention_recommended?: boolean; intervention_move?: string | null;
    intervention_validated?: boolean; intervention_suppressed_reason?: string | null;
    intervention_suppression_explanation?: string | null;
    intervention_target?: string | null; trigger_reasoning?: string | null;
  } | null;
  const suppressedIntervention = modTrace?.intervention_recommended && !modTrace.intervention_validated
    ? modTrace : null;
  const hasModTab = !!modTrace;

  const stageRan = (stages?.length ?? 0) > 0;
  const tabs: { id: EntryTab; label: string; count?: number; has: boolean; ranEmpty?: boolean; copy: string }[] = [
    { id: 'moderator', label: 'Moderator-Pre', has: hasModTab, copy: modTrace?.selection_prompt ?? '' },
    { id: 'details', label: 'Overview', has: hasDetails, copy: '' },
    { id: 'brief', label: 'Brief', has: !!briefStage, copy: JSON.stringify(briefStage?.work_product, null, 2) ?? '' },
    { id: 'plan', label: 'Plan', has: !!planStage, copy: JSON.stringify(planStage?.work_product, null, 2) ?? '' },
    { id: 'evidence', label: 'Evidence', count: evidenceFactCount || undefined, has: hasEvidence, ranEmpty: !hasEvidence && stageRan && entry.type === 'statement' && !pipelineError, copy: evidenceStage?.raw_response ?? '' },
    { id: 'citations', label: 'Citations', count: citationsCount || undefined, has: hasCitations, ranEmpty: !hasCitations && !!draftStage && entry.type === 'statement' && !pipelineError, copy: citationResDiag ? JSON.stringify(citationResDiag, null, 2) : '' },
    { id: 'draft', label: 'Draft', has: !!(draftStage || entry.content), copy: draftStage ? (JSON.stringify(draftStage?.work_product, null, 2) ?? '') : (typeof entry.content === 'string' ? entry.content : JSON.stringify(entry.content, null, 2)) },
    { id: 'lookahead', label: 'Lookahead', has: !!lookaheadDiag, copy: lookaheadDiag ? JSON.stringify(lookaheadDiag, null, 2) : '' },
    { id: 'cite', label: 'Cite', has: !!citeStage, copy: JSON.stringify(citeStage?.work_product, null, 2) ?? '' },
    { id: 'claims', label: 'Claims', has: hasClaims, ranEmpty: !hasClaims && stageRan && entry.type === 'statement' && !pipelineError, copy: claimsCopy },
    { id: 'exclusion', label: 'Exclusion', has: hasExclusionData, copy: '' },
    { id: 'affect', label: 'Affect', has: !!((entry.type === 'statement' || entry.type === 'opening') && entry.speaker !== 'system' && entry.speaker !== 'moderator' && entry.content && typeof entry.content === 'string' && entry.content.split(/\s+/).length >= 20), copy: '' },
    { id: 'tax-refs', label: 'Taxonomy Refs', count: taxRefCount, has: taxRefCount > 0, copy: entry.taxonomy_refs?.map(r => `${r.node_id}: ${r.relevance}`).join('\n') ?? '' },
  ];
  const tabEnabled = (t: typeof tabs[0]) => t.has || !!t.ranEmpty;
  // If the current tab has no data, auto-select the first tab that does (prefer has over ranEmpty).
  const activeTab = tabs.find(t => t.id === entryTab && tabEnabled(t))
    ? entryTab
    : (tabs.find(t => t.has)?.id ?? tabs.find(t => t.ranEmpty)?.id ?? 'details');
  const active = tabs.find(t => t.id === activeTab)!;
  const handleCopy = () => { if (active.copy) navigator.clipboard?.writeText(active.copy).catch((err) => { getGlobalRecorder()?.record({ type: 'system.error', component: 'diagnostics-entry-detail', level: 'warn', message: 'Clipboard write failed', error: { name: (err as Error).name ?? 'Error', message: String(err) } }); }); };

  const tabBtnStyle = (t: typeof tabs[0]): React.CSSProperties => {
    const enabled = tabEnabled(t);
    return {
      padding: '6px 12px',
      fontSize: '0.75rem',
      fontWeight: 600,
      border: '1px solid var(--border)',
      borderBottom: t.id === activeTab ? '1px solid var(--bg-primary)' : '1px solid var(--border)',
      background: t.id === activeTab ? 'var(--bg-primary)' : 'transparent',
      color: !enabled ? 'var(--text-muted)' : t.ranEmpty ? '#d97706' : (t.id === activeTab ? '#f97316' : 'var(--text-primary)'),
      cursor: enabled ? 'pointer' : 'not-allowed',
      opacity: enabled ? 1 : 0.5,
      borderRadius: '6px 6px 0 0',
      marginRight: 2,
      marginBottom: -1,
      position: 'relative',
      zIndex: t.id === activeTab ? 2 : 1,
    };
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
      {/* ── Entry header ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
        {stmtId && (
          <span
            title={`Statement ${stmtId}`}
            style={{
              padding: '1px 7px', borderRadius: 10,
              background: 'rgba(249,115,22,0.12)', color: '#f97316',
              fontSize: '0.7rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums',
            }}
          >{stmtId}</span>
        )}
        <strong style={{ fontSize: '0.85rem' }}>{speakerLabel(entry.speaker)}</strong>
        <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>{entry.type}</span>
        <button
          onClick={() => { void api.clipboardWriteText(entry.id); }}
          style={{ fontSize: '0.55rem', color: 'var(--text-muted)', fontFamily: 'monospace', background: 'none', border: '1px solid var(--border)', borderRadius: 3, padding: '1px 4px', cursor: 'pointer', opacity: 0.7 }}
          title={`Copy turn_id for flight recorder correlation: ${entry.id}`}
        >{entry.id.slice(0, 8)}</button>
        {diag?.topic_alignment && (() => {
          const ta = diag.topic_alignment;
          const sft = (meta?.injection_manifest as Record<string, unknown> | undefined)?.scope_filter_trace as
            { demoted?: { nodeId: string }[] } | undefined;
          const demotedIds = new Set((sft?.demoted ?? []).map(d => d.nodeId));
          const hasDemotedRef = (entry.taxonomy_refs ?? []).some(r => demotedIds.has(r.node_id));
          const modTrace = meta?.moderator_trace as Record<string, unknown> | undefined;
          const modDrift = modTrace?.drift_detected === true;
          const intMeta = entry.intervention_metadata;
          const modRedirect = modDrift && intMeta && ['REDIRECT', 'CHALLENGE'].includes(intMeta.move);
          let state: 'green' | 'amber' | 'red';
          let label: string;
          let tip: string;
          if (!ta.topic_aligned || modRedirect) {
            state = 'red'; label = modRedirect ? 'drift redirect' : 'off-scope'; tip = modRedirect ? `Moderator ${intMeta!.move} for drift` : 'Topic alignment failed after all retries';
          } else if (ta.repaired) {
            state = 'amber'; label = 'repaired'; tip = 'Off-scope draft repaired on retry';
          } else if (modDrift || hasDemotedRef) {
            state = 'amber'; label = 'drift noted'; tip = modDrift ? 'Moderator flagged drift concern' : 'References demoted taxonomy node';
          } else {
            state = 'green'; label = 'on-scope'; tip = 'All topic alignment checks passed';
          }
          const colors = { green: '#16a34a', amber: '#d97706', red: '#dc2626' };
          const bgs = { green: 'rgba(22,163,74,0.15)', amber: 'rgba(245,158,11,0.15)', red: 'rgba(220,38,38,0.15)' };
          return (
            <span title={tip} style={{
              padding: '1px 6px', borderRadius: 3, fontSize: '0.6rem', fontWeight: 600,
              background: bgs[state], color: colors[state], cursor: 'help',
            }}>{label}</span>
          );
        })()}
        {diag?.entailment_repairs && diag.entailment_repairs.some(r => r.verdict !== 'entailed') && (() => {
          const repaired = diag.entailment_repairs!.filter(r => r.verdict !== 'entailed');
          return (
            <span title={`${repaired.length} claim${repaired.length !== 1 ? 's' : ''} repaired by entailment verification`} style={{
              padding: '1px 6px', borderRadius: 3, fontSize: '0.6rem', fontWeight: 600,
              background: 'rgba(245,158,11,0.15)', color: '#d97706', cursor: 'help',
            }}>{repaired.length} repaired</span>
          );
        })()}
        {pipelineError && (
          <span title="Pipeline stages completed but post-pipeline processing (claim extraction, evidence, AN update) failed — check flight recorder" style={{
            padding: '1px 6px', borderRadius: 3, fontSize: '0.6rem', fontWeight: 600,
            background: 'rgba(220,38,38,0.15)', color: '#dc2626', cursor: 'help',
          }}>pipeline error</span>
        )}
        {!diag && !proxiedModeratorTrace && entry.type !== 'intervention' && <span style={{ color: '#f59e0b', fontSize: '0.65rem' }}>(no diagnostic capture &mdash; turn was generated before diagnostics was always-on)</span>}
        <span style={{ flex: 1 }} />
        <button
          onClick={() => { setSelectedEntry(null); setLocalOverride(true); }}
          title="Back to overview"
          style={{
            padding: '2px 8px', fontSize: '0.7rem', fontWeight: 600,
            borderRadius: 4, border: '1px solid var(--border)',
            background: 'rgba(249,115,22,0.1)', color: '#f97316',
            cursor: 'pointer',
          }}
        >{'◀'} Back</button>
        <button
          onClick={() => goToIdx(entryIdx - 1)}
          disabled={entryIdx <= 0}
          title="Previous statement"
          style={navBtnStyle(entryIdx <= 0)}
        >{'◀'} Prev</button>
        <button
          onClick={() => goToIdx(entryIdx + 1)}
          disabled={entryIdx >= totalEntries - 1}
          title="Next statement"
          style={navBtnStyle(entryIdx >= totalEntries - 1)}
        >Next {'▶'}</button>
        <span style={{ color: 'var(--text-muted)', fontSize: '0.65rem' }}>
          {entryIdx + 1} / {totalEntries}
        </span>
        {diag?.stage_diagnostics?.some(s => s.prompt) && debate && (
          <button
            onClick={() => { setSelectedEntry(entry.id); setOverviewTab('prompt-diff'); setLocalOverride(true); }}
            title="View Prompt Diff for this entry"
            style={{
              marginLeft: 8, padding: '2px 8px', fontSize: '0.65rem', fontWeight: 600,
              borderRadius: 4, border: 'none',
              background: 'rgba(245,158,11,0.15)', color: '#f59e0b',
              cursor: 'pointer',
            }}
          >Prompt Diff</button>
        )}
      </div>

      {/* ── Proxied moderator trace for system entries ── */}
      {proxiedModeratorTrace && (() => {
        const t = proxiedModeratorTrace as {
          selected?: string; focus_point?: string; selection_reason?: string;
          excluded_last_speaker?: string | null; recent_scheme?: string | null;
          convergence_score?: number | null; convergence_triggered?: boolean;
          candidates?: { debater: string; computed_strength: number | null; claim_count?: number; scored_count?: number; rank: number }[];
          argument_network_snapshot?: { total_claims: number; total_edges: number; unaddressed_claims: number } | null;
          commitment_snapshot?: Record<string, { asserted: number; conceded: number; challenged: number }>;
        };
        return (
          <div style={{
            margin: '0 0 10px', padding: '8px 12px', borderRadius: 6,
            background: 'rgba(249,115,22,0.08)', borderLeft: '3px solid #f97316',
            fontSize: '0.72rem',
          }}>
            <div style={{ fontWeight: 700, color: '#f97316', fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
              Moderator Deliberation
            </div>
            {t.selected && (
              <div style={{ marginBottom: 3 }}>
                <strong>Selected:</strong> {t.selected}
                {t.selection_reason && <span style={{ marginLeft: 6, padding: '1px 5px', borderRadius: 3, background: 'rgba(249,115,22,0.15)', color: '#f97316', fontSize: '0.6rem', fontWeight: 600 }}>{t.selection_reason.replace(/_/g, ' ')}</span>}
                {t.excluded_last_speaker && <span style={{ marginLeft: 6, color: 'var(--text-muted)', fontSize: '0.65rem' }}>(excluded last speaker: {t.excluded_last_speaker})</span>}
              </div>
            )}
            {t.focus_point && <div style={{ marginBottom: 3 }}><strong>Focus:</strong> {t.focus_point}</div>}
            {t.candidates && t.candidates.length > 0 && (
              <div style={{ marginBottom: 3 }}>
                <strong>Candidates:</strong>{' '}
                {t.candidates.map((c, i) => (
                  <span key={i} style={{ marginRight: 8, fontWeight: c.debater === t.selected ? 700 : 400, opacity: c.debater === t.selected ? 1 : 0.7 }}
                    title={[
                      `CANDIDATE RANKING — ${c.debater}`,
                      ``,
                      `QBAF Score: ${c.computed_strength != null ? c.computed_strength.toFixed(2) : 'n/a (no scored claims)'}`,
                      `Claims in argument network: ${c.claim_count ?? '?'}`,
                      `Claims with QBAF scores: ${c.scored_count ?? '?'}`,
                      ``,
                      `The QBAF score is the average computed_strength across all`,
                      `of this debater's claims in the argument network.`,
                      ``,
                      `computed_strength uses Quantitative Bipolar Argumentation`,
                      `Framework (QBAF) propagation: each claim starts with a`,
                      `base_strength (0-1), then attack/support edges from other`,
                      `claims raise or lower it. The final score reflects how well`,
                      `a claim survives challenges and gains support.`,
                      ``,
                      `Interpretation:`,
                      `  0.0-0.3  Weak — claims are heavily attacked or unsupported`,
                      `  0.3-0.5  Below average — more attacks than support`,
                      `  0.5       Neutral — balanced or unengaged`,
                      `  0.5-0.7  Above average — net support from other claims`,
                      `  0.7-1.0  Strong — well-supported, surviving challenges`,
                      ``,
                      `Lower-ranked candidates are selected first, as they have`,
                      `weaker argumentation positions and greater need to respond.`,
                    ].join('\n')}
                  >
                    #{c.rank} {c.debater}{c.computed_strength != null ? ` (QBAF: ${c.computed_strength.toFixed(2)})` : ''}
                  </span>
                ))}
              </div>
            )}
            {t.convergence_score != null && (
              <div style={{ marginBottom: 3 }}>
                <strong>Convergence:</strong> {(t.convergence_score * 100).toFixed(0)}%
                {t.convergence_triggered && <span style={{ color: '#22c55e', marginLeft: 4, fontWeight: 700 }}>triggered</span>}
              </div>
            )}
            {t.recent_scheme && <div style={{ marginBottom: 3 }}><strong>Recent scheme:</strong> {t.recent_scheme}</div>}
            {t.argument_network_snapshot && (
              <div style={{ marginBottom: 3 }}>
                <strong>AN snapshot:</strong> {t.argument_network_snapshot.total_claims} claims, {t.argument_network_snapshot.total_edges} edges, {t.argument_network_snapshot.unaddressed_claims} unaddressed
              </div>
            )}
            {t.commitment_snapshot && (
              <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: 4 }}>
                {Object.entries(t.commitment_snapshot).map(([name, c]) => (
                  <span key={name} style={{ marginRight: 10 }}>{name}: {c.asserted}A {c.conceded}C {c.challenged}Ch</span>
                ))}
              </div>
            )}
          </div>
        );
      })()}

      {/* ── Tabbed view ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', margin: '8px 0 0', minHeight: 0 }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', borderBottom: '1px solid var(--border)' }}>
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => tabEnabled(t) && setEntryTab(t.id)}
              disabled={!tabEnabled(t)}
              style={tabBtnStyle(t)}
              title={t.has ? t.label : t.ranEmpty ? `${t.label} — stage ran, no output` : `${t.label} (no data)`}
            >
              {t.ranEmpty && <span style={{ marginRight: 3, fontSize: '0.6rem' }}>∅</span>}
              {t.label}
              {!t.has && !t.ranEmpty && pipelineError && (t.id === 'claims' || t.id === 'evidence' || t.id === 'citations') && (
                <span title="Skipped — pipeline error" style={{ marginLeft: 3, color: '#dc2626', fontSize: '0.55rem' }}>⚠</span>
              )}
              {t.count != null && <span style={{ marginLeft: 4, color: 'var(--text-muted)', fontWeight: 400 }}>({t.count})</span>}
            </button>
          ))}
          <div style={{ flex: 1 }} />
          {active.has && active.id !== 'tax-refs' && (
            <button
              onClick={handleCopy}
              style={{ fontSize: '0.75rem', padding: '3px 10px', border: '1px solid var(--border)', borderRadius: 4, background: 'var(--bg-secondary)', color: 'var(--text-primary)', cursor: 'pointer', marginBottom: 4 }}
              title="Copy tab content"
            >Copy</button>
          )}
        </div>
        <div ref={tabContentRef} tabIndex={0} onContextMenu={(e) => {
          const sel = window.getSelection()?.toString();
          if (sel && sel.trim().length > 0) {
            e.preventDefault();
            setTextCopyMenu({ x: e.clientX, y: e.clientY, text: sel });
          }
        }} style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
          overflowY: 'auto',
          background: 'var(--bg-primary)',
          border: '1px solid var(--border)',
          borderTop: 'none',
          borderRadius: '0 6px 6px 6px',
          padding: activeTab === 'tax-refs' ? '8px 10px' : 0,
          outline: 'none',
          userSelect: 'text',
        }}>
          {/* ══════════════ TAX-REFS TAB ══════════════ */}
          {activeTab === 'tax-refs' && (
            <TaxRefsTab
              entry={entry}
              meta={meta}
              debate={debate}
              taxRefCount={taxRefCount}
              nodeWeights={nodeWeights}
              taxNodeMap={taxNodeMap}
              allEdges={allEdges}
              selectedTaxRefId={selectedTaxRefId}
              setSelectedTaxRefId={setSelectedTaxRefId}
              setOverviewTab={setOverviewTab}
            />
          )}

          {/* ══════════════ DETAILS (OVERVIEW) TAB ══════════════ */}
          {activeTab === 'details' && (
            <DetailsTab
              entry={entry}
              entryIdx={entryIdx}
              diag={diag}
              meta={meta}
              debate={debate}
              an={an}
              turnValTrail={turnValTrail}
              perTurnUtilities={perTurnUtilities}
              precedingIntervention={precedingIntervention}
              interventionResponseField={interventionResponseField}
              suppressedIntervention={suppressedIntervention}
              policyMap={policyMap}
              allEdges={allEdges}
              taxNodeMap={taxNodeMap}
              nodeWeights={nodeWeights}
              nodeLabels={nodeLabels}
              selectedTaxRefId={selectedTaxRefId}
              setSelectedTaxRefId={setSelectedTaxRefId}
              entryErrors={entryErrors}
            />
          )}

          {/* ══════════════ MODERATOR TAB ══════════════ */}
          {activeTab === 'moderator' && modTrace && (
            <div style={{ padding: '8px 10px', flex: 1, minHeight: 200, overflowY: 'auto' }}>
              <ModeratorTab trace={modTrace} />
            </div>
          )}

          {/* ══════════════ BRIEF TAB ══════════════ */}
          {activeTab === 'brief' && briefStage && (
            <BriefTab
              entry={entry}
              briefStage={briefStage}
              briefAttempts={briefAttempts}
              turnValTrail={turnValTrail}
              nodeWeights={nodeWeights}
              taxNodeMap={taxNodeMap}
              allEdges={allEdges}
              selectedTaxRefId={selectedTaxRefId}
              setSelectedTaxRefId={setSelectedTaxRefId}
            />
          )}

          {/* ══════════════ PLAN TAB ══════════════ */}
          {activeTab === 'plan' && planStage && (
            <PlanTab
              planStage={planStage}
              planAttempts={planAttempts}
              taxNodeMap={taxNodeMap}
              allEdges={allEdges}
              selectedTaxRefId={selectedTaxRefId}
              setSelectedTaxRefId={setSelectedTaxRefId}
            />
          )}

          {/* ══════════════ DRAFT TAB (delegated) ══════════════ */}
          {activeTab === 'draft' && (draftStage || entry.content) && (
            <div style={{ padding: '8px 10px', flex: 1, minHeight: 200, overflowY: 'auto' }}>
              <DraftTab
                entry={entry as any}
                diag={diag}
                meta={meta}
                debate={debate as any}
                turnValTrail={turnValTrail}
                an={an}
                selectedTaxRefId={selectedTaxRefId}
                setSelectedTaxRefId={setSelectedTaxRefId}
                nodeWeights={nodeWeights as any}
                taxNodeMap={taxNodeMap}
                allEdges={allEdges}
              />
            </div>
          )}

          {/* ══════════════ LOOKAHEAD TAB ══════════════ */}
          {activeTab === 'lookahead' && lookaheadDiag && (
            <LookaheadTab
              lookaheadDiag={lookaheadDiag}
            />
          )}

          {/* ══════════════ CITE TAB ══════════════ */}
          {activeTab === 'cite' && citeStage && (
            <CiteTab
              entry={entry}
              debate={debate}
              citeStage={citeStage}
              citeAttempts={citeAttempts}
              briefStage={briefStage}
              turnValTrail={turnValTrail}
              taxNodeMap={taxNodeMap}
              allEdges={allEdges}
              policyMap={policyMap}
              selectedTaxRefId={selectedTaxRefId}
              setSelectedTaxRefId={setSelectedTaxRefId}
              selectedPolicyId={selectedPolicyId}
              setSelectedPolicyId={setSelectedPolicyId}
            />
          )}

          {/* ══════════════ CLAIMS TAB (delegated) ══════════════ */}
          {activeTab === 'claims' && (
            <div style={{ padding: '8px 10px', flex: 1, minHeight: 200, overflowY: 'auto' }}>
              {tabs.find(t => t.id === 'claims')?.ranEmpty && (
                <div style={{ marginBottom: 10, padding: '8px 12px', borderRadius: 6, background: 'rgba(217,119,6,0.08)', borderLeft: '3px solid #d97706', fontSize: '0.72rem' }}>
                  <div style={{ fontWeight: 600, color: '#d97706' }}>Stage ran — no output</div>
                  <div style={{ color: 'var(--text-muted)', marginTop: 2 }}>The pipeline completed but claim extraction produced no claims for this entry. This may indicate the entry content was too short or off-topic for extraction.</div>
                </div>
              )}
              <ClaimsTab
                entry={entry as any}
                diag={diag}
                meta={meta}
                debate={debate as any}
                an={an}
                nodeWeights={nodeWeights as any}
                searchQuery={searchQuery}
              />
            </div>
          )}

          {/* ══════════════ EXCLUSION GUARD TAB ══════════════ */}
          {activeTab === 'exclusion' && (
            <ExclusionGuardTab diag={diag} />
          )}

          {/* ══════════════ AFFECT TAB ══════════════ */}
          {activeTab === 'affect' && (
            <AffectTab entry={entry} debate={debate} entryIdx={entryIdx} />
          )}

          {/* ══════════════ EVIDENCE TAB (delegated) ══════════════ */}
          {activeTab === 'evidence' && (
            <div style={{ padding: '8px 10px', flex: 1, minHeight: 200, overflowY: 'auto' }}>
              {tabs.find(t => t.id === 'evidence')?.ranEmpty && (
                <div style={{ marginBottom: 10, padding: '8px 12px', borderRadius: 6, background: 'rgba(217,119,6,0.08)', borderLeft: '3px solid #d97706', fontSize: '0.72rem' }}>
                  <div style={{ fontWeight: 600, color: '#d97706' }}>Stage ran — no output</div>
                  <div style={{ color: 'var(--text-muted)', marginTop: 2 }}>The pipeline completed but the evidence stage produced no facts or key points for this entry.</div>
                </div>
              )}
              <EvidenceTab
                entry={entry as any}
                diag={diag}
                an={an}
                searchQuery={searchQuery}
              />
            </div>
          )}

          {/* ══════════════ CITATIONS TAB (delegated) ══════════════ */}
          {activeTab === 'citations' && (
            <div style={{ padding: '8px 10px', flex: 1, minHeight: 200, overflowY: 'auto' }}>
              {tabs.find(t => t.id === 'citations')?.ranEmpty && (
                <div style={{ marginBottom: 10, padding: '8px 12px', borderRadius: 6, background: 'rgba(217,119,6,0.08)', borderLeft: '3px solid #d97706', fontSize: '0.72rem' }}>
                  <div style={{ fontWeight: 600, color: '#d97706' }}>Stage ran — no output</div>
                  <div style={{ color: 'var(--text-muted)', marginTop: 2 }}>The draft stage completed but produced no citation resolution data. The cite stage may have been skipped or the entry contained no references to verify.</div>
                </div>
              )}
              <CitationsTab
                diag={diag}
                searchQuery={searchQuery}
              />
            </div>
          )}

        </div>

        {/* ── Text copy context menu ── */}
        {textCopyMenu && (
          <div
            onMouseDown={e => e.stopPropagation()}
            style={{
              position: 'fixed', left: textCopyMenu.x, top: textCopyMenu.y, zIndex: 9999,
              background: 'var(--bg-primary)', border: '1px solid var(--border)',
              borderRadius: 6, boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
              padding: '4px 0', minWidth: 120, fontSize: '0.72rem',
            }}
          >
            <button
              onClick={() => { void navigator.clipboard.writeText(textCopyMenu.text); setTextCopyMenu(null); }}
              style={{
                display: 'block', width: '100%', textAlign: 'left',
                padding: '5px 12px', border: 'none', background: 'transparent',
                color: 'var(--text-primary)', cursor: 'pointer', fontSize: '0.72rem',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(59,130,246,0.1)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >Copy</button>
            <button
              onClick={() => {
                if (tabContentRef.current) {
                  const range = document.createRange();
                  range.selectNodeContents(tabContentRef.current);
                  const sel = window.getSelection();
                  sel?.removeAllRanges();
                  sel?.addRange(range);
                }
                setTextCopyMenu(null);
              }}
              style={{
                display: 'block', width: '100%', textAlign: 'left',
                padding: '5px 12px', border: 'none', background: 'transparent',
                color: 'var(--text-primary)', cursor: 'pointer', fontSize: '0.72rem',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(59,130,246,0.1)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >Select All</button>
          </div>
        )}
      </div>
    </div>
  );
}

