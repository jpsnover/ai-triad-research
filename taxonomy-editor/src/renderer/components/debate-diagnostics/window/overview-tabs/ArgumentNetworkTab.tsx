// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import React, { useState, useMemo } from 'react';
import type { DebateSession, ArgumentNetworkNode, ArgumentNetworkEdge } from '../../../../types/debate';
import type { WeightHistoryEntry } from '../../../../types/taxonomy';
import { computeQbafStrengths } from '@lib/debate/qbaf';
import type { QbafNode, QbafEdge } from '@lib/debate/qbaf';
import { useTaxonomyStore } from '../../../../hooks/useTaxonomyStore';
import { INodeRow } from '../shared';
import { Highlight, speakerLabel } from '../helpers';
import type { OverviewTab } from '../types';

interface ArgumentNetwork {
  nodes: ArgumentNetworkNode[];
  edges: ArgumentNetworkEdge[];
}

interface ArgumentNetworkTabProps {
  debate: DebateSession;
  an: ArgumentNetwork;
  anFilterMode: 'all' | 'unattributed' | 'novel' | 'anchored';
  anFilterNodeId: string;
  setAnFilterMode: (mode: 'all' | 'unattributed' | 'novel' | 'anchored') => void;
  setAnFilterNodeId: (id: string) => void;
  focusedNodeId: string | null;
  handleUpdateSubScore: (nodeId: string, key: string, value: number) => void;
  setOverviewTab: (tab: OverviewTab) => void;
  setSelectedEntry: (id: string | null) => void;
  setLocalOverride: (v: boolean) => void;
  /** Taxonomy node-id → human-readable label map, used to lead attribution tooltips with the node's title. */
  nodeLabels: Map<string, string>;
}

