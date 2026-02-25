import { useMemo } from 'react';
import { useAppStore } from '../store/useAppStore';
import type { Source, Point, PovCamp } from '../types/types';
import { POV_LABELS, POV_COLORS } from '../types/types';

interface NodeAggregation {
  nodeId: string;
  nodeLabel: string;
  nodeDescription: string;
  category: string;
  camp: PovCamp;
  sources: Array<{
    sourceId: string;
    sourceTitle: string;
    pointCount: number;
    alignments: { agrees: number; contradicts: number };
    strengths: { strong: number; moderate: number; weak: number };
  }>;
  totalPoints: number;
}

export default function AggregationView() {
  const notebooks = useAppStore(s => s.notebooks);
  const activeNotebookId = useAppStore(s => s.activeNotebookId);
  const enabledSourceIds = useAppStore(s => s.enabledSourceIds);
  const povFilters = useAppStore(s => s.povFilters);

  const notebook = notebooks.find(n => n.id === activeNotebookId) ?? notebooks[0];
  const enabledSources = notebook.sources.filter(
    s => enabledSourceIds.includes(s.id) && s.status === 'analyzed',
  );

  const aggregation = useMemo(() => {
    const nodeMap = new Map<string, NodeAggregation>();

    for (const source of enabledSources) {
      for (const point of source.points) {
        for (const mapping of point.mappings) {
          if (!povFilters[mapping.camp]) continue;

          let node = nodeMap.get(mapping.nodeId);
          if (!node) {
            node = {
              nodeId: mapping.nodeId,
              nodeLabel: mapping.nodeLabel,
              nodeDescription: mapping.nodeDescription ?? '',
              category: mapping.category,
              camp: mapping.camp,
              sources: [],
              totalPoints: 0,
            };
            nodeMap.set(mapping.nodeId, node);
          }

          let sourceEntry = node.sources.find(s => s.sourceId === source.id);
          if (!sourceEntry) {
            sourceEntry = {
              sourceId: source.id,
              sourceTitle: source.title,
              pointCount: 0,
              alignments: { agrees: 0, contradicts: 0 },
              strengths: { strong: 0, moderate: 0, weak: 0 },
            };
            node.sources.push(sourceEntry);
          }

          sourceEntry.pointCount++;
          sourceEntry.alignments[mapping.alignment]++;
          sourceEntry.strengths[mapping.strength]++;
          node.totalPoints++;
        }
      }
    }

    return Array.from(nodeMap.values()).sort((a, b) => b.totalPoints - a.totalPoints);
  }, [enabledSources, povFilters]);

  if (enabledSources.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state-icon">&#128202;</div>
        <div className="empty-state-text">Enable analyzed sources to see cross-source aggregation</div>
      </div>
    );
  }

  return (
    <div className="aggregation-view">
      <div className="aggregation-summary">
        {aggregation.length} taxonomy nodes referenced across {enabledSources.length} sources
      </div>
      {aggregation.map(node => (
        <div key={node.nodeId} className="aggregation-node">
          <div className="aggregation-node-header">
            <span
              className="aggregation-node-dot"
              style={{ backgroundColor: POV_COLORS[node.camp] }}
            />
            <span className="aggregation-node-label">{node.nodeLabel}</span>
            <span className="aggregation-node-id">{node.nodeId}</span>
            <span className="aggregation-node-count">{node.totalPoints}</span>
          </div>
          <div className="aggregation-node-category">{node.category}</div>
          {node.nodeDescription && (
            <div className="aggregation-node-description">{node.nodeDescription}</div>
          )}
          <div className="aggregation-node-sources">
            {node.sources.map(src => (
              <div key={src.sourceId} className="aggregation-source-row">
                <span className="aggregation-source-title">{src.sourceTitle}</span>
                <span className="aggregation-source-pts">{src.pointCount} pts</span>
                <span className="aggregation-align-bar">
                  {src.alignments.agrees > 0 && (
                    <span className="align-bar-agrees" title={`${src.alignments.agrees} agrees`}>
                      +{src.alignments.agrees}
                    </span>
                  )}
                  {src.alignments.contradicts > 0 && (
                    <span className="align-bar-contradicts" title={`${src.alignments.contradicts} contradicts`}>
                      -{src.alignments.contradicts}
                    </span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
