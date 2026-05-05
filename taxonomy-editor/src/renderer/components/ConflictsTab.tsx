// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useTaxonomyStore } from '../hooks/useTaxonomyStore';
import { useKeyboardNav } from '../hooks/useKeyboardNav';
import { useResizablePanel } from '../hooks/useResizablePanel';
import { ConflictDetail } from './ConflictDetail';
import { PinnedPanel } from './PinnedPanel';
import { SearchPreview } from './SearchPreview';
import { FallacyDetailPanel } from './FallacyPanel';
import { PromptDetailPanel } from './PromptsPanel';
import { ToolbarPaneRenderer, isFullWidthPanel } from './ToolbarPaneRenderer';
import { getLineageInfo } from '../data/lineageLookup';
import { getCategoryLabel } from '../data/lineageCategories';
import { POV_KEYS } from '@lib/debate/types';
import { api } from '@bridge';
import type { PromptCatalogEntry } from '../data/promptCatalog';
import { PROMPT_CATALOG } from '../data/promptCatalog';

const COLLAPSE_STORAGE_KEY = 'taxonomy-editor-conflict-collapsed';
const COLLAPSE_VERSION_KEY = 'taxonomy-editor-conflict-collapsed-version';
const COLLAPSE_VERSION = 2; // bump to reset all users to collapsed-by-default

function loadCollapsedClusters(): Set<string> {
  try {
    const version = Number(localStorage.getItem(COLLAPSE_VERSION_KEY) || '0');
    if (version >= COLLAPSE_VERSION) {
      const raw = localStorage.getItem(COLLAPSE_STORAGE_KEY);
      if (raw) return new Set(JSON.parse(raw));
    }
    localStorage.setItem(COLLAPSE_VERSION_KEY, String(COLLAPSE_VERSION));
    localStorage.removeItem(COLLAPSE_STORAGE_KEY);
  } catch { /* ignore */ }
  return new Set(); // empty = will be initialized from cluster labels on first render
}

function saveCollapsedClusters(collapsed: Set<string>) {
  localStorage.setItem(COLLAPSE_STORAGE_KEY, JSON.stringify([...collapsed]));
}

