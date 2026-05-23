// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Level 2 intellectual lineage clusters.
// Source: research/comp-linguist/docs/lineage-level2-clusters.json
// Generated via embedding-based agglomerative clustering (k=55, all-MiniLM-L6-v2).

import l2Data from './lineageL2Data.json';

export interface L2Cluster {
  id: number;
  label: string;
  memberCount: number;
}

/** 55 L2 clusters, sorted by member count descending. */
export const L2_CLUSTERS: L2Cluster[] = l2Data.clusters;

/** Map lineage name → L2 cluster ID (case-sensitive). */
const NAME_TO_L2: Record<string, number> = l2Data.nameToL2;

/** Case-insensitive index built on first access. */
let _lowerIndex: Map<string, number> | null = null;
function getLowerIndex(): Map<string, number> {
  if (!_lowerIndex) {
    _lowerIndex = new Map();
    for (const [k, v] of Object.entries(NAME_TO_L2)) {
      _lowerIndex.set(k.toLowerCase(), v);
    }
  }
  return _lowerIndex;
}

/** Get L2 cluster ID for a lineage name (case-insensitive). */
export function getL2ClusterId(name: string): number | undefined {
  const direct = NAME_TO_L2[name];
  if (direct !== undefined) return direct;
  return getLowerIndex().get(name.toLowerCase());
}

/** Get cluster label by ID. */
export function getL2Label(clusterId: number): string {
  return L2_CLUSTERS.find(c => c.id === clusterId)?.label ?? 'Uncategorized';
}
