// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useEffect, useRef, useMemo } from 'react';
import { useTaxonomyStore } from '../hooks/useTaxonomyStore';
import { useKeyboardNav } from '../hooks/useKeyboardNav';
import { useResizablePanel, useResizableRightPanel } from '../hooks/useResizablePanel';
import { CrossCuttingDetail } from './CrossCuttingDetail';
import { NodeDetail } from './NodeDetail';
import { PinnedPanel } from './PinnedPanel';
import { SearchPanel } from './SearchPanel';
import { AttributeFilterPanel } from './AttributeFilterPanel';
import { AttributeInfoPanel } from './AttributeInfoPanel';
import { RelatedEdgesPanel } from './RelatedEdgesPanel';
import { EdgeDetailPanel } from './EdgeDetailPanel';
import { LineagePanel } from './LineagePanel';
import { INTELLECTUAL_LINEAGES } from '../data/intellectualLineageInfo';

export function CrossCuttingTab() {
  const {
    crossCutting, selectedNodeId, setSelectedNodeId, createCrossCuttingNode,
    pinnedStack, pinAtDepth,
    attributeFilter, attributeInfo,
    relatedNodeId, showRelatedEdges, selectedEdge,
    toolbarPanel,
  } = useTaxonomyStore();
  const [listCollapsed, setListCollapsed] = useState(false);
  const [detailCollapsed, setDetailCollapsed] = useState(false);
  const [searchPreviewId, setSearchPreviewId] = useState<string | null>(null);
  const [lineagePreviewValue, setLineagePreviewValue] = useState<string | null>(null);
  const [lineageLinkUrl, setLineageLinkUrl] = useState<string | null>(null);
  const { width, onMouseDown } = useResizablePanel();
  const { width: edgeDetailWidth, onMouseDown: onEdgeDetailResize } = useResizableRightPanel({
    storageKey: 'taxonomy-editor-edge-detail-width',
    defaultWidth: 480,
    minWidth: 320,
    maxWidth: 700,
  });

  const showRelatedPanel = relatedNodeId !== null;
  const showEdgeDetail = selectedEdge !== null && showRelatedPanel;
  const hasToolbarPane = toolbarPanel !== null;

  // Grow/shrink window when Edge Detail panel opens/closes
  const prevShowEdgeDetail = useRef(false);
  useEffect(() => {
    const wasShowing = prevShowEdgeDetail.current;
    prevShowEdgeDetail.current = showEdgeDetail;
    if (showEdgeDetail === wasShowing) return;
    const delta = edgeDetailWidth + 4;
    window.electronAPI.isMaximized().then((max) => {
      if (max) return;
      if (showEdgeDetail) window.electronAPI.growWindow(delta);
      else window.electronAPI.shrinkWindow(delta);
    });
  }, [showEdgeDetail]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-collapse pane 2 when edge detail opens; auto-expand when closed
  const prevEdgeDetailForCollapse = useRef(false);
  useEffect(() => {
    const was = prevEdgeDetailForCollapse.current;
    prevEdgeDetailForCollapse.current = showEdgeDetail;
    if (showEdgeDetail && !was) setDetailCollapsed(true);
    if (!showEdgeDetail && was) setDetailCollapsed(false);
  }, [showEdgeDetail]);

  // Auto-refresh related edges when selection changes while panel is open
  useEffect(() => {
    if (showRelatedPanel && selectedNode) {
      showRelatedEdges(selectedNode.id);
    }
  }, [selectedNodeId]); // eslint-disable-line react-hooks/exhaustive-deps

  const orderedIds = useMemo(
    () => (crossCutting ? crossCutting.nodes.map(n => n.id) : []),
    [crossCutting],
  );
  useKeyboardNav(orderedIds, selectedNodeId, setSelectedNodeId, toolbarPanel !== null);

  // Auto-select first node when tab loads
  useEffect(() => {
    if (!selectedNodeId && orderedIds.length > 0) {
      setSelectedNodeId(orderedIds[0]);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!crossCutting) {
    return <div className="detail-panel-empty">No cross-cutting data loaded</div>;
  }

  const selectedNode = crossCutting.nodes.find(n => n.id === selectedNodeId) || null;

  const handlePin = () => {
    if (selectedNode) {
      pinAtDepth(0, {
        type: 'cross-cutting',
        node: structuredClone(selectedNode),
      });
    }
  };

  const handleRelated = () => {
    if (selectedNode) {
      showRelatedEdges(selectedNode.id);
    }
  };

  // Render the promoted panel content for Pane 1
  // Render cross-POV node detail for search preview
  const renderSearchPreview = () => {
    if (!searchPreviewId) return <div className="detail-panel-empty">Select a search result to preview</div>;
    const state = useTaxonomyStore.getState();
    if (searchPreviewId.startsWith('cc-')) {
      const node = state.crossCutting?.nodes.find(n => n.id === searchPreviewId);
      if (node) return <CrossCuttingDetail node={node} readOnly chipDepth={0} />;
    } else {
      for (const p of ['accelerationist', 'safetyist', 'skeptic'] as const) {
        const node = state[p]?.nodes.find(n => n.id === searchPreviewId);
        if (node) return <NodeDetail pov={p} node={node} readOnly chipDepth={0} />;
      }
    }
    return <div className="detail-panel-empty">Node not found</div>;
  };

  // Render lineage about info for Pane 2
  const renderLineagePreview = () => {
    if (!lineagePreviewValue) return <div className="detail-panel-empty">Select a lineage value to view details</div>;
    const info = INTELLECTUAL_LINEAGES[lineagePreviewValue]
      ?? Object.entries(INTELLECTUAL_LINEAGES).find(([k]) => k.toLowerCase() === lineagePreviewValue.toLowerCase())?.[1]
      ?? null;
    if (!info) return (
      <div className="lineage-detail">
        <h2 className="lineage-detail-title">{lineagePreviewValue}</h2>
        <div className="lineage-detail-section">
          <p className="lineage-detail-text" style={{ color: 'var(--text-muted)' }}>No detailed information available for this lineage value.</p>
        </div>
      </div>
    );
    return (
      <div className="lineage-detail">
        <h2 className="lineage-detail-title">{info.label}</h2>
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
            <div className="lineage-detail-label">Links</div>
            <div className="lineage-detail-links">
              {info.links.map((link, i) => (
                <button
                  key={i}
                  className={`btn btn-sm${lineageLinkUrl === link.url ? '' : ' btn-ghost'}`}
                  onClick={() => setLineageLinkUrl(link.url)}
                >
                  {link.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderToolbarPane = () => {
    switch (toolbarPanel) {
      case 'search':
        return <SearchPanel onSelectResult={setSearchPreviewId} />;
      case 'related':
        return <RelatedEdgesPanel />;
      case 'attrFilter':
        return <AttributeFilterPanel />;
      case 'attrInfo':
        return <AttributeInfoPanel />;
      case 'lineage':
        return <LineagePanel onSelectValue={setLineagePreviewValue} />;
      default:
        return null;
    }
  };

  return (
    <div className="two-column">
      {/* Pane 1: Node list OR promoted toolbar panel */}
      {(toolbarPanel === 'search' || toolbarPanel === 'attrFilter') ? (
        <div className="list-panel list-panel-full">
          {renderToolbarPane()}
        </div>
      ) : hasToolbarPane ? (
        <div className="list-panel" style={{ width }}>
          {renderToolbarPane()}
        </div>
      ) : listCollapsed ? (
        <div className="pane-collapsed pane-collapsed-list" onClick={() => setListCollapsed(false)} title="Expand list">
          <span className="pane-collapsed-label">Cross-Cutting</span>
        </div>
      ) : (
        <div className="list-panel" style={{ width }}>
          <div className="list-panel-header">
            <h2>Cross-Cutting</h2>
            <div className="list-panel-header-actions">
              <button className="btn btn-sm" onClick={createCrossCuttingNode}>
                + New
              </button>
              <button className="pane-collapse-btn" onClick={() => setListCollapsed(true)} title="Collapse">&lsaquo;</button>
            </div>
          </div>
          <div className="list-panel-items">
            {crossCutting.nodes.map((node) => (
              <ListItem
                key={node.id}
                id={node.id}
                label={node.label}
                isSelected={selectedNodeId === node.id}
                onSelect={setSelectedNodeId}
              />
            ))}
          </div>
        </div>
      )}
      {toolbarPanel !== 'attrFilter' && (
        <div className="resize-handle" onMouseDown={onMouseDown} />
      )}
      {/* Pane 2: Detail (search preview, lineage preview, or normal detail) */}
      {toolbarPanel === 'search' ? (
        <div className="detail-panel">
          {renderSearchPreview()}
        </div>
      ) : toolbarPanel === 'attrFilter' ? null
      : toolbarPanel === 'lineage' ? (
        <>
          <div className="detail-panel">
            {renderLineagePreview()}
          </div>
          {lineageLinkUrl && (
            <>
              <div className="resize-handle" />
              <div className="webview-pane">
                <div className="webview-pane-header">
                  <span className="webview-pane-url">{lineageLinkUrl}</span>
                  <button className="btn btn-ghost btn-sm" onClick={() => setLineageLinkUrl(null)}>&times;</button>
                </div>
                <webview src={lineageLinkUrl} className="webview-frame" />
              </div>
            </>
          )}
        </>
      ) : (
        <>
          {detailCollapsed ? (
            <div className="pane-collapsed pane-collapsed-detail" onClick={() => setDetailCollapsed(false)} title="Expand detail">
              <span className="pane-collapsed-label">Detail</span>
            </div>
          ) : (
            <div className="detail-panel">
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 4 }}>
                <button className="pane-collapse-btn" onClick={() => setDetailCollapsed(true)} title="Collapse">&lsaquo;</button>
              </div>
              {selectedNode ? (
                <CrossCuttingDetail node={selectedNode} onPin={handlePin} onRelated={handleRelated} />
              ) : (
                <div className="detail-panel-empty">Select a cross-cutting node to edit</div>
              )}
            </div>
          )}
          {/* Pane 3: Edge Detail (child of Related Edges, when related is in Pane 1) */}
          {toolbarPanel === 'related' && showEdgeDetail && (
            <>
              <div className="resize-handle" onMouseDown={onEdgeDetailResize} />
              <EdgeDetailPanel width={edgeDetailWidth} />
            </>
          )}
          {pinnedStack.length > 0 && !hasToolbarPane && <PinnedPanel />}
        </>
      )}
    </div>
  );
}

function ListItem({ id, label, isSelected, onSelect }: { id: string; label: string; isSelected: boolean; onSelect: (id: string) => void }) {
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
      onClick={() => onSelect(id)}
    >
      <div>{label || '(untitled)'}</div>
      <div className="node-item-id">{id}</div>
    </div>
  );
}
