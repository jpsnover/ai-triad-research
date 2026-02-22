import { useTaxonomyStore } from '../hooks/useTaxonomyStore';
import { NodeDetail } from './NodeDetail';
import { CrossCuttingDetail } from './CrossCuttingDetail';
import { ConflictDetail } from './ConflictDetail';

export function PinnedPanel() {
  const { pinnedData, setPinnedData } = useTaxonomyStore();

  if (!pinnedData) return null;

  return (
    <div className="pinned-panel">
      <div className="pinned-panel-header">
        <div className="pinned-badge">Pinned</div>
        <button className="btn btn-ghost btn-sm" onClick={() => setPinnedData(null)}>
          Unpin
        </button>
      </div>
      {pinnedData.type === 'pov' && (
        <NodeDetail pov={pinnedData.pov} node={pinnedData.node} readOnly />
      )}
      {pinnedData.type === 'cross-cutting' && (
        <CrossCuttingDetail node={pinnedData.node} readOnly />
      )}
      {pinnedData.type === 'conflict' && (
        <ConflictDetail conflict={pinnedData.conflict} readOnly />
      )}
    </div>
  );
}
