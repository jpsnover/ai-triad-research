import { useEffect, useRef } from 'react';
import type { PovNode, Category } from '../types/taxonomy';

interface NodeTreeProps {
  nodes: PovNode[];
  selectedNodeId: string | null;
  onSelect: (id: string) => void;
}

const CATEGORY_ORDER: Category[] = ['Goals/Values', 'Methods', 'Data/Facts'];

export function getOrderedNodeIds(nodes: PovNode[]): string[] {
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
    for (const node of grouped.get(cat) || []) {
      ids.push(node.id);
    }
  }
  return ids;
}

export function NodeTree({ nodes, selectedNodeId, onSelect }: NodeTreeProps) {
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
        const catNodes = grouped.get(cat) || [];
        return (
          <div key={cat} className="category-group">
            <div className="category-label" data-cat={cat}>
              {cat} <span className="category-count">({catNodes.length})</span>
            </div>
            {catNodes.map((node) => (
              <NodeItem
                key={node.id}
                node={node}
                isSelected={selectedNodeId === node.id}
                onSelect={onSelect}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}

function NodeItem({ node, isSelected, onSelect }: { node: PovNode; isSelected: boolean; onSelect: (id: string) => void }) {
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
      data-cat={node.category}
      onClick={() => onSelect(node.id)}
    >
      <div>{node.label || '(untitled)'}</div>
      <div className="node-item-id">{node.id}</div>
    </div>
  );
}
