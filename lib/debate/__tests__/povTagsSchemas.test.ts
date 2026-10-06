// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// @vitest-environment node
// t/3955: the lib Zod node schemas declare pov_tags, so a parse no longer strips it, and route the element
// rules through validatePovTags. The committed registry is EMPTY until t/3956 adds the Skeptic tags with
// their souls, so any concrete tag is rejected today; the pass arms with real tags are in povTags.test.ts.

import { describe, it, expect } from 'vitest';
import { PovNodeSchema, SituationNodeSchema } from '../schemas.js';

const povNode = (extra: Record<string, unknown> = {}) => ({
  id: 'skp-beliefs-001',
  category: 'Beliefs',
  label: 'A node',
  description: 'A Beliefs within skeptic discourse that holds something.', // povDescriptionPattern uses the plural category
  parent_id: null,
  children: [],
  situation_refs: [],
  ...extra,
});

const sitNode = (extra: Record<string, unknown> = {}) => ({
  id: 'sit-001',
  label: 'A situation',
  description: 'A situation that tests something.',
  interpretations: { accelerationist: 'a', safetyist: 's', skeptic: 'k' },
  linked_nodes: [],
  conflict_ids: [],
  ...extra,
});

describe('PovNodeSchema pov_tags (t/3955)', () => {
  it('KEEPS pov_tags through a parse instead of stripping it', () => {
    const r = PovNodeSchema.safeParse(povNode({ pov_tags: [] }));
    expect(r.success).toBe(true);
    expect(r.success && r.data.pov_tags).toEqual([]);
  });

  it('accepts an untagged node', () => {
    expect(PovNodeSchema.safeParse(povNode()).success).toBe(true);
  });

  it('REJECTS a tag that is not in the registry (the registry ships empty)', () => {
    const r = PovNodeSchema.safeParse(povNode({ pov_tags: ['critical'] }));
    expect(r.success).toBe(false);
    expect(r.error?.issues[0].path).toEqual(['pov_tags']);
  });

  it('REJECTS a scalar (an unrolled one-element array)', () => {
    expect(PovNodeSchema.safeParse(povNode({ pov_tags: 'critical' })).success).toBe(false);
  });
});

describe('SituationNodeSchema pov_tags (t/3955)', () => {
  it('REJECTS any present pov_tags instead of silently stripping it', () => {
    expect(SituationNodeSchema.safeParse(sitNode({ pov_tags: ['critical'] })).success).toBe(false);
    expect(SituationNodeSchema.safeParse(sitNode({ pov_tags: [] })).success).toBe(false);
  });

  it('accepts a situation without the field', () => {
    expect(SituationNodeSchema.safeParse(sitNode()).success).toBe(true);
  });
});
