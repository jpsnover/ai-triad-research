import { useTaxonomyStore, type PinnedData } from '../hooks/useTaxonomyStore';
import { NodeDetail } from './NodeDetail';
import { CrossCuttingDetail } from './CrossCuttingDetail';
import { ConflictDetail } from './ConflictDetail';

function PinnedPanelEntry({ data, depth, onClose }: {
  data: PinnedData;
  depth: number;
  onClose: () => void;
}) {
  const chipDepth = depth + 1;

  return (
    <div className="pinned-panel">
      <div className="pinned-panel-header">
        <div className="pinned-badge">Pinned {depth > 0 ? `(${depth + 1})` : ''}</div>
        <button className="btn btn-ghost btn-sm" onClick={onClose}>
          Close
        </button>
      </div>
      {data.type === 'pov' && (
        <NodeDetail pov={data.pov} node={data.node} readOnly chipDepth={chipDepth} />
      )}
      {data.type === 'cross-cutting' && (
        <CrossCuttingDetail node={data.node} readOnly chipDepth={chipDepth} />
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
