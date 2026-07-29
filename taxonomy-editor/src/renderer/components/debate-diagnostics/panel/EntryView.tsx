// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useCallback, useMemo } from 'react';
import './EntryView.css';
import { useDebateStore } from '../../../hooks/useDebateStore';
import { useTaxonomyStore } from '../../../hooks/useTaxonomyStore';
import { useFlag } from '../../../hooks/useFeatureFlags';
import { POVER_INFO } from '../../../types/debate';
import type { SpeakerId, EntryDiagnostics, ArgumentNetworkNode, ArgumentNetworkEdge } from '../../../types/debate';
import { QbafClaimBadge, QbafScoreSlider, QbafEdgeIndicator } from '../../taxonomy/QbafOverlay';
import { getMoveName } from '@lib/debate/helpers';
import type { MoveAnnotation } from '@lib/debate/helpers';
import { api } from '@bridge';
import { CollapsibleSection, speakerLabel } from './helpers';
import { ScoreBadge, VerdictChip } from '../window/shared';
import type { Verdict } from '../window/shared/VerdictChip';

// ── Shared derived types ─────────────────────────────────────────────────────
type ActiveDebate = NonNullable<ReturnType<typeof useDebateStore.getState>['activeDebate']>;
type Entry = ActiveDebate['transcript'][number];
type QbafDebate = { argument_network?: { nodes: ArgumentNetworkNode[]; edges: ArgumentNetworkEdge[] } } | null;
type TopicAlignment = NonNullable<EntryDiagnostics['topic_alignment']>;
type StageDiag = NonNullable<EntryDiagnostics['stage_diagnostics']>[number];
type ExtractedClaims = NonNullable<EntryDiagnostics['extracted_claims']>;
type AcceptedClaim = ExtractedClaims['accepted'][number];
type EntailmentRepair = NonNullable<EntryDiagnostics['entailment_repairs']>[number];
type SituationNodes = NonNullable<ReturnType<typeof useTaxonomyStore.getState>['situations']>['nodes'];
type InjectionManifest = { povNodeIds: string[]; povPrimaryIds: string[]; situationNodeIds: string[]; vulnerabilityCount: number; policyCount: number; totalTokenEstimate: number };

type ModeratorTrace = {
  selected: string; excluded_last_speaker: string | null;
  candidates: { debater: string; computed_strength: number | null; rank: number }[];
  convergence_score: number | null; convergence_triggered: boolean;
  commitment_snapshot: Record<string, { asserted: number; conceded: number; challenged: number }>;
  selection_reason: string; focus_point: string;
  recent_scheme?: string;
  metaphor_reframe_offered?: string;
  metaphor_reframe_used?: boolean;
  critical_questions?: string;
  argument_network_snapshot?: {
    total_claims: number; total_edges: number; unaddressed_claims: number;
    strongest_unaddressed?: { id: string; speaker: string; strength?: number; text: string }[];
  };
};

type ExclusionViolation = { claim_id: string; claim_text: string; node_id: string; similarity_main: number; similarity_exclusion: number };
type ExclusionGuardData = { checked: number; refs_with_exclusion_vector: number; threshold: number; violations: ExclusionViolation[] };
type ScopeWarning = { debater: string; node_id: string; similarity: number; draft_excerpt: string };
type ScopeDriftCheck = { checked: boolean; refs_checked: number; refs_with_exclusion_vector: number; threshold: number; warnings: ScopeWarning[] };

// ── Pure helpers ─────────────────────────────────────────────────────────────
function bdiLayerOf(node: ArgumentNetworkNode): string {
  return node.taxonomy_refs.some(r => r.includes('-beliefs-')) ? 'Beliefs'
    : node.taxonomy_refs.some(r => r.includes('-desires-')) ? 'Desires'
    : node.taxonomy_refs.some(r => r.includes('-intentions-')) ? 'Intentions' : 'Unknown';
}

function scoringMethodLabel(method: ArgumentNetworkNode['scoring_method']): string {
  return method === 'bdi_criteria' ? 'BDI Criteria (v3)' : method === 'human' ? 'Human' : method === 'fact_check' ? 'Fact-check verification' : method === 'unscored' ? 'Unscored (default 0.5)' : 'Unknown';
}

function topicAlignmentVerdict(
  ta: TopicAlignment,
  flags: { modRedirect: boolean; modDrift: boolean; hasDemotedRef: boolean; intMove: string | undefined },
): { verdict: Verdict; label: string; tip: string } {
  const { modRedirect, modDrift, hasDemotedRef, intMove } = flags;
  let verdict: Verdict;
  let label: string;
  let tip: string;
  if (!ta.topic_aligned || modRedirect) {
    verdict = 'fail'; label = modRedirect ? 'drift redirect' : 'off-scope'; tip = modRedirect ? `Moderator ${intMove} for drift` : 'Topic alignment failed after all retries';
  } else if (ta.repaired) {
    verdict = 'flag'; label = 'repaired'; tip = 'Off-scope draft repaired on retry';
  } else if (modDrift || hasDemotedRef) {
    verdict = 'flag'; label = 'drift noted'; tip = modDrift ? 'Moderator flagged drift concern' : 'References demoted taxonomy node';
  } else {
    verdict = 'pass'; label = 'on-scope'; tip = 'All topic alignment checks passed';
  }
  return { verdict, label, tip };
}

function computeExclusionGuardData(diag: EntryDiagnostics | undefined) {
  const extTrace = diag?.extraction_trace as Record<string, unknown> | undefined;
  const exclusionGuard = extTrace?.exclusion_guard as ExclusionGuardData | undefined;
  const scopeDriftCheck = diag?.scope_drift_check as ScopeDriftCheck | undefined;
  const legacyViolations = (extTrace?.exclusion_violations as ExclusionViolation[] | undefined);
  const legacyWarnings = diag?.scope_drift_warnings;

  const hasExclusionGuard = !!exclusionGuard || (legacyViolations && legacyViolations.length > 0);
  const hasScopeCheck = !!scopeDriftCheck || (legacyWarnings && legacyWarnings.length > 0);
  const hasExtTrace = !!extTrace;
  const hasAnyData = hasExclusionGuard || hasScopeCheck || hasExtTrace || !!diag;

  if (!hasAnyData) return null;

  return { exclusionGuard, scopeDriftCheck, legacyViolations, legacyWarnings, hasExtTrace };
}

// ── QBAF Claim Strength sub-components ────────────────────────────────────────
function QbafIncomingEdges({ incoming, activeDebate }: { incoming: ArgumentNetworkEdge[]; activeDebate: QbafDebate }) {
  if (incoming.length === 0) return null;
  return (
    <div className="diag-qbaf-edges">
      {incoming.map((e, i) => {
        const srcNode = activeDebate?.argument_network?.nodes?.find(n => n.id === e.source);
        return (
          <div key={i} className={`diag-qbaf-edge ${e.type === 'attacks' ? 'diag-qbaf-attack' : 'diag-qbaf-support'}`}>
            <span>{e.type === 'attacks' ? '⚔' : '✓'} {e.source}</span>
            {e.attack_type && <span className="diag-badge diag-badge-move">{e.attack_type}</span>}
            {e.argumentation_scheme && <span className="diag-badge ev-badge-hover ev-ml-2">{e.argumentation_scheme}</span>}
            {e.weight != null && <QbafEdgeIndicator edge={e} />}
            {srcNode && <span className="diag-muted ev-ml-4">{srcNode.text.slice(0, 60)}{srcNode.text.length > 60 ? '…' : ''}</span>}
          </div>
        );
      })}
    </div>
  );
}

function QbafSubScores({ node }: { node: ArgumentNetworkNode }) {
  if (!node.bdi_sub_scores) return null;
  return (
    <div className="diag-qbaf-subscores-row">
      {Object.entries(node.bdi_sub_scores)
        .filter(([, v]) => v != null)
        .map(([key, val]) => (
          <span key={key} className="diag-qbaf-subscore">
            <span className="diag-k">{({
              evidence_quality: 'Evidence', source_reliability: 'Source', falsifiability: 'Falsifiable',
              values_grounding: 'Values', tradeoff_acknowledgment: 'Tradeoffs', precedent_citation: 'Precedent',
              mechanism_specificity: 'Mechanism', scope_bounding: 'Scope', failure_mode_addressing: 'Failure modes',
            } as Record<string, string>)[key] ?? key}:</span>
            <span className="diag-v">{((val as number) ?? 0).toFixed(2)}</span>
          </span>
        ))}
    </div>
  );
}

