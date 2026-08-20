// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Tests for the Brief Export schema version-bump gate (t/2808).
// Exercises the pure comparison logic — the CLI's git plumbing is covered by the
// both-arms Gate Verification (TL) against real PRs.

import { describe, it, expect } from 'vitest';
// @ts-expect-error — plain ESM module, no type declarations needed for a test import.
import { schemaVersion, contractSignature, detectViolation, isPathAbsentError } from './check-version-bump.mjs';

function schema(version: string, extraProps: Record<string, unknown> = {}) {
  return {
    $schema: 'http://json-schema.org/draft-07/schema#',
    $id: `https://aitriad.local/schemas/deck_spec/${version}`,
    title: 'DeckSpec',
    type: 'object',
    required: ['deck_spec_version'],
    additionalProperties: false,
    properties: {
      deck_spec_version: { type: 'string', pattern: '^1\\.\\d+$' },
      ...extraProps,
    },
  };
}

describe('schemaVersion', () => {
  it('extracts major.minor from the $id', () => {
    expect(schemaVersion(schema('1.0'))).toBe('1.0');
    expect(schemaVersion(schema('1.7'))).toBe('1.7');
    expect(schemaVersion(schema('2.0'))).toBe('2.0');
  });
  it('returns null for a missing/malformed $id', () => {
    expect(schemaVersion({})).toBeNull();
    expect(schemaVersion({ $id: 'no-version-here' })).toBeNull();
  });
});

describe('contractSignature', () => {
  it('is identical when only description/title differ', () => {
    const a = schema('1.0', { foo: { type: 'string' } });
    const b = schema('1.0', { foo: { type: 'string', description: 'a docstring' } });
    (b as { title: string }).title = 'Renamed But Same Contract';
    expect(contractSignature(a)).toBe(contractSignature(b));
  });
  it('is identical when only the $id version differs (version is not part of the surface)', () => {
    expect(contractSignature(schema('1.0'))).toBe(contractSignature(schema('1.1')));
  });
  it('differs when a property is added', () => {
    expect(contractSignature(schema('1.0'))).not.toBe(
      contractSignature(schema('1.0', { newField: { type: 'number' } })),
    );
  });
});

describe('detectViolation', () => {
  it('flags a property addition with no version bump', () => {
    const base = schema('1.0');
    const head = schema('1.0', { newField: { type: 'number' } });
    const v = detectViolation('deck_spec.write.json', base, head);
    expect(v).not.toBeNull();
    expect(v.headVersion).toBe('1.0');
  });

  it('passes a property addition WITH a minor bump', () => {
    const base = schema('1.0');
    const head = schema('1.1', { newField: { type: 'number' } });
    expect(detectViolation('deck_spec.write.json', base, head)).toBeNull();
  });

  it('passes a description-only edit with no bump', () => {
    const base = schema('1.0', { foo: { type: 'string' } });
    const head = schema('1.0', { foo: { type: 'string', description: 'now documented' } });
    expect(detectViolation('deck_spec.write.json', base, head)).toBeNull();
  });

  it('passes a version-only bump with no contract change', () => {
    expect(detectViolation('deck_spec.write.json', schema('1.0'), schema('1.1'))).toBeNull();
  });

  it('flags a required-list change with no bump', () => {
    const base = schema('1.0', { foo: { type: 'string' } });
    const head = schema('1.0', { foo: { type: 'string' } });
    (head as { required: string[] }).required = ['deck_spec_version', 'foo'];
    expect(detectViolation('deck_spec.write.json', base, head)).not.toBeNull();
  });

  it('flags an enum change with no bump', () => {
    const base = schema('1.0', { mode: { type: 'string', enum: ['a', 'b'] } });
    const head = schema('1.0', { mode: { type: 'string', enum: ['a', 'b', 'c'] } });
    expect(detectViolation('deck_spec.write.json', base, head)).not.toBeNull();
  });

  it('ignores a brand-new schema file (no prior contract)', () => {
    expect(detectViolation('new.write.json', null, schema('1.0'))).toBeNull();
  });

  it('ignores a deleted schema file', () => {
    expect(detectViolation('gone.write.json', schema('1.0'), null)).toBeNull();
  });
});

describe('isPathAbsentError', () => {
  it('is true for git\'s "path absent at ref" messages (new file → null, safe)', () => {
    expect(isPathAbsentError("fatal: path 'lib/brief/schemas/deck_spec.write.json' does not exist in 'origin/main'")).toBe(true);
    expect(isPathAbsentError("fatal: path 'x.write.json' exists on disk, but not in 'origin/main'")).toBe(true);
  });

  it('is false for real git failures (bad ref, shallow gap, unavailable) — must NOT false-pass', () => {
    expect(isPathAbsentError("fatal: invalid object name 'origin/main'")).toBe(false);
    expect(isPathAbsentError("fatal: bad revision 'origin/nope'")).toBe(false);
    expect(isPathAbsentError("fatal: not a git repository")).toBe(false);
    expect(isPathAbsentError('')).toBe(false);
    expect(isPathAbsentError(undefined)).toBe(false);
  });
});
