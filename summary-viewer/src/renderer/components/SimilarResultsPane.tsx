// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useMemo, useCallback, useRef } from 'react';
import { useStore } from '../store/useStore';
import ApiKeyDialog from './ApiKeyDialog';

type SortKey = 'match' | 'id' | 'label' | 'description';
type SortDir = 'asc' | 'desc';

interface ResolvedRow {
  id: string;
  score: number;
  label: string;
  description: string;
  category: string;
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

  const [showApiKeyDialog, setShowApiKeyDialog] = useState(false);
  const [showIds, setShowIds] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('match');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

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
                onClick={() => setShowApiKeyDialog(true)}
              >
                Configure API Key
              </button>
            )}
          </div>
        )}

        {showApiKeyDialog && (
          <ApiKeyDialog
            onClose={() => setShowApiKeyDialog(false)}
            onSaved={() => {
              setShowApiKeyDialog(false);
              if (similarQuery) {
                const state = useStore.getState();
                runSimilarSearch(state.similarQuery!, state.similarQueryDescription || state.similarQuery!);
              }
            }}
          />
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
            </div>

            <div className="similar-table-wrap">
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
                      <tr key={r.id} className="similar-table-row">
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
          </>
        )}
      </div>
    </>
  );
}
