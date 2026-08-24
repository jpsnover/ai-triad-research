// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState } from 'react';
import { useTaxonomyStore, type PinnedData } from '../../hooks/useTaxonomyStore';
import { usePreferencesStore } from '../../store/preferencesStore';
import { NodeDetail } from '../taxonomy/NodeDetail';
import { SituationDetail } from '../debate/SituationDetail';
import { ConflictDetail } from '../conflict/ConflictDetail';
import './PinnedPanel.css';

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
        <div className="pinned-panel-header-actions">
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
  // Bookmark (Pin-for-comparison) surface is Advanced-view only — the shared gate for all
  // three tabs that render it. Subscribing here re-renders on view toggle (no reload, t/2826).
  const viewMode = usePreferencesStore(s => s.viewMode);

  if (viewMode !== 'advanced') return null;
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
