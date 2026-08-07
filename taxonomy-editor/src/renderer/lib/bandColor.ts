// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

export type BandEntry = { threshold: number; color: string };

/** Returns the color from the first band where value >= threshold. */
export function bandColor(value: number, bands: readonly BandEntry[]): string {
  for (const { threshold, color } of bands) {
    if (value >= threshold) return color;
  }
  return bands.at(-1)?.color ?? '';
}

/** Claim / argument strength (ClaimsView primary banding). */
export const CONFIDENCE_BANDS: readonly BandEntry[] = [
  { threshold: 0.8, color: '#22c55e' },
  { threshold: 0.5, color: '#3b82f6' },
  { threshold: 0.3, color: '#f59e0b' },
  { threshold: 0,   color: '#ef4444' },
];

/** Concession-asymmetry magnitude; returns CSS variable tokens. */
export const RISK_BANDS: readonly BandEntry[] = [
  { threshold: 0.3,  color: 'var(--danger)' },
  { threshold: 0.15, color: 'var(--warning)' },
  { threshold: 0,    color: 'var(--success)' },
];

/** Token-budget consumption level; returns CSS class suffix string. */
export const BUDGET_BANDS: readonly BandEntry[] = [
  { threshold: 0.95, color: 'urgent' },
  { threshold: 0.8,  color: 'warning' },
  { threshold: 0,    color: '' },
];
