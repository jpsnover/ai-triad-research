// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import { filterByPovTag, povTagFilterOptions } from './povTagFilter';

// t/3961: the taxonomy node list filters by POV tag. The committed registry is empty until t/3956,
// so these inject one.
const REGISTRY = {
  version: 1,
  povs: {
    skeptic: [
      { id: 'critical', label: 'Critical', soul_doc: 'skeptic.critical', description: 'd' },
      { id: 'institutional', label: 'Institutional', soul_doc: 'skeptic.institutional', description: 'd' },
    ],
  },
};

const NODES = [
  { id: 'skp-beliefs-001', pov_tags: ['critical'] },
  { id: 'skp-beliefs-002', pov_tags: ['critical', 'institutional'] },
  { id: 'skp-beliefs-003', pov_tags: [] as string[] },
  { id: 'skp-beliefs-004' },
  { id: 'skp-beliefs-005', pov_tags: 'institutional' as unknown as string[] }, // PowerShell-unrolled scalar
];
const ids = (ns: Array<{ id: string }>) => ns.map(n => n.id);

describe('filterByPovTag (t/3961)', () => {
  it('"all" keeps every node, in order', () => {
    expect(ids(filterByPovTag(NODES, 'all'))).toEqual(ids(NODES));
  });

  it('"untagged" keeps nodes with no tags: field absent or an empty list', () => {
    expect(ids(filterByPovTag(NODES, 'untagged'))).toEqual(['skp-beliefs-003', 'skp-beliefs-004']);
  });

  it('a tag keeps exactly the nodes carrying it, multi-tagged included', () => {
    expect(ids(filterByPovTag(NODES, 'tag:critical'))).toEqual(['skp-beliefs-001', 'skp-beliefs-002']);
  });

  it('a malformed scalar still filters as its one tag rather than vanishing from every view', () => {
    expect(ids(filterByPovTag(NODES, 'tag:institutional'))).toEqual(['skp-beliefs-002', 'skp-beliefs-005']);
  });
});

describe('povTagFilterOptions (t/3961)', () => {
  it('offers All, Untagged, then each of this POV\'s registry tags', () => {
    expect(povTagFilterOptions('skeptic', REGISTRY).map(o => o.value)).toEqual(['all', 'untagged', 'tag:critical', 'tag:institutional']);
  });

  it('is empty for a POV with no tags, so the control hides itself', () => {
    expect(povTagFilterOptions('accelerationist', REGISTRY)).toEqual([]);
  });

  it('is empty for every POV with the committed (empty) registry today', () => {
    expect(povTagFilterOptions('skeptic')).toEqual([]);
  });
});