export function ArgumentNetworkTab({
  debate,
  an,
  anFilterMode,
  anFilterNodeId,
  setAnFilterMode,
  setAnFilterNodeId,
  focusedNodeId,
  handleUpdateSubScore,
  setOverviewTab,
  setSelectedEntry,
  setLocalOverride,
  nodeLabels,
}: ArgumentNetworkTabProps) {
  const caCount = an.edges.filter(e => e.type === 'attacks').length;
  const raCount = an.edges.filter(e => e.type === 'supports').length;
  // Statement-ID map — matches S{round} from the main transcript view.
  const stmtIdByEntry = new Map<string, string>();
  debate.transcript.forEach((e, i) => stmtIdByEntry.set(e.id, `S${i + 1}`));

  // Compute QBAF strengths from edges
  const qbafNodes: QbafNode[] = an.nodes.map(n => ({ id: n.id, base_strength: n.base_strength ?? 0.5 }));
  const qbafEdges: QbafEdge[] = an.edges.map(e => ({
    source: e.source, target: e.target,
    type: e.type as 'attacks' | 'supports',
    weight: e.weight ?? 0.5,
    attack_type: e.attack_type,
  }));
  const qbafResult = computeQbafStrengths(qbafNodes, qbafEdges);
  const strengthMap = qbafResult.strengths;

  // Build moderator trace lookup: entry ID -> trace
  const modTraceByEntryId = new Map<string, {
    selected: string; focus_point: string; addressing?: string;
    excluded_last_speaker?: string | null;
    selection_reason?: string;
    recent_scheme?: string | null;
    convergence_score?: number | null; convergence_triggered?: boolean;
    candidates?: { debater: string; computed_strength: number | null; rank: number }[];
    argument_network_snapshot?: { total_claims: number; total_edges: number; unaddressed_claims: number } | null;
  }>();
  debate.transcript.forEach(e => {
    const meta = e.metadata as Record<string, unknown> | undefined;
    if (meta?.moderator_trace) {
      modTraceByEntryId.set(e.id, meta.moderator_trace as NonNullable<ReturnType<typeof modTraceByEntryId.get>>);
    }
  });

  // Group AN nodes by source_entry_id to interleave with moderator traces
  const entryGroups: { entryId: string; nodes: typeof an.nodes; trace: ReturnType<typeof modTraceByEntryId.get> }[] = [];
  const seenEntries = new Set<string>();
  for (const n of an.nodes) {
    const eid = n.source_entry_id;
    if (!seenEntries.has(eid)) {
      seenEntries.add(eid);
      entryGroups.push({
        entryId: eid,
        nodes: an.nodes.filter(x => x.source_entry_id === eid),
        trace: modTraceByEntryId.get(eid),
      });
    }
  }

  // Also show moderator traces for entries that produced no AN nodes
  debate.transcript.forEach(e => {
    const meta = e.metadata as Record<string, unknown> | undefined;
    if (meta?.moderator_trace && !seenEntries.has(e.id)) {
      entryGroups.push({ entryId: e.id, nodes: [], trace: meta.moderator_trace as ReturnType<typeof modTraceByEntryId.get> });
    }
  });

  const modCount = [...modTraceByEntryId.values()].length;

  // Apply AN claim filters (t/117)
  const anNodeFilter = (n: ArgumentNetworkNode): boolean => {
    const attr = n.claim_taxonomy_attribution;
    if (anFilterMode === 'unattributed') return !!attr?.unattributed_reason;
    if (anFilterMode === 'novel') return attr?.unattributed_reason === 'novel_argument';
    if (anFilterMode === 'anchored') return !!attr && !attr.unattributed_reason;
    if (anFilterNodeId.trim()) {
      const q = anFilterNodeId.trim().toLowerCase();
      return !!attr?.primary_ref?.toLowerCase().includes(q)
        || !!attr?.secondary_refs?.some(s => s.node_id.toLowerCase().includes(q));
    }
    return true;
  };
  const filteredGroups = entryGroups.map(g => ({
    ...g,
    nodes: g.nodes.filter(anNodeFilter),
  })).filter(g => g.nodes.length > 0 || g.trace);

  const filteredNodeCount = filteredGroups.reduce((sum, g) => sum + g.nodes.length, 0);
  const isFiltered = anFilterMode !== 'all' || anFilterNodeId.trim() !== '';
  const [allExpanded, setAllExpanded] = useState(false);

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
      <ArgNetMinimap nodes={an.nodes} edges={an.edges} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
          {an.nodes.length} I-nodes · {caCount} CA · {raCount} RA{modCount > 0 ? ` · ${modCount} moderator decisions` : ''}
        </span>
        <button
          onClick={() => setAllExpanded(!allExpanded)}
          style={{ marginLeft: 'auto', fontSize: 'var(--text-2xs)', padding: '2px 6px', borderRadius: 3, border: '1px solid var(--border)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', cursor: 'pointer' }}
        >
          {allExpanded ? 'Collapse All' : 'Expand All'}
        </button>
      </div>
      {/* AN claim filter bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, flexWrap: 'wrap', fontSize: 'var(--text-2xs)' }}>
        <select
          value={anFilterMode}
          onChange={e => setAnFilterMode(e.target.value as typeof anFilterMode)}
          style={{ fontSize: 'var(--text-2xs)', padding: '2px 4px', borderRadius: 4, background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-color, rgba(255,255,255,0.1))' }}
        >
          <option value="all">All claims</option>
          <option value="unattributed">Unattributed only</option>
          <option value="novel">Novel arguments</option>
          <option value="anchored">Attributed only</option>
        </select>
        <input
          type="text"
          placeholder="Filter by node ID…"
          value={anFilterNodeId}
          onChange={e => setAnFilterNodeId(e.target.value)}
          style={{ fontSize: 'var(--text-2xs)', padding: '2px 6px', borderRadius: 4, background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-color, rgba(255,255,255,0.1))', width: 140 }}
        />
        {isFiltered && (
          <span style={{ color: 'var(--text-muted)' }}>
            {filteredNodeCount}/{an.nodes.length} shown
            <button
              onClick={() => { setAnFilterMode('all'); setAnFilterNodeId(''); }}
              style={{ marginLeft: 4, cursor: 'pointer', background: 'none', border: 'none', color: 'var(--color-saf)', fontSize: 'var(--text-2xs)', padding: 0 }}
            >clear</button>
          </span>
        )}
      </div>
      {filteredGroups.map(({ entryId, nodes: groupNodes, trace }) => {
        const srcEntry = debate.transcript.find(e => e.id === entryId);
        const stmtId = stmtIdByEntry.get(entryId);
        return (
        <div key={entryId}>
          {/* Source statement header */}
          {srcEntry && groupNodes.length > 0 && (
            <div
              style={{
                margin: '10px 0 2px', padding: '4px 8px', borderRadius: 4,
                background: 'color-mix(in srgb, var(--color-saf) 6%, transparent)', borderLeft: '3px solid color-mix(in srgb, var(--color-saf) 40%, transparent)',
                fontSize: 'var(--text-2xs)', color: 'var(--text-secondary)',
                cursor: 'pointer',
              }}
              onClick={() => { setOverviewTab('transcript'); setSelectedEntry(entryId); setLocalOverride(true); }}
              title={`Go to ${stmtId ?? entryId} in transcript`}
            >
              <span style={{ fontWeight: 700, color: 'var(--color-saf)', marginRight: 6 }}>{stmtId ?? entryId}</span>
              <span style={{ fontWeight: 600, marginRight: 6 }}>{speakerLabel(srcEntry.speaker)}</span>
              <span style={{ color: 'var(--text-muted)' }}>
                {srcEntry.content.length > 200 ? srcEntry.content.slice(0, 200) + '…' : srcEntry.content}
              </span>
            </div>
          )}
          {/* Moderator deliberation banner */}
          {trace && (
            <div style={{
              margin: '8px 0 4px', padding: '6px 10px', borderRadius: 6,
              background: 'color-mix(in srgb, var(--color-acc) 8%, transparent)', borderLeft: '3px solid var(--color-acc)',
              fontSize: 'var(--text-2xs)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 700, color: 'var(--color-acc)', fontSize: 'var(--text-2xs)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Moderator</span>
                <span style={{ fontWeight: 600 }}>→ {speakerLabel(trace.selected)}</span>
                {trace.selection_reason && (
                  <span style={{ padding: '1px 5px', borderRadius: 3, background: 'color-mix(in srgb, var(--color-acc) 15%, transparent)', color: 'var(--color-acc)', fontSize: 'var(--text-2xs)', fontWeight: 600 }}>
                    {trace.selection_reason.replace(/_/g, ' ')}
                  </span>
                )}
                {trace.recent_scheme && (
                  <span style={{ padding: '1px 5px', borderRadius: 3, background: 'color-mix(in srgb, var(--text-secondary) 15%, transparent)', color: 'var(--text-secondary)', fontSize: 'var(--text-2xs)', fontWeight: 600 }}>
                    {trace.recent_scheme}
                  </span>
                )}
                {trace.convergence_score != null && (
                  <span style={{ color: 'var(--text-muted)' }}>
                    conv: {(trace.convergence_score * 100).toFixed(0)}%
                    {trace.convergence_triggered && <span style={{ color: 'var(--success)', marginLeft: 3, fontWeight: 700 }}>triggered</span>}
                  </span>
                )}
              </div>
              <div style={{ marginTop: 3, color: 'var(--text-muted)' }}>
                <strong>Focus:</strong> <Highlight text={trace.focus_point} />
              </div>
              {trace.candidates && trace.candidates.length > 0 && (
                <div style={{ marginTop: 3, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {trace.candidates.map((c, i) => (
                    <span key={i} style={{
                      fontSize: 'var(--text-2xs)',
                      opacity: c.debater === trace.selected ? 1 : 0.6,
                      fontWeight: c.debater === trace.selected ? 700 : 400,
                    }}>
                      #{c.rank} {speakerLabel(c.debater)}
                      {c.computed_strength != null && ` (${c.computed_strength.toFixed(2)})`}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
          {/* AN nodes from this entry */}
          {groupNodes.map(n => {
            const attacks = an.edges.filter(e => e.target === n.id && e.type === 'attacks');
            const supports = an.edges.filter(e => e.target === n.id && e.type === 'supports');
            const isSource = an.edges.some(e => e.source === n.id);
            return (
              <INodeRow
                key={n.id}
                node={n}
                attacks={attacks}
                supports={supports}
                allNodes={an.nodes}
                allEdges={an.edges}
                isSource={isSource}
                computedStrength={strengthMap.get(n.id)}
                strengthMap={strengthMap}
                statementId={stmtIdByEntry.get(n.source_entry_id)}
                onGotoEntry={(eid) => { setOverviewTab('transcript'); setSelectedEntry(eid); setLocalOverride(true); }}
                stmtIdByEntry={stmtIdByEntry}
                focused={focusedNodeId === n.id}
                onUpdateSubScore={handleUpdateSubScore}
                nodeLabels={nodeLabels}
                defaultExpanded={allExpanded}
              />
            );
          })}
        </div>
        );
      })}
      {/* Confidence evolution trace — shows taxonomy nodes whose confidence changed from this debate */}
      <ConfidenceImpactTrace debateId={debate.id} />
    </div>
  );
}

const MINIMAP_SPEAKER_COLORS: Record<string, string> = {
  accelerationist: 'var(--color-acc, #b84e13)',
  safetyist: 'var(--color-saf, #2b5fad)',
  skeptic: 'var(--color-skp, #7b4fa6)',
};
const MINIMAP_DEGRADE_CEILING = 80;

function ArgNetMinimap({ nodes, edges }: { nodes: ArgumentNetworkNode[]; edges: ArgumentNetworkEdge[] }) {
  const layout = useMemo(() => {
    if (nodes.length === 0 || nodes.length > MINIMAP_DEGRADE_CEILING) return null;

    const speakers = [...new Set(nodes.map(n => n.speaker))];
    const W = 280, H = 140, CX = W / 2, CY = H / 2, R = 52;
    const arcPerSpeaker = (2 * Math.PI) / Math.max(speakers.length, 1);
    const positions = new Map<string, { x: number; y: number }>();

    speakers.forEach((spk, si) => {
      const spkNodes = nodes.filter(n => n.speaker === spk);
      const arcStart = si * arcPerSpeaker - Math.PI / 2;
      spkNodes.forEach((n, ni) => {
        const angle = arcStart + ((ni + 0.5) / spkNodes.length) * arcPerSpeaker;
        const jitter = spkNodes.length > 10 ? (ni % 2 === 0 ? 0.82 : 1.15) : 1;
        positions.set(n.id, {
          x: CX + R * jitter * Math.cos(angle),
          y: CY + R * jitter * Math.sin(angle),
        });
      });
    });

    return { W, H, CX, CY, positions, speakers };
  }, [nodes, edges]);

  if (nodes.length > MINIMAP_DEGRADE_CEILING) {
    return (
      <div style={{ padding: '6px 10px', marginBottom: 8, fontSize: 'var(--text-2xs)', color: 'var(--text-muted)', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-sm)', textAlign: 'center' }}>
        Network too large for minimap ({nodes.length} nodes, {edges.length} edges)
      </div>
    );
  }

  if (!layout || nodes.length === 0) return null;

  const { W, H, positions } = layout;

  return (
    <div style={{ marginBottom: 8, textAlign: 'center' }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxWidth: 360, height: H }}>
        {edges.map((e, i) => {
          const s = positions.get(e.source);
          const t = positions.get(e.target);
          if (!s || !t) return null;
          return (
            <line key={i} x1={s.x} y1={s.y} x2={t.x} y2={t.y}
              stroke={e.type === 'attacks' ? 'var(--danger, var(--danger))' : 'var(--success, var(--success))'}
              strokeWidth={0.6} opacity={0.35} />
          );
        })}
        {nodes.map(n => {
          const pos = positions.get(n.id);
          if (!pos) return null;
          return (
            <circle key={n.id} cx={pos.x} cy={pos.y} r={3}
              fill={MINIMAP_SPEAKER_COLORS[n.speaker] ?? 'var(--text-muted)'}
              opacity={0.8} />
          );
        })}
      </svg>
      <div style={{ display: 'flex', justifyContent: 'center', gap: 12, fontSize: 'var(--text-2xs)', color: 'var(--text-muted)', marginTop: 2 }}>
        {layout.speakers.map(s => (
          <span key={s} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
            <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: MINIMAP_SPEAKER_COLORS[s] ?? 'var(--text-muted)' }} />
            {speakerLabel(s)}
          </span>
        ))}
        <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
          <span style={{ display: 'inline-block', width: 10, height: 2, background: 'var(--danger, var(--danger))' }} /> attack
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
          <span style={{ display: 'inline-block', width: 10, height: 2, background: 'var(--success, var(--success))' }} /> support
        </span>
      </div>
    </div>
  );
}

/** Inline sub-component: confidence impact trace from taxonomy store. */
function ConfidenceImpactTrace({ debateId }: { debateId: string }) {
  const taxState = useTaxonomyStore.getState();
  const impacts: { nodeId: string; label: string; pov: string; entry: WeightHistoryEntry }[] = [];
  for (const pov of ['accelerationist', 'safetyist', 'skeptic'] as const) {
    const file = taxState[pov];
    if (!file) continue;
    for (const n of file.nodes) {
      if (n.confidence_history) {
        for (const h of n.confidence_history) {
          if (h.reason?.includes(debateId)) {
            impacts.push({ nodeId: n.id, label: n.label, pov, entry: h });
          }
        }
      }
      if (n.priority_history) {
        for (const h of n.priority_history) {
          if (h.reason?.includes(debateId)) {
            impacts.push({ nodeId: n.id, label: n.label, pov, entry: h });
          }
        }
      }
      if (n.operationality_history) {
        for (const h of n.operationality_history) {
          if (h.reason?.includes(debateId)) {
            impacts.push({ nodeId: n.id, label: n.label, pov, entry: h });
          }
        }
      }
    }
  }
  if (impacts.length === 0) return null;
  return (
    <div style={{ marginTop: 12, padding: '8px 10px', borderRadius: 6, background: 'color-mix(in srgb, var(--success) 6%, transparent)', borderLeft: '3px solid var(--success)' }}>
      <div style={{ fontWeight: 700, fontSize: 'var(--text-2xs)', color: 'var(--success)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
        Confidence Impact ({impacts.length})
      </div>
      {impacts.map((imp, i) => {
        const deltaColor = imp.entry.delta > 0 ? 'var(--success)' : imp.entry.delta < 0 ? 'var(--danger)' : 'var(--text-muted)';
        return (
          <div key={i} style={{ fontSize: 'var(--text-2xs)', marginBottom: 3, display: 'flex', gap: 6, alignItems: 'baseline', flexWrap: 'wrap' }}>
            <code style={{ fontSize: 'var(--text-2xs)', background: 'var(--bg-secondary)', padding: '0 3px', borderRadius: 2 }}>{imp.nodeId}</code>
            <span style={{ color: 'var(--text-muted)' }}>{imp.label.length > 40 ? imp.label.slice(0, 40) + '…' : imp.label}</span>
            <span style={{ fontWeight: 700 }}>{imp.entry.value.toFixed(2)}</span>
            <span style={{ color: deltaColor, fontWeight: 600 }}>
              {imp.entry.delta > 0 ? '+' : ''}{imp.entry.delta.toFixed(2)}
            </span>
            {imp.entry.attack_claim && (
              <span style={{ color: 'var(--text-muted)', fontSize: 'var(--text-2xs)' }} title={imp.entry.attack_claim}>
                ← {imp.entry.attack_claim.length > 50 ? imp.entry.attack_claim.slice(0, 50) + '…' : imp.entry.attack_claim}
              </span>
            )}
            {imp.entry.robustness != null && imp.entry.robustness >= 2 && (
              <span style={{ fontSize: 'var(--text-2xs)', padding: '0 4px', borderRadius: 3, background: 'color-mix(in srgb, var(--success) 15%, transparent)', color: 'var(--success)', fontWeight: 600 }}>
                {imp.entry.robustness}× confirmed
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
