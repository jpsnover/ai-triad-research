// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// @vitest-environment node
// Both-arms proof at birth (Guard Testability, t/3453): a FIRE arm deliberately triggers each of the
// 4 Finding types, and a CLEAN arm shows the true record + a matching extraction yields zero findings.
// A third arm feeds an extraction that mirrors the 4 KNOWN corpus defects (t/3448-t/3451) and asserts
// exactly those findings — the "clean modulo known defects" contract. All fixture-based (no live
// corpus / no ai-triad-data dependency), so the comparator's contract is proven deterministically in CI.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { checkSchemaDrift, type SchemaRecord, type Extracted, type Finding } from './checkSchemaDrift.js';

// The TRUE record, loaded from the landed artifact (t/3452).
const RECORD = JSON.parse(
  readFileSync(fileURLToPath(new URL('./taxonomy-schema.json', import.meta.url)), 'utf-8'),
) as SchemaRecord;

const types = (fs: Finding[]) => fs.map((f) => f.type).sort();

describe('checkSchemaDrift — FIRE arm (each Finding type triggers)', () => {
  it('missing_in_consumer: a validator missing a record value + a canonical edge type', () => {
    const extracted: Extracted = {
      source: 'zod', kind: 'validator',
      attributes: { epistemic_type: { type: 'enum', values: ['empirical_claim'] } }, // record has 7
      edgeTypes: ['SUPPORTS'], // record canonical has 8
    };
    const f = checkSchemaDrift(RECORD, extracted);
    expect(f.some((x) => x.type === 'missing_in_consumer' && x.field === 'graph_attributes.epistemic_type')).toBe(true);
    expect(f.some((x) => x.type === 'missing_in_consumer' && x.field === 'edges' && x.value === 'CONTRADICTS')).toBe(true);
  });

  it('extra_in_consumer: a value + an edge type the record does not declare', () => {
    const extracted: Extracted = {
      source: 'corpus', kind: 'corpus',
      attributes: { epistemic_type: { values: ['empirical_claim', 'made_up_type'] } },
      edgeTypes: ['SUPPORTS', 'LLM_PROPOSED_JUNK'],
    };
    const f = checkSchemaDrift(RECORD, extracted);
    expect(f.some((x) => x.type === 'extra_in_consumer' && x.value === 'made_up_type')).toBe(true);
    expect(f.some((x) => x.type === 'extra_in_consumer' && x.field === 'edges' && x.value === 'LLM_PROPOSED_JUNK')).toBe(true);
  });

  it('type_mismatch: consumer type differs from the record type', () => {
    const extracted: Extracted = {
      source: 'corpus', kind: 'corpus',
      attributes: { steelman_vulnerability: { type: 'object' } }, // record type = string
    };
    const f = checkSchemaDrift(RECORD, extracted);
    expect(f.some((x) => x.type === 'type_mismatch' && x.field === 'graph_attributes.steelman_vulnerability')).toBe(true);
  });

  it('deprecated_in_use: a record-deprecated attribute present in the corpus', () => {
    const extracted: Extracted = {
      source: 'corpus', kind: 'corpus',
      attributes: { attribution_text: { type: 'string', values: [] } }, // record status:deprecated
    };
    const f = checkSchemaDrift(RECORD, extracted);
    expect(f.some((x) => x.type === 'deprecated_in_use' && x.field === 'graph_attributes.attribution_text')).toBe(true);
  });

  it('deprecated_in_use: a deprecated EDGE type in use (sprawl re-entry)', () => {
    // Simulate deprecated_types being populated + used (today deprecated_types is []).
    const recWithDeprecatedEdge: SchemaRecord = {
      ...RECORD,
      edges: { canonical: RECORD.edges.canonical, deprecated_types: ['llm_proposed_old'] },
    };
    const f = checkSchemaDrift(recWithDeprecatedEdge, { source: 'corpus', kind: 'corpus', edgeTypes: ['SUPPORTS', 'llm_proposed_old'] });
    expect(f.some((x) => x.type === 'deprecated_in_use' && x.field === 'edges' && x.value === 'llm_proposed_old')).toBe(true);
  });

  it('deprecated_in_use: a status:removed TOMBSTONE field re-appearing in the corpus fires (t/3463)', () => {
    // synthetic_phrases is a status:'removed' tombstone (t/3433) — retired from the corpus. If it
    // re-appears, that is the drift the tombstone exists to catch.
    const f = checkSchemaDrift(RECORD, { source: 'corpus', kind: 'corpus', attributes: { synthetic_phrases: { type: 'array' } } });
    const hit = f.find((x) => x.type === 'deprecated_in_use' && x.field === 'graph_attributes.synthetic_phrases');
    expect(hit).toBeDefined();
    expect(hit!.detail).toContain('status:removed');
  });

  it('a status:removed tombstone ABSENT from the corpus does NOT fire (no false positive)', () => {
    // The normal post-retirement state: synthetic_phrases not present in the corpus extraction.
    const f = checkSchemaDrift(RECORD, { source: 'corpus', kind: 'corpus', attributes: { epistemic_type: { values: ['empirical_claim'] } } });
    expect(f.some((x) => x.field === 'graph_attributes.synthetic_phrases')).toBe(false);
  });
});

