// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import type { Category, Pov } from '../types/taxonomy';

const POV_PREFIX: Record<Pov, string> = {
  accelerationist: 'acc',
  safetyist: 'saf',
  skeptic: 'skp',
};

const CATEGORY_SLUG: Record<Category, string> = {
  'Desires': 'desires',
  'Beliefs': 'beliefs',
  'Intentions': 'intentions',
};

function zeroPad(n: number, width: number = 3): string {
  return String(n).padStart(width, '0');
}

function maxSequence(ids: string[], prefix: string): number {
  let max = 0;
  for (const id of ids) {
    if (id.startsWith(prefix)) {
      const suffix = id.slice(prefix.length);
      const num = parseInt(suffix, 10);
      if (!isNaN(num) && num > max) {
        max = num;
      }
    }
  }
  return max;
}

export function generatePovNodeId(
  pov: Pov,
  category: Category,
  existingIds: string[],
): string {
  const prefix = `${POV_PREFIX[pov]}-${CATEGORY_SLUG[category]}-`;
  const next = maxSequence(existingIds, prefix) + 1;
  return `${prefix}${zeroPad(next)}`;
}

export function generateSituationId(existingIds: string[]): string {
  const prefix = 'sit-';
  const next = maxSequence(existingIds, prefix) + 1;
  return `${prefix}${zeroPad(next)}`;
}

/** @deprecated Use generateSituationId */
export const generateCrossCuttingId = generateSituationId;

export function generateConflictId(
  claimLabel: string,
  existingIds: string[],
): string {
  const slug = claimLabel
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 30)
    .replace(/-$/, '');
  const prefix = `conflict-${slug}-`;
  const next = maxSequence(existingIds, prefix) + 1;
  return `${prefix}${zeroPad(next)}`;
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}