function QbafNodeMeta({ node, bdiLayer }: { node: ArgumentNetworkNode; bdiLayer: string }) {
  return (
    <div className="diag-qbaf-meta">
      <span className="diag-badge diag-badge-type">{bdiLayer}{node.bdi_confidence != null && node.bdi_confidence < 0.5 ? '*' : ''}</span>
      <span className="diag-muted">Scored by: {scoringMethodLabel(node.scoring_method)}</span>
      {node.bdi_confidence != null && node.bdi_confidence < 0.5 && (
        <span className="diag-muted" title="Scoring reliability is low for Beliefs claims (Q-0 calibration r &lt; 0.2)"> (low scoring reliability)</span>
      )}
    </div>
  );
}

function QbafNodeCard({ node, anEdges, activeDebate, onScoreChange }: {
  node: ArgumentNetworkNode;
  anEdges: ArgumentNetworkEdge[];
  activeDebate: QbafDebate;
  onScoreChange: (nodeId: string, score: number) => void;
}) {
  const computed = node.computed_strength ?? node.base_strength ?? 0;
  const base = node.base_strength ?? computed;
  const delta = computed - base;
  const incoming = anEdges.filter(e => e.target === node.id);
  const bdiLayer = bdiLayerOf(node);
  const isPending = node.scoring_method === 'unscored';

  return (
    <div className={`diag-qbaf-card ${isPending ? 'diag-qbaf-pending' : ''}`}>
      <div className="diag-qbaf-card-header">
        <span className="diag-an-id">{node.id}</span>
        <QbafClaimBadge node={node} />
      </div>
      <div className="diag-qbaf-claim-text">{node.text}</div>
      {node.attribution_text_genus && <div className="claim-attribution-text"><span className="claim-attribution-label">Attribution:</span>{node.attribution_text_genus}</div>}
      <div className="diag-qbaf-strength-row">
        <ScoreBadge value={base} label="intrinsic" tooltip={`Intrinsic (base) strength: ${base.toFixed(2)}`} />
        <span className="diag-qbaf-arrow">→</span>
        <ScoreBadge value={computed} label="dialectical" tooltip={`Dialectical (computed) strength: ${computed.toFixed(2)}`} />
        {Math.abs(delta) > 0.01 && (
          <span className={`qbaf-delta ${delta > 0 ? 'qbaf-delta-up' : 'qbaf-delta-down'}`}>
            ({delta > 0 ? '+' : ''}{delta.toFixed(2)})
          </span>
        )}
      </div>
      <QbafIncomingEdges incoming={incoming} activeDebate={activeDebate} />
      <QbafSubScores node={node} />
      <QbafNodeMeta node={node} bdiLayer={bdiLayer} />
      {isPending && (
        <div className="diag-qbaf-slider-row">
          <QbafScoreSlider node={node} onScoreChange={onScoreChange} />
        </div>
      )}
    </div>
  );
}

function QbafClaimStrengthSection({ entryId, activeDebate }: { entryId: string; activeDebate: QbafDebate }) {
  const qbafEnabled = useFlag('release-qbaf-analysis');
  const anNodes = activeDebate?.argument_network?.nodes?.filter(
    n => n.source_entry_id === entryId
  ) ?? [];
  const anEdges = activeDebate?.argument_network?.edges ?? [];
  const scoredNodes = anNodes.filter(n => n.computed_strength != null || n.base_strength != null);

  const handleScoreChange = useCallback((nodeId: string, score: number) => {
    const debate = useDebateStore.getState().activeDebate;
    if (!debate?.argument_network) return;
    const node = debate.argument_network.nodes.find(n => n.id === nodeId);
    if (node) {
      node.base_strength = score;
      node.scoring_method = 'human';
    }
  }, []);

  if (!qbafEnabled || scoredNodes.length === 0) return null;

  return (
    <CollapsibleSection title={`QBAF Strength (${scoredNodes.length} claims)`} defaultOpen>
      {scoredNodes.map(node => (
        <QbafNodeCard key={node.id} node={node} anEdges={anEdges} activeDebate={activeDebate} onScoreChange={handleScoreChange} />
      ))}
    </CollapsibleSection>
  );
}

// ── Entry header + verdict chips ──────────────────────────────────────────────
function TopicAlignmentChip({ diag, meta, entry }: { diag: EntryDiagnostics | undefined; meta: Record<string, unknown> | undefined; entry: Entry }) {
  if (!diag?.topic_alignment) return null;
  const ta = diag.topic_alignment;
  const sft = (meta?.injection_manifest as Record<string, unknown> | undefined)?.scope_filter_trace as
    { demoted?: { nodeId: string }[] } | undefined;
  const demotedIds = new Set((sft?.demoted ?? []).map(d => d.nodeId));
  const hasDemotedRef = (entry.taxonomy_refs ?? []).some(r => demotedIds.has(r.node_id));
  const modTrace = meta?.moderator_trace as Record<string, unknown> | undefined;
  const modDrift = modTrace?.drift_detected === true;
  const intMeta = entry.intervention_metadata;
  const modRedirect = modDrift && intMeta && ['REDIRECT', 'CHALLENGE'].includes(intMeta.move);
  const { verdict, label, tip } = topicAlignmentVerdict(ta, {
    modRedirect: !!modRedirect, modDrift, hasDemotedRef, intMove: intMeta?.move,
  });
  return (
    <VerdictChip verdict={verdict} label={label} tooltip={tip} />
  );
}

function EntailmentRepairsChip({ diag }: { diag: EntryDiagnostics | undefined }) {
  if (!(diag?.entailment_repairs && diag.entailment_repairs.some(r => r.verdict !== 'entailed'))) return null;
  const repaired = diag.entailment_repairs!.filter(r => r.verdict !== 'entailed');
  return (
    <VerdictChip
      verdict="flag"
      label={`${repaired.length} repaired`}
      tooltip={`${repaired.length} claim${repaired.length !== 1 ? 's' : ''} repaired by entailment verification`}
    />
  );
}

function EntryHeader({ entry, diag, meta, entryId }: { entry: Entry; diag: EntryDiagnostics | undefined; meta: Record<string, unknown> | undefined; entryId: string }) {
  return (
    <div className="diag-entry-header">
      <span className="diag-entry-speaker">{speakerLabel(entry.speaker)}</span>
      <span className="diag-entry-type">{entry.type}</span>
      <button
        onClick={() => { void api.clipboardWriteText(entryId); }}
        className="ev-copy-id-btn"
        title={`Copy turn_id for flight recorder correlation: ${entryId}`}
      >…{entryId.slice(-6)} ⧉</button>
      <TopicAlignmentChip diag={diag} meta={meta} entry={entry} />
      <EntailmentRepairsChip diag={diag} />
    </div>
  );
}

// ── Model & Timing ────────────────────────────────────────────────────────────
function ModelTimingSection({ diag }: { diag: EntryDiagnostics | undefined }) {
  if (!diag?.model) return null;
  return (
    <CollapsibleSection title={`Model & Timing — ${diag.model} (${diag.response_time_ms ? ((diag.response_time_ms ?? 0) / 1000).toFixed(1) + 's' : '?'})`} defaultOpen>
      <div className="diag-kv">
        <span className="diag-k">Model:</span> <span className="diag-v">{diag.model}</span>
      </div>
      {diag.response_time_ms && (
        <div className="diag-kv">
          <span className="diag-k">Response time:</span> <span className="diag-v">{((diag.response_time_ms ?? 0) / 1000).toFixed(1)}s</span>
        </div>
      )}
      {(diag.input_tokens != null || diag.output_tokens != null) && (
        <div className="diag-kv">
          <span className="diag-k">Tokens:</span>
          <span className="diag-v">
            {diag.input_tokens != null ? diag.input_tokens.toLocaleString() : '—'} in
            {' / '}
            {diag.output_tokens != null ? diag.output_tokens.toLocaleString() : '—'} out
          </span>
        </div>
      )}
    </CollapsibleSection>
  );
}

