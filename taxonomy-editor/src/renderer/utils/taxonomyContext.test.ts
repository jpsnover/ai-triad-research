// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import { formatTaxonomyContext, formatNodeAttributes, CATEGORY_TO_BDI } from './taxonomyContext';
import type { TaxonomyContext } from './taxonomyContext';
import type { PovNode, CrossCuttingNode } from '../types/taxonomy';

// ── Test fixtures ─────────────────────────────────────────

const dataNode: PovNode = {
  id: 'acc-data-001',
  category: 'Data/Facts',
  label: 'More Power Equals More Smarts',
  description: 'Scaling compute leads to emergent capabilities.',
  parent_id: null,
  children: [],
  cross_cutting_refs: [],
  graph_attributes: {
    epistemic_type: 'empirical_claim',
    assumes: ['scaling laws continue to hold'],
  },
};

const goalsNode: PovNode = {
  id: 'acc-goals-001',
  category: 'Goals/Values',
  label: 'AI Creates a World of Plenty',
  description: 'AI-driven abundance improves quality of life for all.',
  parent_id: null,
  children: [],
  cross_cutting_refs: [],
  graph_attributes: {
    steelman_vulnerability: 'Assumes benefits are evenly distributed',
  },
};

const methodsNode: PovNode = {
  id: 'acc-methods-001',
  category: 'Methods/Arguments',
  label: 'Winning the Race for Safe AI',
  description: 'Building AI fast is the best way to ensure safety.',
  parent_id: null,
  children: [],
  cross_cutting_refs: [],
  graph_attributes: {
    possible_fallacies: [
      { fallacy: 'false_dilemma', confidence: 'likely', explanation: 'Presents speed vs. safety as binary' },
      { fallacy: 'appeal_to_fear', confidence: 'borderline', explanation: 'Minor' },
    ],
  },
};

const ccNode: CrossCuttingNode = {
  id: 'cc-001',
  label: 'When Will Super-Smart AI Arrive?',
  description: 'The timeline debate around AGI arrival.',
  interpretations: {
    accelerationist: 'Soon, and we must prepare to benefit.',
    safetyist: 'Possibly soon, which makes alignment urgent.',
    skeptic: 'Timelines are speculative and distract from present harms.',
  },
  linked_nodes: [],
  conflict_ids: [],
  graph_attributes: {},
};

