// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import type { Pov, Category, PovNode } from '../types/taxonomy';
import { PROMPT_CATALOG, type PromptCatalogEntry } from '../data/promptCatalog';
import { useTaxonomyStore } from '../hooks/useTaxonomyStore';
import { useKeyboardNav } from '../hooks/useKeyboardNav';
import { useResizablePanel, useResizableRightPanel } from '../hooks/useResizablePanel';
import { NodeTree, getOrderedNodeIds } from './NodeTree';
import type { SortMode } from './NodeTree';
import { NodeDetail } from './NodeDetail';
import { SituationDetail } from './SituationDetail';
import { NewNodeDialog } from './NewNodeDialog';
import { PinnedPanel } from './PinnedPanel';
import { SearchPanel } from './SearchPanel';
import { AnalysisPanel } from './AnalysisPanel';
import { AttributeFilterPanel } from './AttributeFilterPanel';
import { AttributeInfoPanel } from './AttributeInfoPanel';
import { RelatedEdgesPanel } from './RelatedEdgesPanel';
import { EdgeDetailPanel } from './EdgeDetailPanel';
import { LineagePanel } from './LineagePanel';
import { PromptsPanel, PromptDetailPanel } from './PromptsPanel';
import { FallacyPanel, FallacyDetailPanel } from './FallacyPanel';
import { TerminalPanel } from './TerminalPanel';
import { INTELLECTUAL_LINEAGES } from '../data/intellectualLineageInfo';
import { getLineageInfo } from '../data/lineageLookup';
import { getCategoryLabel, classifyLineage } from '../data/lineageCategories';
import { EdgeBrowser } from './EdgeBrowser';
import { PolicyAlignmentPanel } from './PolicyAlignmentPanel';
import { PolicyDashboard } from './PolicyDashboard';
import { nodeTypeFromId } from '@lib/debate';
import { api } from '@bridge';

interface PovTabProps {
  pov: Pov;
}

const SEE_ALSO_STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'of', 'to', 'in', 'on', 'at', 'by', 'for',
  'with', 'from', 'as', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'this', 'that', 'these', 'those', 'it', 'its', 'into', 'which', 'who',
  'not', 'no', 'but', 'if', 'then', 'than', 'so', 'also', 'such', 'other',
  'about', 'their', 'they', 'them', 'theory', 'view', 'based',
]);

function tokenize(s: string): Set<string> {
  const tokens = s.toLowerCase().match(/[a-z][a-z0-9-]{2,}/g) ?? [];
  return new Set(tokens.filter(t => !SEE_ALSO_STOPWORDS.has(t)));
}

/** Rank related lineage entries by shared label/summary tokens and category. */
function computeSeeAlso(
  rawKey: string,
  info: { label: string; summary: string } | null,
): { key: string; label: string }[] {
  const currentKey = Object.keys(INTELLECTUAL_LINEAGES).find(k =>
    k.toLowerCase() === rawKey.toLowerCase()
  ) ?? rawKey;
  const currentCat = classifyLineage(currentKey);
  const currentTokens = tokenize(`${info?.label ?? currentKey} ${info?.summary ?? ''}`);

  type Scored = { key: string; label: string; score: number };
  const scored: Scored[] = [];
  for (const [key, inf] of Object.entries(INTELLECTUAL_LINEAGES)) {
    if (key === currentKey) continue;
    const cand = tokenize(`${inf.label} ${inf.summary}`);
    let overlap = 0;
    for (const t of cand) if (currentTokens.has(t)) overlap++;
    if (overlap === 0) continue;
    const sameCat = classifyLineage(key) === currentCat ? 2 : 0;
    scored.push({ key, label: inf.label, score: overlap + sameCat });
  }
  scored.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));
  // Take top 6; require minimum 2-token overlap (or same-cat bonus) to keep quality high.
  const top = scored.filter(s => s.score >= 2).slice(0, 6);
  // If fewer than 2 survive the filter, fall back to the best candidates so we always surface something.
  return top.length >= 2 ? top : scored.slice(0, Math.min(6, scored.length));
}

