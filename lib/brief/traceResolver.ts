// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// RFC 6901 JSON Pointer resolver for the Brief Export pipeline (t/2801).
// Consumed by narrate (T3), render (T4), and verify (T5) — do NOT fork.
// All three stages share this single implementation.

import { ActionableError } from '../debate/errors.js';
import type { DeckSpec } from './types.js';

const LOCATION = 'lib/brief/traceResolver.ts';

/**
 * Build an RFC 6901 JSON Pointer string from a path array.
 * Escapes `~` → `~0` and `/` → `~1` per the spec.
 * buildTrace(['cruxes', 1]) → '/cruxes/1'
 * buildTrace([]) → '' (root pointer)
 */
export function buildTrace(path: (string | number)[]): string {
  if (path.length === 0) return '';
  return '/' + path
    .map(seg =>
      typeof seg === 'number'
        ? String(seg)
        : String(seg).replace(/~/g, '~0').replace(/\//g, '~1')
    )
    .join('/');
}

/**
 * Resolve an RFC 6901 JSON Pointer into a DeckSpec.
 * Returns the value at the pointer location.
 * Throws ActionableError if the pointer is invalid or the path is unresolvable.
 */
export function resolveTrace(spec: DeckSpec, pointer: string): unknown {
  if (pointer === '') return spec;

  if (!pointer.startsWith('/')) {
    throw new ActionableError({
      goal: 'Resolve JSON Pointer trace into deck_spec',
      problem: `Pointer "${pointer}" is not a valid RFC 6901 pointer (must start with '/' or be empty)`,
      location: LOCATION,
      nextSteps: ['Use buildTrace() to construct valid pointers.'],
    });
  }

  const tokens = pointer
    .slice(1)
    .split('/')
    .map(t => t.replace(/~1/g, '/').replace(/~0/g, '~'));

  let current: unknown = spec;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const traversed = '/' + tokens.slice(0, i + 1).join('/');

    if (current === null || current === undefined) {
      throw new ActionableError({
        goal: 'Resolve JSON Pointer trace into deck_spec',
        problem: `Cannot traverse into null/undefined at "${traversed}" in pointer "${pointer}"`,
        location: LOCATION,
        nextSteps: ['Check that the deck_spec has the expected structure.'],
      });
    }

    if (Array.isArray(current)) {
      const idx = Number(token);
      if (!Number.isInteger(idx) || idx < 0 || String(idx) !== token) {
        throw new ActionableError({
          goal: 'Resolve JSON Pointer trace into deck_spec',
          problem: `Array index "${token}" is not a valid non-negative integer at "${traversed}"`,
          location: LOCATION,
          nextSteps: [`Use an integer index for array access. Pointer: "${pointer}"`],
        });
      }
      if (idx >= (current as unknown[]).length) {
        throw new ActionableError({
          goal: 'Resolve JSON Pointer trace into deck_spec',
          problem: `Array index ${idx} out of bounds (length ${(current as unknown[]).length}) at "${traversed}"`,
          location: LOCATION,
          nextSteps: [`Pointer "${pointer}" refers to a non-existent array element.`],
        });
      }
      current = (current as unknown[])[idx];
    } else if (typeof current === 'object') {
      const obj = current as Record<string, unknown>;
      if (!(token in obj)) {
        throw new ActionableError({
          goal: 'Resolve JSON Pointer trace into deck_spec',
          problem: `Key "${token}" not found in object at "${traversed}" (pointer: "${pointer}")`,
          location: LOCATION,
          nextSteps: ['The model may have hallucinated a trace. Verify the pointer against the deck_spec structure.'],
        });
      }
      current = obj[token];
    } else {
      throw new ActionableError({
        goal: 'Resolve JSON Pointer trace into deck_spec',
        problem: `Cannot traverse into a scalar value (${typeof current}) at "${traversed}"`,
        location: LOCATION,
        nextSteps: [`Pointer "${pointer}" traverses past a leaf node.`],
      });
    }
  }

  return current;
}

/**
 * Test whether a pointer is resolvable into the spec without throwing.
 * Used by narrate (self-validation) and verify (T5 coverage gate).
 */
export function isResolvable(spec: DeckSpec, pointer: string): boolean {
  try {
    resolveTrace(spec, pointer);
    return true;
  } catch {
    return false;
  }
}
