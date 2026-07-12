// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import fs from 'fs';
import path from 'path';

const AGGREGATED_CRUXES_PATH = path.join('taxonomy', 'Origin', 'aggregated-cruxes.json');

interface AggregatedCruxEntry {
  linked_node_ids?: string[];
}

export function loadCruxLinksFromAggregated(dataRoot: string): Map<string, number> {
  const filePath = path.join(dataRoot, AGGREGATED_CRUXES_PATH);
  if (!fs.existsSync(filePath)) {
    return new Map();
  }
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const cruxes: AggregatedCruxEntry[] = raw?.cruxes;
    if (!Array.isArray(cruxes)) return new Map();

    const counts = new Map<string, number>();
    for (const entry of cruxes) {
      for (const nodeId of entry.linked_node_ids ?? []) {
        counts.set(nodeId, (counts.get(nodeId) ?? 0) + 1);
      }
    }
    return counts;
  } catch {
    return new Map();
  }
}