// ── Moderator Intervention Metadata ───────────────────────────────────────────
function InterventionSection({ entry }: { entry: Entry }) {
  if (!(entry.type === 'intervention' && entry.intervention_metadata)) return null;
  const im = entry.intervention_metadata;
  const familyColors: Record<string, string> = {
    procedural: 'var(--text-secondary)', elicitation: 'var(--warning)', repair: 'var(--danger)',
    reconciliation: 'var(--success)', reflection: 'var(--text-secondary)', synthesis: 'var(--text-secondary)',
  };
  const familyFallback = 'var(--text-muted)';
  return (
    <CollapsibleSection title={`Intervention — ${im.move} [${im.family}]`} defaultOpen>
      <div className="ev-badge-row">
        {/* eslint-disable-next-line local/no-inline-style -- data-driven family color */}
        <span className="diag-badge" style={{ background: `color-mix(in srgb, ${familyColors[im.family] ?? familyFallback} 19%, transparent)`, color: familyColors[im.family] ?? familyFallback }}>{im.family}</span>
        <span className="diag-badge diag-badge-move">{im.move}</span>
        <span className="diag-badge diag-badge-type">{im.force}</span>
      </div>
      <div className="diag-kv">
        <span className="diag-k">Target:</span> <span className="diag-v">{speakerLabel(im.target_debater as SpeakerId)}</span>
      </div>
      <div className="diag-kv">
        <span className="diag-k">Burden:</span> <span className="diag-v">{(im.burden ?? 0).toFixed(2)}</span>
      </div>
      <div className="diag-kv">
        <span className="diag-k">Trigger:</span> <span className="diag-v">{im.trigger_reason}</span>
      </div>
      {im.prerequisite_applied && (
        <div className="diag-kv">
          <span className="diag-k">Prerequisite:</span> <span className="diag-badge ev-badge-warning">{im.prerequisite_applied}</span>
        </div>
      )}
      {im.source_evidence?.claim && (
        <div className="diag-kv">
          <span className="diag-k">Source claim:</span> <span className="diag-v">{im.source_evidence.claim}</span>
        </div>
      )}
      {im.original_claim_text && (
        <div className="ev-original-claim">
          {im.original_claim_text}
        </div>
      )}
    </CollapsibleSection>
  );
}

// ── Moderator Deliberation (t/160) ────────────────────────────────────────────
function ModeratorImplChallenge({ trace }: { trace: ModeratorTrace }) {
  if (trace.selection_reason !== 'implementation_challenge') return null;
  const trigger = (trace as Record<string, unknown>).implementation_challenge_trigger as { round?: number; operationality_score?: number; convergence_score?: number } | undefined;
  return (
    <div className="diag-kv ev-mt-4">
      <span className="diag-badge ev-impl-challenge-badge">
        IMPLEMENTATION CHALLENGE
      </span>
      {trigger ? (
        <span className="diag-muted ev-ml-6">
          round {trigger.round ?? '?'} · operationality {trigger.operationality_score?.toFixed(2) ?? '?'} · convergence {trigger.convergence_score?.toFixed(2) ?? '?'}
        </span>
      ) : null}
    </div>
  );
}

