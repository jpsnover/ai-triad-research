// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import { povTaxonomyFileSchema, extractPovErrors } from './validation';

function validNode(overrides: Record<string, unknown> = {}) {
  return {
    id: 'acc-desires-001',
    category: 'Desires',
    label: 'Test node',
    description: 'A test node for validation',
    parent_id: null,
    children: [],
    situation_refs: [],
    ...overrides,
  };
}

function validFile(nodeOverrides: Record<string, unknown> = {}) {
  return {
    _schema_version: '1.0.0',
    _doc: 'Test file',
    pov: 'accelerationist',
    color_hex: '#27AE60',
    last_modified: '2026-07-05',
    nodes: [validNode(nodeOverrides)],
  };
}

describe('povTaxonomyFileSchema', () => {
  it('accepts a valid file', () => {
    const result = povTaxonomyFileSchema.safeParse(validFile());
    expect(result.success).toBe(true);
  });

  it('rejects node with bad ID format', () => {
    const result = povTaxonomyFileSchema.safeParse(validFile({ id: 'acc-goals-001' }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain('{pov}-{category}-{NNN}');
    }
  });

  it('rejects node with empty ID', () => {
    const result = povTaxonomyFileSchema.safeParse(validFile({ id: '' }));
    expect(result.success).toBe(false);
  });

  it('accepts all three POV prefixes', () => {
    for (const [pov, prefix] of [['accelerationist', 'acc'], ['safetyist', 'saf'], ['skeptic', 'skp']] as const) {
      const result = povTaxonomyFileSchema.safeParse({
        ...validFile({ id: `${prefix}-beliefs-001` }),
        pov,
      });
      expect(result.success).toBe(true);
    }
  });

  it('accepts all three BDI category prefixes', () => {
    for (const cat of ['desires', 'beliefs', 'intentions'] as const) {
      const result = povTaxonomyFileSchema.safeParse(validFile({ id: `acc-${cat}-001` }));
      expect(result.success).toBe(true);
    }
  });

  it('rejects situation_refs with stale cc- prefix', () => {
    const result = povTaxonomyFileSchema.safeParse(validFile({ situation_refs: ['cc-001'] }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain('sit-NNN');
    }
  });

  it('accepts valid situation_refs', () => {
    const result = povTaxonomyFileSchema.safeParse(validFile({ situation_refs: ['sit-001', 'sit-042'] }));
    expect(result.success).toBe(true);
  });

  it('rejects malformed conflict_ids', () => {
    const result = povTaxonomyFileSchema.safeParse(validFile({ conflict_ids: ['bad_id!'] }));
    expect(result.success).toBe(false);
  });

  it('accepts valid conflict_ids', () => {
    const result = povTaxonomyFileSchema.safeParse(validFile({ conflict_ids: ['conflict-scaling-laws-001'] }));
    expect(result.success).toBe(true);
  });

  it('accepts valid parent_relationship values', () => {
    for (const rel of ['is_a', 'part_of', 'specializes', null]) {
      const result = povTaxonomyFileSchema.safeParse(validFile({ parent_relationship: rel }));
      expect(result.success).toBe(true);
    }
  });

  it('rejects invalid parent_relationship', () => {
    const result = povTaxonomyFileSchema.safeParse(validFile({ parent_relationship: 'contains' }));
    expect(result.success).toBe(false);
  });

  it('rejects confidence outside 0-1', () => {
    const over = povTaxonomyFileSchema.safeParse(validFile({ confidence: 1.5 }));
    expect(over.success).toBe(false);

    const under = povTaxonomyFileSchema.safeParse(validFile({ confidence: -0.1 }));
    expect(under.success).toBe(false);
  });

  it('accepts confidence within 0-1', () => {
    const result = povTaxonomyFileSchema.safeParse(validFile({ confidence: 0.75 }));
    expect(result.success).toBe(true);
  });

  it('rejects priority outside 1-5', () => {
    const zero = povTaxonomyFileSchema.safeParse(validFile({ priority: 0 }));
    expect(zero.success).toBe(false);

    const six = povTaxonomyFileSchema.safeParse(validFile({ priority: 6 }));
    expect(six.success).toBe(false);
  });

  it('rejects operationality outside 1-5 (known-bad data: operationality=6)', () => {
    const result = povTaxonomyFileSchema.safeParse(validFile({ operationality: 6 }));
    expect(result.success).toBe(false);
  });

  it('accepts operationality within 1-5', () => {
    const result = povTaxonomyFileSchema.safeParse(validFile({ operationality: 3 }));
    expect(result.success).toBe(true);
  });

  it('accepts null weight fields (nullish)', () => {
    const result = povTaxonomyFileSchema.safeParse(validFile({
      confidence: null,
      priority: null,
      operationality: null,
    }));
    expect(result.success).toBe(true);
  });

  it('passes through enrichment fields without rejection', () => {
    const result = povTaxonomyFileSchema.safeParse(validFile({
      graph_attributes: { node_scope: 'claim', custom_field: 'anything' },
      debate_refs: ['debate-abc-123'],
      doctrinally_anchored: true,
      evidential_confidence: 0.8,
      confidence_history: [{ date: '2026-07-01', value: 0.5, delta: 0, reason: 'initial' }],
      _edit_meta: { last_edited_by: 'user1', last_edited_at: '2026-07-05T12:00:00Z' },
      intellectual_lineage: ['source-a'],
    }));
    expect(result.success).toBe(true);
  });
});

describe('extractPovErrors', () => {
  it('includes expected/received in invalid_type messages', () => {
    const result = povTaxonomyFileSchema.safeParse(validFile({ confidence: 'not-a-number' }));
    expect(result.success).toBe(false);
    if (!result.success) {
      const errors = extractPovErrors(result.error, [validNode({ confidence: 'not-a-number' })]);
      const msg = errors['nodes.acc-desires-001.confidence'];
      expect(msg).toBeDefined();
      expect(msg).toContain('expected');
      expect(msg).toContain('number');
    }
  });

  it('remaps array indices to node IDs', () => {
    const result = povTaxonomyFileSchema.safeParse(validFile({ label: '' }));
    expect(result.success).toBe(false);
    if (!result.success) {
      const errors = extractPovErrors(result.error, [validNode({ label: '' })]);
      expect(errors['nodes.acc-desires-001.label']).toBeDefined();
      expect(errors['nodes.0.label']).toBeUndefined();
    }
  });

  it('preserves descriptive messages for range violations', () => {
    const result = povTaxonomyFileSchema.safeParse(validFile({ confidence: 1.5 }));
    expect(result.success).toBe(false);
    if (!result.success) {
      const errors = extractPovErrors(result.error, [validNode({ confidence: 1.5 })]);
      const msg = errors['nodes.acc-desires-001.confidence'];
      expect(msg).toBeDefined();
      expect(msg.length).toBeGreaterThan(5);
    }
  });
});
