// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useEffect, useRef, useMemo } from 'react';
import { useTaxonomyStore } from '../hooks/useTaxonomyStore';
import { useKeyboardNav } from '../hooks/useKeyboardNav';
import { useResizablePanel } from '../hooks/useResizablePanel';
import { CrossCuttingDetail } from './CrossCuttingDetail';
import { PinnedPanel } from './PinnedPanel';

export function CrossCuttingTab() {
  const { crossCutting, selectedNodeId, setSelectedNodeId, createCrossCuttingNode, pinnedStack, pinAtDepth } = useTaxonomyStore();
  const { width, onMouseDown } = useResizablePanel();

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

  return (
    <div className="two-column">
      <div className="list-panel" style={{ width }}>
        <div className="list-panel-header">
          <h2>Cross-Cutting</h2>
          <button className="btn btn-sm" onClick={createCrossCuttingNode}>
            + New
          </button>
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
      <div className="resize-handle" onMouseDown={onMouseDown} />
      <div className="detail-panel">
        {selectedNode ? (
          <CrossCuttingDetail node={selectedNode} onPin={handlePin} />
        ) : (
          <div className="detail-panel-empty">Select a cross-cutting node to edit</div>
        )}
      </div>
      {pinnedStack.length > 0 && <PinnedPanel />}
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
