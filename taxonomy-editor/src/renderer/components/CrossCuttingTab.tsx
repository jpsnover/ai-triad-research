// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useEffect, useRef, useMemo } from 'react';
import { useTaxonomyStore } from '../hooks/useTaxonomyStore';
import { useKeyboardNav } from '../hooks/useKeyboardNav';
import { useResizablePanel, useResizableRightPanel } from '../hooks/useResizablePanel';
import { CrossCuttingDetail } from './CrossCuttingDetail';
import { PinnedPanel } from './PinnedPanel';
import { AttributeFilterPanel } from './AttributeFilterPanel';
import { AttributeInfoPanel } from './AttributeInfoPanel';
import { RelatedEdgesPanel } from './RelatedEdgesPanel';
import { EdgeDetailPanel } from './EdgeDetailPanel';

export function CrossCuttingTab() {
  const { crossCutting, selectedNodeId, setSelectedNodeId, createCrossCuttingNode, pinnedStack, pinAtDepth, attributeFilter, attributeInfo, relatedNodeId, showRelatedEdges, selectedEdge } = useTaxonomyStore();
  const [listCollapsed, setListCollapsed] = useState(false);
  const [detailCollapsed, setDetailCollapsed] = useState(false);
  const { width, onMouseDown } = useResizablePanel();
  const { width: attrPaneWidth, onMouseDown: onAttrPaneResize } = useResizableRightPanel({
    storageKey: 'taxonomy-editor-attr-filter-panel-width',
    defaultWidth: 480,
    minWidth: 320,
    maxWidth: 900,
  });
  const { width: infoPaneWidth, onMouseDown: onInfoPaneResize } = useResizableRightPanel({
    storageKey: 'taxonomy-editor-attr-info-panel-width',
    defaultWidth: 400,
    minWidth: 300,
    maxWidth: 700,
  });
  const { width: relatedPaneWidth, onMouseDown: onRelatedPaneResize } = useResizableRightPanel({
    storageKey: 'taxonomy-editor-related-panel-width',
    defaultWidth: 420,
    minWidth: 300,
    maxWidth: 800,
  });
  const { width: edgeDetailWidth, onMouseDown: onEdgeDetailResize } = useResizableRightPanel({
    storageKey: 'taxonomy-editor-edge-detail-width',
    defaultWidth: 480,
    minWidth: 320,
    maxWidth: 700,
  });
  const showAttrFilterPanel = attributeFilter !== null;
  const showInfoPanel = attributeInfo !== null;
  const showRelatedPanel = relatedNodeId !== null;
  const showEdgeDetail = selectedEdge !== null && showRelatedPanel;

  // Determine where info panel renders
  const hasPane3 = showAttrFilterPanel;
  const infoIsPane4 = showInfoPanel && hasPane3;
  const infoIsPane3 = showInfoPanel && !hasPane3;

  // Grow/shrink window when Attribute Filter panel opens/closes
  const prevShowAttrFilter = useRef(false);
  useEffect(() => {
    const wasShowing = prevShowAttrFilter.current;
    prevShowAttrFilter.current = showAttrFilterPanel;
    const delta = attrPaneWidth + 4;
    if (showAttrFilterPanel && !wasShowing) {
      window.electronAPI.growWindow(delta);
    } else if (!showAttrFilterPanel && wasShowing) {
      window.electronAPI.shrinkWindow(delta);
    }
  }, [showAttrFilterPanel]); // eslint-disable-line react-hooks/exhaustive-deps

  // Grow/shrink window when Info panel opens/closes
  const prevShowInfo = useRef(false);
  useEffect(() => {
    const wasShowing = prevShowInfo.current;
    prevShowInfo.current = showInfoPanel;
    const delta = infoPaneWidth + 4;
    if (showInfoPanel && !wasShowing) {
      window.electronAPI.growWindow(delta);
    } else if (!showInfoPanel && wasShowing) {
      window.electronAPI.shrinkWindow(delta);
    }
  }, [showInfoPanel]); // eslint-disable-line react-hooks/exhaustive-deps

  // Grow/shrink window when Related panel opens/closes
  const prevShowRelated = useRef(false);
  useEffect(() => {
    const wasShowing = prevShowRelated.current;
    prevShowRelated.current = showRelatedPanel;
    const delta = relatedPaneWidth + 4;
    if (showRelatedPanel && !wasShowing) {
      window.electronAPI.isMaximized().then((max) => { if (!max) window.electronAPI.growWindow(delta); });
    } else if (!showRelatedPanel && wasShowing) {
      window.electronAPI.isMaximized().then((max) => { if (!max) window.electronAPI.shrinkWindow(delta); });
    }
  }, [showRelatedPanel]); // eslint-disable-line react-hooks/exhaustive-deps

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
  useKeyboardNav(orderedIds, selectedNodeId, setSelectedNodeId);

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

  return (
    <div className="two-column">
      {listCollapsed ? (
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
      <div className="resize-handle" onMouseDown={onMouseDown} />
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
      {showAttrFilterPanel && (
        <>
          <div className="resize-handle" onMouseDown={onAttrPaneResize} />
          <AttributeFilterPanel width={attrPaneWidth} />
        </>
      )}
      {/* Info Panel: renders as Pane 3 or Pane 4 depending on context */}
      {infoIsPane3 && (
        <>
          <div className="resize-handle" onMouseDown={onInfoPaneResize} />
          <AttributeInfoPanel width={infoPaneWidth} />
        </>
      )}
      {infoIsPane4 && (
        <>
          <div className="resize-handle" onMouseDown={onInfoPaneResize} />
          <AttributeInfoPanel width={infoPaneWidth} />
        </>
      )}
      {/* Related Edges Panel (Pane 3) */}
      {showRelatedPanel && !showAttrFilterPanel && (
        <>
          <div className="resize-handle" onMouseDown={onRelatedPaneResize} />
          <RelatedEdgesPanel width={relatedPaneWidth} />
        </>
      )}
      {/* Edge Detail Panel (Pane 4) */}
      {showEdgeDetail && !showAttrFilterPanel && (
        <>
          <div className="resize-handle" onMouseDown={onEdgeDetailResize} />
          <EdgeDetailPanel width={edgeDetailWidth} />
        </>
      )}
      {pinnedStack.length > 0 && !showAttrFilterPanel && !showInfoPanel && !showRelatedPanel && <PinnedPanel />}
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
