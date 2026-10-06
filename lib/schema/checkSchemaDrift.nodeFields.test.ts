// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// @vitest-environment node
// node_fields drift (t/3955, TL t/3955#2 point 2): the record's top-level node fields compared against the
// Zod node schemas and the live corpus. Both arms per finding, on synthetic surfaces, plus the REAL record
// vs the REAL Zod schemas (must be clean).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { checkSchemaDrift, type SchemaRecord, type Extracted, type NodeFieldObservation } from './checkSchemaDrift.js';
import { extractZodVocab } from './extractors.js';

const REAL_RECORD = JSON.parse(
  readFileSync(fileURLToPath(new URL('./taxonomy-schema.json', import.meta.url)), 'utf-8'),
) as SchemaRecord;

const RECORD: SchemaRecord = {
  graph_attributes: {},
  edges: { canonical: [], deprecated_types: [] },
  node_fields: { _doc: 'note, not a field', pov_tags: { type: 'array', elem: 'string', applies_to: 'pov', status: 'active' } },
};

const ex = (kind: 'validator' | 'corpus', pov?: Record<string, NodeFieldObservation>, situation?: Record<string, NodeFieldObservation>): Extracted =>
  ({ source: 'test', kind, nodeFields: { ...(pov ? { pov } : {}), ...(situation ? { situation } : {}) } });
const nf = (e: Extracted) => checkSchemaDrift(RECORD, e).filter((f) => f.field.startsWith('node_fields'));

describe('checkSchemaDrift node_fields (t/3955)', () => {
  it('CLEAN: POV schema declares the array, situation schema rejects it', () => {
    expect(nf(ex('validator', { pov_tags: { accepts: true, type: 'array' } }, { pov_tags: { accepts: false } }))).toEqual([]);
  });

  it('missing_in_consumer when the POV schema does not declare it (it would be stripped on parse)', () => {
    const f = nf(ex('validator', {}, { pov_tags: { accepts: false } }));
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ type: 'missing_in_consumer', field: 'node_fields.pov_tags' });
  });

  it('missing_in_consumer when the situation schema does not REJECT it (undeclared = silently stripped)', () => {
    const f = nf(ex('validator', { pov_tags: { accepts: true, type: 'array' } }, {}));
    expect(f).toHaveLength(1);
    expect(f[0].detail).toMatch(/does not REJECT/);
  });

  it('extra_in_consumer when the situation schema ACCEPTS a pov-only field', () => {
    const f = nf(ex('validator', { pov_tags: { accepts: true, type: 'array' } }, { pov_tags: { accepts: true, type: 'array' } }));
    expect(f).toEqual([expect.objectContaining({ type: 'extra_in_consumer', field: 'node_fields.pov_tags' })]);
  });

  it('type_mismatch when the POV schema declares the wrong type', () => {
    const f = nf(ex('validator', { pov_tags: { accepts: true, type: 'string' } }, { pov_tags: { accepts: false } }));
    expect(f).toEqual([expect.objectContaining({ type: 'type_mismatch' })]);
  });

  it('corpus: type_mismatch on a one-element array unrolled to a string, and extra on a situation carrying tags', () => {
    const f = nf(ex('corpus', { pov_tags: { accepts: true, type: 'array|string' } }, { pov_tags: { accepts: true, type: 'array' } }));
    expect(f.map((x) => x.type).sort()).toEqual(['extra_in_consumer', 'type_mismatch']);
  });

  it('corpus: an untagged corpus (field absent everywhere) is NOT drift', () => {
    expect(nf(ex('corpus', {}, {}))).toEqual([]);
  });

  it('skips _-prefixed keys and surfaces that cover neither node kind', () => {
    expect(nf({ source: 'test', kind: 'validator' })).toEqual([]);
  });

  it('REAL record vs REAL Zod node schemas: no node_fields drift', () => {
    const f = checkSchemaDrift(REAL_RECORD, extractZodVocab()).filter((x) => x.field.startsWith('node_fields'));
    expect(f).toEqual([]);
  });
});