export function PovTab({ pov }: PovTabProps) {
  const {
    selectedNodeId, setSelectedNodeId, createPovNode, pinnedStack, pinAtDepth,
    similarResults, similarLoading, similarError,
    runAnalyzeDistinction, analysisResult, analysisLoading, analysisError, clearAnalysis,
    navigateToSearchRelated,
    attributeFilter, attributeInfo,
    clusterView, clusterLoading, clusterError, runClusterView, clearClusterView,
    relatedNodeId, showRelatedEdges, selectedEdge,
    toolbarPanel, setActiveTab,
  } = useTaxonomyStore();
  const file = useTaxonomyStore((s) => s[pov]);
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>('label');
  const [listCollapsed, setListCollapsed] = useState(false);
  const [detailCollapsed, setDetailCollapsed] = useState(false);
  const [searchPreviewId, setSearchPreviewId] = useState<string | null>(null);
  const [lineagePreviewValue, setLineagePreviewValue] = useState<string | null>(null);
  const [lineageSecondaryValue, setLineageSecondaryValue] = useState<string | null>(null);
  const [lineageLinkUrl, setLineageLinkUrl] = useState<string | null>(null);
  // Clear pane 3 webview + secondary preview when a different lineage value is selected in pane 1
  useEffect(() => { setLineageLinkUrl(null); setLineageSecondaryValue(null); }, [lineagePreviewValue]);
  const [selectedPromptEntry, setSelectedPromptEntry] = useState<PromptCatalogEntry | null>(PROMPT_CATALOG[0]);
  const [promptInspectorActive, setPromptInspectorActive] = useState(false);
  const handleSelectPrompt = useCallback((entry: PromptCatalogEntry | null) => setSelectedPromptEntry(entry), []);
  const [selectedFallacyKey, setSelectedFallacyKey] = useState<string | null>(null);
  const handleSelectFallacy = useCallback((key: string | null) => setSelectedFallacyKey(key), []);
  const handleFallacyNodeSelect = useCallback((nodeId: string, nodePov: string) => {
    const tabMap: Record<string, string> = {
      accelerationist: 'accelerationist', safetyist: 'safetyist',
      skeptic: 'skeptic', situations: 'situations',
    };
    const tab = tabMap[nodePov];
    if (tab) {
      setActiveTab(tab as any);
      setTimeout(() => setSelectedNodeId(nodeId), 50);
    }
  }, [setActiveTab, setSelectedNodeId]);
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
  const clusterMisfits = clusterView?.misfits ?? null;

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
      navigateToSearchRelated(selectedNode.id);
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
  // Skip when toolbar=related (edge detail is in pane 2) or when NodeDetail's Related tab is active
  const prevEdgeDetailForCollapse = useRef(false);
  useEffect(() => {
    const was = prevEdgeDetailForCollapse.current;
    prevEdgeDetailForCollapse.current = showEdgeDetail;
    if (toolbarPanel === 'related') return;
    // If relatedNodeId is set but toolbar isn't 'related', NodeDetail's Related tab is handling it
    if (relatedNodeId && !toolbarPanel) return;
    if (showEdgeDetail && !was) setDetailCollapsed(true);
    if (!showEdgeDetail && was) setDetailCollapsed(false);
  }, [showEdgeDetail, toolbarPanel, relatedNodeId]);

  // Grow/shrink window for Analysis panel (child of Similar, still Pane 3)
  const prevShowAnalysis = useRef(false);
  useEffect(() => {
    const wasShowing = prevShowAnalysis.current;
    prevShowAnalysis.current = showAnalysisPanel;
    if (showAnalysisPanel === wasShowing) return;
    const delta = pane3Width + 4;
    api.isMaximized().then((max) => {
      if (max) return;
      if (showAnalysisPanel) api.growWindow(delta);
      else api.shrinkWindow(delta);
    });
  }, [showAnalysisPanel]); // eslint-disable-line react-hooks/exhaustive-deps

  // Grow/shrink window for Edge Detail panel (only in non-toolbar mode where it's a new Pane 3)
  // Skip when toolbar=related or when NodeDetail's Related tab is handling edges inline
  const prevShowEdgeDetail = useRef(false);
  useEffect(() => {
    const wasShowing = prevShowEdgeDetail.current;
    prevShowEdgeDetail.current = showEdgeDetail;
    if (showEdgeDetail === wasShowing) return;
    if (toolbarPanel === 'related') return;
    if (relatedNodeId && !toolbarPanel) return; // NodeDetail Related tab is active
    const delta = edgeDetailWidth + 4;
    api.isMaximized().then((max) => {
      if (max) return;
      if (showEdgeDetail) api.growWindow(delta);
      else api.shrinkWindow(delta);
    });
  }, [showEdgeDetail, toolbarPanel, relatedNodeId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-refresh related edges when selection changes while toolbar panel is open
  // Only trigger when the user explicitly opened the toolbar Related panel (not NodeDetail's Related tab)
  useEffect(() => {
    if (toolbarPanel === 'related' && selectedNode) {
      showRelatedEdges(selectedNode.id);
    }
  }, [selectedNodeId]); // eslint-disable-line react-hooks/exhaustive-deps

  // (Similar search auto-refresh is handled by SearchPanel)

  // Render cross-POV node detail for search preview
  const renderSearchPreview = () => {
    if (!searchPreviewId) return <div className="detail-panel-empty">Select a search result to preview</div>;
    const state = useTaxonomyStore.getState();
    if (nodeTypeFromId(searchPreviewId) === 'situation') {
      const node = state.situations?.nodes.find(n => n.id === searchPreviewId);
      if (node) return <SituationDetail node={node} readOnly chipDepth={0} />;
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
    const info = getLineageInfo(lineagePreviewValue);
    // Compute See Also — sibling lineage entries ranked by relevance
    const seeAlsoItems = computeSeeAlso(lineagePreviewValue, info);

    const renderSeeAlso = () => seeAlsoItems.length > 0 && (
      <div className="lineage-detail-section">
        <div className="lineage-detail-label">See Also</div>
        <div className="lineage-detail-links">
          {seeAlsoItems.map(({ key, label }) => (
            <button
              key={key}
              className={`btn btn-sm${lineageSecondaryValue === key ? '' : ' btn-ghost'}`}
              onClick={() => setLineageSecondaryValue(lineageSecondaryValue === key ? null : key)}
              title={`Preview: ${label}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    );

    const renderSecondary = () => {
      if (!lineageSecondaryValue) return null;
      const secInfo = getLineageInfo(lineageSecondaryValue);
      return (
        <div className="lineage-detail-secondary">
          <div className="lineage-detail-secondary-header">
            <div>
              <div className="lineage-detail-secondary-eyebrow">See Also</div>
              <h3 className="lineage-detail-secondary-title">{secInfo?.label ?? lineageSecondaryValue}</h3>
              <div className="lineage-category-badge">{getCategoryLabel(lineageSecondaryValue)}</div>
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              <button
                className="btn btn-sm btn-ghost"
                onClick={() => { setLineagePreviewValue(lineageSecondaryValue); }}
                title="Open as primary"
              >Open</button>
              <button
                className="btn btn-sm btn-ghost"
                onClick={() => setLineageSecondaryValue(null)}
                title="Close secondary pane"
              >Close</button>
            </div>
          </div>
          {secInfo ? (
            <>
              <div className="lineage-detail-section">
                <div className="lineage-detail-label">Summary</div>
                <p className="lineage-detail-text">{secInfo.summary}</p>
              </div>
              <div className="lineage-detail-section">
                <div className="lineage-detail-label">Example</div>
                <p className="lineage-detail-text">{secInfo.example}</p>
              </div>
              <div className="lineage-detail-section">
                <div className="lineage-detail-label">Frequency</div>
                <p className="lineage-detail-text">{secInfo.frequency}</p>
              </div>
              {secInfo.links && secInfo.links.length > 0 && (
                <div className="lineage-detail-section">
                  <div className="lineage-detail-label">Links</div>
                  <div className="lineage-detail-links">
                    {secInfo.links.map((link, i) => (
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
            </>
          ) : (
            <div className="lineage-detail-section">
              <p className="lineage-detail-text" style={{ color: 'var(--text-muted)' }}>No detailed information available.</p>
            </div>
          )}
        </div>
      );
    };

    if (!info) return (
      <div className="lineage-detail">
        <h2 className="lineage-detail-title">{lineagePreviewValue}</h2>
        <div className="lineage-category-badge">{getCategoryLabel(lineagePreviewValue)}</div>
        <div className="lineage-detail-section">
          <p className="lineage-detail-text" style={{ color: 'var(--text-muted)' }}>No detailed information available for this lineage value.</p>
        </div>
        {renderSeeAlso()}
        {renderSecondary()}
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
        {renderSeeAlso()}
        {renderSecondary()}
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
      case 'prompts':
        return <PromptsPanel onSelectPrompt={handleSelectPrompt} onInspectorToggle={setPromptInspectorActive} />;
      case 'fallacy':
        return <FallacyPanel onSelectFallacy={handleSelectFallacy} />;
      case 'console':
        return <TerminalPanel />;
      case 'policyAlignment':
        return <PolicyAlignmentPanel />;
      case 'policyDashboard':
        return <PolicyDashboard />;
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
      {toolbarPanel === 'search' ? (
        <div className="list-panel" style={{ width }}>
          {renderToolbarPane()}
        </div>
      ) : toolbarPanel === 'edges' ? (
        <div className="list-panel list-panel-full">
          <EdgeBrowser />
        </div>
      ) : (toolbarPanel === 'attrFilter' || toolbarPanel === 'console' || toolbarPanel === 'policyAlignment' || toolbarPanel === 'policyDashboard') ? (
        <div className="list-panel list-panel-full">
          {renderToolbarPane()}
        </div>
      ) : (hasToolbarPane && toolbarPanel === 'prompts' && promptInspectorActive) ? (
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
              misfits={clusterMisfits}
            />
          </div>
        </div>
      )}
      {toolbarPanel !== 'attrFilter' && toolbarPanel !== 'console' && toolbarPanel !== 'edges' && toolbarPanel !== 'policyAlignment' && toolbarPanel !== 'policyDashboard' && !(toolbarPanel === 'prompts' && promptInspectorActive) && (
        <div className="resize-handle" onMouseDown={onMouseDown} />
      )}
      {/* Pane 2: Detail (search preview, lineage, or normal detail) */}
      {toolbarPanel === 'search' ? (
        <div className="detail-panel">
          {renderSearchPreview()}
        </div>
      ) : toolbarPanel === 'related' ? (
        <div className="detail-panel">
          {showEdgeDetail ? (
            <EdgeDetailPanel width={0} />
          ) : (
            <div className="detail-panel-empty">Select an edge to view details</div>
          )}
        </div>
      ) : (toolbarPanel === 'attrFilter' || toolbarPanel === 'console' || toolbarPanel === 'edges' || toolbarPanel === 'policyAlignment' || toolbarPanel === 'policyDashboard') ? null
      : (toolbarPanel === 'prompts' && !promptInspectorActive) ? (
        <div className="detail-panel">
          <PromptDetailPanel entry={selectedPromptEntry} />
        </div>
      )
      : toolbarPanel === 'prompts' ? null : toolbarPanel === 'fallacy' ? (
        <div className="detail-panel">
          <FallacyDetailPanel fallacyKey={selectedFallacyKey} onSelectNode={handleFallacyNodeSelect} />
        </div>
      ) : toolbarPanel === 'lineage' ? (
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
                {import.meta.env.VITE_TARGET === 'web'
                  ? <iframe src={lineageLinkUrl} className="webview-frame" sandbox="allow-scripts allow-same-origin" />
                  : <webview src={lineageLinkUrl} className="webview-frame" />}
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
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 0, lineHeight: 1 }}>
                <button className="pane-collapse-btn" onClick={() => setDetailCollapsed(true)} title="Collapse">&lsaquo;</button>
              </div>
              {selectedNode ? (
                <NodeDetail pov={pov} node={selectedNode} onPin={handlePin} onSimilarSearch={handleSimilarSearch} onRelated={handleRelated} />
              ) : (
                <div className="detail-panel-empty">Select a node to edit</div>
              )}
            </div>
          )}
          {pinnedStack.length > 0 && !hasToolbarPane && <PinnedPanel />}
        </>
      )}
      {showAnalysisPanel && (
        <>
          <div className="resize-handle" onMouseDown={onPane3Resize} />
          <AnalysisPanel width={pane3Width} />
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
