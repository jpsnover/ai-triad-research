// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import path from 'node:path';
import { ActionableError } from '../debate/errors.js';

// Consolidates SAFE_ID_RE (fileIO.ts:78) and SAFE_NAME (promptLoader.ts:6) — byte-identical.
export const SAFE_ID_RE = /^[a-zA-Z0-9_-]+$/;

export function isSafeId(value: string): boolean {
  return !!value && SAFE_ID_RE.test(value);
}

export function assertSafeId(value: string, label = 'id'): string {
  if (!isSafeId(value))
    throw Object.assign(new ActionableError({
      goal: 'Validate input parameter',
      problem: `Invalid ${label}: must be alphanumeric, hyphens, or underscores only, got "${value}"`,
      location: 'lib/electron-shared/safeId.ts → assertSafeId',
      nextSteps: ['Check the input contains only a-z, A-Z, 0-9, hyphens, and underscores'],
    }), { statusCode: 400 });
  return value;
}

/**
 * Assert that resolvedPath is strictly inside baseDir (not equal to it, not a sibling
 * sharing a prefix). Both arguments must already be fully resolved (path.resolve'd).
 * Uses path.relative to avoid the startsWith-sibling-prefix false-pass (t/2526).
 */
export function assertContainedIn(resolvedPath: string, baseDir: string): void {
  const rel = path.relative(baseDir, resolvedPath);
  const safe = rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
  if (!safe)
    throw Object.assign(new ActionableError({
      goal: 'Validate file path containment',
      problem: `Path "${resolvedPath}" escapes base directory "${baseDir}"`,
      location: 'lib/electron-shared/safeId.ts → assertContainedIn',
      nextSteps: ['Ensure the path was constructed from a validated safe identifier', 'Do not use user-supplied path segments directly'],
    }), { statusCode: 400 });
}
