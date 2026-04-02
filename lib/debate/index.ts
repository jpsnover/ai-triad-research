// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Shared debate library — barrel export.
 * Consumed by taxonomy-editor (Electron app) and the future CLI debate runner.
 */

export * from './errors';
export * from './types';
export * from './taxonomyTypes';
export * from './prompts';
export * from './argumentNetwork';
export * from './taxonomyContext';
export * from './taxonomyRelevance';
export * from './harvestUtils';
export * from './protocols';
export * from './topics';
export * from './helpers';
export * from './aiAdapter';
export * from './taxonomyLoader';
export * from './debateEngine';
export * from './formatters';

// ── BDI Migration Normalizers (Phase 1 shims) ────────────

/** Normalize legacy bdi_layer values to new BDI terminology. */
export function normalizeBdiLayer(
  layer: 'belief' | 'value' | 'conceptual' | 'desire' | 'intention',
): 'belief' | 'desire' | 'intention' {
  if (layer === 'value') return 'desire';
  if (layer === 'conceptual') return 'intention';
  return layer as 'belief' | 'desire' | 'intention';
}

/** Normalize legacy category names to new BDI terminology. */
export function normalizeCategory(
  category: string,
): 'Beliefs' | 'Desires' | 'Intentions' {
  switch (category) {
    case 'Data/Facts':
    case 'Beliefs':
      return 'Beliefs';
    case 'Goals/Values':
    case 'Desires':
      return 'Desires';
    case 'Methods/Arguments':
    case 'Intentions':
    default:
      return 'Intentions';
  }
}
