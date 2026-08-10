// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import './OverviewTabRouter.css';
import React from 'react';
import type { DebateSession, ArgumentNetworkNode, ArgumentNetworkEdge, CommitmentStore } from '../../../types/debate';
import type { TopicScope, TopicScopeRiskLevel } from '@lib/debate/types';
import type { WeightHistoryEntry } from '../../../types/taxonomy';
import { useTaxonomyStore } from '../../../hooks/useTaxonomyStore';
import { triggerManualDump } from '../../../lib/flightRecorderInit';
import { speakerLabel, Highlight } from './helpers';
import type { OverviewTab, UtilitySnapshot } from './types';
import { UTILITY_WEIGHTS } from './types';

import { ArgumentNetworkTab } from './overview-tabs';
import { AdaptiveStagingTab } from './overview-tabs';
import { ReflectionsTab } from './overview-tabs';
import { UtilityTab } from './overview-tabs';
import { EmotionalRegisterTab } from './overview-tabs';

import { ExtractionTimelinePanel } from '../../analysis/ExtractionTimelinePanel';
import { ConvergenceSignalsPanel } from '../../analysis/ConvergenceSignalsPanel';
import { TaxonomyGapPanel } from '../../analysis/TaxonomyGapPanel';
import { GroundingPanel } from '../../analysis/GroundingPanel';
import { PovProgressionView } from '../../PovProgression/PovProgressionView';
import { PromptDiffContent } from '../../chat/PromptDiffWindow';
import { CommitmentsPanel } from './shared';
import { BookmarkLink } from '../../shared/BookmarkLink';

declare const __COMPONENT_VERSIONS__: Record<string, string>;

type TranscriptEntry = DebateSession['transcript'][number];

type ModeratorTrace = {
  selected?: string; focus_point?: string; selection_reason?: string;
  convergence_score?: number | null; convergence_triggered?: boolean;
  intervention_recommended?: boolean; intervention_move?: string | null;
  intervention_validated?: boolean; health_score?: number;
};

const TOPIC_SCOPE_RISK_COLORS: Record<TopicScopeRiskLevel, string> = {
  low: 'var(--success)', medium: 'var(--warning)', high: 'var(--danger)', catastrophic: 'var(--danger)', unspecified: 'var(--text-muted)',
};

// ---------------------------------------------------------------------------
// Topic Scope (10.2)
// ---------------------------------------------------------------------------

function TopicScopeBadges({ scope }: { scope: TopicScope }) {
  return (
    <div className="ovr-badge-row">
      {scope.domain && <span className="ovr-chip">{scope.domain}</span>}
      {scope.product_type && <span className="ovr-chip">{scope.product_type}</span>}
      {scope.time_horizon && <span className="ovr-chip">{scope.time_horizon}</span>}
      <span
        className="ovr-chip-bold"
        // eslint-disable-next-line local/no-inline-style -- risk-level-driven background/color
        style={{ background: `color-mix(in srgb, ${TOPIC_SCOPE_RISK_COLORS[scope.risk_level]} 20%, transparent)`, color: TOPIC_SCOPE_RISK_COLORS[scope.risk_level] }}
      >
        risk: {scope.risk_level}
      </span>
      <span
        className="ovr-chip-base"
        // eslint-disable-next-line local/no-inline-style -- constraint-confidence-driven background/color
        style={{ background: scope.constraint_confidence === 'explicit' ? 'color-mix(in srgb, var(--success) 15%, transparent)' : 'color-mix(in srgb, var(--warning) 15%, transparent)', color: scope.constraint_confidence === 'explicit' ? 'var(--success)' : 'var(--warning)' }}
      >
        {scope.constraint_confidence}
      </span>
    </div>
  );
}

