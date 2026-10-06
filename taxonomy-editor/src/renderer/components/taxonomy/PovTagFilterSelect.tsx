// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import type { PovTagFilter, PovTagFilterOption } from '../../utils/povTagFilter';

/** POV-tag filter for the node list (t/3961). Renders nothing when the POV has no registry tags. */
export function PovTagFilterSelect({ options, value, onChange }: {
  options: PovTagFilterOption[];
  value: PovTagFilter;
  onChange: (next: PovTagFilter) => void;
}) {
  if (options.length === 0) return null;
  return (
    <select
      className="sort-select"
      value={value}
      onChange={(e) => onChange(e.target.value as PovTagFilter)}
      title="Filter by POV tag"
      aria-label="Filter by POV tag"
    >
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}
