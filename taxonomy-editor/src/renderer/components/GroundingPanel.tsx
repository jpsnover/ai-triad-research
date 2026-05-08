// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useMemo, useEffect } from 'react';
import { api } from '@bridge';
import { POVER_INFO } from '../types/debate';
import type { SpeakerId, DebateSession } from '../types/debate';

function speakerLabel(speaker: string): string {
  if (speaker === 'system') return 'Moderator';
  if (speaker === 'user') return 'You';
  if (speaker === 'document') return 'Document';
  if (speaker === 'moderator') return 'Moderator';
  return POVER_INFO[speaker as Exclude<SpeakerId, 'user'>]?.label || speaker;
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
      const files = await Promise.all([
        api.loadTaxonomyFile('accelerationist').catch(() => null),
        api.loadTaxonomyFile('safetyist').catch(() => null),
        api.loadTaxonomyFile('skeptic').catch(() => null),
        api.loadTaxonomyFile('situations').catch(() => null),
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

  type RefDetail = { entryId: string; stmtId: string; speaker: string; relevance: string };
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

  if (rows.length === 0) {
    return <div style={{ color: 'var(--text-secondary)', padding: 16 }}>No taxonomy references found in this debate.</div>;
  }

  const sortArrow = (col: typeof sortCol) => sortCol === col ? (sortAsc ? ' ▲' : ' ▼') : '';
  const statementsWithRefs = debate.transcript.filter(e => e.taxonomy_refs?.length > 0).length;

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: 8 }}>
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
            </tr>
          </thead>
          <tbody>
            {filtered.map(row => (
              <tr
                key={row.id}
                className={`grounding-row ${selectedNodeId === row.id ? 'grounding-row-selected' : ''}`}
                onClick={() => setSelectedNodeId(selectedNodeId === row.id ? null : row.id)}
              >
                <td className="grounding-cell-count">{row.count}</td>
                <td className="grounding-cell-id">{row.id}</td>
                <td className="grounding-cell-label">{row.label}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {selectedNodeId && selectedDetails.length > 0 && (
        <div className="grounding-detail">
          <div className="grounding-detail-header">
            <span className="grounding-detail-id">{selectedNodeId}</span>
            <span className="grounding-detail-label">{labelMap.get(selectedNodeId) ?? selectedNodeId}</span>
            <span className="grounding-detail-count">{selectedDetails.length} reference{selectedDetails.length !== 1 ? 's' : ''}</span>
          </div>
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
                  <td className="grounding-detail-relevance">{d.relevance || <span style={{ color: 'var(--text-muted)' }}>(none)</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