function TopicScopeSection({ debate, effectiveOverviewTab }: { debate: DebateSession; effectiveOverviewTab: OverviewTab }) {
  if (effectiveOverviewTab !== 'topic-scope' || !debate.topic?.scope) return null;
  const scope = debate.topic.scope as TopicScope;
  return (
    <div className="ovr-topic-scope">
      <h4 className="ovr-h4">Topic Scope <BookmarkLink docPath="docs/topic-scope.md" label="About Topic Scope" size="xs" /></h4>
      <div className="ovr-mb-8">
        <span className="ovr-scope-prop">{scope.core_proposition}</span>
      </div>
      <TopicScopeBadges scope={scope} />

      {scope.relevant_disciplines.length > 0 && (
        <div className="ovr-mb-10">
          <div className="ovr-label">Relevant Disciplines</div>
          <div className="ovr-tag-row">
            {scope.relevant_disciplines.map(d => (
              <span key={d} className="ovr-tag-warning">{d}</span>
            ))}
          </div>
        </div>
      )}

      {scope.key_tensions.length > 0 && (
        <div className="ovr-mb-10">
          <div className="ovr-label">Key Tensions</div>
          <ol className="ovr-ol">
            {scope.key_tensions.map((t, i) => <li key={i} className="ovr-mb-2">{t}</li>)}
          </ol>
        </div>
      )}

      {scope.off_scope_topics.length > 0 && (
        <div className="ovr-mb-10">
          <div className="ovr-label-danger">Off-Scope Topics</div>
          <div className="ovr-tag-row">
            {scope.off_scope_topics.map(t => (
              <span key={t} className="ovr-tag-danger">{t}</span>
            ))}
          </div>
        </div>
      )}

      {scope.drift_signatures.length > 0 && (
        <div className="ovr-mb-10">
          <div className="ovr-label-warning">Drift Signatures</div>
          <ul className="ovr-ul">
            {scope.drift_signatures.map((d, i) => <li key={i} className="ovr-li-warning">{d}</li>)}
          </ul>
        </div>
      )}

      {scope.example_ceiling && (
        <div className="ovr-mb-10">
          <div className="ovr-label-tight">Example Ceiling</div>
          <div className="ovr-example-ceiling">{scope.example_ceiling}</div>
        </div>
      )}

      {scope.explicit_qualifiers.length > 0 && (
        <div className="ovr-mb-10">
          <div className="ovr-label">Qualifiers</div>
          <div className="ovr-tag-row">
            {scope.explicit_qualifiers.map(q => (
              <span key={q} className="ovr-tag-neutral">{q}</span>
            ))}
          </div>
        </div>
      )}

      {scope.excluded_scenarios.length > 0 && (
        <div className="ovr-mb-10">
          <div className="ovr-label">Excluded Scenarios</div>
          <ul className="ovr-ul">
            {scope.excluded_scenarios.map((s, i) => <li key={i} className="ovr-mb-2">{s}</li>)}
          </ul>
        </div>
      )}

      {scope.on_scope_evidence.length > 0 && (
        <div className="ovr-mb-10">
          <div className="ovr-label">On-Scope Evidence</div>
          <ul className="ovr-ul">
            {scope.on_scope_evidence.map((e, i) => <li key={i} className="ovr-mb-2">{e}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Lineage Frame
// ---------------------------------------------------------------------------

function computeLineageBoostStats(transcript: DebateSession['transcript']) {
  // Check if any transcript entry had lineage boost data
  const boostActive = transcript.some(e => {
    const manifest = (e.metadata as Record<string, unknown>)?.injection_manifest as { lineage_boost?: unknown } | undefined;
    return !!manifest?.lineage_boost;
  });
  // Aggregate per-turn boost stats from injection manifests
  let totalBoosted = 0;
  let totalPromoted = 0;
  let turnsWithBoost = 0;
  for (const e of transcript) {
    const manifest = (e.metadata as Record<string, unknown>)?.injection_manifest as {
      lineage_boost?: { boosted?: number; promoted?: number };
    } | undefined;
    if (manifest?.lineage_boost) {
      turnsWithBoost++;
      totalBoosted += manifest.lineage_boost.boosted ?? 0;
      totalPromoted += manifest.lineage_boost.promoted ?? 0;
    }
  }
  return { boostActive, totalBoosted, totalPromoted, turnsWithBoost };
}

function aggregateLineageNodes(transcript: DebateSession['transcript']) {
  const allPromoted = new Set<string>();
  const allInjected = new Set<string>();
  const allReferenced = new Set<string>();
  for (const e of transcript) {
    if (e.type !== 'opening' && e.type !== 'statement') continue;
    const manifest = (e.metadata as Record<string, unknown>)?.injection_manifest as {
      lineage_boost?: { boostedNodeIds?: string[]; promotedNodeIds?: string[] };
      povNodeIds?: string[];
    } | undefined;
    if (!manifest) continue;
    for (const id of (e.taxonomy_refs ?? []).map((r: { node_id: string }) => r.node_id)) allReferenced.add(id);
    for (const id of manifest.povNodeIds ?? []) allInjected.add(id);
    const lb = manifest.lineage_boost;
    if (lb) {
      for (const id of lb.promotedNodeIds ?? []) allPromoted.add(id);
    }
  }
  return { allPromoted, allInjected, allReferenced };
}

function lineageVerdict(promotedRate: number) {
  const verdict = promotedRate > 0.15 ? 'high_impact' : promotedRate > 0.05 ? 'moderate_impact' : 'low_impact';
  const verdictLabel = verdict === 'high_impact' ? 'High impact' : verdict === 'moderate_impact' ? 'Moderate impact' : 'Low impact';
  const verdictColor = verdict === 'high_impact' ? 'var(--success)' : verdict === 'moderate_impact' ? 'var(--warning)' : 'var(--danger)';
  return { verdictLabel, verdictColor };
}

// Lineage Effectiveness — promoted vs. cited
function LineageEffectivenessSection({ debate, boostActive }: { debate: DebateSession; boostActive: boolean }) {
  if (!boostActive) return null;
  const { allPromoted, allInjected, allReferenced } = aggregateLineageNodes(debate.transcript);
  if (allPromoted.size === 0) return null;
  const promotedCitedIds = [...allPromoted].filter(id => allReferenced.has(id));
  const promotedCited = promotedCitedIds.length;
  const promotedRate = promotedCited / allPromoted.size;
  const baselineRate = allInjected.size > 0 ? allReferenced.size / allInjected.size : 0;
  const ratio = baselineRate > 0 ? promotedRate / baselineRate : 0;
  const { verdictLabel, verdictColor } = lineageVerdict(promotedRate);
  const promotedCitedSet = new Set(promotedCitedIds);
  return (
    <div className="ovr-effectiveness">
      <div className="ovr-effectiveness-title">Lineage Effectiveness</div>
      <div>
        Lineage boost promoted <strong>{allPromoted.size}</strong> node{allPromoted.size !== 1 ? 's' : ''};{' '}
        <strong className="ovr-success-text">{promotedCited}</strong> cited ({(promotedRate * 100).toFixed(0)}%)
        {' vs. '}<strong>{(baselineRate * 100).toFixed(0)}%</strong> baseline
      </div>
      <div className="ovr-muted-mt-2">
        {promotedRate > baselineRate
          ? `Promoted nodes cited ${ratio.toFixed(1)}× more than baseline — boost is helping`
          : promotedRate === baselineRate
            ? 'Promoted node citation rate matches baseline'
            : 'Promoted nodes cited less than baseline — boost had limited effect'}
      </div>
      <div
        className="ovr-verdict"
        // eslint-disable-next-line local/no-inline-style -- verdict-driven color
        style={{ color: verdictColor }}
      >
        Lineage boost: {verdictLabel}
      </div>
      {allPromoted.size <= 30 && (
        <div className="ovr-promoted-list">
          {[...allPromoted].map(id => (
            <span
              key={id}
              className="ovr-promoted-chip"
              // eslint-disable-next-line local/no-inline-style -- citation-state-driven background/color/border
              style={{
                background: promotedCitedSet.has(id) ? 'color-mix(in srgb, var(--success) 15%, transparent)' : 'color-mix(in srgb, var(--text-muted) 15%, transparent)',
                color: promotedCitedSet.has(id) ? 'var(--success)' : 'var(--text-muted)',
                border: `1px solid ${promotedCitedSet.has(id) ? 'color-mix(in srgb, var(--success) 30%, transparent)' : 'color-mix(in srgb, var(--text-muted) 20%, transparent)'}`,
              }}
              title={promotedCitedSet.has(id) ? 'Cited by debaters' : 'Not cited'}
            >
              {id}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// Vocabulary Disambiguation Aggregate (t/212)
function computeVocabularyData(transcript: DebateSession['transcript']) {
  const allResolved: { colloquial: string; canonical: string; confidence: string; speaker: string }[] = [];
  const allAmbiguous: { colloquial: string; speaker: string }[] = [];
  for (const e of transcript) {
    if (e.speaker === 'system' || e.speaker === 'moderator' || e.speaker === 'user') continue;
    const meta = e.metadata as Record<string, unknown> | undefined;
    const res = meta?.vocabulary_resolutions as { colloquial: string; canonical: string; confidence: string }[] | undefined;
    const amb = meta?.vocabulary_ambiguities as { colloquial: string }[] | undefined;
    if (res) for (const r of res) allResolved.push({ ...r, speaker: speakerLabel(e.speaker) });
    if (amb) for (const a of amb) allAmbiguous.push({ colloquial: a.colloquial, speaker: speakerLabel(e.speaker) });
  }
  // Group by colloquial term -> canonical form(s) with speakers
  const grouped = new Map<string, { canonical: string; confidence: string; speakers: Set<string>; count: number }>();
  for (const r of allResolved) {
    const key = `${r.colloquial}→${r.canonical}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.speakers.add(r.speaker);
      existing.count++;
    } else {
      grouped.set(key, { canonical: r.canonical, confidence: r.confidence, speakers: new Set([r.speaker]), count: 1 });
    }
  }
  return { allResolved, allAmbiguous, grouped };
}

function VocabularyDisambiguationSection({ debate }: { debate: DebateSession }) {
  const { allResolved, allAmbiguous, grouped } = computeVocabularyData(debate.transcript);
  if (allResolved.length === 0 && allAmbiguous.length === 0) return null;
  return (
    <div className="ovr-mt-20">
      <h4 className="ovr-h4">Vocabulary Disambiguation</h4>
      <p className="ovr-intro-8">
        Colloquial terms resolved to canonical forms based on speaker POV.
        {allResolved.length > 0 && <> <strong>{allResolved.length}</strong> resolved across {grouped.size} unique mappings.</>}
        {allAmbiguous.length > 0 && <> <span className="ovr-warning-text"><strong>{allAmbiguous.length}</strong> ambiguous.</span></>}
      </p>
      {grouped.size > 0 && (
        <table className="ovr-vocab-table">
          <thead>
            <tr className="ovr-vocab-head-row">
              <th className="ovr-th-left">Colloquial</th>
              <th className="ovr-th-left">Canonical Form</th>
              <th className="ovr-th-center">Conf.</th>
              <th className="ovr-th-left">Speakers</th>
              <th className="ovr-th-center">Hits</th>
            </tr>
          </thead>
          <tbody>
            {[...grouped.entries()].sort((a, b) => b[1].count - a[1].count).map(([key, v]) => {
              const colloquial = key.split('→')[0];
              return (
                <tr key={key} className="ovr-vocab-row">
                  <td className="ovr-td">
                    <span className="vocab-term ovr-vocab-term">{colloquial}</span>
                  </td>
                  <td className="ovr-td-secondary">{v.canonical}</td>
                  <td
                    className="ovr-td-conf"
                    // eslint-disable-next-line local/no-inline-style -- confidence-driven color
                    style={{ color: v.confidence === 'high' ? 'var(--success)' : v.confidence === 'low' ? 'var(--danger)' : 'var(--warning)' }}
                  >{v.confidence}</td>
                  <td className="ovr-td-muted">{[...v.speakers].join(', ')}</td>
                  <td className="ovr-td-center">{v.count}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {allAmbiguous.length > 0 && (
        <div className="ovr-ambiguous">
          <div className="ovr-ambiguous-title">Ambiguous terms (needs review):</div>
          {[...new Set(allAmbiguous.map(a => a.colloquial))].map((term, i) => {
            const speakers = [...new Set(allAmbiguous.filter(a => a.colloquial === term).map(a => a.speaker))];
            return (
              <div key={i} className="ovr-ambiguous-item">
                &ldquo;{term}&rdquo; <span className="ovr-muted">&mdash; {speakers.join(', ')}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function LineageSection({ debate, effectiveOverviewTab }: { debate: DebateSession; effectiveOverviewTab: OverviewTab }) {
  if (effectiveOverviewTab !== 'lineage') return null;
  const frame = debate.topic.critique?.lineage_frame;
  if (!frame || frame.length === 0) return <div className="ovr-empty">No lineage data for this debate.</div>;
  const maxPct = Math.max(...frame.map(f => f.percentage));
  const { boostActive, totalBoosted, totalPromoted, turnsWithBoost } = computeLineageBoostStats(debate.transcript);
  return (
    <div className="ovr-panel">
      <h4 className="ovr-h4">Intellectual Lineage Frame</h4>
      <p className="ovr-intro">
        Dominant intellectual traditions detected from activated taxonomy nodes. These traditions shape which nodes receive relevance boosts during context injection.
      </p>
      <div className="ovr-lineage-list">
        {frame.map(f => (
          <div key={f.cluster_id}>
            <div className="ovr-lineage-row">
              <span className="ovr-lineage-label">{f.label}</span>
              <div className="ovr-lineage-track">
                <div
                  className="ovr-lineage-bar"
                  // eslint-disable-next-line local/no-inline-style -- data-driven bar width
                  style={{ width: `${maxPct > 0 ? (f.percentage / maxPct) * 100 : 0}%` }}
                />
              </div>
              <span className="ovr-lineage-pct">
                {(f.percentage * 100).toFixed(0)}%
              </span>
            </div>
            {f.traditions && f.traditions.length > 0 && (
              <div className="ovr-lineage-traditions">
                {f.traditions.join(', ')}
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="ovr-boost-row">
        <div
          className="ovr-boost-stat-base"
          // eslint-disable-next-line local/no-inline-style -- boostActive-driven background/color
          style={{
            background: boostActive ? 'color-mix(in srgb, var(--success) 12%, transparent)' : 'color-mix(in srgb, var(--danger) 8%, transparent)',
            color: boostActive ? 'var(--success)' : 'var(--text-muted)',
          }}
        >
          Lineage Boost: {boostActive ? 'Active' : 'Inactive'}
        </div>
        {boostActive && turnsWithBoost > 0 && (
          <>
            <div className="ovr-boost-stat">
              Turns with boost: {turnsWithBoost}
            </div>
            <div className="ovr-boost-stat">
              Nodes boosted: {totalBoosted} · Promoted: {totalPromoted}
            </div>
          </>
        )}
      </div>
      <LineageEffectivenessSection debate={debate} boostActive={boostActive} />
      <VocabularyDisambiguationSection debate={debate} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Argument Network / Commitments / POV Progression / Prompt Diff wrappers
// ---------------------------------------------------------------------------

interface ArgumentNetworkSectionProps {
  debate: DebateSession;
  an: { nodes: ArgumentNetworkNode[]; edges: ArgumentNetworkEdge[] } | undefined;
  effectiveOverviewTab: OverviewTab;
  anFilterMode: 'all' | 'unattributed' | 'novel' | 'anchored';
  anFilterNodeId: string;
  setAnFilterMode: (mode: 'all' | 'unattributed' | 'novel' | 'anchored') => void;
  setAnFilterNodeId: (id: string) => void;
  focusedNodeId: string | null;
  handleUpdateSubScore: (nodeId: string, key: string, value: number) => void;
  setOverviewTab: (tab: OverviewTab) => void;
  setSelectedEntry: (id: string | null) => void;
  setLocalOverride: (v: boolean) => void;
  nodeLabels: Map<string, string>;
}

function ArgumentNetworkSection({
  debate, an, effectiveOverviewTab, anFilterMode, anFilterNodeId, setAnFilterMode,
  setAnFilterNodeId, focusedNodeId, handleUpdateSubScore, setOverviewTab, setSelectedEntry,
  setLocalOverride, nodeLabels,
}: ArgumentNetworkSectionProps) {
  if (effectiveOverviewTab !== 'argument-network' || !an || an.nodes.length === 0) return null;
  return (
    <ArgumentNetworkTab
      debate={debate}
      an={an}
      anFilterMode={anFilterMode}
      anFilterNodeId={anFilterNodeId}
      setAnFilterMode={setAnFilterMode}
      setAnFilterNodeId={setAnFilterNodeId}
      focusedNodeId={focusedNodeId}
      handleUpdateSubScore={handleUpdateSubScore}
      setOverviewTab={setOverviewTab}
      setSelectedEntry={setSelectedEntry}
      setLocalOverride={setLocalOverride}
      nodeLabels={nodeLabels}
    />
  );
}

interface CommitmentsSectionProps {
  effectiveOverviewTab: OverviewTab;
  commitments: Record<string, CommitmentStore> | undefined;
  an: { nodes: ArgumentNetworkNode[]; edges: ArgumentNetworkEdge[] } | undefined;
  setOverviewTab: (tab: OverviewTab) => void;
  setFocusedNodeId: (id: string | null) => void;
}

function CommitmentsSection({ effectiveOverviewTab, commitments, an, setOverviewTab, setFocusedNodeId }: CommitmentsSectionProps) {
  if (effectiveOverviewTab !== 'commitments' || !commitments || Object.keys(commitments).length === 0) return null;
  return (
    <CommitmentsPanel
      commitments={commitments}
      nodes={an?.nodes ?? []}
      edges={an?.edges ?? []}
      onGoToNode={(nodeId) => { setOverviewTab('argument-network'); setFocusedNodeId(nodeId); }}
    />
  );
}

function PromptDiffSection({ debate, effectiveOverviewTab, selectedEntry }: { debate: DebateSession; effectiveOverviewTab: OverviewTab; selectedEntry: string | null }) {
  if (effectiveOverviewTab !== 'prompt-diff') return null;
  return (
    <div className="ovr-prompt-diff">
      <PromptDiffContent
        debate={debate}
        focusedEntryId={selectedEntry ?? debate.transcript[0]?.id ?? ''}
        embedded
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Flight Recorder Context — live snapshot of app state
// ---------------------------------------------------------------------------

type FrRow = [string, string | number | null | undefined];
type FrSection = { title: string; rows: FrRow[] };
type FrEApi = { processVersions?: Record<string, string | undefined>; osRelease?: string; osPlatform?: string; osArch?: string } | undefined;
type FrMem = { usedJSHeapSize: number; totalJSHeapSize: number } | undefined;
type FrTaxState = ReturnType<typeof useTaxonomyStore.getState>;

function frNodeCount(file: { nodes?: readonly unknown[] } | null | undefined): number {
  return file?.nodes?.length ?? 0;
}

function buildAppSection(eApi: FrEApi): FrSection {
  return {
    title: 'App',
    rows: [
      ['Platform', eApi?.osPlatform ?? navigator.platform],
      ['Arch', eApi?.osArch ?? 'unknown'],
      ['OS Version', eApi?.osRelease ?? 'N/A'],
      ['VITE_TARGET', import.meta.env.VITE_TARGET ?? 'electron'],
      ['Mode', import.meta.env.DEV ? 'dev' : 'prod'],
    ],
  };
}

function buildSbomSection(pv: Record<string, string | undefined> | undefined): FrSection {
  return {
    title: 'SBOM',
    rows: [
      ['Node', pv?.node ?? 'N/A'],
      ['Electron', pv?.electron ?? 'N/A'],
      ['Chrome', pv?.chrome ?? 'N/A'],
      ['V8', pv?.v8 ?? 'N/A'],
      ['React', typeof __COMPONENT_VERSIONS__ !== 'undefined' ? __COMPONENT_VERSIONS__.react : 'N/A'],
      ['Zustand', typeof __COMPONENT_VERSIONS__ !== 'undefined' ? __COMPONENT_VERSIONS__.zustand : 'N/A'],
    ],
  };
}

function buildWindowsSection(taxState: FrTaxState): FrSection {
  return {
    title: 'Windows',
    rows: [
      ['Active Tab', taxState.activeTab],
      ['Toolbar Panel', taxState.toolbarPanel ?? '(none)'],
      ['Selected Node', taxState.selectedNodeId ?? '(none)'],
    ],
  };
}

function buildDebateSection(debate: DebateSession): FrSection {
  return {
    title: 'Debate',
    rows: [
      ['ID', debate.id.slice(0, 8) + '...'],
      ['Phase', debate.phase],
      ['Adaptive Phase', debate.adaptive_staging?.phase_state?.current_phase ?? '(none)'],
      ['Transcript', debate.transcript?.length ?? 0],
      ['AN Nodes', debate.argument_network?.nodes?.length ?? 0],
      ['Convergence Signals', debate.convergence_signals?.length ?? 0],
      ['Protocol', debate.protocol_id ?? '(default)'],
    ],
  };
}

function buildTaxonomySection(taxState: FrTaxState): FrSection {
  return {
    title: 'Taxonomy',
    rows: [
      ['Accelerationist nodes', frNodeCount(taxState.accelerationist)],
      ['Safetyist nodes', frNodeCount(taxState.safetyist)],
      ['Skeptic nodes', frNodeCount(taxState.skeptic)],
      ['Situations nodes', frNodeCount(taxState.situations)],
      ['Edges', taxState.edgesFile?.edges?.length ?? 0],
      ['Dirty files', taxState.dirty?.size ?? 0],
      ['Save error', taxState.saveError ?? '(none)'],
    ],
  };
}

function buildAiSection(taxState: FrTaxState): FrSection {
  return {
    title: 'AI',
    rows: [
      ['Backend', taxState.aiBackend],
      ['Model', taxState.geminiModel],
    ],
  };
}

function buildPerformanceSection(mem: FrMem): FrSection {
  return {
    title: 'Performance',
    rows: [
      ['Uptime', `${Math.round(performance.now() / 1000)}s`],
      ['Heap used', mem ? `${Math.round(mem.usedJSHeapSize / 1048576)} MB` : 'N/A'],
      ['Heap total', mem ? `${Math.round(mem.totalJSHeapSize / 1048576)} MB` : 'N/A'],
    ],
  };
}

function isFrValueEmpty(v: string | number | null | undefined): boolean {
  if (v === null || v === undefined) return true;
  const s = String(v);
  return s === '' || s === '0' || s === '(none)' || s === 'N/A';
}

function FrContextSection({ debate, effectiveOverviewTab }: { debate: DebateSession; effectiveOverviewTab: OverviewTab }) {
  if (effectiveOverviewTab !== 'fr-context') return null;
  const taxState = useTaxonomyStore.getState();
  const mem = (performance as unknown as { memory?: { usedJSHeapSize: number; totalJSHeapSize: number } }).memory;
  const eApi = (window as unknown as { electronAPI?: { processVersions?: Record<string, string | undefined>; osRelease?: string; osPlatform?: string; osArch?: string } }).electronAPI;
  const pv = eApi?.processVersions;
  const sections: FrSection[] = [
    buildAppSection(eApi),
    buildSbomSection(pv),
    buildWindowsSection(taxState),
    buildDebateSection(debate),
    buildTaxonomySection(taxState),
    buildAiSection(taxState),
    buildPerformanceSection(mem),
  ];
  return (
    <div className="ovr-fr-context">
      <div className="ovr-fr-header">
        <span className="ovr-fr-title">Flight Recorder Context Snapshot</span>
        <button
          onClick={() => { void triggerManualDump(); }}
          className="ovr-dump-btn"
        >Dump Now</button>
      </div>
      <div className="ovr-fr-grid">
        {sections.map(s => (
          <div key={s.title} className="ovr-fr-card">
            <div className="ovr-fr-card-title">{s.title}</div>
            {s.rows.map(([label, value]) => {
              const empty = isFrValueEmpty(value);
              return (
                <div key={label} className="ovr-fr-row">
                  <span className="ovr-fr-label">{label}</span>
                  <span
                    className="ovr-fr-value"
                    // eslint-disable-next-line local/no-inline-style -- empty-state-driven color
                    style={{ color: empty ? 'var(--text-muted)' : 'var(--text-primary)' }}
                  >{String(value ?? '')}</span>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Transcript list for selection
// ---------------------------------------------------------------------------

function deriveTranscriptRowMeta(e: TranscriptEntry, debate: DebateSession) {
  const eMeta = e.metadata as Record<string, unknown> | undefined;
  const modT = eMeta?.moderator_trace as ModeratorTrace | undefined;
  const eDiag = debate.diagnostics?.entries[e.id];
  const hasStages = eDiag?.stage_diagnostics && eDiag.stage_diagnostics.length > 0;
  const pipelineError = e.type === 'statement' && hasStages && !eDiag?.extracted_claims && !(eDiag as Record<string, unknown>)?.extraction_trace;
  return { modT, hasStages, pipelineError };
}

function ModeratorTraceRow({ modT }: { modT: ModeratorTrace }) {
  return (
    <div className="ovr-mod-row">
      <span className="ovr-mod-tag">MOD</span>
      {modT.focus_point && <span className="ovr-mod-focus" title={modT.focus_point}>{modT.focus_point}</span>}
      {modT.selection_reason && modT.selection_reason !== 'moderator_ai_selection' && (
        <span className="ovr-mod-reason">{modT.selection_reason === 'turn_alternation_override' ? 'override' : modT.selection_reason}</span>
      )}
      {modT.intervention_move && (
        <span
          className="ovr-mod-tag-base"
          // eslint-disable-next-line local/no-inline-style -- validation-driven background/color
          style={{ background: modT.intervention_validated ? 'var(--bg-hover)' : 'color-mix(in srgb, var(--danger) 15%, transparent)', color: modT.intervention_validated ? 'var(--text-secondary)' : 'var(--danger)' }}
        >{modT.intervention_move}{modT.intervention_validated ? '' : ' (suppressed)'}</span>
      )}
      {modT.convergence_score != null && <span className="ovr-mod-metric">conv:{(modT.convergence_score * 100).toFixed(0)}%</span>}
      {modT.health_score != null && <span className="ovr-mod-metric">H:{modT.health_score.toFixed(2)}</span>}
    </div>
  );
}

interface TranscriptRowProps {
  e: TranscriptEntry;
  i: number;
  debate: DebateSession;
  selectedEntry: string | null;
  setSelectedEntry: (id: string | null) => void;
  setLocalOverride: (v: boolean) => void;
}

function TranscriptRow({ e, i, debate, selectedEntry, setSelectedEntry, setLocalOverride }: TranscriptRowProps) {
  const stmtId = `S${i + 1}`;
  const { modT, hasStages, pipelineError } = deriveTranscriptRowMeta(e, debate);
  return (
    <div
      onClick={() => { setSelectedEntry(e.id); setLocalOverride(true); }}
      className="ovr-transcript-entry"
      // eslint-disable-next-line local/no-inline-style -- selection-driven background/border
      style={{ background: selectedEntry === e.id ? 'color-mix(in srgb, var(--color-acc) 8%, transparent)' : 'var(--bg-primary)', borderLeft: selectedEntry === e.id ? '3px solid var(--color-acc)' : '3px solid transparent' }}
    >
      <div className="ovr-stmt-head">
        <span
          title={pipelineError ? `Statement ${stmtId} — pipeline error` : `Statement ${stmtId}`}
          className="ovr-stmt-badge"
          // eslint-disable-next-line local/no-inline-style -- pipeline-error-driven background/color
          style={{
            background: pipelineError ? 'color-mix(in srgb, var(--danger) 15%, transparent)' : 'color-mix(in srgb, var(--color-acc) 12%, transparent)',
            color: pipelineError ? 'var(--danger)' : 'var(--color-acc)',
          }}
        >{pipelineError && <span className="ovr-mr-3">●</span>}{stmtId}</span>
        <span className="ovr-stmt-content">
          <strong>{speakerLabel(e.speaker)}</strong> [{e.type}] <Highlight text={e.content.slice(0, 80)} />...
        </span>
        {hasStages && <span title="4-stage pipeline" className="ovr-pipeline-badge">B/P/D/C</span>}
      </div>
      {modT && <ModeratorTraceRow modT={modT} />}
    </div>
  );
}

interface TranscriptSectionProps {
  debate: DebateSession;
  effectiveOverviewTab: OverviewTab;
  transcriptSpeakerFilter: string | null;
  setTranscriptSpeakerFilter: (filter: string | null) => void;
  selectedEntry: string | null;
  setSelectedEntry: (id: string | null) => void;
  setLocalOverride: (v: boolean) => void;
}

function TranscriptSection({
  debate, effectiveOverviewTab, transcriptSpeakerFilter, setTranscriptSpeakerFilter,
  selectedEntry, setSelectedEntry, setLocalOverride,
}: TranscriptSectionProps) {
  if (effectiveOverviewTab !== 'transcript') return null;
  const speakers = Array.from(new Set(debate.transcript.map(e => e.speaker)));
  const filteredTranscript = transcriptSpeakerFilter
    ? debate.transcript.map((e, i) => ({ e, i })).filter(({ e }) => e.speaker === transcriptSpeakerFilter)
    : debate.transcript.map((e, i) => ({ e, i }));
  return (
    <div className="ovr-transcript">
      <div className="ovr-transcript-filters">
        <button
          onClick={() => setTranscriptSpeakerFilter(null)}
          className="ovr-filter-btn"
          // eslint-disable-next-line local/no-inline-style -- active-filter-driven background/color
          style={{
            background: !transcriptSpeakerFilter ? 'var(--warning)' : 'transparent',
            color: !transcriptSpeakerFilter ? 'var(--text-primary)' : 'var(--text-secondary)',
          }}
        >All ({debate.transcript.filter(e => e.type === 'statement' || e.type === 'opening').length} stmts / {debate.transcript.length})</button>
        {speakers.map(s => {
          const count = debate.transcript.filter(e => e.speaker === s).length;
          const active = transcriptSpeakerFilter === s;
          return (
            <button
              key={s}
              onClick={() => setTranscriptSpeakerFilter(active ? null : s)}
              className="ovr-filter-btn"
              // eslint-disable-next-line local/no-inline-style -- active-filter-driven background/color
              style={{
                background: active ? 'var(--warning)' : 'transparent',
                color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
              }}
            >{speakerLabel(s)} ({count})</button>
          );
        })}
      </div>
      <div className="ovr-transcript-list">
      {filteredTranscript.map(({ e, i }) => (
        <TranscriptRow
          key={e.id}
          e={e}
          i={i}
          debate={debate}
          selectedEntry={selectedEntry}
          setSelectedEntry={setSelectedEntry}
          setLocalOverride={setLocalOverride}
        />
      ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Exclusion Guard Overview — aggregate across all entries
// ---------------------------------------------------------------------------

type ExclusionEntries = NonNullable<DebateSession['diagnostics']>['entries'];

function computeExclusionAggregate(entries: ExclusionEntries) {
  let claimsChecked = 0;
  let claimViolations: { claim_id: string; claim_text: string; node_id: string; similarity_main: number; similarity_exclusion: number }[] = [];
  let draftsChecked = 0;
  let driftWarnings: { debater: string; node_id: string; similarity: number; draft_excerpt: string }[] = [];
  let hasAnyData = false;

  for (const entry of Object.values(entries)) {
    const extTrace = entry.extraction_trace;
    if (extTrace) {
      hasAnyData = true;
      if (extTrace.exclusion_guard) {
        claimsChecked += extTrace.exclusion_guard.checked;
        if (extTrace.exclusion_guard.violations?.length) claimViolations = claimViolations.concat(extTrace.exclusion_guard.violations);
      }
      if (extTrace.exclusion_violations?.length) {
        claimViolations = claimViolations.concat(extTrace.exclusion_violations);
      }
    }
    if (entry.scope_drift_check) {
      hasAnyData = true;
      draftsChecked += entry.scope_drift_check.refs_checked;
      if (entry.scope_drift_check.warnings?.length) driftWarnings = driftWarnings.concat(entry.scope_drift_check.warnings);
    }
    if (entry.scope_drift_warnings?.length) {
      hasAnyData = true;
      driftWarnings = driftWarnings.concat(entry.scope_drift_warnings);
    }
  }

  const allClear = claimViolations.length === 0 && driftWarnings.length === 0;
  return { claimsChecked, claimViolations, draftsChecked, driftWarnings, hasAnyData, allClear };
}

function ExclusionOverviewSection({ debate, effectiveOverviewTab }: { debate: DebateSession; effectiveOverviewTab: OverviewTab }) {
  if (effectiveOverviewTab !== 'exclusion-overview') return null;
  const entries = debate.diagnostics?.entries;
  if (!entries || Object.keys(entries).length === 0) {
    return (
      <div className="ovr-p-16">
        <h4 className="ovr-h4-8">Exclusion Guard</h4>
        <div className="ovr-italic-muted">
          No diagnostics data available for this debate.
        </div>
      </div>
    );
  }

  const { claimsChecked, claimViolations, draftsChecked, driftWarnings, hasAnyData, allClear } = computeExclusionAggregate(entries);

  return (
    <div className="ovr-panel">
      <h4 className="ovr-h4-10">Exclusion Guard Summary</h4>

      {!hasAnyData ? (
        <div className="ovr-italic-muted">
          Exclusion guard data not available — no extraction traces found in this debate.
        </div>
      ) : (
        <>
          {/* Aggregate badges */}
          <div className="ovr-badge-row">
            <span
              className="ovr-guard-badge"
              // eslint-disable-next-line local/no-inline-style -- violation-count-driven background/color
              style={{
                background: claimViolations.length > 0 ? 'color-mix(in srgb, var(--danger) 10%, transparent)' : 'color-mix(in srgb, var(--success) 8%, transparent)',
                color: claimViolations.length > 0 ? 'var(--danger)' : 'var(--success)',
              }}
            >
              {claimsChecked} claims checked — {claimViolations.length} violation{claimViolations.length !== 1 ? 's' : ''}
            </span>
            <span
              className="ovr-guard-badge"
              // eslint-disable-next-line local/no-inline-style -- warning-count-driven background/color
              style={{
                background: driftWarnings.length > 0 ? 'color-mix(in srgb, var(--warning) 10%, transparent)' : 'color-mix(in srgb, var(--success) 8%, transparent)',
                color: driftWarnings.length > 0 ? 'var(--warning)' : 'var(--success)',
              }}
            >
              {draftsChecked} refs checked — {driftWarnings.length} drift warning{driftWarnings.length !== 1 ? 's' : ''}
            </span>
          </div>

          {allClear ? (
            <div className="ovr-clear-banner">
              All statements within scope — no exclusion violations or drift warnings
            </div>
          ) : (
            <>
              {claimViolations.length > 0 && (
                <div className="ovr-mb-12">
                  <div className="ovr-section-title-danger">
                    Exclusion Violations ({claimViolations.length})
                  </div>
                  {claimViolations.map((v, i) => (
                    <div key={i} className="ovr-violation-card">
                      <div className="ovr-violation-head">
                        <span className="ovr-danger-bold">{v.claim_id}</span>
                        <span className="ovr-muted">→</span>
                        <span className="ovr-bold">{v.node_id}</span>
                      </div>
                      <div className="ovr-violation-claim">{v.claim_text}</div>
                      <div className="ovr-violation-sims">
                        <span>main: <strong>{v.similarity_main.toFixed(3)}</strong></span>
                        <span>exclusion: <strong>{v.similarity_exclusion.toFixed(3)}</strong></span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {driftWarnings.length > 0 && (
                <div>
                  <div className="ovr-section-title-warning">
                    Scope Drift Warnings ({driftWarnings.length})
                  </div>
                  {driftWarnings.map((w, i) => (
                    <div key={i} className="ovr-drift-card">
                      <div className="ovr-violation-head">
                        <span className="ovr-warning-bold">{w.debater}</span>
                        <span className="ovr-muted">→</span>
                        <span className="ovr-bold">{w.node_id}</span>
                        <span className="ovr-drift-sim">
                          {w.similarity.toFixed(3)}
                        </span>
                      </div>
                      <div className="ovr-drift-excerpt">
                        {w.draft_excerpt.length > 200 ? w.draft_excerpt.slice(0, 200) + '…' : w.draft_excerpt}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

interface OverviewTabRouterProps {
  debate: DebateSession;
  an: { nodes: ArgumentNetworkNode[]; edges: ArgumentNetworkEdge[] } | undefined;
  commitments: Record<string, CommitmentStore> | undefined;
  effectiveOverviewTab: OverviewTab;
  selectedEntry: string | null;
  setSelectedEntry: (id: string | null) => void;
  setOverviewTab: (tab: OverviewTab) => void;
  setLocalOverride: (v: boolean) => void;
  focusedNodeId: string | null;
  setFocusedNodeId: (id: string | null) => void;
  anFilterMode: 'all' | 'unattributed' | 'novel' | 'anchored';
  anFilterNodeId: string;
  setAnFilterMode: (mode: 'all' | 'unattributed' | 'novel' | 'anchored') => void;
  setAnFilterNodeId: (id: string) => void;
  handleUpdateSubScore: (nodeId: string, key: string, value: number) => void;
  transcriptSpeakerFilter: string | null;
  setTranscriptSpeakerFilter: (filter: string | null) => void;
  perTurnUtilities: UtilitySnapshot[];
  nodeLabels: Map<string, string>;
  searchQuery: string;
}

export function OverviewTabRouter({
  debate,
  an,
  commitments,
  effectiveOverviewTab,
  selectedEntry,
  setSelectedEntry,
  setOverviewTab,
  setLocalOverride,
  focusedNodeId,
  setFocusedNodeId,
  anFilterMode,
  anFilterNodeId,
  setAnFilterMode,
  setAnFilterNodeId,
  handleUpdateSubScore,
  transcriptSpeakerFilter,
  setTranscriptSpeakerFilter,
  perTurnUtilities,
  nodeLabels,
  searchQuery,
}: OverviewTabRouterProps) {
  return (
    <>
      {/* Overview content — always visible (master-detail layout on desktop) */}
      {<>

      {/* Topic Scope (10.2) */}
      <TopicScopeSection debate={debate} effectiveOverviewTab={effectiveOverviewTab} />

      {/* Extraction Timeline — diagnoses AN-plateau failures */}
      {effectiveOverviewTab === 'extraction' && (
        <ExtractionTimelinePanel debate={debate} />
      )}

      {/* Convergence Signals — per-turn diagnostic signals */}
      {effectiveOverviewTab === 'convergence' && (
        <ConvergenceSignalsPanel debate={debate} />
      )}

      {/* Taxonomy Gaps — post-debate coverage analysis */}
      {effectiveOverviewTab === 'gaps' && (
        <TaxonomyGapPanel debate={debate} />
      )}

      {/* Taxonomy Grounding — which POV nodes are referenced and why */}
      {effectiveOverviewTab === 'grounding' && (
        <GroundingPanel debate={debate} />
      )}

      {/* Lineage Frame — intellectual tradition distribution from topic critique */}
      <LineageSection debate={debate} effectiveOverviewTab={effectiveOverviewTab} />

      {/* Adaptive Staging — signal telemetry, phase transitions, GC events */}
      {effectiveOverviewTab === 'adaptive' && (
        <AdaptiveStagingTab debate={debate} />
      )}

      {/* Reflections — taxonomy edits proposed by debaters */}
      {effectiveOverviewTab === 'reflections' && (
        <ReflectionsTab debate={debate} />
      )}

      {/* Argument Network with inline Moderator Deliberations */}
      <ArgumentNetworkSection
        debate={debate}
        an={an}
        effectiveOverviewTab={effectiveOverviewTab}
        anFilterMode={anFilterMode}
        anFilterNodeId={anFilterNodeId}
        setAnFilterMode={setAnFilterMode}
        setAnFilterNodeId={setAnFilterNodeId}
        focusedNodeId={focusedNodeId}
        handleUpdateSubScore={handleUpdateSubScore}
        setOverviewTab={setOverviewTab}
        setSelectedEntry={setSelectedEntry}
        setLocalOverride={setLocalOverride}
        nodeLabels={nodeLabels}
      />

      {/* Commitments */}
      <CommitmentsSection
        effectiveOverviewTab={effectiveOverviewTab}
        commitments={commitments}
        an={an}
        setOverviewTab={setOverviewTab}
        setFocusedNodeId={setFocusedNodeId}
      />

      {/* POV Progression — inline view (replaces separate popout) */}
      {effectiveOverviewTab === 'pov-progression' && (
        <div className="ovr-pov-progression">
          <PovProgressionView session={debate} nodeLabels={nodeLabels} />
        </div>
      )}

      {/* Flight Recorder Context — live snapshot of app state */}
      <FrContextSection debate={debate} effectiveOverviewTab={effectiveOverviewTab} />

      {/* Transcript list for selection */}
      <TranscriptSection
        debate={debate}
        effectiveOverviewTab={effectiveOverviewTab}
        transcriptSpeakerFilter={transcriptSpeakerFilter}
        setTranscriptSpeakerFilter={setTranscriptSpeakerFilter}
        selectedEntry={selectedEntry}
        setSelectedEntry={setSelectedEntry}
        setLocalOverride={setLocalOverride}
      />
      </>}

      {/* Prompt Diff — rendered outside the selectedEntry guard so it works from transcript inline buttons too */}
      <PromptDiffSection debate={debate} effectiveOverviewTab={effectiveOverviewTab} selectedEntry={selectedEntry} />

      {/* Agent Utility — per-speaker composite with sparkline curves */}
      {effectiveOverviewTab === 'utility' && (
        <UtilityTab
          debate={debate}
          perTurnUtilities={perTurnUtilities}
          setSelectedEntry={setSelectedEntry}
          setLocalOverride={setLocalOverride}
        />
      )}

      {/* Emotional Register — per-speaker affect profiles, intensity trends, appropriateness */}
      {effectiveOverviewTab === 'emotional-register' && (
        <EmotionalRegisterTab
          debate={debate}
          setSelectedEntry={setSelectedEntry}
          setLocalOverride={setLocalOverride}
        />
      )}

      {/* Exclusion Guard Overview — aggregate across all entries */}
      <ExclusionOverviewSection debate={debate} effectiveOverviewTab={effectiveOverviewTab} />
    </>
  );
}
