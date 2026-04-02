// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useStore } from '../store/useStore';
import SettingsDialog from './SettingsDialog';
import type { GraphAttributes } from '../types/types';
import { nodePovFromId } from '@lib/debate';

type SortKey = 'match' | 'id' | 'label' | 'description';
type SortDir = 'asc' | 'desc';

interface ResolvedRow {
  id: string;
  score: number;
  label: string;
  description: string;
  category: string;
  graph_attributes?: GraphAttributes;
}

export default function SimilarResultsPane() {
  const similarQuery = useStore(s => s.similarQuery);
  const similarResults = useStore(s => s.similarResults);
  const similarLoading = useStore(s => s.similarLoading);
  const similarError = useStore(s => s.similarError);
  const similarThreshold = useStore(s => s.similarThreshold);
  const setSimilarThreshold = useStore(s => s.setSimilarThreshold);
  const clearSimilarSearch = useStore(s => s.clearSimilarSearch);
  const runSimilarSearch = useStore(s => s.runSimilarSearch);
  const taxonomy = useStore(s => s.taxonomy);

  const [showSettings, setShowSettings] = useState(false);
  const [showIds, setShowIds] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('match');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Reset selection when a new search starts
  useEffect(() => { setSelectedId(null); }, [similarQuery]);

  // Column widths (resizable)
  const [colWidths, setColWidths] = useState({ match: 60, id: 150, label: 160 });
  const dragCol = useRef<'match' | 'id' | 'label' | null>(null);
  const dragStartX = useRef(0);
  const dragStartW = useRef(0);

  const onColResizeStart = useCallback((col: 'match' | 'id' | 'label', e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCol.current = col;
    dragStartX.current = e.clientX;
    dragStartW.current = colWidths[col];
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMove = (ev: MouseEvent) => {
      if (!dragCol.current) return;
      const delta = ev.clientX - dragStartX.current;
      const newW = Math.max(40, dragStartW.current + delta);
      setColWidths(prev => ({ ...prev, [dragCol.current!]: newW }));
    };

    const onUp = () => {
      dragCol.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [colWidths]);

  // Resizable vertical split between list and detail
  const splitDrag = useRef<{ startY: number; startH: number } | null>(null);
  const [listHeight, setListHeight] = useState(() => {
    const saved = localStorage.getItem('similar-split-height');
    return saved ? Number(saved) : 200;
  });

  const listHeightRef = useRef(listHeight);
  listHeightRef.current = listHeight;

  const onSplitResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    splitDrag.current = { startY: e.clientY, startH: listHeightRef.current };
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';

    const onMove = (ev: MouseEvent) => {
      if (!splitDrag.current) return;
      const delta = ev.clientY - splitDrag.current.startY;
      const newH = Math.max(80, Math.min(600, splitDrag.current.startH + delta));
      setListHeight(newH);
    };

    const onUp = () => {
      localStorage.setItem('similar-split-height', String(listHeightRef.current));
      splitDrag.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, []);

  const resolvedRows = useMemo((): ResolvedRow[] => {
    if (!similarResults) return [];
    return similarResults.map(r => {
      const node = taxonomy[r.id];
      return {
        id: r.id,
        score: r.score,
        label: node?.label || r.id,
        description: node?.description || '',
        category: node?.category || '',
        graph_attributes: node?.graph_attributes,
      };
    });
  }, [similarResults, taxonomy]);

  const filteredAndSorted = useMemo(() => {
    const threshold = similarThreshold / 100;
    const filtered = resolvedRows.filter(r => r.score >= threshold);

    filtered.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'match':
          cmp = a.score - b.score;
          break;
        case 'id':
          cmp = a.id.localeCompare(b.id);
          break;
        case 'label':
          cmp = a.label.localeCompare(b.label);
          break;
        case 'description':
          cmp = a.description.localeCompare(b.description);
          break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });

    return filtered;
  }, [resolvedRows, similarThreshold, sortKey, sortDir]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir(key === 'match' ? 'desc' : 'asc');
    }
  };

  const sortIndicator = (key: SortKey) => {
    if (sortKey !== key) return '';
    return sortDir === 'asc' ? ' \u25B2' : ' \u25BC';
  };

  const colCount = showIds ? 4 : 3;

  const resizeHandle = (col: 'match' | 'id' | 'label') => (
    <span
      className="col-resize-handle"
      onMouseDown={(e) => onColResizeStart(col, e)}
    />
  );

  return (
    <>
      <div className="pane-header">
        <h2>Similar to: {similarQuery}</h2>
        <div className="similar-search-actions">
          <label className="similar-id-toggle">
            <input
              type="checkbox"
              checked={showIds}
              onChange={(e) => setShowIds(e.target.checked)}
            />
            IDs
          </label>
          <button className="btn btn-ghost btn-sm" onClick={clearSimilarSearch}>
            Close
          </button>
        </div>
      </div>
      <div className="pane-body similar-search-panel">
        {similarLoading && (
          <div className="similar-search-loading">
            <span className="search-spinner" /> Computing similarity...
          </div>
        )}

        {similarError && (
          <div className="search-error">
            {similarError}
            {similarError.includes('No API key') && (
              <button
                className="btn btn-ghost btn-sm"
                style={{ marginLeft: 8 }}
                onClick={() => setShowSettings(true)}
              >
                Configure API Key
              </button>
            )}
          </div>
        )}

        {showSettings && (
          <SettingsDialog onClose={() => setShowSettings(false)} />
        )}

        {similarResults !== null && !similarLoading && (
          <>
            <div className="similar-threshold-row">
              <label>Min Match:</label>
              <input
                type="range"
                min={40}
                max={100}
                value={similarThreshold}
                onChange={(e) => setSimilarThreshold(Number(e.target.value))}
              />
              <span className="similar-threshold-value">{similarThreshold}%</span>
              <span className="similar-count-badge">{filteredAndSorted.length}</span>
            </div>

            <div className="similar-split-container">
              {/* Top: results list */}
              <div className="similar-table-wrap" style={{ height: selectedId ? listHeight : undefined, flex: selectedId ? 'none' : 1 }}>
                <table className="similar-table">
                  <thead>
                    <tr>
                      <th
                        style={{ width: colWidths.match }}
                        className="similar-th-sortable"
                        onClick={() => handleSort('match')}
                      >
                        Match{sortIndicator('match')}
                        {resizeHandle('match')}
                      </th>
                      {showIds && (
                        <th
                          style={{ width: colWidths.id }}
                          className="similar-th-sortable"
                          onClick={() => handleSort('id')}
                        >
                          ID{sortIndicator('id')}
                          {resizeHandle('id')}
                        </th>
                      )}
                      <th
                        style={{ width: colWidths.label }}
                        className="similar-th-sortable"
                        onClick={() => handleSort('label')}
                      >
                        Label{sortIndicator('label')}
                        {resizeHandle('label')}
                      </th>
                      <th
                        className="similar-th-sortable"
                        onClick={() => handleSort('description')}
                      >
                        Description{sortIndicator('description')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredAndSorted.length === 0 ? (
                      <tr>
                        <td colSpan={colCount} className="similar-table-empty">
                          No results above {similarThreshold}% threshold
                        </td>
                      </tr>
                    ) : (
                      filteredAndSorted.map((r) => (
                        <tr
                          key={r.id}
                          className={`similar-table-row${selectedId === r.id ? ' selected' : ''}`}
                          onClick={() => setSelectedId(prev => prev === r.id ? null : r.id)}
                        >
                          <td className="similar-table-match">
                            {Math.round(r.score * 100)}%
                          </td>
                          {showIds && (
                            <td className="similar-table-id">{r.id}</td>
                          )}
                          <td className="similar-table-label">{r.label}</td>
                          <td className="similar-table-desc">{r.description}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {/* Resize handle between list and detail */}
              {selectedId && (
                <>
                  <div className="similar-split-handle" onMouseDown={onSplitResizeStart} />
                  <SimilarDetailPanel row={filteredAndSorted.find(r => r.id === selectedId) ?? null} />
                </>
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}

/** Detail panel showing the full info for a selected similar node */
function SimilarDetailPanel({ row }: { row: ResolvedRow | null }) {
  if (!row) return <div className="similar-detail-empty">Node not found</div>;

  const povDisplayFromId = (id: string): string => {
    const pov = nodePovFromId(id);
    if (pov === 'situations') return 'Cross-cutting';
    if (pov) return pov.charAt(0).toUpperCase() + pov.slice(1);
    return '';
  };

  const formatAttrValue = (val: string | string[] | undefined): string => {
    if (!val) return '';
    if (Array.isArray(val)) return val.map(v => v.replace(/_/g, ' ')).join(', ');
    return String(val).replace(/_/g, ' ');
  };

  const attrs = row.graph_attributes;

  return (
    <div className="similar-detail-panel">
      <div className="similar-detail-header">
        <span className="similar-detail-id">{row.id}</span>
        <span className="similar-detail-match">{Math.round(row.score * 100)}% match</span>
      </div>
      <div className="similar-detail-pov-cat">
        <span className={`pov-badge pov-${povDisplayFromId(row.id).toLowerCase()}`}>{povDisplayFromId(row.id)}</span>
        {row.category && <span className="similar-detail-category">{row.category}</span>}
      </div>
      <h3 className="similar-detail-label">{row.label}</h3>
      <p className="similar-detail-desc">{row.description}</p>

      {attrs && (
        <div className="similar-detail-attrs">
          {attrs.epistemic_type && (
            <div className="similar-detail-attr">
              <span className="similar-detail-attr-label">Epistemic Type</span>
              <span className="similar-detail-attr-value">{formatAttrValue(attrs.epistemic_type)}</span>
            </div>
          )}
          {attrs.rhetorical_strategy && (
            <div className="similar-detail-attr">
              <span className="similar-detail-attr-label">Rhetorical Strategy</span>
              <span className="similar-detail-attr-value">{formatAttrValue(attrs.rhetorical_strategy)}</span>
            </div>
          )}
          {attrs.emotional_register && (
            <div className="similar-detail-attr">
              <span className="similar-detail-attr-label">Emotional Register</span>
              <span className="similar-detail-attr-value">{formatAttrValue(attrs.emotional_register)}</span>
            </div>
          )}
          {attrs.falsifiability && (
            <div className="similar-detail-attr">
              <span className="similar-detail-attr-label">Falsifiability</span>
              <span className="similar-detail-attr-value">{formatAttrValue(attrs.falsifiability)}</span>
            </div>
          )}
          {attrs.audience && (
            <div className="similar-detail-attr">
              <span className="similar-detail-attr-label">Audience</span>
              <span className="similar-detail-attr-value">{formatAttrValue(attrs.audience)}</span>
            </div>
          )}
          {attrs.intellectual_lineage && attrs.intellectual_lineage.length > 0 && (
            <div className="similar-detail-attr">
              <span className="similar-detail-attr-label">Intellectual Lineage</span>
              <span className="similar-detail-attr-value">{formatAttrValue(attrs.intellectual_lineage)}</span>
            </div>
          )}
          {attrs.assumes && attrs.assumes.length > 0 && (
            <div className="similar-detail-attr">
              <span className="similar-detail-attr-label">Assumes</span>
              <span className="similar-detail-attr-value">{formatAttrValue(attrs.assumes)}</span>
            </div>
          )}
          {attrs.steelman_vulnerability && (
            <div className="similar-detail-attr">
              <span className="similar-detail-attr-label">Steelman Vulnerability</span>
              <span className="similar-detail-attr-value">{typeof attrs.steelman_vulnerability === 'string' ? attrs.steelman_vulnerability : Object.entries(attrs.steelman_vulnerability).filter(([,v]) => v).map(([k,v]) => `${k.replace('from_', '')}: ${v}`).join(' | ')}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
