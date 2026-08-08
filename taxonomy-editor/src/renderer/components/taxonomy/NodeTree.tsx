// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useEffect, useRef, useState, useCallback } from 'react';
import { getGlobalRecorder } from '@lib/flight-recorder/index';
import type { PovNode, Pov, Category } from '../../types/taxonomy';
import { EditConflictBadge, type NodeConflict } from '../conflict/edit-conflicts';
import { DebateTestedChip } from './DebateTestedChip';
import './NodeTree.css';

export type SortMode = 'id' | 'label' | 'similarity' | 'priority' | 'debate_tested' | 'debate_tested_desc';

export interface ClusterGroup {
  label: string;
  nodeIds: string[];
}

interface NodeTreeProps {
  nodes: PovNode[];
  selectedNodeId: string | null;
  onSelect: (id: string) => void;
  pov?: Pov;
  sortMode?: SortMode;
  similarScores?: Map<string, number> | null;
  clusters?: ClusterGroup[] | null;
  clusterLoading?: boolean;
  misfits?: Set<string> | null;
  onVisibleIdsChange?: (ids: string[]) => void;
  conflicts?: Map<string, NodeConflict>;
  resolveUrl?: string | null;
}

const CATEGORY_ORDER: Category[] = ['Desires', 'Intentions', 'Beliefs'];

function sortNodes(nodes: PovNode[], mode: SortMode, scores: Map<string, number> | null): PovNode[] {
  if (mode === 'id') {
    return [...nodes].sort((a, b) => a.id.localeCompare(b.id));
  }
  if (mode === 'label') {
    return [...nodes].sort((a, b) => a.label.localeCompare(b.label));
  }
  if (mode === 'similarity' && scores && scores.size > 0) {
    return [...nodes].sort((a, b) => (scores.get(b.id) ?? -1) - (scores.get(a.id) ?? -1));
  }
  if (mode === 'priority') {
    return [...nodes].sort((a, b) => {
      // Desires: sort by priority descending (higher = more important)
      if (a.category === 'Desires' && b.category === 'Desires') {
        return (b.priority ?? 0) - (a.priority ?? 0);
      }
      // Beliefs: sort by confidence descending
      if (a.category === 'Beliefs' && b.category === 'Beliefs') {
        return (b.confidence ?? 0) - (a.confidence ?? 0);
      }
      // Intentions: keep ID order
      return a.id.localeCompare(b.id);
    });
  }
  if (mode === 'debate_tested' || mode === 'debate_tested_desc') {
    // ascending = least tested first (gap-finding); descending = most tested first
    const dir = mode === 'debate_tested_desc' ? -1 : 1;
    return [...nodes].sort((a, b) => {
      const aKey = a.graph_attributes?.debate_tested?.sort_key ?? 0;
      const bKey = b.graph_attributes?.debate_tested?.sort_key ?? 0;
      return (aKey - bKey) * dir;
    });
  }
  return nodes;
}

export function getOrderedNodeIds(
  nodes: PovNode[],
  sortMode: SortMode = 'id',
  similarScores?: Map<string, number> | null,
  clusters?: ClusterGroup[] | null,
): string[] {
  // Cluster mode: return IDs in cluster order
  if (sortMode === 'similarity' && clusters && clusters.length > 0) {
    return clusters.flatMap(c => c.nodeIds);
  }

  const grouped = new Map<Category, PovNode[]>();
  for (const cat of CATEGORY_ORDER) {
    grouped.set(cat, []);
  }
  for (const node of nodes) {
    const list = grouped.get(node.category);
    if (list) list.push(node);
  }
  const ids: string[] = [];
  for (const cat of CATEGORY_ORDER) {
    const catNodes = sortNodes(grouped.get(cat) || [], sortMode, similarScores ?? null);
    for (const node of catNodes) {
      ids.push(node.id);
    }
  }
  return ids;
}

const COLLAPSE_STORAGE_KEY = 'taxonomy-editor-collapsed-categories';
const COLLAPSE_VERSION_KEY = 'taxonomy-editor-collapsed-version';
const COLLAPSE_VERSION = 2; // bump to reset all users to collapsed-by-default

