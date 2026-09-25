// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// The ENFORCEMENT half of the field-classification matrix (t/3648). This is not a document — it is the
// gate that makes the matrix fail CLOSED: it walks InquiryResultSchema for every leaf path and asserts
// each is classified on ALL THREE surfaces. A new contract field cannot ship until it is deliberately
// classified — the exact failure the matrix exists to prevent (a denylist failing open on an
// unclassified field, on a green mergeable PR — t/3651).

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { InquiryResultSchema } from './schema.js';
import { CLASSIFICATION, includedFields, dispositionFor, type Surface } from './fieldClassification.js';

const SURFACES: Surface[] = ['public-share', 'community', 'export'];

/** Recursively derive every LEAF dotted-path from a Zod schema (indices dropped — a path represents the
 *  leaf on every element/value). Duck-typed over Zod v3/v4 internals: unwrap optional/nullable/default;
 *  object → recurse shape; array → recurse element; record → recurse value; else leaf. */
function leafPaths(schema: unknown, prefix = ''): string[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let s: any = schema;
  // Unwrap optional / nullable / default / readonly / catch (all expose _def.innerType).
  while (s?._def?.innerType) s = s._def.innerType;
  const def = s?._def ?? {};

  // Object (incl. .passthrough()) — has a `shape`.
  const shape = typeof s?.shape === 'function' ? s.shape() : s?.shape;
  if (shape && typeof shape === 'object' && !Array.isArray(shape)) {
    return Object.keys(shape).flatMap((k) => leafPaths(shape[k], prefix ? `${prefix}.${k}` : k));
  }
  // Array — element under def.element (v4) or def.type (v3, a schema not a string).
  const element = def.element ?? (def.type && typeof def.type !== 'string' && def.type?._def ? def.type : undefined);
  if (element?._def) return leafPaths(element, prefix);
  // Record / map — value schema under def.valueType.
  if (def.valueType?._def) return leafPaths(def.valueType, prefix);

  return [prefix];
}

describe('fieldClassification — CI exhaustiveness gate (t/3648)', () => {
  const schemaPaths = new Set(leafPaths(InquiryResultSchema));
  const matrixPaths = new Set(Object.keys(CLASSIFICATION));

  it('EVERY InquiryResultSchema leaf path is classified — no unclassified field can ship (fail-closed)', () => {
    const unclassified = [...schemaPaths].filter((p) => !matrixPaths.has(p)).sort();
    // If this fails, a new/renamed contract field is unclassified. Add it to CLASSIFICATION with an
    // explicit disposition + reason on all three surfaces (never a reflexive default).
    expect(unclassified, `unclassified schema fields: ${unclassified.join(', ')}`).toEqual([]);
  });

  it('NO stale matrix key — every classified path still exists in the schema', () => {
    const stale = [...matrixPaths].filter((p) => !schemaPaths.has(p)).sort();
    expect(stale, `matrix keys not present in InquiryResultSchema: ${stale.join(', ')}`).toEqual([]);
  });

  it('every cell classifies all three surfaces with a non-empty reason', () => {
    for (const [path, cells] of Object.entries(CLASSIFICATION)) {
      for (const surface of SURFACES) {
        const cell = cells[surface];
        expect(cell, `${path} missing surface ${surface}`).toBeDefined();
        expect(typeof cell.include, `${path}.${surface}.include`).toBe('boolean');
        expect(cell.reason.trim().length, `${path}.${surface} needs a reason`).toBeGreaterThan(0);
      }
    }
  });

  it('debateId is the worked example: exclude / exclude / INCLUDE (public / community / export)', () => {
    expect(dispositionFor('debateId', 'public-share').include).toBe(false);
    expect(dispositionFor('debateId', 'community').include).toBe(false);
    expect(dispositionFor('debateId', 'export').include).toBe(true);
  });

  it('every NodeRef.nodeId is excluded from public-share, consistently', () => {
    for (const p of ['campVerdicts.nodes.nodeId', 'convergences.nodes.nodeId', 'grounding.nodesByCamp.nodeId']) {
      expect(dispositionFor(p, 'public-share').include, p).toBe(false);
    }
  });

  it('community differs from public-share by more than debateId (not a reflexive copy)', () => {
    // costUsd is community\'s own deliberate exclude; situationId/nodeId are community-include vs public-exclude.
    expect(dispositionFor('derivation.costUsd', 'community').include).toBe(false);
    expect(dispositionFor('request.situationId', 'community').include).toBe(true);
    expect(dispositionFor('request.situationId', 'public-share').include).toBe(false);
  });

  it('includedFields returns only the surface\'s included paths', () => {
    const pub = includedFields('public-share');
    expect(pub).not.toContain('debateId');
    expect(pub).not.toContain('campVerdicts.nodes.nodeId');
    expect(pub).toContain('request.question');
    expect(includedFields('export')).toContain('debateId'); // export is full-fidelity
  });

  it('dispositionFor throws on an unclassified path (fail-closed in code)', () => {
    expect(() => dispositionFor('made.up.path', 'public-share')).toThrow();
  });
});