describe('checkSchemaDrift — CLEAN arm (record ⇄ matching extraction = zero findings)', () => {
  it('a validator that mirrors the record exactly yields NO findings', () => {
    // Build an extraction that exactly matches the record's enum value-sets + all 8 edges.
    const attributes: Extracted['attributes'] = {};
    for (const [field, attr] of Object.entries(RECORD.graph_attributes)) {
      const vals = attr.values ?? attr.atomic_values;
      if (vals) attributes[field] = { type: attr.type, values: [...vals] };
    }
    const extracted: Extracted = {
      source: 'zod', kind: 'validator',
      attributes,
      edgeTypes: RECORD.edges.canonical.map((e) => e.type),
      nodeId: { pov: RECORD.node_id?.pov, category: RECORD.node_id?.category },
    };
    expect(checkSchemaDrift(RECORD, extracted)).toEqual([]);
  });

  it('a corpus that uses only declared, non-deprecated values yields NO findings', () => {
    const extracted: Extracted = {
      source: 'corpus', kind: 'corpus',
      attributes: {
        epistemic_type: { values: ['empirical_claim', 'predictive'] },
        node_scope: { values: ['claim', 'systemic'] },
        rhetorical_strategy: { values: ['appeal_to_evidence'] },
      },
      edgeTypes: ['SUPPORTS', 'TENSION_WITH'],
    };
    expect(checkSchemaDrift(RECORD, extracted)).toEqual([]);
  });
});

describe('checkSchemaDrift — CLEAN-modulo-known-defects arm (t/3448-t/3451)', () => {
  it('the real corpus state reproduces exactly the expected known-defect findings', () => {
    // A corpus extraction mirroring the 4 drafting-time defects the record documents:
    const extracted: Extracted = {
      source: 'corpus', kind: 'corpus',
      attributes: {
        // t/3448: rhetorical_strategy vocab drift — evidence_based is a variant canonical-16 merged
        // into appeal_to_evidence, so it is no longer a declared value (fires extra_in_consumer).
        rhetorical_strategy: { values: ['appeal_to_evidence', 'evidence_based'] },
        // t/3450: cross-field contamination — moral_imperative leaked into emotional_register.
        emotional_register: { values: ['cautionary', 'moral_imperative'] },
        // t/3449: steelman_vulnerability type-drift — dict shape observed where record says string.
        steelman_vulnerability: { type: 'object' },
      },
    };
    const f = checkSchemaDrift(RECORD, extracted);
    // Exactly the 3 divergence-producing defects surface (t/3451 is status:transient in the record →
    // NOT a finding by design; documented in the record's motivation as a residue, not drift).
    expect(types(f)).toEqual(['extra_in_consumer', 'extra_in_consumer', 'type_mismatch']);
    expect(f.some((x) => x.value === 'evidence_based')).toBe(true);
    expect(f.some((x) => x.value === 'moral_imperative')).toBe(true);
    expect(f.some((x) => x.type === 'type_mismatch' && x.field === 'graph_attributes.steelman_vulnerability')).toBe(true);
  });
});
