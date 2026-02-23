import { useState, useMemo, useEffect } from 'react';
import type { Pov, Category, PovNode } from '../types/taxonomy';
import { useTaxonomyStore } from '../hooks/useTaxonomyStore';
import { useKeyboardNav } from '../hooks/useKeyboardNav';
import { useResizablePanel } from '../hooks/useResizablePanel';
import { NodeTree, getOrderedNodeIds } from './NodeTree';
import { NodeDetail } from './NodeDetail';
import { NewNodeDialog } from './NewNodeDialog';
import { PinnedPanel } from './PinnedPanel';

interface PovTabProps {
  pov: Pov;
}

export function PovTab({ pov }: PovTabProps) {
  const { selectedNodeId, setSelectedNodeId, createPovNode, pinnedStack, pinAtDepth } = useTaxonomyStore();
  const file = useTaxonomyStore((s) => s[pov]);
  const [showNewDialog, setShowNewDialog] = useState(false);
  const { width, onMouseDown } = useResizablePanel();

  const orderedIds = useMemo(
    () => (file ? getOrderedNodeIds(file.nodes) : []),
    [file],
  );
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

  return (
    <div className="two-column">
      <div className="list-panel" style={{ width }}>
        <div className="list-panel-header">
          <h2>{pov}</h2>
          <button className="btn btn-sm" onClick={() => setShowNewDialog(true)}>
            + New
          </button>
        </div>
        <div className="list-panel-items">
          <NodeTree
            nodes={file.nodes}
            selectedNodeId={selectedNodeId}
            onSelect={setSelectedNodeId}
          />
        </div>
      </div>
      <div className="resize-handle" onMouseDown={onMouseDown} />
      <div className="detail-panel" data-cat={selectedNode?.category}>
        {selectedNode ? (
          <NodeDetail pov={pov} node={selectedNode} onPin={handlePin} />
        ) : (
          <div className="detail-panel-empty">Select a node to edit</div>
        )}
      </div>
      {pinnedStack.length > 0 && <PinnedPanel />}
      {showNewDialog && (
        <NewNodeDialog
          onConfirm={handleCreate}
          onCancel={() => setShowNewDialog(false)}
        />
      )}
    </div>
  );
}
