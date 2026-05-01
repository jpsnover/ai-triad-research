// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import type { SituationNode } from '../types/taxonomy';
import { useTaxonomyStore } from '../hooks/useTaxonomyStore';
import { useDebateStore } from '../hooks/useDebateStore';
import { useKeyboardNav } from '../hooks/useKeyboardNav';
import { useResizablePanel, useResizableRightPanel } from '../hooks/useResizablePanel';
import { SituationDetail } from './SituationDetail';
import { NodeDetail } from './NodeDetail';
import { FallacyPanel, FallacyDetailPanel } from './FallacyPanel';
import { PinnedPanel } from './PinnedPanel';
import { SearchPanel } from './SearchPanel';
import { AttributeFilterPanel } from './AttributeFilterPanel';
import { AttributeInfoPanel } from './AttributeInfoPanel';
import { RelatedEdgesPanel } from './RelatedEdgesPanel';
import { EdgeDetailPanel } from './EdgeDetailPanel';
import { LineagePanel } from './LineagePanel';
import { TerminalPanel } from './TerminalPanel';
import { EdgeBrowser } from './EdgeBrowser';
import { PolicyAlignmentPanel } from './PolicyAlignmentPanel';
import { PolicyDashboard } from './PolicyDashboard';
import { VocabularyPanel } from './VocabularyPanel';
import { getLineageInfo } from '../data/lineageLookup';
import { getCategoryLabel } from '../data/lineageCategories';
import { PromptsPanel, PromptDetailPanel } from './PromptsPanel';
import type { PromptCatalogEntry } from '../data/promptCatalog';
import { PROMPT_CATALOG } from '../data/promptCatalog';
import { nodeTypeFromId } from '@lib/debate/nodeIdUtils';
import { api } from '@bridge';

