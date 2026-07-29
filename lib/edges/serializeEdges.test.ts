// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { serializeEdgesJson } from './serializeEdges.js';

// Repo root is two levels up from lib/edges/.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const fixtureDir = path.join(repoRoot, 'tests', 'fixtures', 'edges-format');

function readFixture(name: string): string {
  return readFileSync(path.join(fixtureDir, name), 'utf8');
}

describe('serializeEdgesJson', () => {
  it('reproduces the golden fixture byte-for-byte', () => {
    const input = JSON.parse(readFixture('input.json'));
    const expected = readFixture('expected.json');
    expect(serializeEdgesJson(input)).toBe(expected);
  });

  it('ends with exactly one trailing newline and contains no CR characters', () => {
    const input = JSON.parse(readFixture('input.json'));
    const output = serializeEdgesJson(input);
    expect(output.endsWith('\n')).toBe(true);
    expect(output.endsWith('\n\n')).toBe(false);
    expect(output).not.toContain('\r');
  });

  it('emits an empty edges array inline', () => {
    const output = serializeEdgesJson({ _schema_version: '1.0.0', edges: [] });
    expect(output).toBe('{\n  "_schema_version": "1.0.0",\n  "edges": []\n}\n');
  });

  it('handles a missing edges key without throwing', () => {
    const output = serializeEdgesJson({ _schema_version: '1.0.0', last_modified: '2026-07-29T00:00:00Z' });
    expect(output).toBe(
      '{\n  "_schema_version": "1.0.0",\n  "last_modified": "2026-07-29T00:00:00Z"\n}\n',
    );
  });

  it('serializes a single edge compactly on its own line at 4-space indent', () => {
    const edge = { source: 'acc-beliefs-001', target: 'saf-beliefs-042', type: 'SUPPORTS' };
    const output = serializeEdgesJson({ edges: [edge] });
    expect(output).toBe(
      '{\n  "edges": [\n    {"source":"acc-beliefs-001","target":"saf-beliefs-042","type":"SUPPORTS"}\n  ]\n}\n',
    );
  });

  it('preserves top-level key order as given (does not sort)', () => {
    // Keys deliberately out of alphabetical order.
    const output = serializeEdgesJson({ zulu: 1, alpha: 2, edges: [], mike: 3 });
    const keyOrder = [...output.matchAll(/^  "([^"]+)":/gm)].map((m) => m[1]);
    expect(keyOrder).toEqual(['zulu', 'alpha', 'edges', 'mike']);
  });

  it('re-indents a nested top-level object one level in', () => {
    const output = serializeEdgesJson({ meta: { a: 1, b: 2 }, edges: [] });
    expect(output).toBe(
      '{\n  "meta": {\n    "a": 1,\n    "b": 2\n  },\n  "edges": []\n}\n',
    );
  });

  it('throws an ActionableError on non-object input', () => {
    expect(() => serializeEdgesJson([])).toThrow(/top-level object/);
    expect(() => serializeEdgesJson(null)).toThrow(/top-level object/);
    expect(() => serializeEdgesJson('nope')).toThrow(/top-level object/);
  });
});