function loadCollapsed(): Set<string> {
  try {
    const version = Number(localStorage.getItem(COLLAPSE_VERSION_KEY) || '0');
    if (version >= COLLAPSE_VERSION) {
      const raw = localStorage.getItem(COLLAPSE_STORAGE_KEY);
      if (raw) return new Set(JSON.parse(raw));
    }
    // First run or version bump — default collapsed & store the version
    localStorage.setItem(COLLAPSE_VERSION_KEY, String(COLLAPSE_VERSION));
  } catch (err) {
    getGlobalRecorder()?.record({ type: 'system.error', component: 'node-tree', level: 'warn', message: 'collapsed state load failed', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
  }
  // Default: all categories collapsed
  return new Set(CATEGORY_ORDER);
}

function saveCollapsed(collapsed: Set<string>) {
  localStorage.setItem(COLLAPSE_STORAGE_KEY, JSON.stringify([...collapsed]));
}

function computeVisibleIds(
  nodes: PovNode[],
  sortMode: SortMode,
  collapsed: Set<string>,
  similarScores: Map<string, number> | null,
  clusters: ClusterGroup[] | null,
): string[] {
  if (sortMode === 'similarity' && clusters && clusters.length > 0) {
    const nodeMap = new Map(nodes.map(n => [n.id, n]));
    const sortedClusters = [...clusters].sort((a, b) => a.label.localeCompare(b.label));
    const ids: string[] = [];
    sortedClusters.forEach((cluster, ci) => {
      const key = `cluster-${ci}`;
      if (!collapsed.has(`${key}-expanded`)) return;
      const clusterNodes = (cluster.nodeIds.map(id => nodeMap.get(id)).filter(Boolean) as PovNode[])
        .sort((a, b) => a.label.localeCompare(b.label));
      for (const n of clusterNodes) ids.push(n.id);
    });
    return ids;
  }

  const flatMode = sortMode === 'id' || sortMode === 'priority' || sortMode === 'debate_tested' || sortMode === 'debate_tested_desc';
  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  const grouped = new Map<Category, PovNode[]>();
  for (const cat of CATEGORY_ORDER) grouped.set(cat, []);
  for (const node of nodes) {
    const list = grouped.get(node.category);
    if (list) list.push(node);
  }

  const ids: string[] = [];
  for (const cat of CATEGORY_ORDER) {
    if (collapsed.has(cat)) continue;
    const catNodes = sortNodes(grouped.get(cat) || [], sortMode, similarScores);

    if (flatMode) {
      for (const node of catNodes) ids.push(node.id);
      continue;
    }

    const catIdSet = new Set(catNodes.map(n => n.id));
    const parentNodes = catNodes.filter(n => n.children && n.children.length > 0);
    const topLeaves = catNodes.filter(n =>
      (!n.children || n.children.length === 0) &&
      (!n.parent_id || !catIdSet.has(n.parent_id)),
    );
    const hasHierarchy = parentNodes.length > 0;

    if (!hasHierarchy) {
      for (const node of catNodes) ids.push(node.id);
      continue;
    }

    for (const parent of parentNodes) {
      ids.push(parent.id);
      const parentKey = `parent-${parent.id}`;
      if (!collapsed.has(parentKey)) {
        const children = parent.children
          .map(id => nodeMap.get(id))
          .filter((n): n is PovNode => !!n && n.category === cat);
        for (const child of children) ids.push(child.id);
      }
    }
    for (const node of topLeaves) ids.push(node.id);
  }

  return ids;
}

export function NodeTree({ nodes, selectedNodeId, onSelect, pov, sortMode = 'id', similarScores, clusters, clusterLoading, misfits, onVisibleIdsChange, conflicts, resolveUrl, showDebateTestedChip }: NodeTreeProps & { showDebateTestedChip?: boolean }) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => loadCollapsed());

  // Collapse all parent/cluster groups when sort mode changes
  const prevSortMode = useRef(sortMode);
  useEffect(() => {
    if (prevSortMode.current !== sortMode) {
      prevSortMode.current = sortMode;
      setCollapsed(() => {
        const next = new Set<string>(CATEGORY_ORDER);
        for (const n of nodes) {
          if (n.children && n.children.length > 0) next.add(`parent-${n.id}`);
        }
        saveCollapsed(next);
        return next;
      });
    }
  }, [sortMode, nodes]);

  // Auto-expand category when keyboard nav selects a node in a collapsed group
  useEffect(() => {
    if (!selectedNodeId) return;
    const node = nodes.find(n => n.id === selectedNodeId);
    if (!node) return;
    if (collapsed.has(node.category)) {
      setCollapsed(prev => {
        const next = new Set(prev);
        next.delete(node.category);
        saveCollapsed(next);
        return next;
      });
    }
  }, [selectedNodeId]);

  useEffect(() => {
    onVisibleIdsChange?.(computeVisibleIds(nodes, sortMode, collapsed, similarScores ?? null, clusters ?? null));
  }, [nodes, sortMode, collapsed, similarScores, clusters, onVisibleIdsChange]);

  const toggleGroup = useCallback((key: string) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      saveCollapsed(next);
      return next;
    });
  }, []);

  // Cluster view
  if (sortMode === 'similarity' && clusters && clusters.length > 0) {
    const nodeMap = new Map(nodes.map(n => [n.id, n]));
    const sortedClusters = [...clusters].sort((a, b) => a.label.localeCompare(b.label));
    return (
      <div className="node-tree" data-pov={pov}>
        {sortedClusters.map((cluster, ci) => {
          const key = `cluster-${ci}`;
          // Default collapsed for cluster view
          const isCollapsed = !collapsed.has(`${key}-expanded`);
          const clusterNodes = (cluster.nodeIds.map(id => nodeMap.get(id)).filter(Boolean) as PovNode[])
            .sort((a, b) => a.label.localeCompare(b.label));
          return (
            <div key={key} className="category-group cluster-group">
              <div
                className="category-label cluster-label"
                onClick={() => toggleGroup(`${key}-expanded`)}
              >
                <span className={`category-toggle ${isCollapsed ? 'collapsed' : ''}`}>&#9660;</span>
                {cluster.label} <span className="category-count">({clusterNodes.length})</span>
              </div>
              {!isCollapsed && clusterNodes.map((node) => (
                <NodeItem
                  key={node.id}
                  node={node}
                  isSelected={selectedNodeId === node.id}
                  onSelect={onSelect}
                  isMisfit={misfits?.has(node.id)}
                  conflict={conflicts?.get(node.id)}
                  resolveUrl={resolveUrl}
                  showDebateTestedChip={showDebateTestedChip}
                />
              ))}
            </div>
          );
        })}
      </div>
    );
  }

  // Loading state for clusters
  if (sortMode === 'similarity' && clusterLoading) {
    return (
      <div className="node-tree-cluster-loading">
        Clustering nodes...
      </div>
    );
  }

  // Standard category view
  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  const grouped = new Map<Category, PovNode[]>();
  for (const cat of CATEGORY_ORDER) {
    grouped.set(cat, []);
  }
  for (const node of nodes) {
    const list = grouped.get(node.category);
    if (list) {
      list.push(node);
    }
  }

  // Flat modes: 'id' and 'priority' — no parent/child hierarchy
  const flatMode = sortMode === 'id' || sortMode === 'priority' || sortMode === 'debate_tested' || sortMode === 'debate_tested_desc';

  return (
    <div className="node-tree" data-pov={pov}>
      {CATEGORY_ORDER.map((cat) => {
        const catNodes = sortNodes(grouped.get(cat) || [], sortMode, similarScores ?? null);
        const isCollapsed = collapsed.has(cat);

        return (
          <div key={cat} className="category-group">
            <div
              className="category-label"
              data-cat={cat}
              onClick={() => toggleGroup(cat)}
            >
              <span className={`category-toggle ${isCollapsed ? 'collapsed' : ''}`}>&#9660;</span>
              {cat} <span className="category-count">({catNodes.length})</span>
            </div>
            {!isCollapsed && flatMode && catNodes.map((node) => (
              <NodeItem
                key={node.id}
                node={node}
                isSelected={selectedNodeId === node.id}
                onSelect={onSelect}
                score={similarScores?.get(node.id)}
                priorityValue={sortMode === 'priority' ? getPriorityDisplay(node) : undefined}
                conflict={conflicts?.get(node.id)}
                resolveUrl={resolveUrl}
                showDebateTestedChip={showDebateTestedChip}
              />
            ))}
            {!isCollapsed && !flatMode && (() => {
              // Hierarchical view for 'label' and 'similarity' modes
              const catIdSet = new Set(catNodes.map(n => n.id));
              const parentNodes = catNodes.filter(n => n.children && n.children.length > 0);
              const topLeaves = catNodes.filter(n =>
                (!n.children || n.children.length === 0) &&
                (!n.parent_id || !catIdSet.has(n.parent_id)),
              );
              const hasHierarchy = parentNodes.length > 0;

              if (!hasHierarchy) {
                return catNodes.map((node) => (
                  <NodeItem
                    key={node.id}
                    node={node}
                    isSelected={selectedNodeId === node.id}
                    onSelect={onSelect}
                    score={similarScores?.get(node.id)}
                    conflict={conflicts?.get(node.id)}
                    resolveUrl={resolveUrl}
                  />
                ));
              }

              return (
                <>
                  {parentNodes.map((parent) => {
                    const parentKey = `parent-${parent.id}`;
                    const isParentCollapsed = collapsed.has(parentKey);
                    const children = parent.children
                      .map(id => nodeMap.get(id))
                      .filter((n): n is PovNode => !!n && n.category === cat);

                    return (
                      <div key={parent.id} className="node-tree-parent-group">
                        <div
                          className={`node-tree-parent-header ${selectedNodeId === parent.id ? 'selected' : ''}`}
                          data-cat={parent.category}
                          onClick={() => onSelect(parent.id)}
                        >
                          <span
                            className={`category-toggle ${isParentCollapsed ? 'collapsed' : ''}`}
                            onClick={(e) => { e.stopPropagation(); toggleGroup(parentKey); }}
                          >&#9660;</span>
                          <span className="node-tree-parent-label">{parent.label || '(untitled)'}</span>
                          <span className="node-tree-parent-count">{children.length}</span>
                        </div>
                        {!isParentCollapsed && children.map((child) => (
                          <NodeItem
                            key={child.id}
                            node={child}
                            isSelected={selectedNodeId === child.id}
                            onSelect={onSelect}
                            score={similarScores?.get(child.id)}
                            indent
                            relationship={child.parent_relationship}
                            conflict={conflicts?.get(child.id)}
                            resolveUrl={resolveUrl}
                          />
                        ))}
                      </div>
                    );
                  })}
                  {topLeaves.map((node) => (
                    <NodeItem
                      key={node.id}
                      node={node}
                      isSelected={selectedNodeId === node.id}
                      onSelect={onSelect}
                      score={similarScores?.get(node.id)}
                      conflict={conflicts?.get(node.id)}
                      resolveUrl={resolveUrl}
                    />
                  ))}
                </>
              );
            })()}
          </div>
        );
      })}
    </div>
  );
}

