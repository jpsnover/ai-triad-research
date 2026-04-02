// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Full-graph edge browser — migrated from the standalone edge-viewer app.
 * Shown as a toolbar panel in the taxonomy editor.
 */

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useTaxonomyStore } from '../hooks/useTaxonomyStore';
import type { Edge, EdgeType, EdgeStatus } from '../types/taxonomy';

// ── Types ────────────────────────────────────────────────

interface IndexedEdge extends Edge {
  index: number;
  sourcePov: string;
  targetPov: string;
  sourceLabel: string;
  targetLabel: string;
}

interface FilterState {
  sourcePov: string;
  targetPov: string;
  edgeType: string;
  status: string;
  minConfidence: number;
  searchText: string;
  crossPovOnly: boolean;
}

const DEFAULT_FILTERS: FilterState = {
  sourcePov: '',
  targetPov: '',
  edgeType: '',
  status: '',
  minConfidence: 0,
  searchText: '',
  crossPovOnly: false,
};

// ── Filter options ───────────────────────────────────────

const POVS = [
  { value: '', label: 'All POVs' },
  { value: 'accelerationist', label: 'Accelerationist' },
  { value: 'safetyist', label: 'Safetyist' },
  { value: 'skeptic', label: 'Skeptic' },
  { value: 'situations', label: 'Situations' },
];

const EDGE_TYPES = [
  { value: '', label: 'All Types' },
  { value: 'SUPPORTS', label: 'Supports' },
  { value: 'CONTRADICTS', label: 'Contradicts' },
  { value: 'ASSUMES', label: 'Assumes' },
  { value: 'WEAKENS', label: 'Weakens' },
  { value: 'RESPONDS_TO', label: 'Responds To' },
  { value: 'TENSION_WITH', label: 'Tension With' },
  { value: 'INTERPRETS', label: 'Interprets' },
  // Legacy types — kept for backward compat with pre-Phase-5 data
  { value: 'CITES', label: 'Cites (legacy)' },
  { value: 'SUPPORTED_BY', label: 'Supported By (legacy)' },
  { value: '_OTHER', label: 'Other (non-canonical)' },
];

