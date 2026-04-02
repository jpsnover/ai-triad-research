// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useAppStore } from '../store/useAppStore';
import type { PovCamp } from '../types/types';
import { POV_LABELS } from '../types/types';

const CAMPS: PovCamp[] = ['accelerationist', 'safetyist', 'skeptic', 'situations'];

const CAMP_CSS: Record<PovCamp, string> = {
  accelerationist: 'filter-chip-acc',
  safetyist: 'filter-chip-saf',
  skeptic: 'filter-chip-skp',
  'situations': 'filter-chip-cc',
};

export default function FilterBar() {
  const povFilters = useAppStore(s => s.povFilters);
  const togglePovFilter = useAppStore(s => s.togglePovFilter);
  const setAllPovFilters = useAppStore(s => s.setAllPovFilters);

  return (
    <div className="filter-bar">
      {CAMPS.map(camp => (
        <button
          key={camp}
          className={`filter-chip ${CAMP_CSS[camp]} ${povFilters[camp] ? 'active' : 'inactive'}`}
          onClick={() => togglePovFilter(camp)}
        >
          {POV_LABELS[camp]}
        </button>
      ))}
      <button className="filter-action" onClick={() => setAllPovFilters(true)}>All</button>
      <button className="filter-action" onClick={() => setAllPovFilters(false)}>None</button>
    </div>
  );
}
