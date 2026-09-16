// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useMemo, useEffect } from 'react';
import { api } from '@bridge';
import { getGlobalRecorder } from '@lib/flight-recorder/index';
import { POVER_INFO, AI_POVERS } from '../../types/debate';
import type { SpeakerId, DebateSession } from '../../types/debate';
import './GroundingPanel.css';

function speakerLabel(speaker: string): string {
  if (speaker === 'system') return 'Moderator';
  if (speaker === 'user') return 'You';
  if (speaker === 'document') return 'Document';
  if (speaker === 'moderator') return 'Moderator';
  return POVER_INFO[speaker as Exclude<SpeakerId, 'user'>]?.label || speaker;
}

const POV_SPEAKER_SET = new Set<string>(AI_POVERS);

type RefDetail = { entryId: string; stmtId: string; speaker: string; speakerId: string; relevance: string };

type TestingLevel = 'contested' | 'well-tested' | 'cited';

type TestingInfo = { level: TestingLevel; reason: string };

const TESTING_BADGE_LABEL: Record<TestingLevel, string> = {
  contested: 'Contested',
  'well-tested': 'Well-tested',
  cited: 'Cited',
};

// Classify each referenced node's depth of debate testing.
// - Contested: a claim citing this node was attacked (argument network) by a claim from a
//   different speaker — the strongest available signal of a live disagreement over the node.
// - Well-tested: cited by 2+ distinct POV debaters with no recorded rebuttal (cross-speaker
//   corroboration, uncontested).
// - Cited: referenced, but only by a single speaker (no corroboration or challenge).
function computeTestingLevels(
  detailMap: Map<string, RefDetail[]>,
  argumentNetwork: DebateSession['argument_network'] | undefined,
): Map<string, TestingInfo> {
  const anNodeSpeaker = new Map<string, string>();
  const nodeToAnNodeIds = new Map<string, Set<string>>();
  if (argumentNetwork) {
    for (const n of argumentNetwork.nodes) {
      anNodeSpeaker.set(n.id, n.speaker);
      for (const ref of n.taxonomy_refs ?? []) {
        if (!nodeToAnNodeIds.has(ref)) nodeToAnNodeIds.set(ref, new Set());
        nodeToAnNodeIds.get(ref)!.add(n.id);
      }
    }
  }

  const result = new Map<string, TestingInfo>();
  for (const [nodeId, refs] of detailMap) {
    const povSpeakers = new Set(refs.map(r => r.speakerId).filter(s => POV_SPEAKER_SET.has(s)));

    let contestedBy: string | null = null;
    const anIds = nodeToAnNodeIds.get(nodeId);
    if (anIds && argumentNetwork) {
      for (const edge of argumentNetwork.edges) {
        if (edge.type !== 'attacks') continue;
        const sourceIn = anIds.has(edge.source);
        const targetIn = anIds.has(edge.target);
        if (!sourceIn && !targetIn) continue;
        const otherId = sourceIn ? edge.target : edge.source;
        const ownId = sourceIn ? edge.source : edge.target;
        const otherSpeaker = anNodeSpeaker.get(otherId);
        const ownSpeaker = anNodeSpeaker.get(ownId);
        if (otherSpeaker && otherSpeaker !== ownSpeaker) {
          contestedBy = otherSpeaker;
          break;
        }
      }
    }

    if (contestedBy) {
      result.set(nodeId, {
        level: 'contested',
        reason: `A claim grounded in this node was attacked in the argument network by ${speakerLabel(contestedBy)}.`,
      });
    } else if (povSpeakers.size >= 2) {
      result.set(nodeId, {
        level: 'well-tested',
        reason: `Cited by ${povSpeakers.size} distinct POV debaters (${[...povSpeakers].map(speakerLabel).join(', ')}) with no recorded rebuttal.`,
      });
    } else {
      result.set(nodeId, {
        level: 'cited',
        reason: refs.length > 1
          ? 'Cited multiple times, but only by a single speaker — no corroboration or challenge.'
          : 'Cited once, with no corroboration or challenge.',
      });
    }
  }
  return result;
}

type LineageEffectiveness = {
  boosted: number;
  promoted: number;
  promotedReferenced: number;
  promotedRefRate: number;
  baselineRefRate: number;
};

type LineageManifest = {
  lineage_boost?: { boostedNodeIds?: string[]; promotedNodeIds?: string[] };
  povNodeIds?: string[];
};

type LineageSets = {
  boosted: Set<string>;
  promoted: Set<string>;
  injected: Set<string>;
  referenced: Set<string>;
};

// Fold one transcript entry's injection manifest into the accumulating lineage sets.
function accumulateLineageEntry(entry: DebateSession['transcript'][number], sets: LineageSets): void {
  if (entry.type !== 'opening' && entry.type !== 'statement') return;
  const manifest = (entry.metadata as Record<string, unknown>)?.injection_manifest as LineageManifest | undefined;
  if (!manifest) return;

  for (const id of (entry.taxonomy_refs ?? []).map((r: { node_id: string }) => r.node_id)) sets.referenced.add(id);
  for (const id of manifest.povNodeIds ?? []) sets.injected.add(id);

  const lb = manifest.lineage_boost;
  if (lb) {
    for (const id of lb.boostedNodeIds ?? []) sets.boosted.add(id);
    for (const id of lb.promotedNodeIds ?? []) sets.promoted.add(id);
  }
}

