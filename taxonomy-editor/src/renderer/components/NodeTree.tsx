// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useEffect, useRef, useState, useCallback } from 'react';
import type { PovNode, Category } from '../types/taxonomy';

export type SortMode = 'id' | 'label' | 'similarity';

export interface ClusterGroup {
  label: string;
  nodeIds: string[];
}

interface NodeTreeProps {
  nodes: PovNode[];
  selectedNodeId: string | null;
  onSelect: (id: string) => void;
  sortMode?: SortMode;
  similarScores?: Map<string, number> | null;
  clusters?: ClusterGroup[] | null;
  clusterLoading?: boolean;
  misfits?: Set<string> | null;
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
  } catch { /* ignore */ }
  // Default: all categories collapsed
  return new Set(CATEGORY_ORDER);
}

function saveCollapsed(collapsed: Set<string>) {
  localStorage.setItem(COLLAPSE_STORAGE_KEY, JSON.stringify([...collapsed]));
}

export function NodeTree({ nodes, selectedNodeId, onSelect, sortMode = 'id', similarScores, clusters, clusterLoading, misfits }: NodeTreeProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => loadCollapsed());

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
      <div>
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
                style={{ cursor: 'pointer', userSelect: 'none' }}
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
      <div style={{ padding: '16px', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
        Clustering nodes...
      </div>
    );
  }

  // Standard category view — with parent/child hierarchy
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

  return (
    <div>
      {CATEGORY_ORDER.map((cat) => {
        const catNodes = sortNodes(grouped.get(cat) || [], sortMode, similarScores ?? null);
        const isCollapsed = collapsed.has(cat);

        // Separate into parent nodes (have children), child nodes, and top-level leaves
        const parentNodes = catNodes.filter(n => n.children && n.children.length > 0);
        const childIds = new Set(catNodes.filter(n => n.parent_id).map(n => n.id));
        const topLeaves = catNodes.filter(n => !n.parent_id && (!n.children || n.children.length === 0));

        // If no hierarchy exists, render flat
        const hasHierarchy = parentNodes.length > 0;

        return (
          <div key={cat} className="category-group">
            <div
              className="category-label"
              data-cat={cat}
              onClick={() => toggleGroup(cat)}
              style={{ cursor: 'pointer', userSelect: 'none' }}
            >
              <span className={`category-toggle ${isCollapsed ? 'collapsed' : ''}`}>&#9660;</span>
              {cat} <span className="category-count">({catNodes.length})</span>
            </div>
            {!isCollapsed && hasHierarchy && (
              <>
                {parentNodes.map((parent) => {
                  const parentKey = `parent-${parent.id}`;
                  const isParentCollapsed = collapsed.has(parentKey);
                  const children = parent.children
                    .map(id => nodeMap.get(id))
                    .filter(Boolean) as PovNode[];

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
                  />
                ))}
              </>
            )}
            {!isCollapsed && !hasHierarchy && catNodes.map((node) => (
              <NodeItem
                key={node.id}
                node={node}
                isSelected={selectedNodeId === node.id}
                onSelect={onSelect}
                score={similarScores?.get(node.id)}
              />
            ))}
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

function NodeItem({ node, isSelected, onSelect, score, indent, relationship, isMisfit }: {
  node: PovNode;
  isSelected: boolean;
  onSelect: (id: string) => void;
  score?: number;
  indent?: boolean;
  relationship?: string | null;
  isMisfit?: boolean;
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
      className={`node-item ${isSelected ? 'selected' : ''}${indent ? ' node-item-child' : ''}${isMisfit ? ' node-item-misfit' : ''}`}
      data-cat={node.category}
      onClick={() => onSelect(node.id)}
    >
      <div>
        {node.label || '(untitled)'}
        {isMisfit && <span className="misfit-badge" title="This node contradicts most of its cluster — it may belong in a different POV">misfit?</span>}
      </div>
      <div className="node-item-id">
        {node.id}
        {relationship && <span className="node-item-rel">{REL_LABELS[relationship] || relationship}</span>}
        {score !== undefined && <span className="node-item-score">{Math.round(score * 100)}%</span>}
      </div>
    </div>
  );
}