export function SituationsTab() {
  const {
    situations, selectedNodeId, setSelectedNodeId, createSituationNode,
    pinnedStack, pinAtDepth,
    attributeFilter, attributeInfo,
    relatedNodeId, showRelatedEdges, selectedEdge,
    toolbarPanel, setActiveTab,
  } = useTaxonomyStore();
  const [listCollapsed, setListCollapsed] = useState(false);
  const [detailCollapsed, setDetailCollapsed] = useState(false);
  const [hierarchyView, setHierarchyView] = useState<boolean>(() => {
    try {
      const v = localStorage.getItem('taxonomy-editor-sit-hierarchy');
      return v === null ? true : v === 'true';
    } catch { return true; }
  });
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => {
    try {
      const version = Number(localStorage.getItem('taxonomy-editor-sit-collapsed-version') || '0');
      if (version >= 3) {
        const raw = localStorage.getItem('taxonomy-editor-sit-collapsed');
        if (raw) return new Set(JSON.parse(raw));
      }
      localStorage.setItem('taxonomy-editor-sit-collapsed-version', '3');
    } catch { /* ignore */ }
    return new Set(['__default_collapsed__']); // sentinel: collapse all on first load
  });
  const [searchPreviewId, setSearchPreviewId] = useState<string | null>(null);
  const [lineagePreviewValue, setLineagePreviewValue] = useState<string | null>(null);
  const [lineageLinkUrl, setLineageLinkUrl] = useState<string | null>(null);
  const [selectedFallacyKey, setSelectedFallacyKey] = useState<string | null>(null);
  const [selectedPromptEntry, setSelectedPromptEntry] = useState<PromptCatalogEntry | null>(PROMPT_CATALOG[0]);
  const [promptInspectorActive, setPromptInspectorActive] = useState(false);
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
    api.isMaximized().then((max) => {
      if (max) return;
      if (showEdgeDetail) api.growWindow(delta);
      else api.shrinkWindow(delta);
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

  const toggleHierarchy = useCallback(() => {
    setHierarchyView(prev => {
      const next = !prev;
      localStorage.setItem('taxonomy-editor-sit-hierarchy', String(next));
      return next;
    });
  }, []);

  const toggleGroup = useCallback((key: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      localStorage.setItem('taxonomy-editor-sit-collapsed', JSON.stringify([...next]));
      return next;
    });
  }, []);

  // Build hierarchy structures for tree view
  const { roots, childMap, standalones } = useMemo(() => {
    if (!situations) return { roots: [] as SituationNode[], childMap: new Map<string, SituationNode[]>(), standalones: [] as SituationNode[] };
    const cMap = new Map<string, SituationNode[]>();
    const allNodes = situations.nodes;
    for (const n of allNodes) {
      if (n.parent_id) {
        const list = cMap.get(n.parent_id) || [];
        list.push(n);
        cMap.set(n.parent_id, list);
      }
    }
    const r = allNodes.filter(n => !n.parent_id && cMap.has(n.id))
      .sort((a, b) => (a.label || '').localeCompare(b.label || ''));
    const s = allNodes.filter(n => !n.parent_id && !cMap.has(n.id))
      .sort((a, b) => (a.label || '').localeCompare(b.label || ''));
    // Sort children within each group
    for (const [key, children] of cMap) {
      cMap.set(key, children.sort((a, b) => (a.label || '').localeCompare(b.label || '')));
    }
    return { roots: r, childMap: cMap, standalones: s };
  }, [situations]);

  // Ordered IDs for keyboard nav — hierarchy-aware when in tree view
  const orderedIds = useMemo(() => {
    if (!situations) return [];
    if (!hierarchyView) return situations.nodes.map(n => n.id);
    const ids: string[] = [];
    for (const root of roots) {
      ids.push(root.id);
      if (!collapsedGroups.has(root.id)) {
        for (const child of childMap.get(root.id) || []) {
          ids.push(child.id);
        }
      }
    }
    for (const node of standalones) {
      ids.push(node.id);
    }
    return ids;
  }, [situations, hierarchyView, roots, childMap, standalones, collapsedGroups]);

  useKeyboardNav(orderedIds, selectedNodeId, setSelectedNodeId, toolbarPanel !== null);

  // Default-collapse all groups on first load (when sentinel is present)
  useEffect(() => {
    if (collapsedGroups.has('__default_collapsed__') && roots.length > 0) {
      const allIds = new Set(roots.map(r => r.id));
      setCollapsedGroups(allIds);
      localStorage.setItem('taxonomy-editor-sit-collapsed', JSON.stringify([...allIds]));
    }
  }, [roots]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-select first node when tab loads
  useEffect(() => {
    if (!selectedNodeId && orderedIds.length > 0) {
      setSelectedNodeId(orderedIds[0]);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!situations) {
    return <div className="detail-panel-empty">No situations data loaded</div>;
  }

  const selectedNode = situations.nodes.find(n => n.id === selectedNodeId) || null;

  const handleFallacyNodeSelect = useCallback((nodeId: string, pov: string) => {
    // Map pov to tab and navigate
    const tabMap: Record<string, string> = {
      accelerationist: 'accelerationist',
      safetyist: 'safetyist',
      skeptic: 'skeptic',
      situations: 'situations',
    };
    const tab = tabMap[pov];
    if (tab) {
      setActiveTab(tab as any);
      // Delay to let the tab render before selecting
      setTimeout(() => setSelectedNodeId(nodeId), 50);
    }
  }, [setActiveTab, setSelectedNodeId]);

  const handlePin = () => {
    if (selectedNode) {
      pinAtDepth(0, {
        type: 'situations',
        node: structuredClone(selectedNode),
      });
    }
  };

  const handleRelated = () => {
    if (selectedNode) {
      showRelatedEdges(selectedNode.id);
    }
  };

  const createSituationDebate = useDebateStore(s => s.createSituationDebate);
  const handleDebate = useCallback(async () => {
    if (!selectedNode) return;
    await createSituationDebate(selectedNode.id);
    setActiveTab('debate');
  }, [selectedNode, createSituationDebate, setActiveTab]);

  // Render the promoted panel content for Pane 1
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
    if (!lineagePreviewValue) return <div className="detail-panel-empty">Select a lineage value to view details</div>;
    const info = getLineageInfo(lineagePreviewValue);
    if (!info) return (
      <div className="lineage-detail">
        <h2 className="lineage-detail-title">{lineagePreviewValue}</h2>
        <div className="lineage-category-badge">{getCategoryLabel(lineagePreviewValue)}</div>
        <div className="lineage-detail-section">
          <p className="lineage-detail-text" style={{ color: 'var(--text-muted)' }}>No detailed information available for this lineage value.</p>
        </div>
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
      case 'fallacy':
        return <FallacyPanel onSelectFallacy={setSelectedFallacyKey} />;
      case 'prompts':
        return <PromptsPanel onSelectPrompt={setSelectedPromptEntry} onInspectorToggle={setPromptInspectorActive} />;
      case 'console':
        return <TerminalPanel />;
      case 'edges':
        return <EdgeBrowser />;
      case 'policyAlignment':
        return <PolicyAlignmentPanel />;
      case 'policyDashboard':
        return <PolicyDashboard />;
      case 'vocabulary':
        return <VocabularyPanel />;
      default:
        return null;
    }
  };

  return (
    <div className="two-column">
      {/* Pane 1: Node list OR promoted toolbar panel */}
      {(toolbarPanel === 'search' || toolbarPanel === 'attrFilter' || toolbarPanel === 'console' || toolbarPanel === 'edges' || toolbarPanel === 'policyAlignment' || toolbarPanel === 'policyDashboard' || toolbarPanel === 'vocabulary' || (toolbarPanel === 'prompts' && promptInspectorActive)) ? (
        <div className="list-panel list-panel-full">
          {renderToolbarPane()}
        </div>
      ) : hasToolbarPane ? (
        <div className="list-panel" style={{ width }}>
          {renderToolbarPane()}
        </div>
      ) : listCollapsed ? (
        <div className="pane-collapsed pane-collapsed-list" onClick={() => setListCollapsed(false)} title="Expand list">
          <span className="pane-collapsed-label">Situations</span>
        </div>
      ) : (
        <div className="list-panel" style={{ width }}>
          <div className="list-panel-header">
            <h2>Situations</h2>
            <div className="list-panel-header-actions">
              <button
                className={`btn btn-sm${hierarchyView ? '' : ' btn-ghost'}`}
                onClick={toggleHierarchy}
                title={hierarchyView ? 'Switch to flat list' : 'Switch to hierarchy view'}
              >
                {hierarchyView ? 'Tree' : 'Flat'}
              </button>
              <button className="btn btn-sm" onClick={createSituationNode}>
                + New
              </button>
              <button className="pane-collapse-btn" onClick={() => setListCollapsed(true)} title="Collapse">&lsaquo;</button>
            </div>
          </div>
          <div className="list-panel-items">
            {hierarchyView ? (
              <>
                {roots.map((root) => {
                  const children = childMap.get(root.id) || [];
                  const isGroupCollapsed = collapsedGroups.has(root.id);
                  return (
                    <div key={root.id} className="node-tree-parent-group">
                      <div
                        className={`node-tree-parent-header ${selectedNodeId === root.id ? 'selected' : ''}`}
                        onClick={() => setSelectedNodeId(root.id)}
                      >
                        <span
                          className={`category-toggle ${isGroupCollapsed ? 'collapsed' : ''}`}
                          onClick={(e) => { e.stopPropagation(); toggleGroup(root.id); }}
                        >&#9660;</span>
                        <span className="node-tree-parent-label">{root.label || '(untitled)'}</span>
                        <span className="node-tree-parent-count">{children.length}</span>
                      </div>
                      {!isGroupCollapsed && children.map((child) => (
                        <ListItem
                          key={child.id}
                          id={child.id}
                          label={child.label}
                          isSelected={selectedNodeId === child.id}
                          onSelect={setSelectedNodeId}
                          indent
                          relationship={child.parent_relationship}
                        />
                      ))}
                    </div>
                  );
                })}
                {standalones.length > 0 && roots.length > 0 && (
                  <div style={{ borderTop: '1px solid var(--border)', marginTop: 4, paddingTop: 4 }} />
                )}
                {standalones.map((node) => (
                  <ListItem
                    key={node.id}
                    id={node.id}
                    label={node.label}
                    isSelected={selectedNodeId === node.id}
                    onSelect={setSelectedNodeId}
                  />
                ))}
              </>
            ) : (
              situations.nodes.map((node) => (
                <ListItem
                  key={node.id}
                  id={node.id}
                  label={node.label}
                  isSelected={selectedNodeId === node.id}
                  onSelect={setSelectedNodeId}
                />
              ))
            )}
          </div>
        </div>
      )}
      {toolbarPanel !== 'attrFilter' && toolbarPanel !== 'console' && toolbarPanel !== 'edges' && toolbarPanel !== 'policyAlignment' && toolbarPanel !== 'policyDashboard' && toolbarPanel !== 'vocabulary' && !(toolbarPanel === 'prompts' && promptInspectorActive) && (
        <div className="resize-handle" onMouseDown={onMouseDown} />
      )}
      {/* Pane 2: Detail (search preview, lineage preview, or normal detail) */}
      {toolbarPanel === 'search' ? (
        <div className="detail-panel">
          {renderSearchPreview()}
        </div>
      ) : toolbarPanel === 'related' ? (
        <div className="detail-panel">
          {showEdgeDetail ? (
            <EdgeDetailPanel />
          ) : (
            <div className="detail-panel-empty">Select an edge to view details</div>
          )}
        </div>
      ) : (toolbarPanel === 'attrFilter' || toolbarPanel === 'console' || toolbarPanel === 'edges' || toolbarPanel === 'policyAlignment' || toolbarPanel === 'policyDashboard' || toolbarPanel === 'vocabulary' || (toolbarPanel === 'prompts' && promptInspectorActive)) ? null
      : (toolbarPanel === 'prompts' && !promptInspectorActive) ? (
        <div className="detail-panel">
          <PromptDetailPanel entry={selectedPromptEntry} />
        </div>
      ) : toolbarPanel === 'fallacy' ? (
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
            <div className="detail-panel">
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 4 }}>
                <button className="pane-collapse-btn" onClick={() => setDetailCollapsed(true)} title="Collapse">&lsaquo;</button>
              </div>
              {selectedNode ? (
                <SituationDetail node={selectedNode} onPin={handlePin} onRelated={handleRelated} onDebate={handleDebate} />
              ) : (
                <div className="detail-panel-empty">Select a situation node to edit</div>
              )}
            </div>
          )}
          {pinnedStack.length > 0 && !hasToolbarPane && <PinnedPanel />}
        </>
      )}
    </div>
  );
}

const REL_LABELS: Record<string, string> = {
  is_a: 'is a',
  part_of: 'part of',
  specializes: 'specializes',
};

function ListItem({ id, label, isSelected, onSelect, indent, relationship }: {
  id: string;
  label: string;
  isSelected: boolean;
  onSelect: (id: string) => void;
  indent?: boolean;
  relationship?: string | null;
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
      className={`node-item ${isSelected ? 'selected' : ''}${indent ? ' node-item-child' : ''}`}
      onClick={() => onSelect(id)}
    >
      <div>{label || '(untitled)'}</div>
      <div className="node-item-id">
        {id}
        {relationship && <span className="node-item-rel">{REL_LABELS[relationship] || relationship}</span>}
      </div>
    </div>
  );
}

/** @deprecated Use SituationsTab instead */
export const CrossCuttingTab = SituationsTab;
