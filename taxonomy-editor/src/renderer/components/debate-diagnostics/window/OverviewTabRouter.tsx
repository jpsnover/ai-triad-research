// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

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

import { ExtractionTimelinePanel } from '../../ExtractionTimelinePanel';
import { ConvergenceSignalsPanel } from '../../ConvergenceSignalsPanel';
import { TaxonomyGapPanel } from '../../TaxonomyGapPanel';
import { GroundingPanel } from '../../GroundingPanel';
import { PovProgressionView } from '../../PovProgression/PovProgressionView';
import { PromptDiffContent } from '../../PromptDiffWindow';
import { CommitmentsPanel } from './shared';

declare const __COMPONENT_VERSIONS__: Record<string, string>;

interface OverviewTabRouterProps {
  debate: DebateSession;
  an: { nodes: ArgumentNetworkNode[]; edges: ArgumentNetworkEdge[] } | undefined;
  commitments: CommitmentStore | undefined;
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
      {/* Overview content — shown when no entry is selected (or always for transcript tab) */}
      {(!selectedEntry || effectiveOverviewTab === 'transcript') && <>

      {/* Topic Scope (10.2) */}
      {effectiveOverviewTab === 'topic-scope' && debate.topic?.scope && (() => {
        const scope = debate.topic.scope as TopicScope;
        const RISK_COLORS: Record<TopicScopeRiskLevel, string> = {
          low: '#22c55e', medium: '#f59e0b', high: '#ef4444', catastrophic: '#dc2626', unspecified: '#6b7280',
        };
        return (
          <div style={{ padding: 16, overflowY: 'auto', flex: 1, fontSize: '0.75rem' }}>
            <h4 style={{ margin: '0 0 8px', fontSize: '0.85rem' }}>Topic Scope</h4>
            <div style={{ marginBottom: 8 }}>
              <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{scope.core_proposition}</span>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
              {scope.domain && <span style={{ padding: '2px 8px', borderRadius: 4, background: 'var(--bg-secondary)', fontSize: '0.7rem' }}>{scope.domain}</span>}
              {scope.product_type && <span style={{ padding: '2px 8px', borderRadius: 4, background: 'var(--bg-secondary)', fontSize: '0.7rem' }}>{scope.product_type}</span>}
              {scope.time_horizon && <span style={{ padding: '2px 8px', borderRadius: 4, background: 'var(--bg-secondary)', fontSize: '0.7rem' }}>{scope.time_horizon}</span>}
              <span style={{ padding: '2px 8px', borderRadius: 4, background: `${RISK_COLORS[scope.risk_level]}20`, color: RISK_COLORS[scope.risk_level], fontWeight: 600, fontSize: '0.7rem' }}>
                risk: {scope.risk_level}
              </span>
              <span style={{ padding: '2px 8px', borderRadius: 4, background: scope.constraint_confidence === 'explicit' ? 'rgba(34,197,94,0.15)' : 'rgba(245,158,11,0.15)', color: scope.constraint_confidence === 'explicit' ? '#22c55e' : '#f59e0b', fontSize: '0.7rem' }}>
                {scope.constraint_confidence}
              </span>
            </div>

            {scope.relevant_disciplines.length > 0 && (
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontWeight: 600, fontSize: '0.7rem', marginBottom: 4 }}>Relevant Disciplines</div>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {scope.relevant_disciplines.map(d => (
                    <span key={d} style={{ padding: '2px 6px', borderRadius: 3, background: 'rgba(245,158,11,0.15)', color: '#f59e0b', fontSize: '0.65rem' }}>{d}</span>
                  ))}
                </div>
              </div>
            )}

            {scope.key_tensions.length > 0 && (
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontWeight: 600, fontSize: '0.7rem', marginBottom: 4 }}>Key Tensions</div>
                <ol style={{ margin: 0, paddingLeft: 20, fontSize: '0.7rem' }}>
                  {scope.key_tensions.map((t, i) => <li key={i} style={{ marginBottom: 2 }}>{t}</li>)}
                </ol>
              </div>
            )}

            {scope.off_scope_topics.length > 0 && (
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontWeight: 600, fontSize: '0.7rem', marginBottom: 4, color: '#ef4444' }}>Off-Scope Topics</div>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {scope.off_scope_topics.map(t => (
                    <span key={t} style={{ padding: '2px 6px', borderRadius: 3, background: 'rgba(239,68,68,0.15)', color: '#ef4444', fontSize: '0.65rem' }}>{t}</span>
                  ))}
                </div>
              </div>
            )}

            {scope.drift_signatures.length > 0 && (
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontWeight: 600, fontSize: '0.7rem', marginBottom: 4, color: '#f59e0b' }}>Drift Signatures</div>
                <ul style={{ margin: 0, paddingLeft: 20, fontSize: '0.7rem', listStyle: 'disc' }}>
                  {scope.drift_signatures.map((d, i) => <li key={i} style={{ color: '#f59e0b', marginBottom: 2 }}>{d}</li>)}
                </ul>
              </div>
            )}

            {scope.example_ceiling && (
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontWeight: 600, fontSize: '0.7rem', marginBottom: 2 }}>Example Ceiling</div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>{scope.example_ceiling}</div>
              </div>
            )}

            {scope.explicit_qualifiers.length > 0 && (
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontWeight: 600, fontSize: '0.7rem', marginBottom: 4 }}>Qualifiers</div>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {scope.explicit_qualifiers.map(q => (
                    <span key={q} style={{ padding: '2px 6px', borderRadius: 3, background: 'rgba(99,102,241,0.15)', color: '#6366f1', fontSize: '0.65rem' }}>{q}</span>
                  ))}
                </div>
              </div>
            )}

            {scope.excluded_scenarios.length > 0 && (
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontWeight: 600, fontSize: '0.7rem', marginBottom: 4 }}>Excluded Scenarios</div>
                <ul style={{ margin: 0, paddingLeft: 20, fontSize: '0.7rem', listStyle: 'disc' }}>
                  {scope.excluded_scenarios.map((s, i) => <li key={i} style={{ marginBottom: 2 }}>{s}</li>)}
                </ul>
              </div>
            )}

            {scope.on_scope_evidence.length > 0 && (
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontWeight: 600, fontSize: '0.7rem', marginBottom: 4 }}>On-Scope Evidence</div>
                <ul style={{ margin: 0, paddingLeft: 20, fontSize: '0.7rem', listStyle: 'disc' }}>
                  {scope.on_scope_evidence.map((e, i) => <li key={i} style={{ marginBottom: 2 }}>{e}</li>)}
                </ul>
              </div>
            )}
          </div>
        );
      })()}

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
      {effectiveOverviewTab === 'lineage' && (() => {
        const frame = debate.topic.critique?.lineage_frame;
        if (!frame || frame.length === 0) return <div style={{ padding: 16, color: 'var(--text-muted)' }}>No lineage data for this debate.</div>;
        const maxPct = Math.max(...frame.map(f => f.percentage));
        // Check if any transcript entry had lineage boost data
        const boostActive = debate.transcript.some(e => {
          const manifest = (e.metadata as Record<string, unknown>)?.injection_manifest as { lineage_boost?: unknown } | undefined;
          return !!manifest?.lineage_boost;
        });
        // Aggregate per-turn boost stats from injection manifests
        let totalBoosted = 0;
        let totalPromoted = 0;
        let turnsWithBoost = 0;
        for (const e of debate.transcript) {
          const manifest = (e.metadata as Record<string, unknown>)?.injection_manifest as {
            lineage_boost?: { boosted?: number; promoted?: number };
          } | undefined;
          if (manifest?.lineage_boost) {
            turnsWithBoost++;
            totalBoosted += manifest.lineage_boost.boosted ?? 0;
            totalPromoted += manifest.lineage_boost.promoted ?? 0;
          }
        }
        return (
          <div style={{ padding: 16, overflowY: 'auto', flex: 1 }}>
            <h4 style={{ margin: '0 0 8px', fontSize: '0.85rem' }}>Intellectual Lineage Frame</h4>
            <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', margin: '0 0 12px' }}>
              Dominant intellectual traditions detected from activated taxonomy nodes. These traditions shape which nodes receive relevance boosts during context injection.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
              {frame.map(f => (
                <div key={f.cluster_id}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: '0.7rem', fontWeight: 600, minWidth: 160, textAlign: 'right' }}>{f.label}</span>
                    <div style={{ flex: 1, height: 14, background: 'var(--bg-secondary, #222)', borderRadius: 3, overflow: 'hidden', position: 'relative' }}>
                      <div style={{
                        width: `${maxPct > 0 ? (f.percentage / maxPct) * 100 : 0}%`,
                        height: '100%',
                        background: 'linear-gradient(90deg, #f59e0b, #f97316)',
                        borderRadius: 3,
                        transition: 'width 0.3s ease',
                      }} />
                    </div>
                    <span style={{ fontSize: '0.65rem', fontWeight: 700, minWidth: 40, textAlign: 'right', color: '#f59e0b' }}>
                      {(f.percentage * 100).toFixed(0)}%
                    </span>
                  </div>
                  {f.traditions && f.traditions.length > 0 && (
                    <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)', marginTop: 2, paddingLeft: 168 }}>
                      {f.traditions.join(', ')}
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: '0.7rem' }}>
              <div style={{
                padding: '6px 12px', borderRadius: 6,
                background: boostActive ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.08)',
                color: boostActive ? '#16a34a' : '#888',
                fontWeight: 600,
              }}>
                Lineage Boost: {boostActive ? 'Active' : 'Inactive'}
              </div>
              {boostActive && turnsWithBoost > 0 && (
                <>
                  <div style={{ padding: '6px 12px', borderRadius: 6, background: 'rgba(59,130,246,0.1)', color: '#3b82f6', fontWeight: 600 }}>
                    Turns with boost: {turnsWithBoost}
                  </div>
                  <div style={{ padding: '6px 12px', borderRadius: 6, background: 'rgba(139,92,246,0.1)', color: '#8b5cf6', fontWeight: 600 }}>
                    Nodes boosted: {totalBoosted} · Promoted: {totalPromoted}
                  </div>
                </>
              )}
            </div>
            {/* Lineage Effectiveness — promoted vs. cited */}
            {boostActive && (() => {
              const allPromoted = new Set<string>();
              const allInjected = new Set<string>();
              const allReferenced = new Set<string>();
              for (const e of debate.transcript) {
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
              if (allPromoted.size === 0) return null;
              const promotedCitedIds = [...allPromoted].filter(id => allReferenced.has(id));
              const promotedCited = promotedCitedIds.length;
              const promotedRate = promotedCited / allPromoted.size;
              const baselineRate = allInjected.size > 0 ? allReferenced.size / allInjected.size : 0;
              const ratio = baselineRate > 0 ? promotedRate / baselineRate : 0;
              const verdict = promotedRate > 0.15 ? 'high_impact' : promotedRate > 0.05 ? 'moderate_impact' : 'low_impact';
              const verdictLabel = verdict === 'high_impact' ? 'High impact' : verdict === 'moderate_impact' ? 'Moderate impact' : 'Low impact';
              const verdictColor = verdict === 'high_impact' ? '#22c55e' : verdict === 'moderate_impact' ? '#f59e0b' : '#ef4444';
              const promotedCitedSet = new Set(promotedCitedIds);
              return (
                <div style={{
                  marginTop: 12, padding: '8px 12px', borderRadius: 6,
                  background: 'rgba(249,115,22,0.06)', border: '1px solid rgba(249,115,22,0.15)',
                  fontSize: '0.7rem', lineHeight: 1.6,
                }}>
                  <div style={{ fontWeight: 700, color: '#f59e0b', marginBottom: 4 }}>Lineage Effectiveness</div>
                  <div>
                    Lineage boost promoted <strong>{allPromoted.size}</strong> node{allPromoted.size !== 1 ? 's' : ''};{' '}
                    <strong style={{ color: '#22c55e' }}>{promotedCited}</strong> cited ({(promotedRate * 100).toFixed(0)}%)
                    {' vs. '}<strong>{(baselineRate * 100).toFixed(0)}%</strong> baseline
                  </div>
                  <div style={{ color: 'var(--text-muted)', marginTop: 2 }}>
                    {promotedRate > baselineRate
                      ? `Promoted nodes cited ${ratio.toFixed(1)}× more than baseline — boost is helping`
                      : promotedRate === baselineRate
                        ? 'Promoted node citation rate matches baseline'
                        : 'Promoted nodes cited less than baseline — boost had limited effect'}
                  </div>
                  <div style={{ marginTop: 6, fontWeight: 700, color: verdictColor }}>
                    Lineage boost: {verdictLabel}
                  </div>
                  {allPromoted.size <= 30 && (
                    <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {[...allPromoted].map(id => (
                        <span key={id} style={{
                          padding: '1px 6px', borderRadius: 4, fontSize: '0.6rem', fontFamily: 'monospace',
                          background: promotedCitedSet.has(id) ? 'rgba(34,197,94,0.15)' : 'rgba(156,163,175,0.15)',
                          color: promotedCitedSet.has(id) ? '#22c55e' : 'var(--text-muted)',
                          border: `1px solid ${promotedCitedSet.has(id) ? 'rgba(34,197,94,0.3)' : 'rgba(156,163,175,0.2)'}`,
                        }} title={promotedCitedSet.has(id) ? 'Cited by debaters' : 'Not cited'}>
                          {id}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })()}
            {/* Vocabulary Disambiguation Aggregate (t/212) */}
            {(() => {
              const allResolved: { colloquial: string; canonical: string; confidence: string; speaker: string }[] = [];
              const allAmbiguous: { colloquial: string; speaker: string }[] = [];
              for (const e of debate.transcript) {
                if (e.speaker === 'system' || e.speaker === 'moderator' || e.speaker === 'user') continue;
                const meta = e.metadata as Record<string, unknown> | undefined;
                const res = meta?.vocabulary_resolutions as { colloquial: string; canonical: string; confidence: string }[] | undefined;
                const amb = meta?.vocabulary_ambiguities as { colloquial: string }[] | undefined;
                if (res) for (const r of res) allResolved.push({ ...r, speaker: speakerLabel(e.speaker) });
                if (amb) for (const a of amb) allAmbiguous.push({ colloquial: a.colloquial, speaker: speakerLabel(e.speaker) });
              }
              if (allResolved.length === 0 && allAmbiguous.length === 0) return null;
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
              return (
                <div style={{ marginTop: 20 }}>
                  <h4 style={{ margin: '0 0 8px', fontSize: '0.85rem' }}>Vocabulary Disambiguation</h4>
                  <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', margin: '0 0 8px' }}>
                    Colloquial terms resolved to canonical forms based on speaker POV.
                    {allResolved.length > 0 && <> <strong>{allResolved.length}</strong> resolved across {grouped.size} unique mappings.</>}
                    {allAmbiguous.length > 0 && <> <span style={{ color: '#d97706' }}><strong>{allAmbiguous.length}</strong> ambiguous.</span></>}
                  </p>
                  {grouped.size > 0 && (
                    <table style={{ width: '100%', fontSize: '0.7rem', borderCollapse: 'collapse', marginBottom: 8 }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid var(--border)' }}>
                          <th style={{ textAlign: 'left', padding: '3px 8px', color: 'var(--text-muted)' }}>Colloquial</th>
                          <th style={{ textAlign: 'left', padding: '3px 8px', color: 'var(--text-muted)' }}>Canonical Form</th>
                          <th style={{ textAlign: 'center', padding: '3px 8px', color: 'var(--text-muted)' }}>Conf.</th>
                          <th style={{ textAlign: 'left', padding: '3px 8px', color: 'var(--text-muted)' }}>Speakers</th>
                          <th style={{ textAlign: 'center', padding: '3px 8px', color: 'var(--text-muted)' }}>Hits</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...grouped.entries()].sort((a, b) => b[1].count - a[1].count).map(([key, v]) => {
                          const colloquial = key.split('→')[0];
                          return (
                            <tr key={key} style={{ borderBottom: '1px solid rgba(128,128,128,0.1)' }}>
                              <td style={{ padding: '3px 8px' }}>
                                <span className="vocab-term" style={{ textDecoration: 'none', cursor: 'default' }}>{colloquial}</span>
                              </td>
                              <td style={{ padding: '3px 8px', color: 'var(--text-secondary)' }}>{v.canonical}</td>
                              <td style={{
                                padding: '3px 8px', textAlign: 'center', fontWeight: 600,
                                color: v.confidence === 'high' ? '#22c55e' : v.confidence === 'low' ? '#ef4444' : '#d97706',
                              }}>{v.confidence}</td>
                              <td style={{ padding: '3px 8px', fontSize: '0.65rem', color: 'var(--text-muted)' }}>{[...v.speakers].join(', ')}</td>
                              <td style={{ padding: '3px 8px', textAlign: 'center' }}>{v.count}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                  {allAmbiguous.length > 0 && (
                    <div style={{ padding: '6px 10px', background: 'rgba(217,119,6,0.06)', borderLeft: '3px solid #d97706', borderRadius: 4, fontSize: '0.68rem' }}>
                      <div style={{ fontWeight: 600, color: '#d97706', marginBottom: 4 }}>Ambiguous terms (needs review):</div>
                      {[...new Set(allAmbiguous.map(a => a.colloquial))].map((term, i) => {
                        const speakers = [...new Set(allAmbiguous.filter(a => a.colloquial === term).map(a => a.speaker))];
                        return (
                          <div key={i} style={{ marginLeft: 8, marginBottom: 2 }}>
                            &ldquo;{term}&rdquo; <span style={{ color: 'var(--text-muted)' }}>&mdash; {speakers.join(', ')}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        );
      })()}

      {/* Adaptive Staging — signal telemetry, phase transitions, GC events */}
      {effectiveOverviewTab === 'adaptive' && (
        <AdaptiveStagingTab debate={debate} />
      )}

      {/* Reflections — taxonomy edits proposed by debaters */}
      {effectiveOverviewTab === 'reflections' && (
        <ReflectionsTab debate={debate} />
      )}

      {/* Argument Network with inline Moderator Deliberations */}
      {effectiveOverviewTab === 'argument-network' && an && an.nodes.length > 0 && (
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
        />
      )}

      {/* Commitments */}
      {effectiveOverviewTab === 'commitments' && commitments && Object.keys(commitments).length > 0 && (
        <CommitmentsPanel
          commitments={commitments}
          nodes={an?.nodes ?? []}
          edges={an?.edges ?? []}
          onGoToNode={(nodeId) => { setOverviewTab('argument-network'); setFocusedNodeId(nodeId); }}
        />
      )}

      {/* POV Progression — inline view (replaces separate popout) */}
      {effectiveOverviewTab === 'pov-progression' && (
        <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
          <PovProgressionView session={debate} nodeLabels={nodeLabels} />
        </div>
      )}

      {/* Flight Recorder Context — live snapshot of app state */}
      {effectiveOverviewTab === 'fr-context' && (() => {
        const taxState = useTaxonomyStore.getState();
        const mem = (performance as unknown as { memory?: { usedJSHeapSize: number; totalJSHeapSize: number } }).memory;
        const eApi = (window as unknown as { electronAPI?: { processVersions?: Record<string, string | undefined>; osRelease?: string; osPlatform?: string; osArch?: string } }).electronAPI;
        const pv = eApi?.processVersions;
        const sections: { title: string; rows: [string, string | number | null | undefined][] }[] = [
          {
            title: 'App',
            rows: [
              ['Platform', eApi?.osPlatform ?? navigator.platform],
              ['Arch', eApi?.osArch ?? 'unknown'],
              ['OS Version', eApi?.osRelease ?? 'N/A'],
              ['VITE_TARGET', import.meta.env.VITE_TARGET ?? 'electron'],
              ['Mode', import.meta.env.DEV ? 'dev' : 'prod'],
            ],
          },
          {
            title: 'SBOM',
            rows: [
              ['Node', pv?.node ?? 'N/A'],
              ['Electron', pv?.electron ?? 'N/A'],
              ['Chrome', pv?.chrome ?? 'N/A'],
              ['V8', pv?.v8 ?? 'N/A'],
              ['React', typeof __COMPONENT_VERSIONS__ !== 'undefined' ? __COMPONENT_VERSIONS__.react : 'N/A'],
              ['Zustand', typeof __COMPONENT_VERSIONS__ !== 'undefined' ? __COMPONENT_VERSIONS__.zustand : 'N/A'],
            ],
          },
          {
            title: 'Windows',
            rows: [
              ['Active Tab', taxState.activeTab],
              ['Toolbar Panel', taxState.toolbarPanel ?? '(none)'],
              ['Selected Node', taxState.selectedNodeId ?? '(none)'],
            ],
          },
          {
            title: 'Debate',
            rows: [
              ['ID', debate.id.slice(0, 8) + '...'],
              ['Phase', debate.phase],
              ['Adaptive Phase', debate.adaptive_staging?.current_phase ?? '(none)'],
              ['Transcript', debate.transcript?.length ?? 0],
              ['AN Nodes', debate.argument_network?.nodes?.length ?? 0],
              ['Convergence Signals', debate.convergence_signals?.length ?? 0],
              ['Protocol', debate.protocol ?? '(default)'],
            ],
          },
          {
            title: 'Taxonomy',
            rows: [
              ['Accelerationist nodes', taxState.accelerationist?.nodes?.length ?? 0],
              ['Safetyist nodes', taxState.safetyist?.nodes?.length ?? 0],
              ['Skeptic nodes', taxState.skeptic?.nodes?.length ?? 0],
              ['Situations nodes', taxState.situations?.nodes?.length ?? 0],
              ['Edges', taxState.edgesFile?.edges?.length ?? 0],
              ['Dirty files', taxState.dirty?.size ?? 0],
              ['Save error', taxState.saveError ?? '(none)'],
            ],
          },
          {
            title: 'AI',
            rows: [
              ['Backend', taxState.aiBackend],
              ['Model', taxState.geminiModel],
            ],
          },
          {
            title: 'Performance',
            rows: [
              ['Uptime', `${Math.round(performance.now() / 1000)}s`],
              ['Heap used', mem ? `${Math.round(mem.usedJSHeapSize / 1048576)} MB` : 'N/A'],
              ['Heap total', mem ? `${Math.round(mem.totalJSHeapSize / 1048576)} MB` : 'N/A'],
            ],
          },
        ];
        return (
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '8px 12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: '0.75rem', fontWeight: 700 }}>Flight Recorder Context Snapshot</span>
              <button
                onClick={() => triggerManualDump()}
                style={{ fontSize: '0.65rem', padding: '2px 8px', background: '#f59e0b', color: '#000', border: 'none', borderRadius: 4, cursor: 'pointer', fontWeight: 600 }}
              >Dump Now</button>
            </div>
            {sections.map(s => (
              <div key={s.title} style={{ marginBottom: 10 }}>
                <div style={{ fontSize: '0.65rem', fontWeight: 700, color: '#f59e0b', marginBottom: 2, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{s.title}</div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.7rem' }}>
                  <tbody>
                    {s.rows.map(([label, value]) => (
                      <tr key={label} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '2px 6px', color: 'var(--text-muted)', width: '40%' }}>{label}</td>
                        <td style={{ padding: '2px 6px', fontFamily: 'monospace', fontSize: '0.65rem' }}>{String(value ?? '')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        );
      })()}

      {/* Transcript list for selection — hidden when an entry is selected (sidebar handles navigation) */}
      {effectiveOverviewTab === 'transcript' && !selectedEntry && (() => {
        const speakers = Array.from(new Set(debate.transcript.map(e => e.speaker)));
        const filteredTranscript = transcriptSpeakerFilter
          ? debate.transcript.map((e, i) => ({ e, i })).filter(({ e }) => e.speaker === transcriptSpeakerFilter)
          : debate.transcript.map((e, i) => ({ e, i }));
        return (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ display: 'flex', gap: 4, padding: '4px 6px', flexWrap: 'wrap', alignItems: 'center', flexShrink: 0 }}>
            <button
              onClick={() => setTranscriptSpeakerFilter(null)}
              style={{
                padding: '2px 8px', fontSize: '0.6rem', fontWeight: 600, borderRadius: 4, cursor: 'pointer',
                border: '1px solid var(--border)',
                background: !transcriptSpeakerFilter ? '#f59e0b' : 'transparent',
                color: !transcriptSpeakerFilter ? '#000' : 'var(--text-secondary)',
              }}
            >All ({debate.transcript.filter(e => e.type === 'statement' || e.type === 'opening').length} stmts / {debate.transcript.length})</button>
            {speakers.map(s => {
              const count = debate.transcript.filter(e => e.speaker === s).length;
              const active = transcriptSpeakerFilter === s;
              return (
                <button
                  key={s}
                  onClick={() => setTranscriptSpeakerFilter(active ? null : s)}
                  style={{
                    padding: '2px 8px', fontSize: '0.6rem', fontWeight: 600, borderRadius: 4, cursor: 'pointer',
                    border: '1px solid var(--border)',
                    background: active ? '#f59e0b' : 'transparent',
                    color: active ? '#000' : 'var(--text-secondary)',
                  }}
                >{speakerLabel(s)} ({count})</button>
              );
            })}
          </div>
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
          {filteredTranscript.map(({ e, i }) => {
          const stmtId = `S${i + 1}`;
          const eMeta = e.metadata as Record<string, unknown> | undefined;
          const modT = eMeta?.moderator_trace as {
            selected?: string; focus_point?: string; selection_reason?: string;
            convergence_score?: number | null; convergence_triggered?: boolean;
            intervention_recommended?: boolean; intervention_move?: string | null;
            intervention_validated?: boolean; health_score?: number;
          } | undefined;
          const eDiag = debate.diagnostics?.entries[e.id];
          const hasStages = eDiag?.stage_diagnostics && eDiag.stage_diagnostics.length > 0;
          return (
            <div
              key={e.id}
              onClick={() => { setSelectedEntry(e.id); setLocalOverride(true); }}
              style={{ padding: '4px 6px', cursor: 'pointer', borderRadius: 4, margin: '2px 0', background: selectedEntry === e.id ? 'rgba(249,115,22,0.08)' : 'var(--bg-primary)', borderLeft: selectedEntry === e.id ? '3px solid #f97316' : '3px solid transparent', fontSize: '0.7rem' }}
            >
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                <span
                  title={`Statement ${stmtId}`}
                  style={{
                    padding: '1px 6px', borderRadius: 8,
                    background: 'rgba(249,115,22,0.12)', color: '#f97316',
                    fontSize: '0.6rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums',
                    flexShrink: 0,
                  }}
                >{stmtId}</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <strong>{speakerLabel(e.speaker)}</strong> [{e.type}] <Highlight text={e.content.slice(0, 80)} />...
                </span>
                {hasStages && <span title="4-stage pipeline" style={{ fontSize: '0.5rem', color: '#3b82f6', opacity: 0.7 }}>B/P/D/C</span>}
              </div>
              {modT && (
                <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginTop: 2, paddingLeft: 36, flexWrap: 'wrap' }}>
                  <span style={{ padding: '0 4px', borderRadius: 3, background: 'rgba(139,92,246,0.12)', color: '#8b5cf6', fontSize: '0.55rem', fontWeight: 600 }}>MOD</span>
                  {modT.focus_point && <span style={{ fontSize: '0.55rem', color: 'var(--text-muted)', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={modT.focus_point}>{modT.focus_point}</span>}
                  {modT.selection_reason && modT.selection_reason !== 'moderator_ai_selection' && (
                    <span style={{ padding: '0 3px', borderRadius: 2, background: 'rgba(239,68,68,0.1)', color: '#ef4444', fontSize: '0.5rem' }}>{modT.selection_reason === 'turn_alternation_override' ? 'override' : modT.selection_reason}</span>
                  )}
                  {modT.intervention_move && (
                    <span style={{ padding: '0 4px', borderRadius: 3, background: modT.intervention_validated ? 'rgba(139,92,246,0.2)' : 'rgba(239,68,68,0.15)', color: modT.intervention_validated ? '#8b5cf6' : '#ef4444', fontSize: '0.5rem', fontWeight: 600 }}>{modT.intervention_move}{modT.intervention_validated ? '' : ' (suppressed)'}</span>
                  )}
                  {modT.convergence_score != null && <span style={{ fontSize: '0.5rem', color: 'var(--text-muted)' }}>conv:{(modT.convergence_score * 100).toFixed(0)}%</span>}
                  {modT.health_score != null && <span style={{ fontSize: '0.5rem', color: 'var(--text-muted)' }}>H:{modT.health_score.toFixed(2)}</span>}
                </div>
              )}
            </div>
          );
        })}
        </div>
        </div>
        );
      })()}
      </>}

      {/* Prompt Diff — rendered outside the selectedEntry guard so it works from transcript inline buttons too */}
      {effectiveOverviewTab === 'prompt-diff' && (
        <div style={{ flex: 1, minHeight: 0, minWidth: 0, overflow: 'hidden', display: 'flex' }}>
          <PromptDiffContent
            debate={debate}
            focusedEntryId={selectedEntry ?? debate.transcript[0]?.id ?? ''}
            embedded
          />
        </div>
      )}

      {/* Agent Utility — per-speaker composite with sparkline curves */}
      {effectiveOverviewTab === 'utility' && (
        <UtilityTab
          debate={debate}
          perTurnUtilities={perTurnUtilities}
          setSelectedEntry={setSelectedEntry}
          setLocalOverride={setLocalOverride}
        />
      )}
    </>
  );
}
