// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/2799 — derived read-variant assertion.
// The strict write schemas are the single source of truth; the read variant is
// mechanically derived (additionalProperties:false stripped). This test asserts
// the invariant so two-schema drift is impossible.

import { describe, it, expect } from 'vitest';
import { deriveReadSchema, hasAdditionalPropertiesFalse } from './schemaUtils.js';
import deckSpecStrict from './schemas/deck_spec.write.json';
import narrationStrict from './schemas/narration.write.json';
import auditManifestStrict from './schemas/audit-manifest.write.json';

const SCHEMAS = [
  { name: 'deck_spec', schema: deckSpecStrict },
  { name: 'narration', schema: narrationStrict },
  { name: 'audit-manifest', schema: auditManifestStrict },
];

describe('strict write schemas', () => {
  SCHEMAS.forEach(({ name, schema }) => {
    it(`${name}: has additionalProperties:false (strict)`, () => {
      expect(hasAdditionalPropertiesFalse(schema as never)).toBe(true);
    });

    it(`${name}: deck_spec_version pattern is ^1\\.\\d+$ (not const)`, () => {
      const versionProp = (schema as Record<string, Record<string, unknown>>)
        .properties?.deck_spec_version;
      expect(versionProp?.['const']).toBeUndefined();
      expect(versionProp?.['pattern']).toBe('^1\\.\\d+$');
    });
  });
});

describe('deriveReadSchema', () => {
  SCHEMAS.forEach(({ name, schema }) => {
    it(`${name}: derived read variant has NO additionalProperties:false`, () => {
      const read = deriveReadSchema(schema as never);
      expect(hasAdditionalPropertiesFalse(read)).toBe(false);
    });

    it(`${name}: derived read variant preserves top-level type and required`, () => {
      const strict = schema as Record<string, unknown>;
      const read = deriveReadSchema(strict);
      expect(read['type']).toBe('object');
      expect(read['required']).toEqual(strict['required']);
    });

    it(`${name}: derived read variant is idempotent and strips only additionalProperties:false`, () => {
      const strict = schema as Record<string, unknown>;
      const read = deriveReadSchema(strict);
      // Idempotent: a second derivation changes nothing
      expect(deriveReadSchema(read)).toEqual(read);
      // Strict contains the field; derived has no :false form (schema-valued additionalProperties is preserved)
      expect(JSON.stringify(strict)).toContain('"additionalProperties":false');
      expect(JSON.stringify(read)).not.toContain('"additionalProperties":false');
    });
  });
});

describe('narration.write.json', () => {
  it('trace fields have RFC 6901 JSON Pointer pattern', () => {
    const entries = (narrationStrict as Record<string, Record<string, Record<string, unknown>>>)
      .properties?.entries?.items as Record<string, Record<string, unknown>> | undefined;
    expect(entries?.properties?.trace?.['pattern']).toBe('^(/([^~/]|~[01])*)+$');
  });

  it('narration_mode is a required enum field', () => {
    const required = (narrationStrict as Record<string, unknown[]>).required;
    expect(required).toContain('narration_mode');
    const prop = (narrationStrict as Record<string, Record<string, Record<string, unknown>>>)
      .properties?.narration_mode;
    expect(prop?.['enum']).toEqual(['narrated', 'deterministic']);
  });

  it('preset is a required field', () => {
    const required = (narrationStrict as Record<string, unknown[]>).required;
    expect(required).toContain('preset');
  });
});

describe('audit-manifest.write.json', () => {
  it('trace_coverage_pct has no const:100 (gate moved to T5)', () => {
    const prop = (auditManifestStrict as Record<string, Record<string, Record<string, unknown>>>)
      .properties?.trace_coverage_pct;
    expect(prop?.['const']).toBeUndefined();
    expect(prop?.['minimum']).toBe(0);
    expect(prop?.['maximum']).toBe(100);
  });

  it('narration_mode is required', () => {
    const required = (auditManifestStrict as Record<string, unknown[]>).required;
    expect(required).toContain('narration_mode');
  });
});

describe('deck_spec.write.json', () => {
  it('meta.snapshot is an optional boolean', () => {
    const metaProps = (deckSpecStrict as Record<string, Record<string, Record<string, Record<string, unknown>>>>)
      .properties?.meta?.properties;
    expect(metaProps?.snapshot?.['type']).toBe('boolean');
  });

  it('meta.snapshot is not in required array', () => {
    const metaRequired = (deckSpecStrict as Record<string, Record<string, unknown[]>>)
      .properties?.meta?.required;
    expect(metaRequired).not.toContain('snapshot');
  });
});