function buildCtx(overrides?: Partial<TaxonomyContext>): TaxonomyContext {
  return {
    povNodes: [dataNode, goalsNode, methodsNode],
    crossCuttingNodes: [ccNode],
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────

describe('CATEGORY_TO_BDI mapping', () => {
  it('maps all three categories', () => {
    expect(Object.keys(CATEGORY_TO_BDI)).toEqual(['Data/Facts', 'Goals/Values', 'Methods/Arguments']);
  });

  it('uses BDI terminology in headers', () => {
    expect(CATEGORY_TO_BDI['Data/Facts'].header).toContain('BELIEFS');
    expect(CATEGORY_TO_BDI['Goals/Values'].header).toContain('VALUES');
    expect(CATEGORY_TO_BDI['Methods/Arguments'].header).toContain('REASONING APPROACH');
  });
});

describe('formatNodeAttributes', () => {
  it('returns empty array for undefined attrs', () => {
    expect(formatNodeAttributes(undefined)).toEqual([]);
  });

  it('includes assumes and epistemic_type', () => {
    const lines = formatNodeAttributes(dataNode.graph_attributes);
    expect(lines.some(l => l.includes('Assumes:'))).toBe(true);
    expect(lines.some(l => l.includes('empirical_claim'))).toBe(true);
  });

  it('filters borderline fallacies', () => {
    const lines = formatNodeAttributes(methodsNode.graph_attributes);
    expect(lines.some(l => l.includes('false dilemma'))).toBe(true);
    expect(lines.some(l => l.includes('appeal to fear'))).toBe(false);
  });
});

describe('formatTaxonomyContext', () => {
  it('contains all BDI section headers', () => {
    const output = formatTaxonomyContext(buildCtx(), 'accelerationist');
    expect(output).toContain('=== YOUR BELIEFS (what you take as empirically true) ===');
    expect(output).toContain('=== YOUR VALUES (what you prioritize and why) ===');
    expect(output).toContain('=== YOUR REASONING APPROACH (how you argue) ===');
  });

  it('places Data/Facts nodes under BELIEFS', () => {
    const output = formatTaxonomyContext(buildCtx(), 'accelerationist');
    const beliefsIdx = output.indexOf('YOUR BELIEFS');
    const valuesIdx = output.indexOf('YOUR VALUES');
    const nodeIdx = output.indexOf('[acc-data-001]');
    expect(nodeIdx).toBeGreaterThan(beliefsIdx);
    expect(nodeIdx).toBeLessThan(valuesIdx);
  });

  it('places Goals/Values nodes under VALUES', () => {
    const output = formatTaxonomyContext(buildCtx(), 'accelerationist');
    const valuesIdx = output.indexOf('YOUR VALUES');
    const reasoningIdx = output.indexOf('YOUR REASONING APPROACH');
    const nodeIdx = output.indexOf('[acc-goals-001]');
    expect(nodeIdx).toBeGreaterThan(valuesIdx);
    expect(nodeIdx).toBeLessThan(reasoningIdx);
  });

  it('places Methods/Arguments nodes under REASONING APPROACH', () => {
    const output = formatTaxonomyContext(buildCtx(), 'accelerationist');
    const reasoningIdx = output.indexOf('YOUR REASONING APPROACH');
    const nodeIdx = output.indexOf('[acc-methods-001]');
    expect(nodeIdx).toBeGreaterThan(reasoningIdx);
  });

  it('contains KNOWN VULNERABILITIES section', () => {
    const output = formatTaxonomyContext(buildCtx(), 'accelerationist');
    expect(output).toContain('=== YOUR KNOWN VULNERABILITIES ===');
    expect(output).toContain('Assumes benefits are evenly distributed');
    expect(output).toContain('false dilemma');
  });

  it('does not include borderline fallacies in vulnerabilities', () => {
    const output = formatTaxonomyContext(buildCtx(), 'accelerationist');
    expect(output).not.toContain('appeal to fear');
  });

  it('contains CROSS-CUTTING CONCERNS section', () => {
    const output = formatTaxonomyContext(buildCtx(), 'accelerationist');
    expect(output).toContain('=== CROSS-CUTTING CONCERNS ===');
    expect(output).toContain('[cc-001]');
  });

  it('shows the current POV interpretation prominently', () => {
    const output = formatTaxonomyContext(buildCtx(), 'accelerationist');
    expect(output).toContain('Your interpretation: Soon, and we must prepare to benefit.');
  });

  it('shows other POV interpretations as brief summaries', () => {
    const output = formatTaxonomyContext(buildCtx(), 'accelerationist');
    expect(output).toContain('Other views:');
    expect(output).toContain('Saf:');  // Safetyist abbreviated
    expect(output).toContain('Ske:');  // Skeptic abbreviated
  });

  it('changes interpretation based on POV', () => {
    const accOutput = formatTaxonomyContext(buildCtx(), 'accelerationist');
    const safOutput = formatTaxonomyContext(buildCtx(), 'safetyist');
    expect(accOutput).toContain('Your interpretation: Soon, and we must prepare to benefit.');
    expect(safOutput).toContain('Your interpretation: Possibly soon, which makes alignment urgent.');
  });

  it('omits empty BDI sections', () => {
    const ctx = buildCtx({ povNodes: [dataNode] });
    const output = formatTaxonomyContext(ctx, 'accelerationist');
    expect(output).toContain('YOUR BELIEFS');
    expect(output).not.toContain('YOUR VALUES');
    expect(output).not.toContain('YOUR REASONING APPROACH');
  });

  it('omits vulnerabilities section when no vulnerabilities exist', () => {
    const cleanNode: PovNode = { ...dataNode, graph_attributes: { epistemic_type: 'empirical_claim' } };
    const ctx = buildCtx({ povNodes: [cleanNode] });
    const output = formatTaxonomyContext(ctx, 'accelerationist');
    expect(output).not.toContain('KNOWN VULNERABILITIES');
  });

  it('omits cross-cutting section when no CC nodes', () => {
    const ctx = buildCtx({ crossCuttingNodes: [] });
    const output = formatTaxonomyContext(ctx, 'accelerationist');
    expect(output).not.toContain('CROSS-CUTTING CONCERNS');
  });

  it('respects maxNodes limit', () => {
    const output = formatTaxonomyContext(buildCtx(), 'accelerationist', 1);
    // Only the first node (dataNode) should appear
    expect(output).toContain('[acc-data-001]');
    expect(output).not.toContain('[acc-goals-001]');
    expect(output).not.toContain('[acc-methods-001]');
  });

  it('section order is Beliefs → Values → Reasoning → Vulnerabilities → Cross-Cutting', () => {
    const output = formatTaxonomyContext(buildCtx(), 'accelerationist');
    const beliefsIdx = output.indexOf('YOUR BELIEFS');
    const valuesIdx = output.indexOf('YOUR VALUES');
    const reasoningIdx = output.indexOf('YOUR REASONING APPROACH');
    const vulnIdx = output.indexOf('YOUR KNOWN VULNERABILITIES');
    const ccIdx = output.indexOf('CROSS-CUTTING CONCERNS');

    expect(beliefsIdx).toBeLessThan(valuesIdx);
    expect(valuesIdx).toBeLessThan(reasoningIdx);
    expect(reasoningIdx).toBeLessThan(vulnIdx);
    expect(vulnIdx).toBeLessThan(ccIdx);
  });
});