const STATUSES = [
  { value: '', label: 'All Statuses' },
  { value: 'proposed', label: 'Proposed' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
];

// ── Helpers ──────────────────────────────────────────────

function povForId(id: string): string {
  if (id.startsWith('acc-')) return 'accelerationist';
  if (id.startsWith('saf-')) return 'safetyist';
  if (id.startsWith('skp-')) return 'skeptic';
  if (id.startsWith('cc-')) return 'situations';
  if (id.startsWith('pol-')) return 'policy';
  return 'unknown';
}

const POV_COLOR: Record<string, string> = {
  accelerationist: 'var(--color-acc)',
  safetyist: 'var(--color-saf)',
  skeptic: 'var(--color-skp)',
  'situations': 'var(--color-sit)',
  policy: 'var(--color-sit)',
};

function applyFilters(edges: IndexedEdge[], f: FilterState): IndexedEdge[] {
  return edges.filter((e) => {
    if (f.sourcePov && e.sourcePov !== f.sourcePov) return false;
    if (f.targetPov && e.targetPov !== f.targetPov) return false;
    if (f.edgeType) {
      if (f.edgeType === '_OTHER') {
        const canonical = new Set(['SUPPORTS','CONTRADICTS','ASSUMES','WEAKENS','RESPONDS_TO','TENSION_WITH','INTERPRETS']);
        if (canonical.has(e.type)) return false;
      } else if (e.type !== f.edgeType) return false;
    }
    if (f.status && e.status !== f.status) return false;
    if (e.confidence < f.minConfidence) return false;
    if (f.crossPovOnly && e.sourcePov === e.targetPov) return false;
    if (f.searchText) {
      const q = f.searchText.toLowerCase();
      const hay = [e.source, e.target, e.sourceLabel, e.targetLabel, e.rationale, e.type, e.notes || ''].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

// ── Main component ───────────────────────────────────────

export function EdgeBrowser() {
  const { edgesFile, loadEdges, edgesLoading, getLabelForId } = useTaxonomyStore();
  const [filters, setFilters] = useState<FilterState>({ ...DEFAULT_FILTERS });
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [splitPct, setSplitPct] = useState(45);
  const splitRef = useRef<HTMLDivElement>(null);

  // Load edges on mount
  useEffect(() => {
    if (!edgesFile && !edgesLoading) loadEdges();
  }, [edgesFile, edgesLoading, loadEdges]);

  // Build indexed edges
  const indexedEdges = useMemo<IndexedEdge[]>(() => {
    if (!edgesFile) return [];
    return edgesFile.edges.map((e: Edge, i: number) => ({
      ...e,
      index: i,
      sourcePov: povForId(e.source),
      targetPov: povForId(e.target),
      sourceLabel: getLabelForId(e.source) || e.source,
      targetLabel: getLabelForId(e.target) || e.target,
    }));
  }, [edgesFile, getLabelForId]);

  const filteredEdges = useMemo(() => applyFilters(indexedEdges, filters), [indexedEdges, filters]);

  const selectedEdge = selectedIdx !== null ? indexedEdges[selectedIdx] : null;

  const setFilter = useCallback((key: keyof FilterState, value: string | number | boolean) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }, []);

  const resetFilters = useCallback(() => setFilters({ ...DEFAULT_FILTERS }), []);

  const handleBulkUpdate = useCallback(async (status: EdgeStatus) => {
    const indices = filteredEdges.map((e) => e.index);
    if (indices.length === 0) return;
    try {
      await (window.electronAPI as any).bulkUpdateEdges(indices, status);
      loadEdges(); // Reload to pick up changes
    } catch (err) {
      console.error('Bulk update failed:', err);
    }
  }, [filteredEdges, loadEdges]);

  const handleStatusUpdate = useCallback(async (index: number, status: EdgeStatus) => {
    try {
      await (window.electronAPI as any).updateEdgeStatus(index, status);
      loadEdges();
    } catch (err) {
      console.error('Status update failed:', err);
    }
  }, [loadEdges]);

  // Stats
  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const e of filteredEdges) {
      counts[e.type] = (counts[e.type] || 0) + 1;
    }
    return counts;
  }, [filteredEdges]);

  // Resize handler
  const handleSplitMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const container = splitRef.current;
    if (!container) return;
    const startX = e.clientX;
    const startPct = splitPct;
    const w = container.offsetWidth;
    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startX;
      setSplitPct(Math.min(70, Math.max(25, startPct + (dx / w) * 100)));
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [splitPct]);

  // Prev/Next navigation
  const currentFilteredIdx = selectedEdge ? filteredEdges.findIndex(e => e.index === selectedEdge.index) : -1;
  const goPrev = () => {
    if (currentFilteredIdx > 0) setSelectedIdx(filteredEdges[currentFilteredIdx - 1].index);
  };
  const goNext = () => {
    if (currentFilteredIdx < filteredEdges.length - 1) setSelectedIdx(filteredEdges[currentFilteredIdx + 1].index);
  };

  if (edgesLoading) return <div className="eb-loading">Loading edges...</div>;
  if (!edgesFile) return <div className="eb-loading">No edges data found</div>;

  return (
    <div className="eb-container">
      {/* Filter bar */}
      <div className="eb-filters">
        <div className="eb-filter-row">
          <select className="eb-select" value={filters.sourcePov} onChange={(e) => setFilter('sourcePov', e.target.value)}>
            {POVS.map((p) => <option key={`s-${p.value}`} value={p.value}>Src: {p.label}</option>)}
          </select>
          <select className="eb-select" value={filters.targetPov} onChange={(e) => setFilter('targetPov', e.target.value)}>
            {POVS.map((p) => <option key={`t-${p.value}`} value={p.value}>Tgt: {p.label}</option>)}
          </select>
          <select className="eb-select" value={filters.edgeType} onChange={(e) => setFilter('edgeType', e.target.value)}>
            {EDGE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          <select className="eb-select" value={filters.status} onChange={(e) => setFilter('status', e.target.value)}>
            {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <label className="eb-checkbox">
            <input type="checkbox" checked={filters.crossPovOnly} onChange={(e) => setFilter('crossPovOnly', e.target.checked)} />
            Cross-POV
          </label>
        </div>
        <div className="eb-filter-row">
          <input
            className="eb-search"
            type="text"
            placeholder="Search nodes, rationale, type..."
            value={filters.searchText}
            onChange={(e) => setFilter('searchText', e.target.value)}
          />
          <div className="eb-confidence">
            <span>Conf &ge; {filters.minConfidence.toFixed(2)}</span>
            <input type="range" min="0" max="1" step="0.05" value={filters.minConfidence} onChange={(e) => setFilter('minConfidence', parseFloat(e.target.value))} />
          </div>
          <button className="btn btn-sm" onClick={resetFilters}>Reset</button>
          <span className="eb-count">{filteredEdges.length} / {indexedEdges.length}</span>
          <button className="btn btn-sm eb-bulk-approve" onClick={() => handleBulkUpdate('approved')}>Approve ({filteredEdges.length})</button>
          <button className="btn btn-sm eb-bulk-reject" onClick={() => handleBulkUpdate('rejected')}>Reject ({filteredEdges.length})</button>
        </div>
      </div>

      {/* Stats bar */}
      <div className="eb-stats">
        {Object.entries(typeCounts).sort((a, b) => b[1] - a[1]).map(([type, count]) => (
          <button
            key={type}
            className={`eb-stat-chip${filters.edgeType === type ? ' eb-stat-chip-active' : ''}`}
            onClick={() => setFilter('edgeType', filters.edgeType === type ? '' : type)}
          >
            {type.replace('_', ' ')} <span className="eb-stat-count">{count}</span>
          </button>
        ))}
      </div>

      {/* Split pane: list + detail */}
      <div className="eb-split" ref={splitRef}>
        <div className="eb-list" style={{ width: `${splitPct}%` }}>
          {filteredEdges.length === 0 && <div className="eb-empty">No edges match filters</div>}
          {filteredEdges.map((edge) => (
            <div
              key={edge.index}
              className={`eb-row${edge.index === selectedIdx ? ' eb-row-selected' : ''}`}
              onClick={() => setSelectedIdx(edge.index)}
            >
              <div className="eb-row-main">
                <span className="eb-row-source" style={{ color: POV_COLOR[edge.sourcePov] }}>{edge.sourceLabel}</span>
                <span className="eb-row-type">{edge.type.replace('_', ' ')}</span>
                <span className="eb-row-target" style={{ color: POV_COLOR[edge.targetPov] }}>{edge.targetLabel}</span>
              </div>
              <div className="eb-row-sub">
                <span className="eb-row-ids">{edge.source} → {edge.target}</span>
                <span className="eb-row-conf">{Math.round(edge.confidence * 100)}%</span>
                {edge.status !== 'approved' && <span className={`eb-row-status status-${edge.status}`}>{edge.status}</span>}
                {edge.status === 'proposed' && (
                  <span className="eb-row-actions">
                    <button className="eb-row-btn eb-approve" onClick={(e) => { e.stopPropagation(); handleStatusUpdate(edge.index, 'approved'); }} title="Approve">&#10003;</button>
                    <button className="eb-row-btn eb-reject" onClick={(e) => { e.stopPropagation(); handleStatusUpdate(edge.index, 'rejected'); }} title="Reject">&#10007;</button>
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="resize-handle" onMouseDown={handleSplitMouseDown} />

        <div className="eb-detail">
          {selectedEdge ? (
            <>
              <div className="eb-detail-nav">
                <button className="btn btn-sm" disabled={currentFilteredIdx <= 0} onClick={goPrev}>&larr; Prev</button>
                <span className="eb-detail-pos">{currentFilteredIdx + 1} / {filteredEdges.length}</span>
                <button className="btn btn-sm" disabled={currentFilteredIdx >= filteredEdges.length - 1} onClick={goNext}>Next &rarr;</button>
              </div>

              <div className="eb-detail-type">{selectedEdge.type.replace('_', ' ')}{selectedEdge.bidirectional ? ' ↔' : ''}</div>

              <div className="eb-detail-endpoints">
                <div className="eb-detail-ep">
                  <div className="eb-detail-ep-role">Source</div>
                  <div className="eb-detail-ep-label" style={{ color: POV_COLOR[selectedEdge.sourcePov] }}>{selectedEdge.sourceLabel}</div>
                  <div className="eb-detail-ep-id">{selectedEdge.source}</div>
                </div>
                <div className="eb-detail-arrow">{selectedEdge.bidirectional ? '↔' : '→'}</div>
                <div className="eb-detail-ep">
                  <div className="eb-detail-ep-role">Target</div>
                  <div className="eb-detail-ep-label" style={{ color: POV_COLOR[selectedEdge.targetPov] }}>{selectedEdge.targetLabel}</div>
                  <div className="eb-detail-ep-id">{selectedEdge.target}</div>
                </div>
              </div>

              <div className="eb-detail-section">
                <div className="eb-detail-section-label">Rationale</div>
                <div className="eb-detail-rationale">{selectedEdge.rationale}</div>
              </div>

              <div className="eb-detail-meta">
                <span>Confidence: {Math.round(selectedEdge.confidence * 100)}%</span>
                {selectedEdge.strength && <span>Strength: {selectedEdge.strength}</span>}
              </div>

              {selectedEdge.notes && (
                <div className="eb-detail-section">
                  <div className="eb-detail-section-label">Notes</div>
                  <div className="eb-detail-notes">{selectedEdge.notes}</div>
                </div>
              )}

              <div className="eb-detail-actions">
                <button className={`btn btn-sm${selectedEdge.status === 'approved' ? ' btn-primary' : ''}`} onClick={() => handleStatusUpdate(selectedEdge.index, 'approved')}>Approve</button>
                <button className={`btn btn-sm${selectedEdge.status === 'rejected' ? ' btn-danger' : ''}`} onClick={() => handleStatusUpdate(selectedEdge.index, 'rejected')}>Reject</button>
                <button className="btn btn-sm" onClick={() => handleStatusUpdate(selectedEdge.index, 'proposed')}>Reset</button>
              </div>
            </>
          ) : (
            <div className="eb-empty">Select an edge to view details</div>
          )}
        </div>
      </div>
    </div>
  );
}