// Compute lineage effectiveness from injection manifests (same logic as calibrationLogger)
function computeLineageEffectiveness(transcript: DebateSession['transcript']): LineageEffectiveness | null {
  const sets: LineageSets = {
    boosted: new Set<string>(),
    promoted: new Set<string>(),
    injected: new Set<string>(),
    referenced: new Set<string>(),
  };

  for (const entry of transcript) accumulateLineageEntry(entry, sets);

  if (sets.boosted.size === 0) return null;

  const promotedReferenced = [...sets.promoted].filter(id => sets.referenced.has(id)).length;
  const promotedRefRate = sets.promoted.size > 0 ? promotedReferenced / sets.promoted.size : 0;
  const baselineRefRate = sets.injected.size > 0 ? sets.referenced.size / sets.injected.size : 0;

  return {
    boosted: sets.boosted.size,
    promoted: sets.promoted.size,
    promotedReferenced,
    promotedRefRate,
    baselineRefRate,
  };
}

export function GroundingPanel({ debate }: { debate: DebateSession }) {
  const [sortCol, setSortCol] = useState<'count' | 'id' | 'label'>('count');
  const [sortAsc, setSortAsc] = useState(false);
  const [filter, setFilter] = useState('');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  const [labelMap, setLabelMap] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const loadWithRecorder = (name: string) => api.loadTaxonomyFile(name).catch((err) => {
        getGlobalRecorder()?.record({ type: 'system.error', component: 'groundingPanel', level: 'warn', message: `Failed to load taxonomy file: ${name}`, error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
        return null;
      });
      const files = await Promise.all([
        loadWithRecorder('accelerationist'),
        loadWithRecorder('safetyist'),
        loadWithRecorder('skeptic'),
        loadWithRecorder('situations'),
      ]);
      if (cancelled) return;
      const m = new Map<string, string>();
      for (const f of files) {
        const nodes = (f as { nodes?: { id: string; label: string }[] } | null)?.nodes;
        if (!Array.isArray(nodes)) continue;
        for (const n of nodes) {
          if (n.id && n.label) m.set(n.id, n.label);
        }
      }
      setLabelMap(m);
    })();
    return () => { cancelled = true; };
  }, []);

  const entryIndexMap = useMemo(() => {
    const m = new Map<string, number>();
    for (let i = 0; i < debate.transcript.length; i++) {
      m.set(debate.transcript[i].id, i + 1);
    }
    return m;
  }, [debate.transcript]);

  const { rows, detailMap } = useMemo(() => {
    const counts = new Map<string, number>();
    const details = new Map<string, RefDetail[]>();

    for (const entry of debate.transcript) {
      if (!entry.taxonomy_refs || entry.taxonomy_refs.length === 0) continue;
      const idx = entryIndexMap.get(entry.id) ?? 0;
      for (const ref of entry.taxonomy_refs) {
        const nid = ref.node_id;
        counts.set(nid, (counts.get(nid) ?? 0) + 1);
        if (!details.has(nid)) details.set(nid, []);
        details.get(nid)!.push({
          entryId: entry.id,
          stmtId: `S${idx}`,
          speaker: speakerLabel(entry.speaker),
          speakerId: entry.speaker,
          relevance: ref.relevance ?? '',
        });
      }
    }

    const r = Array.from(counts.entries()).map(([id, count]) => ({
      id,
      label: labelMap.get(id) ?? id,
      count,
    }));

    return { rows: r, detailMap: details };
  }, [debate.transcript, labelMap, entryIndexMap]);

  const testingLevels = useMemo(
    () => computeTestingLevels(detailMap, debate.argument_network),
    [detailMap, debate.argument_network],
  );

  const filtered = useMemo(() => {
    let result = rows;
    if (filter) {
      const q = filter.toLowerCase();
      result = result.filter(r => r.id.toLowerCase().includes(q) || r.label.toLowerCase().includes(q));
    }
    result.sort((a, b) => {
      let cmp = 0;
      if (sortCol === 'count') cmp = a.count - b.count;
      else if (sortCol === 'id') cmp = a.id.localeCompare(b.id);
      else cmp = a.label.localeCompare(b.label);
      return sortAsc ? cmp : -cmp;
    });
    return result;
  }, [rows, filter, sortCol, sortAsc]);

  const handleSort = (col: typeof sortCol) => {
    if (sortCol === col) setSortAsc(!sortAsc);
    else { setSortCol(col); setSortAsc(col !== 'count'); }
  };

  const selectedDetails = selectedNodeId ? detailMap.get(selectedNodeId) ?? [] : [];
  const selectedTesting = selectedNodeId ? testingLevels.get(selectedNodeId) : undefined;

  // Hook must precede the `if (rows.length === 0)` early return (rules-of-hooks, t/2299).
  // Compute lineage effectiveness from injection manifests (same logic as calibrationLogger).
  const lineageEffectiveness = useMemo(
    () => computeLineageEffectiveness(debate.transcript),
    [debate.transcript],
  );

  if (rows.length === 0) {
    return <div className="grounding-empty">No taxonomy references found in this debate.</div>;
  }

  const sortArrow = (col: typeof sortCol) => sortCol === col ? (sortAsc ? ' ▲' : ' ▼') : '';
  const statementsWithRefs = debate.transcript.filter(e => e.taxonomy_refs?.length > 0).length;

  return (
    <div className="grounding-root">
      {lineageEffectiveness && (
        <div className="grounding-lineage-box">
          <div className="grounding-lineage-title">Lineage Boost Effectiveness</div>
          <div>
            Lineage boost promoted <strong>{lineageEffectiveness.promoted}</strong> node{lineageEffectiveness.promoted !== 1 ? 's' : ''};{' '}
            <strong className="grounding-lineage-cited">{lineageEffectiveness.promotedReferenced}</strong> cited ({(lineageEffectiveness.promotedRefRate * 100).toFixed(0)}%)
            {' vs. '}<strong>{(lineageEffectiveness.baselineRefRate * 100).toFixed(0)}%</strong> baseline reference rate
          </div>
          <div className="grounding-lineage-note">
            {lineageEffectiveness.promotedRefRate > lineageEffectiveness.baselineRefRate
              ? `Promoted nodes cited ${(lineageEffectiveness.promotedRefRate / Math.max(lineageEffectiveness.baselineRefRate, 0.001)).toFixed(1)}× more than baseline — boost is effective`
              : lineageEffectiveness.promotedRefRate === lineageEffectiveness.baselineRefRate
                ? 'Promoted node citation rate matches baseline'
                : 'Promoted nodes cited less than baseline — boost had limited effect'}
          </div>
        </div>
      )}
      <div className="grounding-summary">
        {rows.length} taxonomy nodes referenced across {statementsWithRefs} statement{statementsWithRefs !== 1 ? 's' : ''}
      </div>
      <input
        type="text"
        placeholder="Filter by node ID or label..."
        value={filter}
        onChange={e => setFilter(e.target.value)}
        className="grounding-filter"
      />
      <div className="grounding-table-wrap">
        <table className="grounding-table">
          <thead>
            <tr>
              <th onClick={() => handleSort('count')} className="grounding-th-sortable grounding-th-count">Count{sortArrow('count')}</th>
              <th onClick={() => handleSort('id')} className="grounding-th-sortable">ID{sortArrow('id')}</th>
              <th onClick={() => handleSort('label')} className="grounding-th-sortable">Label{sortArrow('label')}</th>
              <th className="grounding-th-testing">Testing</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(row => {
              const testing = testingLevels.get(row.id);
              return (
                <tr
                  key={row.id}
                  className={`grounding-row ${selectedNodeId === row.id ? 'grounding-row-selected' : ''}`}
                  onClick={() => setSelectedNodeId(selectedNodeId === row.id ? null : row.id)}
                >
                  <td className="grounding-cell-count">{row.count}</td>
                  <td className="grounding-cell-id">{row.id}</td>
                  <td className="grounding-cell-label">{row.label}</td>
                  <td className="grounding-cell-testing">
                    {testing && (
                      <span className={`grounding-testing-badge grounding-testing-${testing.level}`} title={testing.reason}>
                        {TESTING_BADGE_LABEL[testing.level]}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {selectedNodeId && selectedDetails.length > 0 && (
        <div className="grounding-detail">
          <div className="grounding-detail-header">
            <span className="grounding-detail-id">{selectedNodeId}</span>
            <span className="grounding-detail-label">{labelMap.get(selectedNodeId) ?? selectedNodeId}</span>
            {selectedTesting && (
              <span className={`grounding-testing-badge grounding-testing-${selectedTesting.level}`} title={selectedTesting.reason}>
                {TESTING_BADGE_LABEL[selectedTesting.level]}
              </span>
            )}
            <span className="grounding-detail-count">{selectedDetails.length} reference{selectedDetails.length !== 1 ? 's' : ''}</span>
          </div>
          {selectedTesting && (
            <div className="grounding-testing-reason">{selectedTesting.reason}</div>
          )}
          <table className="grounding-detail-table">
            <thead>
              <tr>
                <th>Statement</th>
                <th>Speaker</th>
                <th>Reasoning</th>
              </tr>
            </thead>
            <tbody>
              {selectedDetails.map((d, i) => (
                <tr key={i}>
                  <td className="grounding-detail-entry">{d.stmtId}</td>
                  <td className="grounding-detail-speaker">{d.speaker}</td>
                  <td className="grounding-detail-relevance">{d.relevance || <span className="grounding-none">(none)</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
