// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Shared debate library — barrel export.
 * Consumed by taxonomy-editor (Electron app) and the future CLI debate runner.
 */

export * from './errors.js';
export * from './types.js';
export * from './taxonomyTypes.js';
export * from './prompts.js';
export * from './argumentNetwork.js';
export * from './taxonomyContext.js';
export * from './taxonomyRelevance.js';
export * from './harvestUtils.js';
export * from './protocols.js';
export * from './topics.js';
export * from './helpers.js';
export * from './aiAdapter.js';
export * from './taxonomyLoader.js';
export * from './debateEngine.js';
export * from './formatters.js';
export * from './validators.js';
export * from './nodeIdUtils.js';
export * from './qbaf.js';
export * from './qbafCombinator.js';
export * from './concessionTracker.js';
export * from './networkGc.js';
export * from './coverageTracker.js';
export * from './debateExport.js';
export * from './turnPipeline.js';
export * from './convergenceSignals.js';
export * from './cruxResolution.js';
export * from './tieredCompression.js';
export * from './moderator.js';
export * from './gapCheck.js';
export * from './orchestration.js';
export * from './sessionPruning.js';
export * from './documentAnalysis.js';
export * from './turnValidator.js';
export * from './taxonomyGapAnalysis.js';
export * from './vocabularyContext.js';
export * from './neutralEvaluator.js';
export * from './signalConfidence.js';
export * from './pragmaticSignals.js';
export * from './schemeStagnation.js';
export * from './dialecticTrace.js';
export * from './envelopes.js';
export * from './cacheTypes.js';
export * from './situationRefs.js';
// schemas.ts deliberately excluded from barrel — it imports zod.
// cli.ts deliberately excluded from barrel — it is the CLI entry point.
// phaseTransitions.ts excluded — imports fs/path (Node.js only).
// repairTranscript.ts excluded — CLI script importing fs.
// judgeAudit.ts excluded — CLI script importing fs/path.
// comments.ts excluded — imports zod + fs/path (Node.js only). Import directly.

// ── Situations Migration Normalizers ──────────────────────

/** Normalize legacy node properties: cross_cutting_refs → situation_refs. */
export function normalizeNodeProperties<T extends Record<string, unknown>>(node: T): T {
  if ('cross_cutting_refs' in node && !('situation_refs' in node)) {
    (node as Record<string, unknown>).situation_refs = node.cross_cutting_refs;
  }
  return node;
}

/** Normalize legacy POV string: 'cross-cutting' → 'situations'. */
export function normalizePov(pov: string): string {
  return pov === 'cross-cutting' ? 'situations' : pov;
}

/** Normalize legacy node IDs: old slugs → new BDI/Situations slugs. */
export function normalizeNodeId(id: string): string {
  if (id.startsWith('cc-')) return 'sit-' + id.slice(3);
  return id
    .replace(/^(acc|saf|skp)-goals-/, '$1-desires-')
    .replace(/^(acc|saf|skp)-data-/, '$1-beliefs-')
    .replace(/^(acc|saf|skp)-methods-/, '$1-intentions-');
}

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
