// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import { formatTaxonomyContext, computeInjectionManifest } from './taxonomyContext.js';
import type { TaxonomyContext } from './taxonomyContext.js';
import type { PovNode } from './taxonomyTypes.js';

function makeNode(id: string, category: 'Beliefs' | 'Desires' | 'Intentions', overrides: Partial<PovNode> = {}): PovNode {
  return {
    id,
    category,
    label: `${category} ${id}`,
    description: `A ${category} within accelerationist discourse that ${id}.`,
    parent_id: null,
    children: [],
    situation_refs: [],
    ...overrides,
  };
}

// ── Weighted sorting ────────────────────────────────────

describe('formatTaxonomyContext — weighted sorting', () => {
  it('sorts Beliefs by relevance × confidence', () => {
    const nodes: PovNode[] = [
      makeNode('acc-beliefs-001', 'Beliefs', { confidence: 0.40 }), // relevance 0.90 × 0.40 = 0.36
      makeNode('acc-beliefs-002', 'Beliefs', { confidence: 0.90 }), // relevance 0.50 × 0.90 = 0.45
      makeNode('acc-beliefs-003', 'Beliefs', { confidence: 0.70 }), // relevance 0.80 × 0.70 = 0.56
    ];
    const scores = new Map([
      ['acc-beliefs-001', 0.90],
      ['acc-beliefs-002', 0.50],
      ['acc-beliefs-003', 0.80],
    ]);
    const ctx: TaxonomyContext = { povNodes: nodes, situationNodes: [], nodeScores: scores };
    const result = formatTaxonomyContext(ctx, 'accelerationist');

    const lines = result.split('\n');
    const beliefLines = lines.filter(l => l.includes('[acc-beliefs-'));
    // Order by weighted score: 003 (0.56) > 002 (0.45) > 001 (0.36)
    expect(beliefLines[0]).toContain('acc-beliefs-003');
    expect(beliefLines[1]).toContain('acc-beliefs-002');
    expect(beliefLines[2]).toContain('acc-beliefs-001');
  });

  it('sorts Desires by relevance × priority/5', () => {
    const nodes: PovNode[] = [
      makeNode('acc-desires-001', 'Desires', { priority: 2 }), // relevance 0.90 × 0.40 = 0.36
      makeNode('acc-desires-002', 'Desires', { priority: 5 }), // relevance 0.50 × 1.00 = 0.50
      makeNode('acc-desires-003', 'Desires', { priority: 3 }), // relevance 0.80 × 0.60 = 0.48
    ];
    const scores = new Map([
      ['acc-desires-001', 0.90],
      ['acc-desires-002', 0.50],
      ['acc-desires-003', 0.80],
    ]);
    const ctx: TaxonomyContext = { povNodes: nodes, situationNodes: [], nodeScores: scores };
    const result = formatTaxonomyContext(ctx, 'accelerationist');

    const lines = result.split('\n');
    const desireLines = lines.filter(l => l.includes('[acc-desires-'));
    // Order: 002 (0.50) > 003 (0.48) > 001 (0.36)
    expect(desireLines[0]).toContain('acc-desires-002');
    expect(desireLines[1]).toContain('acc-desires-003');
    expect(desireLines[2]).toContain('acc-desires-001');
  });

  it('falls back to plain relevance when confidence/priority absent', () => {
    const nodes: PovNode[] = [
      makeNode('acc-beliefs-001', 'Beliefs'),
      makeNode('acc-beliefs-002', 'Beliefs'),
    ];
    const scores = new Map([
      ['acc-beliefs-001', 0.30],
      ['acc-beliefs-002', 0.80],
    ]);
    const ctx: TaxonomyContext = { povNodes: nodes, situationNodes: [], nodeScores: scores };
    const result = formatTaxonomyContext(ctx, 'accelerationist');

    const lines = result.split('\n');
    const beliefLines = lines.filter(l => l.includes('[acc-beliefs-'));
    expect(beliefLines[0]).toContain('acc-beliefs-002');
    expect(beliefLines[1]).toContain('acc-beliefs-001');
  });
});

// ── Weight labels ───────────────────────────────────────

