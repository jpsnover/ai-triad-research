// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useTaxonomyStore } from '../hooks/useTaxonomyStore';

interface LinkedChipProps {
  id: string;
  depth?: number;
  readOnly?: boolean;
  onRemove?: (id: string) => void;
}

export function LinkedChip({ id, depth = 0, readOnly, onRemove }: LinkedChipProps) {
  const { getLabelForId, lookupPinnedData, pinAtDepth } = useTaxonomyStore();
  const label = getLabelForId(id);

  const handleClick = () => {
    const data = lookupPinnedData(id);
    if (data) pinAtDepth(depth, data);
  };

  return (
    <span className="chip">
      <span className="chip-content" onClick={handleClick} title="Click to pin for comparison">
        <span className="chip-id">{id}</span>
        {label && <span className="chip-label">{label}</span>}
      </span>
      {!readOnly && onRemove && <button onClick={() => onRemove(id)}>x</button>}
    </span>
  );
}
