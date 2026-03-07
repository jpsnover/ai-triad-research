// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useStore } from '../store/useStore';
import type { Pov, EdgeType, EdgeStatus } from '../types/types';

const POVS: { value: Pov | ''; label: string }[] = [
  { value: '', label: 'All POVs' },
  { value: 'accelerationist', label: 'Accelerationist' },
  { value: 'safetyist', label: 'Safetyist' },
  { value: 'skeptic', label: 'Skeptic' },
  { value: 'cross-cutting', label: 'Cross-cutting' },
];

const EDGE_TYPES: { value: EdgeType | ''; label: string }[] = [
  { value: '', label: 'All Types' },
  { value: 'SUPPORTS', label: 'Supports' },
  { value: 'CONTRADICTS', label: 'Contradicts' },
  { value: 'ASSUMES', label: 'Assumes' },
  { value: 'WEAKENS', label: 'Weakens' },
  { value: 'RESPONDS_TO', label: 'Responds To' },
  { value: 'TENSION_WITH', label: 'Tension With' },
  { value: 'CITES', label: 'Cites' },
  { value: 'INTERPRETS', label: 'Interprets' },
  { value: 'SUPPORTED_BY', label: 'Supported By' },
];

const STATUSES: { value: EdgeStatus | ''; label: string }[] = [
  { value: '', label: 'All Statuses' },
  { value: 'proposed', label: 'Proposed' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
];

export default function FilterBar() {
  const filters = useStore((s) => s.filters);
  const setFilter = useStore((s) => s.setFilter);
  const resetFilters = useStore((s) => s.resetFilters);
  const filteredEdges = useStore((s) => s.filteredEdges);
  const bulkUpdateVisible = useStore((s) => s.bulkUpdateVisible);

  return (
    <div className="filter-bar">
      <div className="filter-row">
        <select
          value={filters.sourcePov}
          onChange={(e) => setFilter('sourcePov', e.target.value)}
          className="filter-select"
          title="Source POV"
        >
          {POVS.map((p) => (
            <option key={`src-${p.value}`} value={p.value}>
              Source: {p.label}
            </option>
          ))}
        </select>

        <select
          value={filters.targetPov}
          onChange={(e) => setFilter('targetPov', e.target.value)}
          className="filter-select"
          title="Target POV"
        >
          {POVS.map((p) => (
            <option key={`tgt-${p.value}`} value={p.value}>
              Target: {p.label}
            </option>
          ))}
        </select>

        <select
          value={filters.edgeType}
          onChange={(e) => setFilter('edgeType', e.target.value)}
          className="filter-select"
          title="Edge Type"
        >
          {EDGE_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>

        <select
          value={filters.status}
          onChange={(e) => setFilter('status', e.target.value)}
          className="filter-select"
          title="Status"
        >
          {STATUSES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>

        <div className="filter-confidence">
          <label>Min confidence:</label>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={filters.minConfidence}
            onChange={(e) => setFilter('minConfidence', parseFloat(e.target.value))}
          />
          <span className="confidence-value">{filters.minConfidence.toFixed(2)}</span>
        </div>

        <label className="filter-checkbox">
          <input
            type="checkbox"
            checked={filters.crossPovOnly}
            onChange={(e) => setFilter('crossPovOnly', e.target.checked)}
          />
          Cross-POV only
        </label>
      </div>

      <div className="filter-row">
        <input
          type="text"
          className="filter-search"
          placeholder="Search nodes, rationale, type..."
          value={filters.searchText}
          onChange={(e) => setFilter('searchText', e.target.value)}
        />

        <button className="filter-btn reset" onClick={resetFilters}>
          Reset Filters
        </button>

        <span className="filter-count">{filteredEdges.length} edges shown</span>

        <div className="bulk-actions">
          <button
            className="filter-btn approve"
            onClick={() => bulkUpdateVisible('approved')}
            title={`Approve all ${filteredEdges.length} visible edges`}
          >
            Approve Visible ({filteredEdges.length})
          </button>
          <button
            className="filter-btn reject"
            onClick={() => bulkUpdateVisible('rejected')}
            title={`Reject all ${filteredEdges.length} visible edges`}
          >
            Reject Visible ({filteredEdges.length})
          </button>
        </div>
      </div>
    </div>
  );
}
