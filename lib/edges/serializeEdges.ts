// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Shared serializer for the hybrid edges.json format (t/673).
// The byte-level contract lives in docs/edges-json-format.md — this is the single
// TypeScript implementation consumed by every TS writer of edges.json (Server Storage,
// ElectronMain) so the two cannot drift. It is a pure function: no fs, no I/O.
//
// Format summary (see the doc for the authoritative contract):
//   - Top-level keys keep their existing order; nothing is sorted, added, or dropped.
//   - Every top-level value except `edges` is pretty-printed at 2-space indent and
//     re-indented one level (2 more spaces) to sit inside the root object.
//   - `edges` is emitted one compact `JSON.stringify(edge)` per line at 4-space indent.
//     An empty edges array is emitted inline as `"edges": []`.
//   - Output is LF-only, UTF-8, and ends with exactly one trailing newline.

import { ActionableError } from '../debate/errors.js';

/**
 * Serialize an edges.json object to the hybrid string format.
 *
 * @param data The parsed edges.json object (top-level key order is load-bearing).
 * @returns The serialized string, ending in exactly one `\n`.
 */
export function serializeEdgesJson(data: unknown): string {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new ActionableError({
      goal: 'Serialize edges.json in the hybrid format',
      problem: `Expected a top-level object, received ${data === null ? 'null' : Array.isArray(data) ? 'an array' : typeof data}`,
      location: 'lib/edges/serializeEdges.ts serializeEdgesJson',
      nextSteps: [
        'Pass the parsed edges.json object (e.g. JSON.parse(fileContents)), not a primitive or array',
        'See docs/edges-json-format.md for the expected top-level shape',
      ],
    });
  }

  const obj = data as Record<string, unknown>;
  const parts: string[] = [];

  for (const key of Object.keys(obj)) {
    const value = obj[key];
    if (key === 'edges' && Array.isArray(value)) {
      parts.push(serializeEdgesEntry(value));
    } else {
      // Pretty-print at 2 spaces, then re-indent one level so continuation lines
      // sit inside the root object. The first line stays inline after the key.
      // `JSON.stringify` returns `undefined` (not a string) for an undefined value;
      // guard so a stray undefined-valued key surfaces as an ActionableError instead
      // of a bare TypeError from `.replace`. Unreachable via JSON.parse (JSON has no
      // undefined), but this is a shared util two writers call with in-memory objects.
      const serialized = JSON.stringify(value, null, 2);
      if (serialized === undefined) {
        throw new ActionableError({
          goal: 'Serialize edges.json in the hybrid format',
          problem: `Top-level key ${JSON.stringify(key)} has an undefined value, which has no JSON representation`,
          location: 'lib/edges/serializeEdges.ts serializeEdgesJson',
          nextSteps: [
            `Remove the ${JSON.stringify(key)} key or give it a JSON value (string, number, boolean, null, array, or object)`,
            'See docs/edges-json-format.md — every top-level value must be JSON-serializable',
          ],
        });
      }
      const pretty = serialized.replace(/\n/g, '\n  ');
      parts.push(`  ${JSON.stringify(key)}: ${pretty}`);
    }
  }

  // Empty object is not a real edges.json, but keep the function total.
  if (parts.length === 0) return '{}\n';

  return `{\n${parts.join(',\n')}\n}\n`;
}

/**
 * Render the `edges` key: one compact edge per line at 4-space indent, or inline
 * `[]` when empty. `JSON.stringify` defaults already match the per-edge contract
 * (compact separators, literal UTF-8, per-edge key order preserved) — no replacer
 * or spacing argument.
 */
function serializeEdgesEntry(edges: unknown[]): string {
  if (edges.length === 0) return '  "edges": []';
  const lines = edges.map((edge) => `    ${JSON.stringify(edge)}`).join(',\n');
  return `  "edges": [\n${lines}\n  ]`;
}
