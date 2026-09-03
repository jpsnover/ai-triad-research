// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Definition-level tests for the canonical link-ref schemas (t/3253). Mirrors logicalForm.test.ts:
// valid parses; every closed vocabulary rejects an out-of-vocab value; required-field omission
// rejects; passthrough forgives additive unknown keys. The bidirectional type-equality guards are
// compile-time (they fail tsc, not vitest).
import { describe, it, expect } from 'vitest';
import { entityLinkRefSchema, conceptLinkRefSchema } from './linkRefs.js';

const ENTITY = {
  ref: 'ent-034',
  surface: 'OpenAI',
  method: 'exact',
  link_confidence: 1.0,
  match_level: 'exact',
  status: 'linked',
};
const CONCEPT = {
  ref: 'term:frontier-model',
  surface: 'frontier models',
  method: 'surface',
  link_confidence: 0.82,
  status: 'proposed',
};

describe('entityLinkRefSchema — valid + reject arms', () => {
  it('parses a canonical entity link ref', () => {
    expect(entityLinkRefSchema.safeParse(ENTITY).success).toBe(true);
  });
  it('passthrough: forgives an additive unknown key', () => {
    expect(entityLinkRefSchema.safeParse({ ...ENTITY, future_field: 1 }).success).toBe(true);
  });
  it('rejects an out-of-vocab method', () => {
    expect(entityLinkRefSchema.safeParse({ ...ENTITY, method: 'surface' }).success).toBe(false);
  });
  it('rejects an out-of-vocab match_level', () => {
    expect(entityLinkRefSchema.safeParse({ ...ENTITY, match_level: 'fuzzy' }).success).toBe(false);
  });
  it('rejects an out-of-vocab status', () => {
    expect(entityLinkRefSchema.safeParse({ ...ENTITY, status: 'accepted' }).success).toBe(false);
  });
  it('rejects a required-field omission (missing match_level)', () => {
    const { match_level: _drop, ...noMl } = ENTITY;
    expect(entityLinkRefSchema.safeParse(noMl).success).toBe(false);
  });
});

describe('conceptLinkRefSchema — valid + reject arms', () => {
  it('parses a canonical concept link ref', () => {
    expect(conceptLinkRefSchema.safeParse(CONCEPT).success).toBe(true);
  });
  it('passthrough: forgives an additive unknown key', () => {
    expect(conceptLinkRefSchema.safeParse({ ...CONCEPT, future_field: 1 }).success).toBe(true);
  });
  it('rejects the entity-only method "alias" (concepts have no alias table)', () => {
    expect(conceptLinkRefSchema.safeParse({ ...CONCEPT, method: 'alias' }).success).toBe(false);
  });
  it('rejects an out-of-vocab status', () => {
    expect(conceptLinkRefSchema.safeParse({ ...CONCEPT, status: 'accepted' }).success).toBe(false);
  });
  it('rejects a stray match_level? no — passthrough tolerates extra keys, but a bad status still fails', () => {
    // concept refs have no match_level field; an extra one is an additive key (tolerated),
    // so this asserts the schema still validates the DEFINED fields on such an object.
    expect(conceptLinkRefSchema.safeParse({ ...CONCEPT, match_level: 'exact' }).success).toBe(true);
    expect(conceptLinkRefSchema.safeParse({ ...CONCEPT, match_level: 'exact', status: 'nope' }).success).toBe(false);
  });
});
