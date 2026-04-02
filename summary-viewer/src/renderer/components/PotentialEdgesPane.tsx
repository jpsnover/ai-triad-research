// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useMemo, useCallback, useRef } from 'react';
import { useStore } from '../store/useStore';
import SettingsDialog from './SettingsDialog';
import type { PotentialEdge, TaxonomyNode } from '../types/types';

type SortKey = 'confidence' | 'type' | 'target' | 'direction';
type SortDir = 'asc' | 'desc';

interface ResolvedEdge extends PotentialEdge {
  targetLabel: string;
  targetDescription: string;
  targetCategory: string;
  targetPov: string;
}

function povFromId(id: string): string {
  if (id.startsWith('acc-')) return 'accelerationist';
  if (id.startsWith('saf-')) return 'safetyist';
  if (id.startsWith('skp-')) return 'skeptic';
  if (id.startsWith('cc-')) return 'situations';
  return '';
}

function povLabel(pov: string): string {
  if (pov === 'accelerationist') return 'Acc';
  if (pov === 'safetyist') return 'Saf';
  if (pov === 'skeptic') return 'Skp';
  if (pov === 'situations') return 'CC';
  return pov.slice(0, 3);
}

export default function PotentialEdgesPane() {
  const potentialEdgesQuery = useStore(s => s.potentialEdgesQuery);
  const potentialEdges = useStore(s => s.potentialEdges);
  const potentialEdgesLoading = useStore(s => s.potentialEdgesLoading);
  const potentialEdgesError = useStore(s => s.potentialEdgesError);
  const clearPotentialEdges = useStore(s => s.clearPotentialEdges);
  const taxonomy = useStore(s => s.taxonomy);

  const [showSettings, setShowSettings] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('confidence');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  // Resizable vertical split
  const splitDrag = useRef<{ startY: number; startH: number } | null>(null);
  const [listHeight, setListHeight] = useState(() => {
    const saved = localStorage.getItem('potential-edges-split-height');
    return saved ? Number(saved) : 220;
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
      setListHeight(Math.max(80, Math.min(600, splitDrag.current.startH + delta)));
    };

    const onUp = () => {
      localStorage.setItem('potential-edges-split-height', String(listHeightRef.current));
      splitDrag.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, []);

  const resolved = useMemo((): ResolvedEdge[] => {
    if (!potentialEdges) return [];
    return potentialEdges.map(e => {
      const node: TaxonomyNode | undefined = taxonomy[e.target];
      return {
        ...e,
        targetLabel: node?.label || e.target,
        targetDescription: node?.description || '',
        targetCategory: node?.category || '',
        targetPov: povFromId(e.target),
      };
    });
  }, [potentialEdges, taxonomy]);

  const sorted = useMemo(() => {
    const arr = [...resolved];
    arr.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'confidence': cmp = a.confidence - b.confidence; break;
        case 'type': cmp = a.type.localeCompare(b.type); break;
        case 'target': cmp = a.targetLabel.localeCompare(b.targetLabel); break;
        case 'direction': cmp = (a.inbound ? 1 : 0) - (b.inbound ? 1 : 0); break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return arr;
  }, [resolved, sortKey, sortDir]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir(key === 'confidence' ? 'desc' : 'asc');
    }
  };

  const sortIndicator = (key: SortKey) => {
    if (sortKey !== key) return '';
    return sortDir === 'asc' ? ' \u25B2' : ' \u25BC';
  };

  const selectedEdge = selectedIdx !== null ? sorted[selectedIdx] ?? null : null;

  return (
    <>
      <div className="pane-header">
        <h2>Potential Edges: {potentialEdgesQuery}</h2>
        <div className="similar-search-actions">
          <button className="btn btn-ghost btn-sm" onClick={clearPotentialEdges}>
            Close
          </button>
        </div>
      </div>
      <div className="pane-body similar-search-panel">
        {potentialEdgesLoading && (
          <div className="similar-search-loading">
            <span className="search-spinner" /> Discovering potential edges...
          </div>
        )}

        {potentialEdgesError && (
          <div className="search-error">
            {potentialEdgesError}
            {potentialEdgesError.includes('No API key') && (
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

        {potentialEdges !== null && !potentialEdgesLoading && (
          <div className="similar-split-container">
            {/* Top: edge list */}
            <div className="similar-table-wrap" style={{ height: selectedEdge ? listHeight : undefined, flex: selectedEdge ? 'none' : 1 }}>
              <table className="similar-table potential-edges-table">
                <thead>
                  <tr>
                    <th className="similar-th-sortable" style={{ width: 50 }} onClick={() => handleSort('confidence')}>
                      Conf{sortIndicator('confidence')}
                    </th>
                    <th className="similar-th-sortable" style={{ width: 130 }} onClick={() => handleSort('type')}>
                      Type{sortIndicator('type')}
                    </th>
                    <th className="similar-th-sortable" style={{ width: 40 }} onClick={() => handleSort('direction')}>
                      Dir{sortIndicator('direction')}
                    </th>
                    <th className="similar-th-sortable" onClick={() => handleSort('target')}>
                      Target{sortIndicator('target')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="similar-table-empty">
                        No potential edges discovered
                      </td>
                    </tr>
                  ) : (
                    sorted.map((e, i) => (
                      <tr
                        key={`${e.target}-${e.type}-${i}`}
                        className={`similar-table-row${selectedIdx === i ? ' selected' : ''}`}
                        onClick={() => setSelectedIdx(prev => prev === i ? null : i)}
                      >
                        <td className="similar-table-match">{Math.round(e.confidence * 100)}%</td>
                        <td className="potential-edge-type">
                          <span className={`edge-type-badge edge-type-${e.type.toLowerCase()}`}>
                            {e.type.replace(/_/g, ' ')}
                          </span>
                        </td>
                        <td className="potential-edge-dir" title={e.inbound ? 'Target \u2192 Concept' : 'Concept \u2192 Target'}>
                          {e.bidirectional ? '\u2194' : e.inbound ? '\u2190' : '\u2192'}
                        </td>
                        <td>
                          <span className={`potential-edge-pov pov-${e.targetPov}`}>{povLabel(e.targetPov)}</span>
                          {' '}
                          <span className="similar-table-label">{e.targetLabel}</span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Detail panel for selected edge */}
            {selectedEdge && (
              <>
                <div className="similar-split-handle" onMouseDown={onSplitResizeStart} />
                <div className="similar-detail-panel">
                  <div className="similar-detail-header">
                    <span className="similar-detail-id">{selectedEdge.target}</span>
                    <span className="similar-detail-match">{Math.round(selectedEdge.confidence * 100)}% confidence</span>
                  </div>

                  <div className="potential-edge-detail-type">
                    <span className={`edge-type-badge edge-type-${selectedEdge.type.toLowerCase()}`}>
                      {selectedEdge.type.replace(/_/g, ' ')}
                    </span>
                    <span className="potential-edge-detail-dir">
                      {selectedEdge.bidirectional
                        ? `${potentialEdgesQuery} \u2194 ${selectedEdge.targetLabel}`
                        : selectedEdge.inbound
                          ? `${selectedEdge.targetLabel} \u2192 ${potentialEdgesQuery}`
                          : `${potentialEdgesQuery} \u2192 ${selectedEdge.targetLabel}`
                      }
                    </span>
                    {selectedEdge.strength && (
                      <span className={`potential-edge-strength strength-${selectedEdge.strength}`}>
                        {selectedEdge.strength}
                      </span>
                    )}
                  </div>

                  <div className="potential-edge-rationale">
                    <span className="similar-detail-attr-label">Rationale</span>
                    <p>{selectedEdge.rationale}</p>
                  </div>

                  <div className="potential-edge-target-info">
                    <div className="similar-detail-pov-cat">
                      <span className={`pov-badge pov-${selectedEdge.targetPov}`}>
                        {selectedEdge.targetPov.charAt(0).toUpperCase() + selectedEdge.targetPov.slice(1)}
                      </span>
                      {selectedEdge.targetCategory && (
                        <span className="similar-detail-category">{selectedEdge.targetCategory}</span>
                      )}
                    </div>
                    <h3 className="similar-detail-label">{selectedEdge.targetLabel}</h3>
                    <p className="similar-detail-desc">{selectedEdge.targetDescription}</p>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </>
  );
}
