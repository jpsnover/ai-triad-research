// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useRef, useEffect } from 'react';

const REL_LABELS: Record<string, string> = {
  is_a: 'is a',
  part_of: 'part of',
  specializes: 'specializes',
};

/** A single situation node row in the Situations list. Self-contained (no store deps)
 *  so it renders cheaply in tests. */
export function SituationListItem({ id, label, isSelected, onSelect, indent, relationship, divergence }: {
  id: string;
  label: string;
  isSelected: boolean;
  onSelect: (id: string) => void;
  indent?: boolean;
  relationship?: string | null;
  divergence?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isSelected && ref.current) {
      ref.current.scrollIntoView({ block: 'nearest' });
    }
  }, [isSelected]);

  return (
    <div
      ref={ref}
      className={`node-item ${isSelected ? 'selected' : ''}${indent ? ' node-item-child' : ''}`}
      onClick={() => onSelect(id)}
    >
      <div>{label || '(untitled)'}</div>
      <div className="node-item-id">
        {id}
        {relationship && <span className="node-item-rel">{REL_LABELS[relationship] || relationship}</span>}
        {divergence != null && (
          <span
            className={`node-item-divergence${divergence > 0.4 ? ' high' : divergence >= 0.2 ? ' medium' : ' low'}`}
            title={`Interpretation divergence: ${divergence.toFixed(3)}`}
          >
            {divergence.toFixed(2)}
          </span>
        )}
      </div>
    </div>
  );
}
