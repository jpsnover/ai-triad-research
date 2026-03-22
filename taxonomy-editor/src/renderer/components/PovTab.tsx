// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useMemo, useEffect, useRef } from 'react';
import type { Pov, Category, PovNode } from '../types/taxonomy';
import { useTaxonomyStore } from '../hooks/useTaxonomyStore';
import { useKeyboardNav } from '../hooks/useKeyboardNav';
import { useResizablePanel, useResizableRightPanel } from '../hooks/useResizablePanel';
import { NodeTree, getOrderedNodeIds } from './NodeTree';
import type { SortMode } from './NodeTree';
import { NodeDetail } from './NodeDetail';
import { CrossCuttingDetail } from './CrossCuttingDetail';
import { NewNodeDialog } from './NewNodeDialog';
import { PinnedPanel } from './PinnedPanel';
import { SearchPanel } from './SearchPanel';
import { AnalysisPanel } from './AnalysisPanel';
import { AttributeFilterPanel } from './AttributeFilterPanel';
import { AttributeInfoPanel } from './AttributeInfoPanel';
import { RelatedEdgesPanel } from './RelatedEdgesPanel';
import { EdgeDetailPanel } from './EdgeDetailPanel';
import { LineagePanel } from './LineagePanel';
import { INTELLECTUAL_LINEAGES } from '../data/intellectualLineageInfo';

interface PovTabProps {
  pov: Pov;
}

