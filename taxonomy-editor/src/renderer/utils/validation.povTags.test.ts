// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/3955, SO e/249#6 condition 2: the editor is a live writer, so save() must enforce the same tag rule as
// the tagging CLI. Since t/3973 that rule is split: STRUCTURAL problems are raised here, by the schema, on
// every node (save() aborts on them); REGISTRY MEMBERSHIP is checked in save() only for nodes changed
// since load, so a tag retired from the registry can't block saving untouched nodes. The membership
// arms live in useTaxonomyStore.test.ts ("pov_tags save gate (t/3973)").

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

  it('does NOT reject an unregistered tag: membership is gated per changed node in save() (t/3973)', () => {
    expect(povTaxonomyFileSchema.safeParse(povFile({ pov_tags: ['critical'] })).success).toBe(true);
  });

  it('REJECTS a malformed tag id (structural), with the issue on nodes[0].pov_tags', () => {
    const r = povTaxonomyFileSchema.safeParse(povFile({ pov_tags: ['Critical'] }));
    expect(r.success).toBe(false);
    expect(r.error?.issues[0].path).toEqual(['nodes', 0, 'pov_tags']);
    expect(r.error?.issues.map(i => i.message).join(' ')).toMatch(/kebab-case/);
    expect(r.error?.issues.map(i => i.message).join(' ')).not.toMatch(/not registered/);
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
