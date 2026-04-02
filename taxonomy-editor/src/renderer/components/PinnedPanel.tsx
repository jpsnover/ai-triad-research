// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState } from 'react';
import { useTaxonomyStore, type PinnedData } from '../hooks/useTaxonomyStore';
import { NodeDetail } from './NodeDetail';
import { SituationDetail } from './SituationDetail';
import { ConflictDetail } from './ConflictDetail';

function PinnedPanelEntry({ data, depth, onClose }: {
  data: PinnedData;
  depth: number;
  onClose: () => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const chipDepth = depth + 1;

  if (collapsed) {
    return (
      <div className="pane-collapsed" onClick={() => setCollapsed(false)} title="Expand Pinned">
        <span className="pane-collapsed-label">Pinned {depth > 0 ? `(${depth + 1})` : ''}</span>
      </div>
    );
  }

  return (
    <div className="pinned-panel">
      <div className="pinned-panel-header">
        <div className="pinned-badge">Pinned {depth > 0 ? `(${depth + 1})` : ''}</div>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <button className="pane-collapse-btn" onClick={() => setCollapsed(true)} title="Collapse">&lsaquo;</button>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
      {data.type === 'pov' && (
        <NodeDetail pov={data.pov} node={data.node} readOnly chipDepth={chipDepth} />
      )}
      {data.type === 'situations' && (
        <SituationDetail node={data.node} readOnly chipDepth={chipDepth} />
      )}
      {data.type === 'conflict' && (
        <ConflictDetail conflict={data.conflict} readOnly chipDepth={chipDepth} />
      )}
    </div>
  );
}

export function PinnedPanel() {
  const { pinnedStack, closePinnedFromDepth } = useTaxonomyStore();

  if (pinnedStack.length === 0) return null;

  return (
    <>
      {pinnedStack.map((data, i) => (
        <PinnedPanelEntry
          key={i}
          data={data}
          depth={i}
          onClose={() => closePinnedFromDepth(i)}
        />
      ))}
    </>
  );
}