const REL_LABELS: Record<string, string> = {
  is_a: 'is a',
  part_of: 'part of',
  specializes: 'specializes',
};

function getPriorityDisplay(node: PovNode): { label: string; value: number } | undefined {
  if (node.category === 'Desires' && node.priority != null) {
    return { label: `P${node.priority}`, value: node.priority };
  }
  if (node.category === 'Beliefs' && node.confidence != null) {
    return { label: (node.confidence).toFixed(2), value: node.confidence };
  }
  return undefined;
}

function NodeItem({ node, isSelected, onSelect, score, indent, relationship, isMisfit, priorityValue, conflict, resolveUrl, showDebateTestedChip }: {
  node: PovNode;
  isSelected: boolean;
  onSelect: (id: string) => void;
  score?: number;
  indent?: boolean;
  relationship?: string | null;
  isMisfit?: boolean;
  priorityValue?: { label: string; value: number };
  conflict?: NodeConflict;
  resolveUrl?: string | null;
  showDebateTestedChip?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isSelected && ref.current) {
      ref.current.scrollIntoView({ block: 'nearest' });
      ref.current.focus({ preventScroll: true });
    }
  }, [isSelected]);

  const handleClick = useCallback(() => {
    (document.activeElement as HTMLElement)?.blur?.();
    onSelect(node.id);
  }, [onSelect, node.id]);

  return (
    <div
      ref={ref}
      className={`node-item ${isSelected ? 'selected' : ''}${indent ? ' node-item-child' : ''}${isMisfit ? ' node-item-misfit' : ''}`}
      data-cat={node.category}
      tabIndex={-1}
      onClick={handleClick}
    >
      <div>
        {node.label || '(untitled)'}
        {isMisfit && <span className="misfit-badge" title="This node contradicts most of its cluster — it may belong in a different Perspective">misfit?</span>}
        <EditConflictBadge conflict={conflict} resolveUrl={resolveUrl} />
      </div>
      {node.graph_attributes?.aphorism && (
        <div className="node-item-aphorism">{node.graph_attributes.aphorism}</div>
      )}
      {/* Raw node.id removed from end-user view per t/2317. Class name kept ('node-item-id')
          to reuse existing styles.css layout; the row now carries only relationship + metric
          chips. Guarded so it never renders an empty line in sort modes with no metadata. */}
      {(() => {
        // Beliefs always show the chip (legacy: "Untested" when no record); Desire/Intention
        // nodes show it only once they carry a debate_tested record — see t/1661. Situations
        // never reach NodeItem (node is PovNode), so BDI-only gating is implicit.
        const showChip = showDebateTestedChip && (node.category === 'Beliefs' || !!node.graph_attributes?.debate_tested);
        const hasMeta = !!relationship || score !== undefined || !!priorityValue || showChip;
        if (!hasMeta) return null;
        return (
          <div className="node-item-id">
            {relationship && <span className="node-item-rel">{REL_LABELS[relationship] || relationship}</span>}
            {score !== undefined && <span className="node-item-score">{Math.round(score * 100)}%</span>}
            {priorityValue && <span className="node-item-priority">{priorityValue.label}</span>}
            {showChip && (
              <DebateTestedChip record={node.graph_attributes?.debate_tested} description={node.description} compact />
            )}
          </div>
        );
      })()}
    </div>
  );
}
