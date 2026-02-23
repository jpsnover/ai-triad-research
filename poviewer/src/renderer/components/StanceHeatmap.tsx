import { useMemo } from 'react';
import { useAppStore } from '../store/useAppStore';
import type { PovCamp, Alignment } from '../types/types';
import { POV_COLORS } from '../types/types';

interface HeatmapCell {
  nodeId: string;
  sourceId: string;
  alignment: Alignment | null;
  count: number;
}

export default function StanceHeatmap() {
  const notebooks = useAppStore(s => s.notebooks);
  const activeNotebookId = useAppStore(s => s.activeNotebookId);
  const enabledSourceIds = useAppStore(s => s.enabledSourceIds);
  const povFilters = useAppStore(s => s.povFilters);
  const selectSource = useAppStore(s => s.selectSource);

  const notebook = notebooks.find(n => n.id === activeNotebookId) ?? notebooks[0];
  const enabledSources = notebook.sources.filter(
    s => enabledSourceIds.includes(s.id) && s.status === 'analyzed',
  );

  const { nodeIds, nodeLabels, nodeCamps, cellMap } = useMemo(() => {
    const nodeSet = new Map<string, { label: string; camp: PovCamp }>();
    const cells = new Map<string, HeatmapCell>();

    for (const source of enabledSources) {
      for (const point of source.points) {
        for (const mapping of point.mappings) {
          if (!povFilters[mapping.camp]) continue;

          nodeSet.set(mapping.nodeId, { label: mapping.nodeLabel, camp: mapping.camp });

          const key = `${mapping.nodeId}:${source.id}`;
          const existing = cells.get(key);
          if (existing) {
            existing.count++;
            // Dominant alignment: if mixed, null
            if (existing.alignment !== mapping.alignment) {
              existing.alignment = null;
            }
          } else {
            cells.set(key, {
              nodeId: mapping.nodeId,
              sourceId: source.id,
              alignment: mapping.alignment,
              count: 1,
            });
          }
        }
      }
    }

    return {
      nodeIds: Array.from(nodeSet.keys()),
      nodeLabels: Object.fromEntries(Array.from(nodeSet.entries()).map(([id, v]) => [id, v.label])),
      nodeCamps: Object.fromEntries(Array.from(nodeSet.entries()).map(([id, v]) => [id, v.camp])),
      cellMap: cells,
    };
  }, [enabledSources, povFilters]);

  if (enabledSources.length === 0 || nodeIds.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state-icon">&#128200;</div>
        <div className="empty-state-text">Enable analyzed sources to see the stance heatmap</div>
      </div>
    );
  }

  const getCellColor = (cell: HeatmapCell | undefined): string => {
    if (!cell) return 'var(--bg-input)';
    if (cell.alignment === 'agrees') return 'rgba(34, 197, 94, 0.4)';
    if (cell.alignment === 'contradicts') return 'rgba(239, 68, 68, 0.4)';
    return 'rgba(100, 116, 139, 0.3)'; // mixed
  };

  return (
    <div className="stance-heatmap">
      <div className="heatmap-legend">
        <span className="heatmap-legend-item">
          <span className="heatmap-legend-swatch" style={{ background: 'rgba(34, 197, 94, 0.4)' }} />
          Agrees
        </span>
        <span className="heatmap-legend-item">
          <span className="heatmap-legend-swatch" style={{ background: 'rgba(239, 68, 68, 0.4)' }} />
          Contradicts
        </span>
        <span className="heatmap-legend-item">
          <span className="heatmap-legend-swatch" style={{ background: 'rgba(100, 116, 139, 0.3)' }} />
          Mixed
        </span>
        <span className="heatmap-legend-item">
          <span className="heatmap-legend-swatch" style={{ background: 'var(--bg-input)' }} />
          Not mapped
        </span>
      </div>

      <div className="heatmap-grid" style={{ gridTemplateColumns: `200px repeat(${enabledSources.length}, 1fr)` }}>
        {/* Header row */}
        <div className="heatmap-header-cell" />
        {enabledSources.map(src => (
          <div
            key={src.id}
            className="heatmap-header-cell heatmap-source-header"
            onClick={() => selectSource(src.id)}
            title={src.title}
          >
            {src.title.length > 15 ? src.title.slice(0, 15) + '...' : src.title}
          </div>
        ))}

        {/* Node rows */}
        {nodeIds.map(nodeId => (
          <>
            <div key={`label-${nodeId}`} className="heatmap-row-label">
              <span
                className="heatmap-camp-dot"
                style={{ backgroundColor: POV_COLORS[nodeCamps[nodeId]] }}
              />
              {nodeLabels[nodeId]}
            </div>
            {enabledSources.map(src => {
              const cell = cellMap.get(`${nodeId}:${src.id}`);
              return (
                <div
                  key={`${nodeId}-${src.id}`}
                  className="heatmap-cell"
                  style={{ backgroundColor: getCellColor(cell) }}
                  title={cell ? `${cell.count} point(s), ${cell.alignment ?? 'mixed'}` : 'Not mapped'}
                >
                  {cell ? cell.count : ''}
                </div>
              );
            })}
          </>
        ))}
      </div>
    </div>
  );
}
