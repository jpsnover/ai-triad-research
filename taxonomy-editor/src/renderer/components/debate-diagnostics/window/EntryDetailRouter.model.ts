// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * EntryDetailRouter.model — data derivation for EntryDetailRouter.
 *
 * Behavior-preserving extraction (ADR-007 line-slice split, t/1877). Every body
 * here is moved verbatim from EntryDetailRouter.tsx's inline computation; only the
 * function signatures and call plumbing are hand-authored (tsc-validated). Splits
 * the former 197-cyclomatic component into a thin renderer + these named
 * sub-derivations. No logic, DOM, or routing changes.
 */

import { useMemo } from 'react';
import type { DebateSession, EntryDiagnostics } from '../../../types/debate';
import { getGlobalRecorder, type FlightRecorderEvent } from '@lib/flight-recorder/index';
import type { EntryTab } from './types';
import type { EntryDetailRouterProps } from './EntryDetailRouter';

type Entry = DebateSession['transcript'][number];

export type ModeratorTraceMeta = {
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

export interface EntryTabDescriptor {
  id: EntryTab; label: string; count?: number; has: boolean; ranEmpty?: boolean; copy: string;
}

/** A tab is selectable if it has data, or a stage ran but produced no output. */
export const isTabEnabled = (t: EntryTabDescriptor) => t.has || !!t.ranEmpty;

// ---------------------------------------------------------------------------
// Stage-diagnostic derivations (all diag-derived)
// ---------------------------------------------------------------------------

/** Last element of an attempts array, or undefined when empty (verbatim of the former `len>0 ? arr[len-1] : undefined`). */
const latestStage = <T,>(attempts: T[]): T | undefined =>
  attempts.length > 0 ? attempts[attempts.length - 1] : undefined;

function deriveEvidenceExtraction(diag: EntryDiagnostics | undefined) {
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
  return { evidenceStage, evidenceWP, extTrace };
}

function deriveCitationResolution(diag: EntryDiagnostics | undefined) {
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
  return { citationResDiag };
}

function deriveStageAttempts(diag: EntryDiagnostics | undefined) {
  const stages = diag?.stage_diagnostics;
  const briefAttempts = stages?.filter(s => s.stage === 'brief') ?? [];
  const planAttempts = stages?.filter(s => s.stage === 'plan') ?? [];
  const draftAttempts = stages?.filter(s => s.stage === 'draft') ?? [];
  const citeAttempts = stages?.filter(s => s.stage === 'cite') ?? [];
  const postDraftStage = stages?.find(s => s.stage === 'postDraft');
  const draftQualityStage = stages?.find(s => s.stage === 'draft_quality');
  const briefStage = latestStage(briefAttempts);
  const planStage = latestStage(planAttempts);
  const draftStage = latestStage(draftAttempts);
  const citeStage = latestStage(citeAttempts);
  return {
    stages, briefAttempts, planAttempts, draftAttempts, citeAttempts,
    postDraftStage, draftQualityStage, briefStage, planStage, draftStage, citeStage,
  };
}

function deriveCiteWorkProduct(citeStage: ReturnType<typeof deriveStageAttempts>['citeStage']) {
  const citeWorkProduct = citeStage?.work_product as Record<string, unknown> | undefined;
  const pinResponse = citeWorkProduct?.pin_response as {
    position?: string; condition?: string; brief_reason?: string;
  } | undefined;
  return { citeWorkProduct, pinResponse };
}

export function deriveEntryStages(diag: EntryDiagnostics | undefined) {
  const evidence = deriveEvidenceExtraction(diag);
  const { citationResDiag } = deriveCitationResolution(diag);
  const attempts = deriveStageAttempts(diag);
  const cite = deriveCiteWorkProduct(attempts.citeStage);
  return {
    ...evidence, citationResDiag,
    ...attempts,
    ...cite,
  };
}

type StageData = ReturnType<typeof deriveEntryStages>;

// ---------------------------------------------------------------------------
// Tab-presence derivations
// ---------------------------------------------------------------------------

interface PresenceArgs {
  entry: Entry;
  diag: EntryDiagnostics | undefined;
  meta: Record<string, unknown> | undefined;
  debate: DebateSession;
  entryIdx: number;
  stages: StageData['stages'];
  extTrace: StageData['extTrace'];
  evidenceStage: StageData['evidenceStage'];
  evidenceWP: StageData['evidenceWP'];
  citationResDiag: StageData['citationResDiag'];
  draftStage: StageData['draftStage'];
}

function computeHasClaims(
  diag: EntryDiagnostics | undefined,
  meta: Record<string, unknown> | undefined,
) {
  return !!(
    diag?.extracted_claims ||
    (meta?.my_claims && (meta.my_claims as unknown[]).length > 0)
  );
}

function computeEvidenceFactCount(evidenceWP: StageData['evidenceWP']) {
  return (evidenceWP?.facts?.length ?? 0) + (evidenceWP?.keyPoints?.length ?? 0);
}

function computeHasExclusionData(diag: EntryDiagnostics | undefined, entry: Entry) {
  return !!(
    (diag?.extraction_trace as Record<string, unknown> | undefined)?.exclusion_guard ||
    (diag?.extraction_trace as Record<string, unknown> | undefined)?.exclusion_violations ||
    (diag as Record<string, unknown> | undefined)?.scope_drift_check ||
    (diag as Record<string, unknown> | undefined)?.scope_drift_warnings ||
    (diag?.extraction_trace && entry.type === 'statement')
  );
}

function computeHasPrecedingIntervention(debate: DebateSession, entryIdx: number) {
  if (!debate?.transcript || entryIdx <= 0) return false;
  for (let i = entryIdx - 1; i >= 0; i--) {
    const t = debate.transcript[i];
    if (t.type === 'intervention' && t.speaker === 'moderator') return true;
    if (t.type === 'statement' || t.type === 'opening') return false;
  }
  return false;
}

function computeHasSuppressedIntervention(meta: Record<string, unknown> | undefined) {
  return !!(
    (meta?.moderator_trace as Record<string, unknown> | undefined)?.intervention_recommended
    && !(meta?.moderator_trace as Record<string, unknown> | undefined)?.intervention_validated
  );
}

function computePipelineError(
  entry: Entry,
  diag: EntryDiagnostics | undefined,
  stages: StageData['stages'],
  extTrace: StageData['extTrace'],
) {
  return entry.type === 'statement' && !!diag && (stages?.length ?? 0) > 0 && !diag.extracted_claims && !extTrace;
}

// hasDetails is split into pure sub-predicates so each stays below the complexity ceiling.
// The terms are side-effect-free reads, so grouping them under `||` preserves the boolean result.
function hasMetaDetail(meta: Record<string, unknown> | undefined, entry: Entry) {
  return !!(
    (meta?.key_assumptions && (meta.key_assumptions as unknown[]).length > 0) ||
    (meta?.policy_refs as string[])?.length || (entry.policy_refs?.length ?? 0) > 0 ||
    (meta?.move_types && (meta.move_types as unknown[]).length > 0)
  );
}

function hasDiagDetail(diag: EntryDiagnostics | undefined) {
  return !!(
    diag?.model ||
    diag?.commitment_context ||
    diag?.edge_tensions ||
    diag?.argument_network_context
  );
}

function hasPipelineErrorDetail(entry: Entry, diag: EntryDiagnostics | undefined, extTrace: StageData['extTrace']) {
  return !!(entry.type === 'statement' && diag && (diag.stage_diagnostics?.length ?? 0) > 0 && !diag.extracted_claims && !extTrace);
}

function computeHasDetails(p: {
  entry: Entry;
  meta: Record<string, unknown> | undefined;
  diag: EntryDiagnostics | undefined;
  extTrace: StageData['extTrace'];
  hasPrecedingIntervention: boolean;
  hasSuppressedIntervention: boolean;
}) {
  return !!(
    p.hasPrecedingIntervention || p.hasSuppressedIntervention ||
    hasMetaDetail(p.meta, p.entry) ||
    hasDiagDetail(p.diag) ||
    hasPipelineErrorDetail(p.entry, p.diag, p.extTrace)
  );
}

export function deriveTabPresence({
  entry, diag, meta, debate, entryIdx,
  stages, extTrace, evidenceStage, evidenceWP, citationResDiag, draftStage,
}: PresenceArgs) {
  const taxRefCount = entry.taxonomy_refs?.length ?? 0;
  const hasClaims = computeHasClaims(diag, meta);
  const evidenceFactCount = computeEvidenceFactCount(evidenceWP);
  const hasEvidence = !!evidenceStage || !!extTrace;
  const hasExclusionData = computeHasExclusionData(diag, entry);
  const hasCitations = !!citationResDiag;
  const citationsCount = citationResDiag?.citations_extracted ?? 0;
  const hasPrecedingIntervention = computeHasPrecedingIntervention(debate, entryIdx);
  const hasSuppressedIntervention = computeHasSuppressedIntervention(meta);
  const stageRan = (stages?.length ?? 0) > 0;
  const pipelineError = computePipelineError(entry, diag, stages, extTrace);
  const hasDetails = computeHasDetails({
    entry, meta, diag, extTrace, hasPrecedingIntervention, hasSuppressedIntervention,
  });

  return {
    taxRefCount, hasClaims, evidenceFactCount, hasEvidence, hasExclusionData,
    hasCitations, citationsCount, hasPrecedingIntervention, hasSuppressedIntervention,
    stageRan, pipelineError, hasDetails,
  };
}

type Presence = ReturnType<typeof deriveTabPresence>;

// ---------------------------------------------------------------------------
// Claims copy-to-clipboard text
// ---------------------------------------------------------------------------

function buildClaimsCopy(
  diag: EntryDiagnostics | undefined,
  meta: Record<string, unknown> | undefined,
  debate: DebateSession,
) {
  return [
    ...(diag?.extracted_claims ? [...diag.extracted_claims.accepted.map(c => { const anN = debate?.argument_network?.nodes?.find(n => n.id === c.id); return `✓ ${c.id} (${c.overlap_pct}%): ${c.text}${anN?.attribution_text_genus ? `\n  [Attribution: ${anN.attribution_text_genus}]` : ''}`; }), ...diag.extracted_claims.rejected.map(c => `✗ (${c.overlap_pct}%): ${c.text} — ${c.reason}`)] : []),
    ...((meta?.my_claims as { claim: string; targets: string[] }[])?.map((c, i) => `${i + 1}. ${c.claim}${c.targets?.length > 0 ? ` → ${c.targets.join(', ')}` : ''}`) ?? []),
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Tab descriptor list + active-tab selection
// ---------------------------------------------------------------------------

type BuildTabsArgs = StageData & Presence & {
  entry: Entry;
  diag: EntryDiagnostics | undefined;
  meta: Record<string, unknown> | undefined;
  debate: DebateSession;
  hasModTab: boolean;
  modTrace: ModeratorTraceMeta;
  lookaheadDiag: unknown;
};

function evidenceTabDescriptor(a: {
  evidenceFactCount: number; hasEvidence: boolean; stageRan: boolean;
  entry: Entry; pipelineError: boolean; evidenceStage: StageData['evidenceStage'];
}): EntryTabDescriptor {
  const { evidenceFactCount, hasEvidence, stageRan, entry, pipelineError, evidenceStage } = a;
  return { id: 'evidence', label: 'Evidence', count: evidenceFactCount || undefined, has: hasEvidence, ranEmpty: !hasEvidence && stageRan && entry.type === 'statement' && !pipelineError, copy: evidenceStage?.raw_response ?? '' };
}

function citationsTabDescriptor(a: {
  citationsCount: number; hasCitations: boolean; draftStage: StageData['draftStage'];
  entry: Entry; pipelineError: boolean; citationResDiag: StageData['citationResDiag'];
}): EntryTabDescriptor {
  const { citationsCount, hasCitations, draftStage, entry, pipelineError, citationResDiag } = a;
  return { id: 'citations', label: 'Citations', count: citationsCount || undefined, has: hasCitations, ranEmpty: !hasCitations && !!draftStage && entry.type === 'statement' && !pipelineError, copy: citationResDiag ? JSON.stringify(citationResDiag, null, 2) : '' };
}

function draftTabDescriptor(draftStage: StageData['draftStage'], entry: Entry): EntryTabDescriptor {
  return { id: 'draft', label: 'Draft', has: !!(draftStage || entry.content), copy: draftStage ? (JSON.stringify(draftStage?.work_product, null, 2) ?? '') : (typeof entry.content === 'string' ? entry.content : JSON.stringify(entry.content, null, 2)) };
}

function claimsTabDescriptor(a: {
  hasClaims: boolean; stageRan: boolean; entry: Entry; pipelineError: boolean; claimsCopy: string;
}): EntryTabDescriptor {
  const { hasClaims, stageRan, entry, pipelineError, claimsCopy } = a;
  return { id: 'claims', label: 'Claims', has: hasClaims, ranEmpty: !hasClaims && stageRan && entry.type === 'statement' && !pipelineError, copy: claimsCopy };
}

function affectTabDescriptor(entry: Entry): EntryTabDescriptor {
  return { id: 'affect', label: 'Affect', has: !!((entry.type === 'statement' || entry.type === 'opening') && entry.speaker !== 'system' && entry.speaker !== 'moderator' && entry.content && typeof entry.content === 'string' && entry.content.split(/\s+/).length >= 20), copy: '' };
}

export function buildEntryTabs(args: BuildTabsArgs): EntryTabDescriptor[] {
  const {
    entry, diag, meta, debate, hasModTab, modTrace, hasDetails, briefStage, planStage,
    evidenceFactCount, hasEvidence, stageRan, pipelineError, evidenceStage,
    citationsCount, hasCitations, draftStage, citationResDiag, lookaheadDiag,
    citeStage, hasClaims, hasExclusionData, taxRefCount,
  } = args;
  const claimsCopy = buildClaimsCopy(diag, meta, debate);
  return [
    { id: 'moderator', label: 'Moderator-Pre', has: hasModTab, copy: modTrace?.selection_prompt ?? '' },
    { id: 'details', label: 'Overview', has: hasDetails, copy: '' },
    { id: 'brief', label: 'Brief', has: !!briefStage, copy: JSON.stringify(briefStage?.work_product, null, 2) ?? '' },
    { id: 'plan', label: 'Plan', has: !!planStage, copy: JSON.stringify(planStage?.work_product, null, 2) ?? '' },
    evidenceTabDescriptor({ evidenceFactCount, hasEvidence, stageRan, entry, pipelineError, evidenceStage }),
    citationsTabDescriptor({ citationsCount, hasCitations, draftStage, entry, pipelineError, citationResDiag }),
    draftTabDescriptor(draftStage, entry),
    { id: 'lookahead', label: 'Lookahead', has: !!lookaheadDiag, copy: lookaheadDiag ? JSON.stringify(lookaheadDiag, null, 2) : '' },
    { id: 'cite', label: 'Cite', has: !!citeStage, copy: JSON.stringify(citeStage?.work_product, null, 2) ?? '' },
    claimsTabDescriptor({ hasClaims, stageRan, entry, pipelineError, claimsCopy }),
    { id: 'exclusion', label: 'Exclusion', has: hasExclusionData, copy: '' },
    affectTabDescriptor(entry),
    { id: 'tax-refs', label: 'Taxonomy Refs', count: taxRefCount, has: taxRefCount > 0, copy: entry.taxonomy_refs?.map(r => `${r.node_id}: ${r.relevance}`).join('\n') ?? '' },
  ];
}

export function pickActiveTab(tabs: EntryTabDescriptor[], entryTab: EntryTab) {
  // If the current tab has no data, auto-select the first tab that does (prefer has over ranEmpty).
  const activeTab = tabs.find(t => t.id === entryTab && isTabEnabled(t))
    ? entryTab
    : (tabs.find(t => t.has)?.id ?? tabs.find(t => t.ranEmpty)?.id ?? 'details');
  const active = tabs.find(t => t.id === activeTab)!;
  return { activeTab, active };
}

// ---------------------------------------------------------------------------
// Assembly hook
// ---------------------------------------------------------------------------

export interface EntryDetailRouterModel extends StageData, Presence {
  totalEntries: number;
  stmtId: string;
  lookaheadDiag: ReturnType<typeof extractLookaheadDiag>;
  precedingIntervention: Entry | null;
  interventionResponseField: Record<string, unknown> | string | null;
  modTrace: ModeratorTraceMeta;
  suppressedIntervention: ModeratorTraceMeta;
  hasModTab: boolean;
  entryErrors: (FlightRecorderEvent & { error: NonNullable<FlightRecorderEvent['error']> })[];
  tabs: EntryTabDescriptor[];
  activeTab: EntryTab;
  active: EntryTabDescriptor;
}

function extractLookaheadDiag(diag: EntryDiagnostics | undefined) {
  return (diag as Record<string, unknown> | undefined)?.lookahead as {
    stage: 'lookahead';
    first_attempt: { pass: boolean; utility_before: { position_strength: number; attack_effectiveness: number; crux_engagement: number; composite: number; concession_asymmetry: number }; utility_after: { position_strength: number; attack_effectiveness: number; crux_engagement: number; composite: number; concession_asymmetry: number }; utility_delta: number; threshold: number; tentative_claims: { text: string; strength: number }[]; tentative_network_size: { nodes: number; edges: number } };
    regen_triggered: boolean;
    regen_attempt?: { pass: boolean; utility_before: { composite: number }; utility_after: { composite: number }; utility_delta: number; threshold: number; tentative_claims: { text: string; strength: number }[]; tentative_network_size: { nodes: number; edges: number } };
    regen_attempts?: { pass: boolean; utility_before: { composite: number }; utility_after: { composite: number }; utility_delta: number; threshold: number; tentative_claims: { text: string; strength: number }[]; tentative_network_size: { nodes: number; edges: number } }[];
    per_claim_analysis?: { perClaim: { index: number; text: string; base_strength: number; marginal_delta: number; classification: 'STRONG' | 'WEAK'; dominant_component: string }[]; analysis: { strongFoundations: { text: string; base_strength: number; marginal_delta: number; reason: string }[]; avoidClaims: { text: string; base_strength: number; marginal_delta: number; reason: string }[] } }[];
    final_pass: boolean;
    elapsed_ms: number;
  } | undefined;
}

export function useEntryDetailRouterModel(props: EntryDetailRouterProps): EntryDetailRouterModel {
  const { debate, entry, entryIdx, diag, meta, turnValTrail, proxiedModeratorTrace, entryTab } = props;

  const totalEntries = debate.transcript.length;
  const stmtId = entryIdx >= 0 ? `S${entryIdx + 1}` : '';

  const stageData = deriveEntryStages(diag);
  const {
    extTrace, evidenceStage, evidenceWP, citationResDiag,
    planStage, draftStage, citeWorkProduct, stages, draftAttempts,
  } = stageData;

  const presence = deriveTabPresence({
    entry, diag, meta, debate, entryIdx,
    stages, extTrace, evidenceStage, evidenceWP, citationResDiag, draftStage,
  });
  const { hasDetails } = presence;

  const lookaheadDiag = extractLookaheadDiag(diag);

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
  void hasMultipleOrchRuns; void effectiveDraftAttempts;

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

  const modTrace = (meta?.moderator_trace ?? proxiedModeratorTrace) as ModeratorTraceMeta;
  const suppressedIntervention = modTrace?.intervention_recommended && !modTrace.intervention_validated
    ? modTrace : null;
  const hasModTab = !!modTrace;

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

  const tabs = buildEntryTabs({
    ...stageData, ...presence,
    entry, diag, meta, debate, hasModTab, modTrace, hasDetails, lookaheadDiag,
  });
  const { activeTab, active } = pickActiveTab(tabs, entryTab);

  return {
    ...stageData, ...presence,
    totalEntries, stmtId, lookaheadDiag,
    precedingIntervention, interventionResponseField,
    modTrace, suppressedIntervention, hasModTab, entryErrors,
    tabs, activeTab, active,
  };
}
