// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useMemo, useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import type { TaxonomyNode, PovCamp } from '../types/types';
import { POV_LABELS, POV_COLORS } from '../types/types';
import ProposeNodeDialog from './ProposeNodeDialog';

interface GapNode {
  nodeId: string;
  nodeLabel: string;
  category: string;
  camp: PovCamp;
  description: string;
}

export default function GapsView() {
  const notebooks = useAppStore(s => s.notebooks);
  const activeNotebookId = useAppStore(s => s.activeNotebookId);
  const enabledSourceIds = useAppStore(s => s.enabledSourceIds);
  const loadedTaxonomies = useAppStore(s => s.loadedTaxonomies);
  const [proposeDialogOpen, setProposeDialogOpen] = useState(false);

  const notebook = notebooks.find(n => n.id === activeNotebookId) ?? notebooks[0];
  const enabledSources = notebook.sources.filter(
    s => enabledSourceIds.includes(s.id) && s.status === 'analyzed',
  );

  // Collect all mapped node IDs across all enabled sources
  const mappedNodeIds = useMemo(() => {
    const ids = new Set<string>();
    for (const source of enabledSources) {
      for (const point of source.points) {
        for (const mapping of point.mappings) {
          ids.add(mapping.nodeId);
        }
      }
    }
    return ids;
  }, [enabledSources]);

  // This would normally load taxonomy data from files
  // For now, show a placeholder that indicates which nodes have zero mappings
  const unmappedCount = enabledSources.length > 0
    ? `${mappedNodeIds.size} nodes covered`
    : '0 nodes';

  return (
    <div className="gaps-view">
      <div className="gaps-summary">
        <span className="gaps-summary-text">
          Across {enabledSources.length} source(s), {unmappedCount} in loaded taxonomies.
        </span>
        <button
          className="gaps-propose-btn"
          onClick={() => setProposeDialogOpen(true)}
        >
          Propose Node
        </button>
      </div>

      {enabledSources.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">&#128270;</div>
          <div className="empty-state-text">Enable analyzed sources to identify taxonomy gaps</div>
        </div>
      ) : (
        <div className="gaps-content">
          <div className="gaps-section">
            <h4 className="gaps-section-title">Unmapped Points</h4>
            <div className="gaps-unmapped-list">
              {enabledSources.flatMap(source =>
                source.points
                  .filter(p => p.mappings.length === 0)
                  .map(p => (
                    <div key={`${source.id}-${p.id}`} className="gaps-unmapped-item">
                      <span className="gaps-unmapped-source">{source.title}</span>
                      <span className="gaps-unmapped-text">
                        {p.text.slice(0, 100)}{p.text.length > 100 ? '...' : ''}
                      </span>
                    </div>
                  ))
              )}
              {enabledSources.every(s => s.points.every(p => p.mappings.length > 0)) && (
                <div className="gaps-none">All points are mapped to taxonomy nodes.</div>
              )}
            </div>
          </div>

          <div className="gaps-section">
            <h4 className="gaps-section-title">Coverage by Camp</h4>
            <div className="gaps-camp-grid">
              {(['accelerationist', 'safetyist', 'skeptic', 'cross-cutting'] as PovCamp[]).map(camp => {
                const campNodes = Array.from(mappedNodeIds).filter(id => id.startsWith(camp.slice(0, 3)));
                return (
                  <div key={camp} className="gaps-camp-item">
                    <span
                      className="gaps-camp-dot"
                      style={{ backgroundColor: POV_COLORS[camp] }}
                    />
                    <span className="gaps-camp-label">{POV_LABELS[camp]}</span>
                    <span className="gaps-camp-count">{campNodes.length} nodes</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <ProposeNodeDialog
        open={proposeDialogOpen}
        onClose={() => setProposeDialogOpen(false)}
      />
    </div>
  );
}