function ModeratorArgNetworkSnapshot({ snapshot }: { snapshot: ModeratorTrace['argument_network_snapshot'] }) {
  if (!snapshot) return null;
  return (
    <div className="ev-fs-sm ev-mt-4">
      <div className="diag-k">Argument Network at Decision:</div>
      <div className="diag-muted">
        {snapshot.total_claims} claims, {snapshot.total_edges} edges, {snapshot.unaddressed_claims} unaddressed
      </div>
      {(snapshot.strongest_unaddressed?.length ?? 0) > 0 && (
        <div className="ev-mt-2">
          <span className="diag-k">Strongest unaddressed:</span>
          {snapshot.strongest_unaddressed!.map((n, i) => (
            <div key={i} className="diag-muted ev-pl-8">
              {n.id} ({n.speaker}, strength {n.strength?.toFixed(2)}): {n.text}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ModeratorCommitments({ commitmentSnapshot }: { commitmentSnapshot: ModeratorTrace['commitment_snapshot'] }) {
  if (Object.keys(commitmentSnapshot).length === 0) return null;
  return (
    <div className="diag-mod-commitments">
      <span className="diag-k">Commitments at selection:</span>
      {Object.entries(commitmentSnapshot).map(([debater, counts]) => (
        <div key={debater} className="diag-mod-commit-row">
          <span className="diag-mod-commit-name">{debater}:</span>
          <span className="diag-muted">{counts.asserted}A {counts.conceded}C {counts.challenged}Ch</span>
        </div>
      ))}
    </div>
  );
}

function ModeratorSection({ meta }: { meta: Record<string, unknown> | undefined }) {
  if (!meta?.moderator_trace) return null;
  const trace = meta.moderator_trace as ModeratorTrace;
  return (
    <CollapsibleSection title={`Moderator — selected ${trace.selected} (${trace.selection_reason.replace(/_/g, ' ')})`} defaultOpen>
      <div className="diag-kv">
        <span className="diag-k">Selected:</span> <span className="diag-v">{trace.selected}</span>
      </div>
      {trace.excluded_last_speaker && (
        <div className="diag-kv">
          <span className="diag-k">Excluded (last speaker):</span> <span className="diag-v">{trace.excluded_last_speaker}</span>
        </div>
      )}
      <div className="diag-kv">
        <span className="diag-k">Reason:</span> <span className="diag-badge diag-badge-move">{trace.selection_reason.replace(/_/g, ' ')}</span>
      </div>
      {trace.focus_point && (
        <div className="diag-kv">
          <span className="diag-k">Focus:</span> <span className="diag-v">{trace.focus_point}</span>
        </div>
      )}
      {trace.candidates.length > 0 && (
        <div className="diag-mod-candidates">
          <span className="diag-k">Candidates:</span>
          {trace.candidates.map((c, i) => (
            <div key={i} className="diag-mod-candidate">
              <span className="diag-mod-rank">#{c.rank}</span>
              <span>{c.debater}</span>
              {c.computed_strength != null && (
                <span className="diag-muted">strength: {c.computed_strength.toFixed(2)}</span>
              )}
            </div>
          ))}
        </div>
      )}
      {trace.convergence_score != null && (
        <div className="diag-kv">
          <span className="diag-k">Convergence:</span>
          <span className="diag-v">{(trace.convergence_score * 100).toFixed(0)}%{trace.convergence_triggered ? ' (triggered)' : ''}</span>
        </div>
      )}
      {trace.recent_scheme && (
        <div className="diag-kv">
          <span className="diag-k">Recent Scheme:</span>
          <span className="diag-badge ev-badge-hover">{trace.recent_scheme}</span>
        </div>
      )}
      {trace.metaphor_reframe_offered && (
        <div className="diag-kv ev-mt-4">
          <span className="diag-k">Metaphor Reframe:</span>
          <span className="diag-badge ev-badge-warning">
            {trace.metaphor_reframe_offered} {trace.metaphor_reframe_used ? '(USED)' : '(offered, not used)'}
          </span>
        </div>
      )}
      {trace.critical_questions && (
        <div className="ev-cq-box">
          <div className="diag-k ev-mb-2">Critical Questions for Moderator:</div>
          <div className="diag-muted ev-pre-wrap">{trace.critical_questions}</div>
        </div>
      )}
      {/* Implementation Challenge move (policymaker debates, t/251) */}
      <ModeratorImplChallenge trace={trace} />
      <ModeratorArgNetworkSnapshot snapshot={trace.argument_network_snapshot} />
      <ModeratorCommitments commitmentSnapshot={trace.commitment_snapshot} />
    </CollapsibleSection>
  );
}

// ── Pipeline Stage Work Products ──────────────────────────────────────────────
function BriefAngle({ a, stageColor }: { a: { angle: string; why: string; grounding?: { node_id: string; why: string }[] }; stageColor: string }) {
  const sitGrounding = (a.grounding ?? []).filter(g => g.node_id.startsWith('sit-'));
  const sitNodes = useTaxonomyStore.getState().situations?.nodes;
  return (
    // eslint-disable-next-line local/no-inline-style -- data-driven stage border color
    <div className="ev-plan-item" style={{ borderLeft: `2px solid color-mix(in srgb, ${stageColor} 25%, transparent)` }}>
      <div className="ev-angle-title">{a.angle}</div>
      <div className="ev-muted-2xs">{a.why}</div>
      {sitGrounding.length > 0 && sitNodes && (
        <div className="ev-mt-2">
          {sitGrounding.map(g => (
            <SitGroundingChip key={g.node_id} g={g} sitNodes={sitNodes} />
          ))}
        </div>
      )}
    </div>
  );
}

function SitGroundingChip({ g, sitNodes }: { g: { node_id: string; why: string }; sitNodes: SituationNodes }) {
  const sit = sitNodes.find(n => n.id === g.node_id);
  const div = sit?.interpretation_divergence;
  if (div == null) return (
    <span className="ev-sit-chip">
      {g.node_id}
    </span>
  );
  const color = div > 0.40 ? 'var(--success)' : div >= 0.20 ? 'var(--warning)' : 'var(--danger)';
  const isLow = div < 0.20;
  return (
    // eslint-disable-next-line local/no-inline-style -- data-driven low-divergence background
    <span className="ev-sit-chip-div" style={{ background: isLow ? 'color-mix(in srgb, var(--danger) 9%, transparent)' : 'var(--bg-secondary)' }}>
      <span className="ev-text-muted">{g.node_id}</span>
      {/* eslint-disable-next-line local/no-inline-style -- data-driven divergence color */}
      <span className="ev-fw-600" style={{ color }}>div:{div.toFixed(2)}</span>
      {isLow && <span title="Low divergence — may not generate disagreement">⚠</span>}
    </span>
  );
}

function BriefStageBody({ s, stageColors }: { s: StageDiag; stageColors: Record<string, string> }) {
  if (s.stage !== 'brief') return null;
  return (
    <>
      {!!(s.work_product as Record<string, unknown>).situation_assessment && (
        // eslint-disable-next-line local/no-inline-style -- data-driven stage border color
        <div className="ev-stage-assessment" style={{ borderLeft: `3px solid color-mix(in srgb, ${stageColors[s.stage]} 25%, transparent)` }}>
          {String((s.work_product as Record<string, unknown>).situation_assessment)}
        </div>
      )}
      {Array.isArray((s.work_product as Record<string, unknown>).strongest_angles) && (
        <div className="ev-mb-6">
          {((s.work_product as Record<string, unknown>).strongest_angles as { angle: string; why: string; grounding?: { node_id: string; why: string }[] }[]).map((a, i) => (
            <BriefAngle key={i} a={a} stageColor={stageColors[s.stage]} />
          ))}
        </div>
      )}
    </>
  );
}

function PlanStageBody({ s, stageColors }: { s: StageDiag; stageColors: Record<string, string> }) {
  if (s.stage !== 'plan') return null;
  return (
    <>
      {!!(s.work_product as Record<string, unknown>).strategic_goal && (
        // eslint-disable-next-line local/no-inline-style -- data-driven stage border color
        <div className="ev-stage-goal" style={{ borderLeft: `3px solid color-mix(in srgb, ${stageColors[s.stage]} 25%, transparent)` }}>
          {String((s.work_product as Record<string, unknown>).strategic_goal)}
        </div>
      )}
      {!!(s.work_product as Record<string, unknown>).core_thesis && (
        // eslint-disable-next-line local/no-inline-style -- data-driven stage border color
        <div className="ev-stage-thesis" style={{ borderLeft: `3px solid color-mix(in srgb, ${stageColors[s.stage]} 25%, transparent)` }}>
          {String((s.work_product as Record<string, unknown>).core_thesis)}
        </div>
      )}
      {Array.isArray((s.work_product as Record<string, unknown>).planned_moves) && (
        <div className="ev-mb-6">
          {((s.work_product as Record<string, unknown>).planned_moves as { move: string; target?: string; detail: string }[]).map((m, i) => (
            // eslint-disable-next-line local/no-inline-style -- data-driven stage border color
            <div key={i} className="ev-plan-item" style={{ borderLeft: `2px solid color-mix(in srgb, ${stageColors[s.stage]} 25%, transparent)` }}>
              <span className="diag-badge diag-badge-move">{m.move}</span>
              {m.target && <span className="ev-ml-6 ev-muted-2xs">{'→'} {m.target}</span>}
              {m.detail && <div className="ev-fs-sm ev-mt-1">{m.detail}</div>}
            </div>
          ))}
        </div>
      )}
      {Array.isArray((s.work_product as Record<string, unknown>).argument_structure) && (
        <div className="ev-mb-6">
          {((s.work_product as Record<string, unknown>).argument_structure as { point: string; evidence: string; taxonomy_anchor: string }[]).map((a, i) => (
            // eslint-disable-next-line local/no-inline-style -- data-driven stage border color
            <div key={i} className="ev-plan-item" style={{ borderLeft: `2px solid color-mix(in srgb, ${stageColors[s.stage]} 25%, transparent)` }}>
              <div className="ev-angle-title">{a.point}</div>
              {a.evidence && <div className="ev-muted-2xs">Evidence: {a.evidence}</div>}
              {a.taxonomy_anchor && <div className="ev-muted-2xs">Anchor: {a.taxonomy_anchor}</div>}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function DraftTopicAlignBox({ ta }: { ta: TopicAlignment }) {
  return (
    // eslint-disable-next-line local/no-inline-style -- data-driven topic-alignment border color
    <div className="ev-topic-align-box" style={{ borderLeft: `3px solid color-mix(in srgb, ${ta.topic_aligned ? 'var(--success)' : 'var(--danger)'} 25%, transparent)` }}>
      <div className="diag-kv ev-mb-2">
        <span className="diag-k">Topic aligned</span>
        <span className="diag-badge ev-badge-hover">Attempt {String((ta as Record<string, unknown>).draft_attempt ?? 1)}</span>
        {ta.repaired && (
          <span className="diag-badge ev-badge-warning">triggered regen</span>
        )}
      </div>
      <div className="diag-kv">
        <span className="diag-k">Result:</span>
        <VerdictChip
          verdict={ta.topic_aligned ? 'pass' : 'fail'}
          label={ta.topic_aligned ? 'yes' : 'no'}
        />
      </div>
      {(ta.scope_used?.off_scope_topics?.length ?? 0) > 0 && (
        <div className="ev-mt-2">
          <span className="diag-k">Off-scope topics (static):</span>
          <ul className="ev-scope-list">
            {ta.scope_used!.off_scope_topics!.map((item: string, i: number) => (
              <li key={i} className="ev-text-danger">{item}</li>
            ))}
          </ul>
        </div>
      )}
      {(ta.scope_used?.drift_signatures?.length ?? 0) > 0 && (
        <div className="ev-mt-2">
          <span className="diag-k">Drift signatures (static):</span>
          <ul className="ev-scope-list">
            {ta.scope_used!.drift_signatures!.map((sig: string, i: number) => (
              <li key={i} className="ev-text-warning">{sig}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function DraftStageBody({ s, diag }: { s: StageDiag; diag: EntryDiagnostics | undefined }) {
  if (s.stage !== 'draft') return null;
  return (
    <>
      {!!(s.work_product as Record<string, unknown>).disagreement_type && (
        <div className="diag-kv ev-mb-4">
          <span className="diag-k">Disagreement:</span>
          <span className="diag-badge diag-badge-type">{String((s.work_product as Record<string, unknown>).disagreement_type)}</span>
        </div>
      )}
      {diag?.topic_alignment && (
        <DraftTopicAlignBox ta={diag.topic_alignment} />
      )}
    </>
  );
}

function CiteStageBody({ s }: { s: StageDiag }) {
  if (s.stage !== 'cite') return null;
  return (
    <>
      {typeof (s.work_product as Record<string, unknown>).grounding_confidence === 'number' && (
        <div className="diag-kv ev-mb-4">
          <span className="diag-k">Grounding confidence:</span>
          <span className="diag-v">{((s.work_product as Record<string, unknown>).grounding_confidence as number).toFixed(2)}</span>
        </div>
      )}
    </>
  );
}

function StageSection({ s, diag, stageColors }: { s: StageDiag; diag: EntryDiagnostics | undefined; stageColors: Record<string, string> }) {
  return (
    <CollapsibleSection key={s.stage} title={`${s.stage.toUpperCase()} — ${s.model} (temp=${s.temperature}, ${((s.response_time_ms ?? 0) / 1000).toFixed(1)}s${s.input_tokens != null || s.output_tokens != null ? `, ${(s.input_tokens ?? 0).toLocaleString()}/${(s.output_tokens ?? 0).toLocaleString()} tok` : ''})`}>
      <BriefStageBody s={s} stageColors={stageColors} />
      <PlanStageBody s={s} stageColors={stageColors} />
      <DraftStageBody s={s} diag={diag} />
      <CiteStageBody s={s} />
      <details className="ev-muted-2xs">
        <summary className="ev-cursor-pointer">Full work product</summary>
        <pre className="ev-work-product-pre">{JSON.stringify(s.work_product, null, 2)}</pre>
      </details>
    </CollapsibleSection>
  );
}

function PipelineStagesSection({ diag }: { diag: EntryDiagnostics | undefined }) {
  if (!(diag?.stage_diagnostics && diag.stage_diagnostics.length > 0)) return null;
  const stages = diag.stage_diagnostics;
  const stageColors: Record<string, string> = { brief: 'var(--text-secondary)', plan: 'var(--text-secondary)', draft: 'var(--success)', cite: 'var(--warning)' };
  return (
    <>
      {stages.map(s => (
        <StageSection key={s.stage} s={s} diag={diag} stageColors={stageColors} />
      ))}
    </>
  );
}

// ── Dialectical Moves ─────────────────────────────────────────────────────────
function DialecticalMovesSection({ meta }: { meta: Record<string, unknown> | undefined }) {
  if (!meta?.move_types) return null;
  return (
    <CollapsibleSection title={`Dialectical Moves — ${(meta.move_types as (string | MoveAnnotation)[]).map(m => getMoveName(m)).join(', ')}`} defaultOpen>
      {(meta.move_types as (string | MoveAnnotation)[]).map((m, i) => {
        const name = getMoveName(m);
        const ann = typeof m === 'object' ? m as MoveAnnotation : null;
        return (
          <div key={i} className="ev-move-item">
            <span className="diag-badge diag-badge-move">{name}</span>
            {ann?.target && <span className="ev-ml-6 ev-muted-2xs">→ {ann.target}</span>}
            {ann?.detail && <div className="ev-fs-sm ev-mt-2">{ann.detail}</div>}
          </div>
        );
      })}
      {!!meta.disagreement_type && (
        <div className="diag-kv ev-mt-4">
          <span className="diag-k">Disagreement type:</span>
          <span className="diag-badge diag-badge-type">{String(meta.disagreement_type)}</span>
        </div>
      )}
    </CollapsibleSection>
  );
}

// ── Key Assumptions ───────────────────────────────────────────────────────────
function KeyAssumptionsSection({ meta }: { meta: Record<string, unknown> | undefined }) {
  if (!(meta?.key_assumptions && (meta.key_assumptions as { assumption: string; if_wrong: string }[]).length > 0)) return null;
  return (
    <CollapsibleSection title={`Key Assumptions (${(meta.key_assumptions as unknown[]).length})`}>
      {(meta.key_assumptions as { assumption: string; if_wrong: string }[]).map((a, i) => (
        <div key={i} className="diag-assumption">
          <div><strong>Assumes:</strong> {a.assumption}</div>
          <div className="diag-muted">If wrong: {a.if_wrong}</div>
        </div>
      ))}
    </CollapsibleSection>
  );
}

// ── Extracted Claims ──────────────────────────────────────────────────────────
function ClaimEntailmentChip({ repair, hasEntailmentData }: { repair: EntailmentRepair | undefined; hasEntailmentData: boolean }) {
  if (repair) return (
    <VerdictChip
      verdict={repair.verdict === 'entailed' ? 'pass' : repair.verdict === 'partial' ? 'flag' : 'fail'}
      label={repair.verdict === 'entailed' ? '✓' : repair.verdict === 'partial' ? '~' : '✗'}
      tooltip={`Entailment: ${repair.verdict} — ${repair.explanation}`}
    />
  );
  if (hasEntailmentData) return (
    <span className="ev-ns-badge">ns</span>
  );
  return null;
}

function ClaimBdiBadge({ anNode }: { anNode: ArgumentNetworkNode | undefined }) {
  if (!anNode?.bdi_category) return null;
  return (
    // eslint-disable-next-line local/no-inline-style -- data-driven BDI category color
    <span className="ev-mini-badge" style={{ background: anNode.bdi_category === 'belief' ? 'color-mix(in srgb, var(--color-saf) 15%, transparent)' : anNode.bdi_category === 'desire' ? 'color-mix(in srgb, var(--color-skp) 15%, transparent)' : 'color-mix(in srgb, var(--color-acc) 15%, transparent)', color: anNode.bdi_category === 'belief' ? 'var(--color-saf)' : anNode.bdi_category === 'desire' ? 'var(--color-skp)' : 'var(--color-acc)' }}>
      {anNode.bdi_category[0].toUpperCase()}
    </span>
  );
}

function ClaimRepairDiff({ repair }: { repair: EntailmentRepair | undefined }) {
  if (!(repair && repair.verdict !== 'entailed' && repair.repaired_text)) return null;
  return (
    <div className="ev-repair-diff">
      <span className="ev-repair-old">{repair.original_text.slice(0, 80)}{repair.original_text.length > 80 ? '…' : ''}</span>
      {' → '}
      <span className="ev-text-success">{repair.repaired_text.slice(0, 80)}{repair.repaired_text.length > 80 ? '…' : ''}</span>
    </div>
  );
}

function AcceptedClaimRow({ c, diag, activeDebate }: { c: AcceptedClaim; diag: EntryDiagnostics; activeDebate: ActiveDebate }) {
  const anNode = activeDebate?.argument_network?.nodes.find(n => n.id === c.id);
  const ec = anNode?.extraction_confidence;
  const repair = diag.entailment_repairs?.find(r => r.node_id === c.id);
  const hasEntailmentData = (diag.entailment_repairs?.length ?? 0) > 0;
  return (
    <div className="diag-claim diag-claim-accepted">
      <span className="diag-claim-status">✓ {c.id}</span>
      <span className="diag-claim-overlap">{c.overlap_pct}%</span>
      {ec != null && (
        <ScoreBadge value={ec} label="FIRE" tooltip={`FIRE ${ec.toFixed(2)} — extraction confidence`} />
      )}
      <ClaimEntailmentChip repair={repair} hasEntailmentData={hasEntailmentData} />
      <ClaimBdiBadge anNode={anNode} />
      {anNode?.specificity && (
        <span className="ev-mini-badge ev-badge-muted12">
          {anNode.specificity}
        </span>
      )}
      {anNode?.steelman_of && (
        <span className="ev-mini-badge ev-badge-secondary">
          ⬆
        </span>
      )}
      <span className="diag-claim-text">{c.text}</span>
      <ClaimRepairDiff repair={repair} />
    </div>
  );
}

function ExtractedClaimsSection({ diag, activeDebate }: { diag: EntryDiagnostics | undefined; activeDebate: ActiveDebate }) {
  if (!diag?.extracted_claims) return null;
  const extractedClaims = diag.extracted_claims;
  return (
    <CollapsibleSection title={`Extracted Claims (${extractedClaims.accepted.length} accepted, ${extractedClaims.rejected.length} rejected)`} defaultOpen>
      {extractedClaims.accepted.map((c, i) => (
        <AcceptedClaimRow key={i} c={c} diag={diag} activeDebate={activeDebate} />
      ))}
      {extractedClaims.rejected.map((c, i) => (
        <div key={i} className="diag-claim diag-claim-rejected">
          <span className="diag-claim-status">✗</span>
          <span className="diag-claim-overlap">{c.overlap_pct}%</span>
          <span className="diag-claim-text">{c.text}</span>
          <span className="diag-claim-reason">{c.reason}</span>
        </div>
      ))}
    </CollapsibleSection>
  );
}

// ── Claim Extraction Details ──────────────────────────────────────────────────
function ClaimExtractionSection({ diag }: { diag: EntryDiagnostics | undefined }) {
  if (!diag?.claim_extraction) return null;
  const ce = diag.claim_extraction;
  return (
    <CollapsibleSection title={`Claim Extraction — ${ce.claims_parsed} claims, ${ce.schemes_classified.length} schemes (${ce.response_time_ms}ms)`} defaultOpen>
      {ce.schemes_classified.length > 0 && (
        <div className="ev-mb-6">
          <span className="diag-k">Argumentation Schemes Classified:</span>
          <div className="diag-badges ev-mt-2">
            {ce.schemes_classified.map((s, i) => (
              <span key={i} className="diag-badge ev-badge-hover">{s}</span>
            ))}
          </div>
        </div>
      )}
      <CollapsibleSection title="Extraction Prompt">
        <textarea readOnly className="diag-textarea" value={ce.prompt} />
      </CollapsibleSection>
      <CollapsibleSection title="Extraction Raw Response">
        <textarea readOnly className="diag-textarea" value={ce.raw_response} />
      </CollapsibleSection>
    </CollapsibleSection>
  );
}

// ── Exclusion Guard ───────────────────────────────────────────────────────────
function ExclusionExtractionGuard({ exclusionGuard, violations, hasExtTrace }: { exclusionGuard: ExclusionGuardData | undefined; violations: ExclusionViolation[]; hasExtTrace: boolean }) {
  return (
    <div className="ev-mb-8">
      <div className="diag-k ev-mb-3">Claim Extraction Guard</div>
      {exclusionGuard ? (
        <>
          <div className="ev-muted-2xs ev-mb-3">
            Checked {exclusionGuard.checked} claims against {exclusionGuard.refs_with_exclusion_vector} exclusion vectors (threshold: {exclusionGuard.threshold.toFixed(2)})
          </div>
          {violations.length > 0 ? violations.map((v, i) => (
            <div key={i} className="ev-violation-row">
              <span className="ev-fw-600 ev-text-danger">{v.claim_id}</span> → {v.node_id}
              <span className="diag-muted"> (main: {v.similarity_main.toFixed(2)}, excl: {v.similarity_exclusion.toFixed(2)})</span>
            </div>
          )) : (
            <div className="ev-scope-ok">All {exclusionGuard.checked} claims within scope — 0 exclusion violations</div>
          )}
        </>
      ) : hasExtTrace ? (
        <div className="ev-scope-ok">All claims within scope — 0 exclusion violations</div>
      ) : (
        <div className="ev-no-data">No exclusion guard data — extraction trace not available</div>
      )}
    </div>
  );
}

function ExclusionDraftScopeCheck({ scopeDriftCheck, warnings, diag }: { scopeDriftCheck: ScopeDriftCheck | undefined; warnings: ScopeWarning[]; diag: EntryDiagnostics | undefined }) {
  return (
    <div className="ev-mb-8">
      <div className="diag-k ev-mb-3">Draft Scope Check</div>
      {scopeDriftCheck ? (
        <>
          <div className="ev-muted-2xs ev-mb-3">
            Checked {scopeDriftCheck.refs_checked} refs, {scopeDriftCheck.refs_with_exclusion_vector} with exclusion vectors (threshold: {scopeDriftCheck.threshold.toFixed(2)})
          </div>
          {warnings.length > 0 ? warnings.map((w, i) => (
            <div key={i} className="ev-warning-row">
              <span className="ev-fw-600 ev-text-warning">{w.debater}</span> → {w.node_id}
              <span className="diag-muted"> (sim: {w.similarity.toFixed(2)})</span>
            </div>
          )) : (
            <div className="ev-scope-ok">All {scopeDriftCheck.refs_checked} refs within scope — 0 drift warnings</div>
          )}
        </>
      ) : diag ? (
        <div className="ev-scope-ok">No scope drift detected — 0 warnings</div>
      ) : (
        <div className="ev-no-data">No scope drift data — diagnostics not available</div>
      )}
    </div>
  );
}

function TaxonomyInjectionTrace({ diag }: { diag: EntryDiagnostics | undefined }) {
  if (!(diag as Record<string, unknown> | undefined)?.taxonomy_injection_trace) return null;
  const tit = (diag as Record<string, unknown>).taxonomy_injection_trace as { considered: number; demoted: number; demoted_nodes?: { node_id: string; exclusion_similarity: number }[] };
  return (
    <div className="ev-mb-8">
      <div className="diag-k ev-mb-3">Taxonomy Context Injection</div>
      <div className="ev-muted-2xs ev-mb-3">
        {tit.considered} nodes considered, {tit.demoted} demoted by exclusion filter
      </div>
      {tit.demoted_nodes?.map((n, i) => (
        <div key={i} className="ev-inject-row">
          <span className="ev-fw-600">{n.node_id}</span>
          <span className="diag-muted"> (excl: {n.exclusion_similarity.toFixed(2)})</span>
        </div>
      ))}
    </div>
  );
}

function SituationInjectionTrace({ diag }: { diag: EntryDiagnostics | undefined }) {
  if (!(diag as Record<string, unknown> | undefined)?.situation_injection_trace) return null;
  const sit = (diag as Record<string, unknown>).situation_injection_trace as { considered: number; excluded: number; excluded_situations?: { situation_id: string; exclusion_similarity: number }[] };
  return (
    <div>
      <div className="diag-k ev-mb-3">Situation Injection</div>
      <div className="ev-muted-2xs ev-mb-3">
        {sit.considered} situations considered, {sit.excluded} excluded
      </div>
      {sit.excluded_situations?.map((s, i) => (
        <div key={i} className="ev-inject-row">
          <span className="ev-fw-600">{s.situation_id}</span>
          <span className="diag-muted"> (excl: {s.exclusion_similarity.toFixed(2)})</span>
        </div>
      ))}
    </div>
  );
}

function ExclusionGuardSection({ diag }: { diag: EntryDiagnostics | undefined }) {
  const data = computeExclusionGuardData(diag);
  if (!data) return null;
  const { exclusionGuard, scopeDriftCheck, legacyViolations, legacyWarnings, hasExtTrace } = data;

  const violations = exclusionGuard?.violations ?? legacyViolations ?? [];
  const warnings = scopeDriftCheck?.warnings ?? legacyWarnings ?? [];
  const totalIssues = violations.length + warnings.length;

  return (
    <CollapsibleSection title={`Exclusion Guard${totalIssues > 0 ? ` — ${totalIssues} issue${totalIssues !== 1 ? 's' : ''}` : ''}`}>
      {/* Claim Extraction Guard */}
      <ExclusionExtractionGuard exclusionGuard={exclusionGuard} violations={violations} hasExtTrace={hasExtTrace} />

      {/* Draft Scope Check */}
      <ExclusionDraftScopeCheck scopeDriftCheck={scopeDriftCheck} warnings={warnings} diag={diag} />

      {/* Taxonomy Context Injection — placeholder for t/489 */}
      <TaxonomyInjectionTrace diag={diag} />

      {/* Situation Injection — placeholder for t/490 */}
      <SituationInjectionTrace diag={diag} />
    </CollapsibleSection>
  );
}

// ── Context Usage Analysis ────────────────────────────────────────────────────
function PolicymakerBoost({ manifest }: { manifest: InjectionManifest }) {
  if (!(manifest as Record<string, unknown>).policymaker_situation_boost) return null;
  const psb = (manifest as Record<string, unknown>).policymaker_situation_boost as { boosted: number; keywords_matched?: string[] };
  return (
    <div className="ev-grid-3">
      <div>
        <div className="diag-k">Policymaker Boost</div>
        <div className="diag-v">{psb.boosted} situation{psb.boosted !== 1 ? 's' : ''} boosted</div>
      </div>
      {psb.keywords_matched && psb.keywords_matched.length > 0 && (
        <div className="ev-grid-span-2">
          <div className="diag-k">Keywords Matched</div>
          <div className="diag-v">{psb.keywords_matched.join(', ')}</div>
        </div>
      )}
    </div>
  );
}

function ScopeFilterTrace({ manifest }: { manifest: InjectionManifest }) {
  if (!(manifest as Record<string, unknown>).scope_filter_trace) return null;
  const sft = (manifest as Record<string, unknown>).scope_filter_trace as {
    demoted: { nodeId: string; reason: string; originalScore: number; newScore: number }[];
    restorations: string[];
  };
  const restoredSet = new Set(sft.restorations);
  return (
    <div className="ev-mb-8">
      <div className="diag-k ev-mb-4">
        Scope Filter — {sft.demoted.length} demoted, {sft.restorations.length} restored
      </div>
      {sft.demoted.map(d => {
        const restored = restoredSet.has(d.nodeId);
        return (
          <div key={d.nodeId} className="ev-flex-row-2xs">
            {/* eslint-disable-next-line local/no-inline-style -- data-driven restored/demoted color */}
            <span className="ev-mono-52" style={{ color: restored ? 'var(--warning)' : 'var(--danger)' }}>{d.nodeId}</span>
            <span className="ev-flex-1 ev-text-muted">{d.reason}</span>
            <span className="ev-score-col">
              {d.originalScore.toFixed(2)} → {d.newScore.toFixed(2)}
            </span>
            {restored && <span className="diag-badge ev-badge-warning">restored</span>}
          </div>
        );
      })}
    </div>
  );
}

function SituationDivergence({ injectedSit, referencedIds }: { injectedSit: string[]; referencedIds: Set<string> }) {
  if (!(injectedSit.length > 0)) return null;
  const sitNodes = useTaxonomyStore.getState().situations?.nodes;
  if (!sitNodes) return null;
  const sitWithDiv = injectedSit
    .map(id => sitNodes.find(n => n.id === id))
    .filter((n): n is NonNullable<typeof n> => !!n && n.interpretation_divergence != null);
  if (sitWithDiv.length === 0) return null;
  return (
    <div className="ev-mb-8">
      <div className="diag-k ev-mb-4">Situation Divergence</div>
      {sitWithDiv.map(sit => {
        const div = sit.interpretation_divergence!;
        const color = div > 0.40 ? 'var(--success)' : div >= 0.20 ? 'var(--warning)' : 'var(--danger)';
        const label = div > 0.40 ? 'high' : div >= 0.20 ? 'moderate' : 'low';
        const cited = referencedIds.has(sit.id);
        const barWidth = Math.round(div * 100);
        return (
          <div key={sit.id} className="ev-flex-row-sm">
            {/* eslint-disable-next-line local/no-inline-style -- data-driven cited color */}
            <span className="ev-mono-52" style={{ color: cited ? 'var(--accent)' : 'var(--text-muted)' }}>{sit.id}</span>
            <span className="ev-sit-label">{sit.label}</span>
            <span className="ev-div-score">{div.toFixed(2)}</span>
            <div className="ev-div-bar-track">
              {/* eslint-disable-next-line local/no-inline-style -- data-driven bar width and color */}
              <div style={{ width: `${barWidth}%`, height: '100%', background: color, borderRadius: 2 }} />
            </div>
            {/* eslint-disable-next-line local/no-inline-style -- data-driven divergence color */}
            <span className="ev-fs-2xs ev-fw-600 ev-minw-28" style={{ color }}>{label}</span>
          </div>
        );
      })}
    </div>
  );
}

function ContextUsageContent({ entry }: { entry: Entry }) {
  const manifest = (entry.metadata as Record<string, unknown>).injection_manifest as InjectionManifest;
  const referencedIds = new Set((entry.taxonomy_refs ?? []).map((r: { node_id: string }) => r.node_id));
  const injectedPov = manifest.povNodeIds ?? [];
  const injectedSit = manifest.situationNodeIds ?? [];
  const usedPov = injectedPov.filter(id => referencedIds.has(id));
  const usedSit = injectedSit.filter(id => referencedIds.has(id));
  const usedPrimary = (manifest.povPrimaryIds ?? []).filter(id => referencedIds.has(id));
  const unusedRefs = [...referencedIds].filter(id => !injectedPov.includes(id) && !injectedSit.includes(id));

  return (
    <div className="ev-fs-md">
      <div className="ev-grid-3">
        <div>
          <div className="diag-k">Perspective Nodes</div>
          <div className="diag-v">{usedPov.length} / {injectedPov.length} used ({injectedPov.length > 0 ? Math.round(100 * usedPov.length / injectedPov.length) : 0}%)</div>
        </div>
        <div>
          <div className="diag-k">Primary (★)</div>
          <div className="diag-v">{usedPrimary.length} / {(manifest.povPrimaryIds ?? []).length} used</div>
        </div>
        <div>
          <div className="diag-k">Situations</div>
          <div className="diag-v">{usedSit.length} / {injectedSit.length} used ({injectedSit.length > 0 ? Math.round(100 * usedSit.length / injectedSit.length) : 0}%)</div>
        </div>
      </div>
      <div className="ev-grid-3">
        <div>
          <div className="diag-k">Vulnerabilities</div>
          <div className="diag-v">{manifest.vulnerabilityCount} injected</div>
        </div>
        <div>
          <div className="diag-k">Policies</div>
          <div className="diag-v">{manifest.policyCount} injected</div>
        </div>
        <div>
          <div className="diag-k">Est. Tokens</div>
          <div className="diag-v">~{manifest.totalTokenEstimate?.toLocaleString()}</div>
        </div>
      </div>
      {/* Policymaker situation boost (t/251) */}
      <PolicymakerBoost manifest={manifest} />
      {/* Scope Filter Trace (10.5) */}
      <ScopeFilterTrace manifest={manifest} />
      {/* Per-situation divergence scores (t/254) */}
      <SituationDivergence injectedSit={injectedSit} referencedIds={referencedIds} />
      {unusedRefs.length > 0 && (
        <div className="ev-text-warning ev-mt-4">
          {unusedRefs.length} referenced node(s) not in injected context — hallucinated refs?
        </div>
      )}
    </div>
  );
}

function ContextUsageSection({ entry }: { entry: Entry }) {
  if (!entry?.metadata?.injection_manifest) return null;
  return (
    <CollapsibleSection title="Context Usage Analysis">
      <ContextUsageContent entry={entry} />
    </CollapsibleSection>
  );
}

// ── Synthesis Preferences (t/251) ─────────────────────────────────────────────
function SynthesisPreferencesSection({ entry, meta }: { entry: Entry; meta: Record<string, unknown> | undefined }) {
  if (!(entry.type === 'concluding' && (meta?.synthesis as Record<string, unknown> | undefined)?.preferences)) return null;
  const prefs = (meta!.synthesis as Record<string, unknown>).preferences as { conflict: string; prevails: string; criterion: string; rationale: string }[];
  const policymakerCriteria = ['political_feasibility', 'implementation_specificity'];
  const hasPolicymaker = prefs.some(p => policymakerCriteria.includes(p.criterion));
  if (prefs.length === 0) return null;
  return (
    <CollapsibleSection title={`Synthesis Preferences (${prefs.length})${hasPolicymaker ? ' — policymaker criteria active' : ''}`}>
      <div className="ev-fs-072">
        {prefs.map((p, i) => {
          const isPolicyCriterion = policymakerCriteria.includes(p.criterion);
          return (
            <div key={i} className="ev-pref-card">
              <div className="ev-flex-row-mb2">
                {/* eslint-disable-next-line local/no-inline-style -- data-driven policymaker-criterion colors */}
                <span className="diag-badge ev-pref-crit-badge" style={{
                  background: isPolicyCriterion ? 'color-mix(in srgb, var(--danger) 15%, transparent)' : 'color-mix(in srgb, var(--text-secondary) 15%, transparent)',
                  color: isPolicyCriterion ? 'var(--danger)' : 'var(--text-secondary)',
                }}>
                  {p.criterion.replace(/_/g, ' ')}
                </span>
                <span className="ev-fw-600">→ {p.prevails}</span>
              </div>
              <div className="diag-muted">{p.conflict}</div>
              <div className="ev-text-secondary ev-mt-2">{p.rationale}</div>
            </div>
          );
        })}
      </div>
    </CollapsibleSection>
  );
}

// ── Textarea context sections ─────────────────────────────────────────────────
function TaxonomyContextSection({ diag }: { diag: EntryDiagnostics | undefined }) {
  if (!diag?.taxonomy_context) return null;
  return (
    <CollapsibleSection title="Taxonomy Context (BDI)">
      <textarea readOnly className="diag-textarea" value={diag.taxonomy_context} />
    </CollapsibleSection>
  );
}

function CommitmentContextSection({ diag }: { diag: EntryDiagnostics | undefined }) {
  if (!diag?.commitment_context) return null;
  return (
    <CollapsibleSection title="Commitments Injected">
      <textarea readOnly className="diag-textarea" value={diag.commitment_context} />
    </CollapsibleSection>
  );
}

function EdgeTensionsSection({ diag }: { diag: EntryDiagnostics | undefined }) {
  if (!diag?.edge_tensions) return null;
  return (
    <CollapsibleSection title="Edge Tensions Considered">
      <textarea readOnly className="diag-textarea" value={diag.edge_tensions} />
    </CollapsibleSection>
  );
}

function AnContextSection({ diag }: { diag: EntryDiagnostics | undefined }) {
  if (!diag?.argument_network_context) return null;
  return (
    <CollapsibleSection title="Argument Network State">
      <textarea readOnly className="diag-textarea" value={diag.argument_network_context} />
    </CollapsibleSection>
  );
}

// ── Taxonomy Refs ─────────────────────────────────────────────────────────────
function TaxonomyRefsSection({ entry }: { entry: Entry }) {
  if (!(entry.taxonomy_refs.length > 0)) return null;
  return (
    <CollapsibleSection title={`Taxonomy Refs (${entry.taxonomy_refs.length})`}>
      {entry.taxonomy_refs.map((r, i) => (
        <div key={i} className="diag-ref">
          <span className="diag-ref-id">{r.node_id}</span>
          <span className="diag-ref-rel">{r.relevance?.slice(0, 100)}</span>
        </div>
      ))}
    </CollapsibleSection>
  );
}

// ── Claim Sketches ────────────────────────────────────────────────────────────
function ClaimSketchesSection({ meta }: { meta: Record<string, unknown> | undefined }) {
  if (!(meta?.my_claims && (meta.my_claims as { claim: string; targets: string[] }[]).length > 0)) return null;
  return (
    <CollapsibleSection title={`Claim Sketches (${(meta.my_claims as unknown[]).length})`} defaultOpen>
      {(meta.my_claims as { claim: string; targets: string[] }[]).map((c, i) => (
        <div key={i} className="ev-claim-sketch">
          <span className="ev-text-saf">{i + 1}.</span> {c.claim}
          {c.targets?.length > 0 && <span className="diag-muted ev-ml-6">→ {c.targets.join(', ')}</span>}
        </div>
      ))}
    </CollapsibleSection>
  );
}

// ── Policy Refs ───────────────────────────────────────────────────────────────
function PolicyRefsSection({ meta, entry }: { meta: Record<string, unknown> | undefined; entry: Entry }) {
  const rawPolRefs = (meta?.policy_refs as (string | { policy_id: string; relevance?: string })[] | undefined) || entry.policy_refs || [];
  const polIds = rawPolRefs.map(p => typeof p === 'string' ? p : p.policy_id);
  if (polIds.length === 0) return null;
  return (
    <CollapsibleSection title={`Policy Refs (${polIds.length})`}>
      <div className="diag-badges">
        {polIds.map((id, i) => (
          <span key={i} className="diag-badge ev-badge-secondary">{id}</span>
        ))}
      </div>
    </CollapsibleSection>
  );
}

// ── Full Prompt ───────────────────────────────────────────────────────────────
function ScopeReminderBlock({ prompt }: { prompt: string }) {
  const match = prompt.match(/Scope reminder:[^\n]*/);
  if (!match) return null;
  return (
    <div className="ev-scope-block">
      <span className="diag-k ev-fs-2xs">Scope block:</span> {match[0]}
    </div>
  );
}

function FullPromptSection({ diag }: { diag: EntryDiagnostics | undefined }) {
  if (!diag?.prompt) return null;
  return (
    <CollapsibleSection title="Full Prompt Sent to AI">
      {diag.prompt.includes('Scope reminder:') && <ScopeReminderBlock prompt={diag.prompt} />}
      <textarea readOnly className="diag-textarea" value={diag.prompt} />
    </CollapsibleSection>
  );
}

// ── Raw Response ──────────────────────────────────────────────────────────────
function RawResponseSection({ diag }: { diag: EntryDiagnostics | undefined }) {
  if (!diag?.raw_response) return null;
  return (
    <CollapsibleSection title="Raw AI Response">
      <textarea readOnly className="diag-textarea" value={diag.raw_response} />
    </CollapsibleSection>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────
function EmptyStateSection({ diag, meta, entry }: { diag: EntryDiagnostics | undefined; meta: Record<string, unknown> | undefined; entry: Entry }) {
  if (!(!diag && !meta?.move_types && entry.taxonomy_refs.length === 0)) return null;
  return (
    <div className="diag-empty">No diagnostic data captured for this entry. Enable diagnostics mode before running the debate.</div>
  );
}

export function EntryView({ entryId }: { entryId: string }) {
  const activeDebate = useDebateStore(s => s.activeDebate);
  if (!activeDebate) return null;

  const entry = activeDebate.transcript.find(e => e.id === entryId);
  if (!entry) return <div className="diag-empty">Entry not found</div>;

  const diag: EntryDiagnostics | undefined = activeDebate.diagnostics?.entries[entryId];
  const meta = entry.metadata as Record<string, unknown> | undefined;

  return (
    <div className="diag-entry-view">
      <EntryHeader entry={entry} diag={diag} meta={meta} entryId={entryId} />

      {/* Model & Timing */}
      <ModelTimingSection diag={diag} />

      {/* Moderator Intervention Metadata */}
      <InterventionSection entry={entry} />

      {/* Moderator Deliberation (t/160) */}
      <ModeratorSection meta={meta} />

      {/* Pipeline Stage Work Products */}
      <PipelineStagesSection diag={diag} />

      {/* Dialectical Moves */}
      <DialecticalMovesSection meta={meta} />

      {/* Key Assumptions */}
      <KeyAssumptionsSection meta={meta} />

      {/* Extracted Claims */}
      <ExtractedClaimsSection diag={diag} activeDebate={activeDebate} />

      {/* Claim Extraction Details — scheme classification, prompt, response */}
      <ClaimExtractionSection diag={diag} />

      {/* Exclusion Guard */}
      <ExclusionGuardSection diag={diag} />

      {/* QBAF Claim Strength (D-Q3) */}
      <QbafClaimStrengthSection entryId={entryId} activeDebate={activeDebate} />

      {/* Context Usage Analysis — injected vs referenced */}
      <ContextUsageSection entry={entry} />

      {/* Synthesis Preferences — show political_feasibility + implementation_specificity scores (t/251) */}
      <SynthesisPreferencesSection entry={entry} meta={meta} />

      {/* Taxonomy Context */}
      <TaxonomyContextSection diag={diag} />

      {/* Commitment Context */}
      <CommitmentContextSection diag={diag} />

      {/* Edge Tensions (moderator only) */}
      <EdgeTensionsSection diag={diag} />

      {/* AN Context (moderator only) */}
      <AnContextSection diag={diag} />

      {/* Taxonomy Refs */}
      <TaxonomyRefsSection entry={entry} />

      {/* Claim Sketches */}
      <ClaimSketchesSection meta={meta} />

      {/* Policy Refs */}
      <PolicyRefsSection meta={meta} entry={entry} />

      {/* Full Prompt */}
      <FullPromptSection diag={diag} />

      {/* Raw Response */}
      <RawResponseSection diag={diag} />

      <EmptyStateSection diag={diag} meta={meta} entry={entry} />
    </div>
  );
}
