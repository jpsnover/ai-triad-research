// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useAppStore } from '../store/useAppStore';
import { useAnnotations } from '../hooks/useAnnotations';
import PovFilterToggles from './PovFilterToggles';
import SummaryStats from './SummaryStats';
import PointDetailCard from './PointDetailCard';
import AggregationView from './AggregationView';
import StanceHeatmap from './StanceHeatmap';
import GapsView from './GapsView';

export default function PovPanel() {
  const notebooks = useAppStore(s => s.notebooks);
  const activeNotebookId = useAppStore(s => s.activeNotebookId);
  const selectedSourceId = useAppStore(s => s.selectedSourceId);
  const selectedPointId = useAppStore(s => s.selectedPointId);
  const pane3View = useAppStore(s => s.pane3View);
  const setPane3View = useAppStore(s => s.setPane3View);

  const notebook = notebooks.find(n => n.id === activeNotebookId) ?? notebooks[0];
  const source = selectedSourceId
    ? notebook.sources.find(s => s.id === selectedSourceId) ?? null
    : null;
  const selectedPoint = source && selectedPointId
    ? source.points.find(p => p.id === selectedPointId) ?? null
    : null;

  const { addAnnotation, getPointAnnotations } = useAnnotations(selectedSourceId);

  const pointAnnotations = selectedPoint
    ? getPointAnnotations(selectedPoint.id)
    : [];

  const hasAnalyzedSources = notebook.sources.some(s => s.status === 'analyzed');

  return (
    <div className="pov-panel">
      <div className="pane-header">
        <h2>POV Analysis</h2>
      </div>

      {/* View mode tabs */}
      {hasAnalyzedSources && (
        <div className="pov-view-tabs">
          <button
            className={`pov-view-tab ${pane3View === 'points' ? 'active' : ''}`}
            onClick={() => setPane3View('points')}
          >
            Points
          </button>
          <button
            className={`pov-view-tab ${pane3View === 'nodes' ? 'active' : ''}`}
            onClick={() => setPane3View('nodes')}
          >
            Nodes
          </button>
          <button
            className={`pov-view-tab ${pane3View === 'gaps' ? 'active' : ''}`}
            onClick={() => setPane3View('gaps')}
          >
            Gaps
          </button>
        </div>
      )}

      {/* Points View (default) */}
      {pane3View === 'points' && (
        source && source.status === 'analyzed' ? (
          <>
            <PovFilterToggles />
            <SummaryStats source={source} />
            <div className="pane-body">
              {selectedPoint ? (
                <PointDetailCard
                  point={selectedPoint}
                  source={source}
                  annotations={pointAnnotations}
                  onAnnotate={(action, value, mappingIndex) =>
                    addAnnotation(selectedPoint.id, action, value, mappingIndex)
                  }
                />
              ) : (
                <div className="empty-state">
                  <div className="empty-state-icon">&#128073;</div>
                  <div className="empty-state-text">Click a highlight to see mapping details</div>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="empty-state">
            <div className="empty-state-icon">&#128202;</div>
            <div className="empty-state-text">Select an analyzed source to see POV mappings</div>
          </div>
        )
      )}

      {/* Nodes View (Aggregation) */}
      {pane3View === 'nodes' && (
        <>
          <PovFilterToggles />
          <div className="pane-body">
            <AggregationView />
            <StanceHeatmap />
          </div>
        </>
      )}

      {/* Gaps View */}
      {pane3View === 'gaps' && (
        <div className="pane-body">
          <GapsView />
        </div>
      )}
    </div>
  );
}
