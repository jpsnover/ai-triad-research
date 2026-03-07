// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useMemo } from 'react';
import { useStore } from '../store/useStore';
import type { EdgeType } from '../types/types';

const TYPE_ORDER: EdgeType[] = [
  'SUPPORTS',
  'CONTRADICTS',
  'TENSION_WITH',
  'ASSUMES',
  'WEAKENS',
  'RESPONDS_TO',
  'CITES',
  'INTERPRETS',
  'SUPPORTED_BY',
];

export default function StatsBar() {
  const filteredEdges = useStore((s) => s.filteredEdges);
  const setFilter = useStore((s) => s.setFilter);

  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const e of filteredEdges) {
      counts[e.type] = (counts[e.type] || 0) + 1;
    }
    return counts;
  }, [filteredEdges]);

  return (
    <div className="stats-bar">
      {TYPE_ORDER.map((t) => {
        const count = typeCounts[t] || 0;
        if (count === 0) return null;
        return (
          <button
            key={t}
            className={`type-chip type-${t.toLowerCase().replace('_', '-')}`}
            onClick={() => setFilter('edgeType', t)}
            title={`Filter to ${t} edges`}
          >
            {t.replace('_', ' ')} <span className="chip-count">{count}</span>
          </button>
        );
      })}
    </div>
  );
}