describe('formatTaxonomyContext — weight labels', () => {
  it('shows confidence label for Beliefs', () => {
    const nodes: PovNode[] = [
      makeNode('acc-beliefs-001', 'Beliefs', { confidence: 0.85 }),
    ];
    const ctx: TaxonomyContext = { povNodes: nodes, situationNodes: [] };
    const result = formatTaxonomyContext(ctx, 'accelerationist');

    expect(result).toContain('(confidence: 0.85)');
  });

  it('marks low-confidence Beliefs as Speculative', () => {
    const nodes: PovNode[] = [
      makeNode('acc-beliefs-001', 'Beliefs', { confidence: 0.40 }),
    ];
    const ctx: TaxonomyContext = { povNodes: nodes, situationNodes: [] };
    const result = formatTaxonomyContext(ctx, 'accelerationist');

    expect(result).toContain('[Speculative, confidence: 0.40]');
  });

  it('shows doctrinally anchored annotation', () => {
    const nodes: PovNode[] = [
      makeNode('acc-beliefs-001', 'Beliefs', { confidence: 0.60, doctrinally_anchored: true }),
    ];
    const ctx: TaxonomyContext = { povNodes: nodes, situationNodes: [] };
    const result = formatTaxonomyContext(ctx, 'accelerationist');

    expect(result).toContain('doctrinally anchored');
    expect(result).toContain('confidence: 0.60');
  });

  it('shows priority label for Desires', () => {
    const nodes: PovNode[] = [
      makeNode('acc-desires-001', 'Desires', { priority: 4 }),
    ];
    const ctx: TaxonomyContext = { povNodes: nodes, situationNodes: [] };
    const result = formatTaxonomyContext(ctx, 'accelerationist');

    expect(result).toContain('(priority: 4/5)');
  });

  it('shows no weight label for Intentions', () => {
    const nodes: PovNode[] = [
      makeNode('acc-intentions-001', 'Intentions'),
    ];
    const ctx: TaxonomyContext = { povNodes: nodes, situationNodes: [] };
    const result = formatTaxonomyContext(ctx, 'accelerationist');

    expect(result).not.toContain('confidence:');
    expect(result).not.toContain('priority:');
  });

  it('shows no weight label when confidence/priority absent', () => {
    const nodes: PovNode[] = [
      makeNode('acc-beliefs-001', 'Beliefs'),
    ];
    const ctx: TaxonomyContext = { povNodes: nodes, situationNodes: [] };
    const result = formatTaxonomyContext(ctx, 'accelerationist');

    expect(result).not.toContain('confidence:');
    expect(result).not.toContain('Speculative');
  });
});

// ── Weighting instructions ──────────────────────────────

describe('formatTaxonomyContext — weighting instructions', () => {
  it('adds Beliefs weighting instruction when confidence present', () => {
    const nodes: PovNode[] = [
      makeNode('acc-beliefs-001', 'Beliefs', { confidence: 0.80 }),
    ];
    const ctx: TaxonomyContext = { povNodes: nodes, situationNodes: [] };
    const result = formatTaxonomyContext(ctx, 'accelerationist');

    expect(result).toContain('Ordered by evidential confidence');
  });

  it('adds Desires weighting instruction when priority present', () => {
    const nodes: PovNode[] = [
      makeNode('acc-desires-001', 'Desires', { priority: 3 }),
    ];
    const ctx: TaxonomyContext = { povNodes: nodes, situationNodes: [] };
    const result = formatTaxonomyContext(ctx, 'accelerationist');

    expect(result).toContain('Ordered by priority');
  });

  it('does not add weighting instruction when no weights', () => {
    const nodes: PovNode[] = [
      makeNode('acc-beliefs-001', 'Beliefs'),
      makeNode('acc-desires-001', 'Desires'),
    ];
    const ctx: TaxonomyContext = { povNodes: nodes, situationNodes: [] };
    const result = formatTaxonomyContext(ctx, 'accelerationist');

    expect(result).not.toContain('Ordered by');
  });
});

// ── computeInjectionManifest weighted sorting ───────────

describe('computeInjectionManifest — weighted primaries', () => {
  it('selects primaries by weighted score', () => {
    const nodes: PovNode[] = [
      makeNode('acc-beliefs-001', 'Beliefs', { confidence: 0.40 }),
      makeNode('acc-beliefs-002', 'Beliefs', { confidence: 0.95 }),
      makeNode('acc-beliefs-003', 'Beliefs', { confidence: 0.70 }),
    ];
    const scores = new Map([
      ['acc-beliefs-001', 0.90], // weighted: 0.36
      ['acc-beliefs-002', 0.50], // weighted: 0.475
      ['acc-beliefs-003', 0.80], // weighted: 0.56
    ]);
    const ctx: TaxonomyContext = { povNodes: nodes, situationNodes: [], nodeScores: scores };
    const manifest = computeInjectionManifest(ctx, 'accelerationist', undefined, { primaryCount: 2 });

    // Top 2 by weighted: 003, 002
    expect(manifest.povPrimaryIds).toContain('acc-beliefs-003');
    expect(manifest.povPrimaryIds).toContain('acc-beliefs-002');
    expect(manifest.povPrimaryIds).not.toContain('acc-beliefs-001');
  });
});