export function ConflictsTab() {
  const {
    conflicts, selectedNodeId, setSelectedNodeId, createConflict, pinnedStack, pinAtDepth, toolbarPanel,
    conflictClusters, conflictClusterLoading, conflictClusterError,
    runClusterConflicts, clearConflictClusters,
  } = useTaxonomyStore();
  const [showNew, setShowNew] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [listCollapsed, setListCollapsed] = useState(false);
  const [detailCollapsed, setDetailCollapsed] = useState(false);
  const [lineagePreviewValue, setLineagePreviewValue] = useState<string | null>(null);
  const [selectedFallacyKey, setSelectedFallacyKey] = useState<string | null>(null);
  const [searchPreviewId, setSearchPreviewId] = useState<string | null>(null);
  const [selectedPromptEntry, setSelectedPromptEntry] = useState<PromptCatalogEntry | null>(PROMPT_CATALOG[0]);
  const [promptInspectorActive, setPromptInspectorActive] = useState(false);
  const { width, onMouseDown } = useResizablePanel();
  const [collapsedClusters, setCollapsedClusters] = useState<Set<string>>(() => loadCollapsedClusters());
  const initialCollapseApplied = useRef(false);

  // Alpha-bucket grouping (zero-dependency, always available)
  const alphaClusters = useMemo(() => {
    if (conflicts.length === 0) return [];
    const sorted = [...conflicts].sort((a, b) => a.claim_label.localeCompare(b.claim_label));
    const buckets = new Map<string, string[]>();
    for (const c of sorted) {
      const first = (c.claim_label[0] || '#').toUpperCase();
      const key = /[A-Z]/.test(first) ? first : '#';
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key)!.push(c.claim_id);
    }
    return [...buckets.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([letter, ids]) => ({ label: letter, nodeIds: ids }));
  }, [conflicts]);

  // Use semantic clusters if available, else alpha buckets
  const displayClusters = conflictClusters || alphaClusters;

  // Default all clusters to collapsed on first load
  useEffect(() => {
    if (displayClusters.length > 0 && !initialCollapseApplied.current) {
      initialCollapseApplied.current = true;
      // Only set defaults if user hasn't saved preferences yet
      if (collapsedClusters.size === 0) {
        const allKeys = new Set(displayClusters.map(c => c.label));
        setCollapsedClusters(allKeys);
        saveCollapsedClusters(allKeys);
      }
    }
  }, [displayClusters]);

  const toggleCluster = useCallback((key: string) => {
    setCollapsedClusters(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      saveCollapsedClusters(next);
      return next;
    });
  }, []);

  // Build ordered IDs from display clusters
  const orderedIds = useMemo(() => {
    return displayClusters.flatMap(c => c.nodeIds);
  }, [displayClusters]);

  useKeyboardNav(orderedIds, selectedNodeId, setSelectedNodeId);

  // Auto-select first conflict when tab loads
  useEffect(() => {
    if (!selectedNodeId && orderedIds.length > 0) {
      setSelectedNodeId(orderedIds[0]);
    }
  }, []);

  const selectedConflict = conflicts.find(c => c.claim_id === selectedNodeId) || null;

  const handleCreate = () => {
    if (newLabel.trim()) {
      createConflict(newLabel.trim());
      setNewLabel('');
      setShowNew(false);
    }
  };

  const handlePin = () => {
    if (selectedConflict) {
      pinAtDepth(0, {
        type: 'conflict',
        conflict: structuredClone(selectedConflict),
      });
    }
  };

  const fullWidth = isFullWidthPanel(toolbarPanel, promptInspectorActive);

  const renderLineagePreview = () => {
    if (!lineagePreviewValue) return <div className="detail-panel-empty">Select a lineage value to view details</div>;
    const info = getLineageInfo(lineagePreviewValue);

    // Compute Referenced By — POV nodes whose intellectual_lineage includes this value
    const normalizedValue = lineagePreviewValue.toLowerCase();
    const referencingNodes: { id: string; label: string; pov: string; category?: string }[] = [];
    const storeState = useTaxonomyStore.getState();
    for (const p of POV_KEYS) {
      const povFile = storeState[p];
      if (!povFile) continue;
      for (const node of povFile.nodes) {
        if (node.graph_attributes?.intellectual_lineage?.some(v => { const s = typeof v === 'string' ? v : (v as { name?: string })?.name; return s?.toLowerCase() === normalizedValue; })) {
          referencingNodes.push({ id: node.id, label: node.label, pov: p, category: node.category });
        }
      }
    }

    const renderReferencedBy = () => referencingNodes.length > 0 && (
      <div className="lineage-detail-section">
        <div className="lineage-detail-label">Referenced By ({referencingNodes.length})</div>
        <div className="lineage-detail-links">
          {referencingNodes.map(ref => (
            <button
              key={ref.id}
              className="btn btn-sm btn-ghost lineage-ref-item"
              onClick={() => useTaxonomyStore.getState().navigateToNode(ref.pov as any, ref.id)}
              title={`Open ${ref.id} in ${ref.pov} tree`}
            >
              <span className={`pov-badge pov-badge-${ref.pov.slice(0, 3)}`}>{ref.pov.slice(0, 3).toUpperCase()}</span>
              <span className="lineage-ref-label">{ref.label}</span>
            </button>
          ))}
        </div>
      </div>
    );

    if (!info) return (
      <div className="lineage-detail">
        <h2 className="lineage-detail-title">{lineagePreviewValue}</h2>
        <div className="lineage-category-badge">{getCategoryLabel(lineagePreviewValue)}</div>
        <div className="lineage-detail-section">
          <p className="lineage-detail-text" style={{ color: 'var(--text-muted)' }}>No detailed information available for this lineage value.</p>
        </div>
        {renderReferencedBy()}
      </div>
    );
    return (
      <div className="lineage-detail">
        <h2 className="lineage-detail-title">{info.label}</h2>
        <div className="lineage-category-badge">{getCategoryLabel(lineagePreviewValue)}</div>
        <div className="lineage-detail-section">
          <div className="lineage-detail-label">Summary</div>
          <p className="lineage-detail-text">{info.summary}</p>
        </div>
        <div className="lineage-detail-section">
          <div className="lineage-detail-label">Example</div>
          <p className="lineage-detail-text">{info.example}</p>
        </div>
        <div className="lineage-detail-section">
          <div className="lineage-detail-label">Frequency</div>
          <p className="lineage-detail-text">{info.frequency}</p>
        </div>
        {info.links && info.links.length > 0 && (
          <div className="lineage-detail-section">
            <div className="lineage-detail-label">Learn More</div>
            <ul className="strategy-info-links">
              {info.links.map((link, i) => (
                <li key={i}>
                  <button
                    className="strategy-info-link"
                    onClick={() => void api.openExternal(link.url)}
                    title={link.url}
                  >
                    {link.label}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {renderReferencedBy()}
      </div>
    );
  };

  return (
    <div className="two-column">
      {fullWidth ? (
        <div className="list-panel list-panel-full">
          <ToolbarPaneRenderer
            panel={toolbarPanel}
            onSelectResult={setSearchPreviewId}
            onSelectLineageValue={setLineagePreviewValue}
            onSelectFallacy={setSelectedFallacyKey}
            onSelectPrompt={setSelectedPromptEntry}
            onInspectorToggle={setPromptInspectorActive}
          />
        </div>
      ) : toolbarPanel ? (
        <div className="list-panel" style={{ width }}>
          <ToolbarPaneRenderer
            panel={toolbarPanel}
            onSelectResult={setSearchPreviewId}
            onSelectLineageValue={setLineagePreviewValue}
            onSelectFallacy={setSelectedFallacyKey}
            onSelectPrompt={setSelectedPromptEntry}
            onInspectorToggle={setPromptInspectorActive}
          />
        </div>
      ) : listCollapsed ? (
        <div className="pane-collapsed pane-collapsed-list" onClick={() => setListCollapsed(false)} title="Expand list">
          <span className="pane-collapsed-label">Conflicts</span>
        </div>
      ) : (
        <div className="list-panel" style={{ width }}>
          <div className="list-panel-header">
            <h2>Conflicts</h2>
            <div className="list-panel-header-actions">
              <button className="btn btn-sm" onClick={() => setShowNew(true)}>
                + New
              </button>
              <button className="pane-collapse-btn" onClick={() => setListCollapsed(true)} title="Collapse">&lsaquo;</button>
            </div>
          </div>
          <div className="list-panel-items">
            {displayClusters.map((cluster) => {
              const isCollapsed = collapsedClusters.has(cluster.label);
              return (
                <div key={cluster.label} className="category-group cluster-group">
                  <div
                    className="category-label cluster-label"
                    onClick={() => toggleCluster(cluster.label)}
                    style={{ cursor: 'pointer', userSelect: 'none' }}
                  >
                    <span className={`category-toggle ${isCollapsed ? 'collapsed' : ''}`}>&#9660;</span>
                    {cluster.label} <span className="category-count">({cluster.nodeIds.length})</span>
                  </div>
                  {!isCollapsed && cluster.nodeIds.map((id) => {
                    const conflict = conflicts.find(c => c.claim_id === id);
                    if (!conflict) return null;
                    return (
                      <ConflictListItem
                        key={conflict.claim_id}
                        claimId={conflict.claim_id}
                        label={conflict.claim_label}
                        status={conflict.status}
                        isSelected={selectedNodeId === conflict.claim_id}
                        onSelect={setSelectedNodeId}
                      />
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      )}
      {!fullWidth && (
        <div className="resize-handle" onMouseDown={onMouseDown} />
      )}
      {fullWidth ? null : toolbarPanel === 'search' ? (
        <div className="detail-panel">
          <SearchPreview searchPreviewId={searchPreviewId} onClear={() => setSearchPreviewId(null)} />
        </div>
      ) : (toolbarPanel === 'prompts' && !promptInspectorActive) ? (
        <div className="detail-panel">
          <PromptDetailPanel entry={selectedPromptEntry} />
        </div>
      ) : toolbarPanel === 'lineage' ? (
        <div className="detail-panel">
          {renderLineagePreview()}
        </div>
      ) : toolbarPanel === 'fallacy' ? (
        <div className="detail-panel">
          <FallacyDetailPanel fallacyKey={selectedFallacyKey} />
        </div>
      ) : detailCollapsed ? (
        <div className="pane-collapsed pane-collapsed-detail" onClick={() => setDetailCollapsed(false)} title="Expand detail">
          <span className="pane-collapsed-label">Detail</span>
        </div>
      ) : (
        <div className="detail-panel">
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 4 }}>
            <button className="pane-collapse-btn" onClick={() => setDetailCollapsed(true)} title="Collapse">&lsaquo;</button>
          </div>
          {selectedConflict ? (
            <ConflictDetail conflict={selectedConflict} onPin={handlePin} />
          ) : (
            <div className="detail-panel-empty">Select a conflict to edit</div>
          )}
        </div>
      )}
      {pinnedStack.length > 0 && <PinnedPanel />}

      {showNew && (
        <div className="dialog-overlay" onClick={() => setShowNew(false)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <h3>New Conflict</h3>
            <div className="form-group">
              <label>Claim Label</label>
              <input
                type="text"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder="e.g., AGI Timeline Estimates"
                autoFocus
              />
            </div>
            <div className="dialog-actions">
              <button className="btn" onClick={() => setShowNew(false)}>Cancel</button>
              <button
                className="btn btn-primary"
                onClick={handleCreate}
                disabled={!newLabel.trim()}
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ConflictListItem({ claimId, label, status, isSelected, onSelect }: {
  claimId: string;
  label: string;
  status: string;
  isSelected: boolean;
  onSelect: (id: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isSelected && ref.current) {
      ref.current.scrollIntoView({ block: 'nearest' });
    }
  }, [isSelected]);

  return (
    <div
      ref={ref}
      className={`node-item ${isSelected ? 'selected' : ''}`}
      onClick={() => onSelect(claimId)}
    >
      <div>{label || '(untitled)'}</div>
      <div className="node-item-id">
        {claimId}
        <span style={{ marginLeft: 8, color: status === 'open' ? 'var(--color-skp)' : 'var(--text-muted)' }}>
          [{status}]
        </span>
      </div>
    </div>
  );
}