export function PovTab({ pov }: PovTabProps) {
  const {
    selectedNodeId, setSelectedNodeId, createPovNode, pinnedStack, pinAtDepth,
    runSimilarSearch, similarResults, similarLoading, similarError,
    runAnalyzeDistinction, analysisResult, analysisLoading, analysisError, clearAnalysis,
    attributeFilter, attributeInfo,
    clusterView, clusterLoading, clusterError, runClusterView, clearClusterView,
    relatedNodeId, showRelatedEdges, selectedEdge,
    toolbarPanel,
  } = useTaxonomyStore();
  const file = useTaxonomyStore((s) => s[pov]);
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>('id');
  const [listCollapsed, setListCollapsed] = useState(false);
  const [detailCollapsed, setDetailCollapsed] = useState(false);
  const [searchPreviewId, setSearchPreviewId] = useState<string | null>(null);
  const [lineagePreviewValue, setLineagePreviewValue] = useState<string | null>(null);
  const [lineageLinkUrl, setLineageLinkUrl] = useState<string | null>(null);
  const { width, onMouseDown } = useResizablePanel();
  const { width: pane3Width, onMouseDown: onPane3Resize } = useResizableRightPanel({
    storageKey: 'taxonomy-editor-analysis-panel-width',
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

  const similarScoresMap = useMemo(() => {
    if (!similarResults || similarResults.length === 0) return null;
    const m = new Map<string, number>();
    for (const r of similarResults) m.set(r.id, r.score);
    return m;
  }, [similarResults]);

  const clusterGroups = clusterView?.clusters ?? null;

  const orderedIds = useMemo(
    () => (file ? getOrderedNodeIds(file.nodes, sortMode, similarScoresMap, clusterGroups) : []),
    [file, sortMode, similarScoresMap, clusterGroups],
  );

  // Trigger clustering when sort mode switches to similarity
  useEffect(() => {
    if (sortMode === 'similarity') {
      runClusterView(pov);
    } else {
      clearClusterView();
    }
  }, [sortMode, pov]); // eslint-disable-line react-hooks/exhaustive-deps
  useKeyboardNav(orderedIds, selectedNodeId, setSelectedNodeId, toolbarPanel !== null);

  // Auto-select first node when tab loads and nothing is selected
  useEffect(() => {
    if (!selectedNodeId && orderedIds.length > 0) {
      setSelectedNodeId(orderedIds[0]);
    }
  }, [pov]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedNode = file ? file.nodes.find(n => n.id === selectedNodeId) || null : null;

  const handleCreate = (category: Category) => {
    createPovNode(pov, category);
    setShowNewDialog(false);
  };

  const handlePin = () => {
    if (selectedNode) {
      pinAtDepth(0, {
        type: 'pov',
        pov,
        node: structuredClone(selectedNode),
      });
    }
  };

  const handleSimilarSearch = () => {
    if (selectedNode) {
      runSimilarSearch(selectedNode.id, selectedNode.label, selectedNode.description);
    }
  };

  const handleRelated = () => {
    if (selectedNode) {
      showRelatedEdges(selectedNode.id);
    }
  };

  const handleAnalyze = (elementB: { label: string; description: string; category: string }) => {
    if (selectedNode) {
      runAnalyzeDistinction(
        { label: selectedNode.label, description: selectedNode.description, category: selectedNode.category },
        elementB,
      );
    }
  };

  const showSimilarPanel = similarResults !== null || similarLoading || !!similarError;
  const showAnalysisPanel = analysisResult !== null || analysisLoading || !!analysisError;
  const showRelatedPanel = relatedNodeId !== null;
  const showEdgeDetail = selectedEdge !== null && showRelatedPanel;

  // A promoted panel is active in Pane 1
  const hasToolbarPane = toolbarPanel !== null;

  // Auto-collapse pane 2 when edge detail opens; auto-expand when closed
  const prevEdgeDetailForCollapse = useRef(false);
  useEffect(() => {
    const was = prevEdgeDetailForCollapse.current;
    prevEdgeDetailForCollapse.current = showEdgeDetail;
    if (showEdgeDetail && !was) setDetailCollapsed(true);
    if (!showEdgeDetail && was) setDetailCollapsed(false);
  }, [showEdgeDetail]);

  // Grow/shrink window for Analysis panel (child of Similar, still Pane 3)
  const prevShowAnalysis = useRef(false);
  useEffect(() => {
    const wasShowing = prevShowAnalysis.current;
    prevShowAnalysis.current = showAnalysisPanel;
    if (showAnalysisPanel === wasShowing) return;
    const delta = pane3Width + 4;
    window.electronAPI.isMaximized().then((max) => {
      if (max) return;
      if (showAnalysisPanel) window.electronAPI.growWindow(delta);
      else window.electronAPI.shrinkWindow(delta);
    });
  }, [showAnalysisPanel]); // eslint-disable-line react-hooks/exhaustive-deps

  // Grow/shrink window for Edge Detail panel (child of Related, still Pane 3)
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

  // Auto-refresh similar search when selection changes while panel is open
  useEffect(() => {
    if (showSimilarPanel && selectedNode && !similarLoading) {
      runSimilarSearch(selectedNode.id, selectedNode.label, selectedNode.description);
    }
  }, [selectedNodeId]); // eslint-disable-line react-hooks/exhaustive-deps

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
    // console.log('[PovTab] renderLineagePreview called. lineagePreviewValue:', JSON.stringify(lineagePreviewValue), '| toolbarPanel:', toolbarPanel);
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

  // Render the promoted panel content for Pane 1
  const renderToolbarPane = () => {
    switch (toolbarPanel) {
      case 'search':
        return <SearchPanel onAnalyze={handleAnalyze} onSelectResult={setSearchPreviewId} />;
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

  if (!file) {
    return <div className="detail-panel-empty">No data loaded for {pov}</div>;
  }

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
          <span className="pane-collapsed-label">{pov}</span>
        </div>
      ) : (
        <div className="list-panel" style={{ width }}>
          <div className="list-panel-header">
            <h2>{pov}</h2>
            <div className="list-panel-header-actions">
              <select
                className="sort-select"
                value={sortMode}
                onChange={(e) => setSortMode(e.target.value as SortMode)}
                title="Sort nodes"
              >
                <option value="id">Sort: ID</option>
                <option value="label">Sort: Label</option>
                <option value="similarity">Sort: Similarity</option>
              </select>
              <button className="btn btn-sm" onClick={() => setShowNewDialog(true)}>
                + New
              </button>
              <button className="pane-collapse-btn" onClick={() => setListCollapsed(true)} title="Collapse">&lsaquo;</button>
            </div>
          </div>
          <div className="list-panel-items">
            <NodeTree
              nodes={file.nodes}
              selectedNodeId={selectedNodeId}
              onSelect={setSelectedNodeId}
              sortMode={sortMode}
              similarScores={similarScoresMap}
              clusters={clusterGroups}
              clusterLoading={clusterLoading}
            />
          </div>
        </div>
      )}
      {toolbarPanel !== 'attrFilter' && (
        <div className="resize-handle" onMouseDown={onMouseDown} />
      )}
      {/* Pane 2: Detail (search preview, lineage, or normal detail) */}
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
            <div className="detail-panel" data-cat={selectedNode?.category}>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 4 }}>
                <button className="pane-collapse-btn" onClick={() => setDetailCollapsed(true)} title="Collapse">&lsaquo;</button>
              </div>
              {selectedNode ? (
                <NodeDetail pov={pov} node={selectedNode} onPin={handlePin} onSimilarSearch={handleSimilarSearch} onRelated={handleRelated} />
              ) : (
                <div className="detail-panel-empty">Select a node to edit</div>
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
      {showNewDialog && (
        <NewNodeDialog
          onConfirm={handleCreate}
          onCancel={() => setShowNewDialog(false)}
        />
      )}
    </div>
  );
}
