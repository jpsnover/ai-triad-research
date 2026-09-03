// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import { povTaxonomyFileSchema, extractPovErrors, stripInvalidLogicalForm } from './validation';

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

  it('accepts + RETAINS t/3157 entity_refs/concept_refs (survive the node write, not stripped)', () => {
    const result = povTaxonomyFileSchema.safeParse(validFile({
      entity_refs: [{ ref: 'ent-001', surface: 'Anthropic', method: 'alias', link_confidence: 1.0, match_level: 'exact', status: 'linked' }],
      concept_refs: [{ ref: 'term:alignment', surface: 'alignment', method: 'surface', link_confidence: 0.8, status: 'proposed' }],
    }));
    expect(result.success).toBe(true);
    if (result.success) {
      const node = result.data.nodes[0] as Record<string, unknown>;
      expect(node.entity_refs).toHaveLength(1);  // retained — this is the whole point of G1
      expect(node.concept_refs).toHaveLength(1);
      expect((node.entity_refs as { status: string }[])[0].status).toBe('linked');
      expect((node.concept_refs as { status: string }[])[0].status).toBe('proposed');
    }
  });

  it('rejects an entity_ref with an invalid status (schema validates the link shape, not just passthrough)', () => {
    const result = povTaxonomyFileSchema.safeParse(validFile({
      entity_refs: [{ ref: 'ent-001', surface: 'x', method: 'alias', link_confidence: 1, match_level: 'exact', status: 'guessed' }],
    }));
    expect(result.success).toBe(false);
  });

  it('omits entity_refs/concept_refs entirely on a legacy node (optional, absence is legal)', () => {
    const result = povTaxonomyFileSchema.safeParse(validFile());
    expect(result.success).toBe(true);
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

// t/3250: canonical logical_form is now validated (not silently .passthrough()'d), with a
// graceful-degrade at load so a malformed *proposed* frame never drops the whole node.
const validLogicalForm = {
  predicate: 'resolve',
  event_ref: 'e1',
  args: [{ role: 'agent', ref: 'ent-001', sort: 'agentive-physical-object', match_level: 'exact' }],
  polarity: 'positive',
  modality: { holder: 'camp:acc', attitude: 'desire' },
  temporal: { type: 'unspecified', value: null },
  formalization_confidence: 0.9,
  status: 'proposed',
};

describe('povNodeSchema.logical_form (t/3250) — validated, not silently accepted', () => {
  it('accepts a node carrying a valid logical_form', () => {
    const result = povTaxonomyFileSchema.safeParse(validFile({ logical_form: validLogicalForm }));
    expect(result.success).toBe(true);
  });

  it('rejects an out-of-vocab enum (was silently passed through before)', () => {
    const result = povTaxonomyFileSchema.safeParse(validFile({ logical_form: { ...validLogicalForm, polarity: 'maybe' } }));
    expect(result.success).toBe(false);
  });

  it('rejects a logical_form missing a required field', () => {
    const noPredicate = { ...validLogicalForm } as Record<string, unknown>;
    delete noPredicate.predicate;
    const result = povTaxonomyFileSchema.safeParse(validFile({ logical_form: noPredicate }));
    expect(result.success).toBe(false);
  });
});

describe('stripInvalidLogicalForm (t/3250) — graceful degrade at load', () => {
  it('keeps a valid logical_form untouched (removed:false)', () => {
    const node: Record<string, unknown> = { id: 'acc-desires-001', logical_form: { ...validLogicalForm } };
    const r = stripInvalidLogicalForm(node);
    expect(r.removed).toBe(false);
    expect(node.logical_form).toBeDefined();
  });

  it('strips a malformed frame + reports the issue, node survives with field omitted (NOT dropped)', () => {
    const node: Record<string, unknown> = { id: 'acc-desires-002', logical_form: { ...validLogicalForm, status: 'bogus' } };
    const r = stripInvalidLogicalForm(node);
    expect(r.removed).toBe(true);
    expect(r.issue).toBeTruthy();
    expect(node.logical_form).toBeUndefined(); // field omitted
    expect(node.id).toBe('acc-desires-002');   // rest of the node intact
  });

  it('is a no-op when the node has no logical_form', () => {
    const node: Record<string, unknown> = { id: 'acc-desires-003' };
    expect(stripInvalidLogicalForm(node).removed).toBe(false);
  });
});
