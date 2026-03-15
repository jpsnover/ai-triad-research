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
import { NewNodeDialog } from './NewNodeDialog';
import { PinnedPanel } from './PinnedPanel';
import { SimilarSearchPanel } from './SimilarSearchPanel';
import { AnalysisPanel } from './AnalysisPanel';
import { AttributeFilterPanel } from './AttributeFilterPanel';
import { AttributeInfoPanel } from './AttributeInfoPanel';

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
  } = useTaxonomyStore();
  const file = useTaxonomyStore((s) => s[pov]);
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>('id');
  const { width, onMouseDown } = useResizablePanel();
  const { width: pane3Width, onMouseDown: onPane3Resize } = useResizableRightPanel({
    storageKey: 'taxonomy-editor-similar-panel-width',
    defaultWidth: 480,
    minWidth: 320,
    maxWidth: 900,
  });
  const { width: pane4Width, onMouseDown: onPane4Resize } = useResizableRightPanel({
    storageKey: 'taxonomy-editor-analysis-panel-width',
    defaultWidth: 420,
    minWidth: 300,
    maxWidth: 800,
  });
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
  useKeyboardNav(orderedIds, selectedNodeId, setSelectedNodeId);

  // Auto-select first node when tab loads and nothing is selected
  useEffect(() => {
    if (!selectedNodeId && orderedIds.length > 0) {
      setSelectedNodeId(orderedIds[0]);
    }
  }, [pov]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!file) {
    return <div className="detail-panel-empty">No data loaded for {pov}</div>;
  }

  const selectedNode = file.nodes.find(n => n.id === selectedNodeId) || null;

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
  const showAttrFilterPanel = attributeFilter !== null;
  const showInfoPanel = attributeInfo !== null;

  // Determine where info panel renders:
  // - If a Pane 3 is already showing (similar or attr filter), info renders as Pane 4
  // - Otherwise info renders as Pane 3
  const hasPane3 = showSimilarPanel || showAttrFilterPanel;
  const infoIsPane4 = showInfoPanel && hasPane3;
  const infoIsPane3 = showInfoPanel && !hasPane3;

  // Grow/shrink window when Pane 3 opens/closes
  const prevShowSimilar = useRef(false);
  useEffect(() => {
    const wasShowing = prevShowSimilar.current;
    prevShowSimilar.current = showSimilarPanel;
    // 4px for the resize handle
    const delta = pane3Width + 4;
    if (showSimilarPanel && !wasShowing) {
      window.electronAPI.growWindow(delta);
    } else if (!showSimilarPanel && wasShowing) {
      window.electronAPI.shrinkWindow(delta);
    }
  }, [showSimilarPanel]); // eslint-disable-line react-hooks/exhaustive-deps

  // Grow/shrink window when Pane 4 (analysis) opens/closes
  const prevShowAnalysis = useRef(false);
  useEffect(() => {
    const wasShowing = prevShowAnalysis.current;
    prevShowAnalysis.current = showAnalysisPanel;
    const delta = pane4Width + 4;
    if (showAnalysisPanel && !wasShowing) {
      window.electronAPI.growWindow(delta);
    } else if (!showAnalysisPanel && wasShowing) {
      window.electronAPI.shrinkWindow(delta);
    }
  }, [showAnalysisPanel]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // Auto-refresh similar search when selection changes while panel is open
  useEffect(() => {
    if (showSimilarPanel && selectedNode && !similarLoading) {
      runSimilarSearch(selectedNode.id, selectedNode.label, selectedNode.description);
    }
  }, [selectedNodeId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="two-column">
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
      <div className="resize-handle" onMouseDown={onMouseDown} />
      <div className="detail-panel" data-cat={selectedNode?.category}>
        {selectedNode ? (
          <NodeDetail pov={pov} node={selectedNode} onPin={handlePin} onSimilarSearch={handleSimilarSearch} />
        ) : (
          <div className="detail-panel-empty">Select a node to edit</div>
        )}
      </div>
      {/* Pane 3: Similar Search */}
      {showSimilarPanel && (
        <>
          <div className="resize-handle" onMouseDown={onPane3Resize} />
          <SimilarSearchPanel width={pane3Width} onAnalyze={handleAnalyze} />
        </>
      )}
      {/* Pane 4: Analysis (only when similar is showing) */}
      {showAnalysisPanel && (
        <>
          <div className="resize-handle" onMouseDown={onPane4Resize} />
          <AnalysisPanel width={pane4Width} />
        </>
      )}
      {/* Pane 3: Attribute Filter (when similar not showing) */}
      {showAttrFilterPanel && !showSimilarPanel && (
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
      {pinnedStack.length > 0 && !showSimilarPanel && !showAttrFilterPanel && !showInfoPanel && <PinnedPanel />}
      {showNewDialog && (
        <NewNodeDialog
          onConfirm={handleCreate}
          onCancel={() => setShowNewDialog(false)}
        />
      )}
    </div>
  );
}
