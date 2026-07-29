// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/1947: verify that the shared serializeEdgesJson function (used by
// modulateEdgeWeights.ts write path) produces the exact bytes specified by the
// edges-format contract (docs/edges-json-format.md).

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { serializeEdgesJson } from '../../edges/serializeEdges.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../../');
const FIXTURE_DIR = path.join(REPO_ROOT, 'tests', 'fixtures', 'edges-format');

describe('edges.json hybrid serializer (t/1947 write-path contract)', () => {
  it('byte-matches expected.json for the golden fixture input', () => {
    const input = JSON.parse(readFileSync(path.join(FIXTURE_DIR, 'input.json'), 'utf-8'));
    const expected = readFileSync(path.join(FIXTURE_DIR, 'expected.json'), 'utf-8');
    expect(serializeEdgesJson(input)).toBe(expected);
  });
});
