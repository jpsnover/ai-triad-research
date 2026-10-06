// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/3955, SO e/249#6 condition 2: the editor is a live writer, so the schema save() runs must enforce the
// same tag rule as the tagging CLI. save() aborts on any issue these schemas raise.
// The committed registry is EMPTY until t/3956 adds the Skeptic tags with their souls, so any concrete
// tag is rejected today; the pass arms with registered tags live in lib/schema/povTags.test.ts.

import { describe, it, expect } from 'vitest';
import { povTaxonomyFileSchema, situationsFileSchema } from './validation';

const povFile = (node: Record<string, unknown>) => ({
  _schema_version: '1.0.0',
  _doc: 'Test file',
  pov: 'skeptic',
  color_hex: '#2980B9',
  last_modified: '2026-10-06',
  nodes: [{
    id: 'skp-beliefs-001', category: 'Beliefs', label: 'Node', description: 'A test node',
    parent_id: null, children: [], situation_refs: [], ...node,
  }],
});

const sitFile = (node: Record<string, unknown>) => ({
  _schema_version: '1.0.0',
  _doc: 'Test file',
  last_modified: '2026-10-06',
  nodes: [{
    id: 'sit-001', label: 'Situation', description: 'A situation that tests',
    interpretations: { accelerationist: 'a', safetyist: 's', skeptic: 'k' },
    linked_nodes: [], conflict_ids: [], ...node,
  }],
});

describe('renderer povNodeSchema pov_tags (t/3955)', () => {
  it('accepts an untagged node and an empty tag list', () => {
    expect(povTaxonomyFileSchema.safeParse(povFile({})).success).toBe(true);
    expect(povTaxonomyFileSchema.safeParse(povFile({ pov_tags: [] })).success).toBe(true);
  });

  it('REJECTS an unregistered tag, with the issue on nodes[0].pov_tags', () => {
    const r = povTaxonomyFileSchema.safeParse(povFile({ pov_tags: ['critical'] }));
    expect(r.success).toBe(false);
    expect(r.error?.issues[0].path).toEqual(['nodes', 0, 'pov_tags']);
    expect(r.error?.issues[0].message).toMatch(/not registered/);
  });

  it('REJECTS a scalar and names the unroll, rather than a generic type error', () => {
    const r = povTaxonomyFileSchema.safeParse(povFile({ pov_tags: 'critical' }));
    expect(r.success).toBe(false);
    expect(r.error?.issues[0].message).toMatch(/unrolled to a scalar/);
  });
});

describe('renderer situationNodeSchema pov_tags (t/3955)', () => {
  it('REJECTS any present pov_tags, so save() blocks it', () => {
    expect(situationsFileSchema.safeParse(sitFile({ pov_tags: ['critical'] })).success).toBe(false);
  });

  it('accepts a situation without the field', () => {
    expect(situationsFileSchema.safeParse(sitFile({})).success).toBe(true);
  });
});
