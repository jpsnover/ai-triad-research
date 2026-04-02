// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import { formatTaxonomyContext, formatNodeAttributes, CATEGORY_TO_BDI } from './taxonomyContext';
import type { TaxonomyContext } from './taxonomyContext';
import type { PovNode, SituationNode } from '../types/taxonomy';

// ── Test fixtures ─────────────────────────────────────────

const beliefsNode: PovNode = {
  id: 'acc-data-001',
  category: 'Beliefs',
  label: 'More Power Equals More Smarts',
  description: 'Scaling compute leads to emergent capabilities.',
  parent_id: null,
  children: [],
  situation_refs: [],
  graph_attributes: {
    epistemic_type: 'empirical_claim',
    assumes: ['scaling laws continue to hold'],
  },
};

const desiresNode: PovNode = {
  id: 'acc-goals-001',
  category: 'Desires',
  label: 'AI Creates a World of Plenty',
  description: 'AI-driven abundance improves quality of life for all.',
  parent_id: null,
  children: [],
  situation_refs: [],
  graph_attributes: {
    steelman_vulnerability: 'Assumes benefits are evenly distributed',
  },
};

const intentionsNode: PovNode = {
  id: 'acc-methods-001',
  category: 'Intentions',
  label: 'Winning the Race for Safe AI',
  description: 'Building AI fast is the best way to ensure safety.',
  parent_id: null,
  children: [],
  situation_refs: [],
  graph_attributes: {
    possible_fallacies: [
      { fallacy: 'false_dilemma', confidence: 'likely', explanation: 'Presents speed vs. safety as binary' },
      { fallacy: 'appeal_to_fear', confidence: 'borderline', explanation: 'Minor' },
    ],
  },
};

const situationNode: SituationNode = {
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
    povNodes: [beliefsNode, desiresNode, intentionsNode],
    situationNodes: [situationNode],
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────

describe('CATEGORY_TO_BDI mapping', () => {
  it('maps all three BDI categories', () => {
    expect(Object.keys(CATEGORY_TO_BDI)).toEqual(['Beliefs', 'Desires', 'Intentions']);
  });

  it('uses BDI terminology in headers', () => {
    expect(CATEGORY_TO_BDI['Beliefs'].header).toContain('EMPIRICAL GROUNDING');
    expect(CATEGORY_TO_BDI['Desires'].header).toContain('NORMATIVE COMMITMENTS');
    expect(CATEGORY_TO_BDI['Intentions'].header).toContain('REASONING APPROACH');
  });
});

describe('formatNodeAttributes', () => {
  it('returns empty array for undefined attrs', () => {
    expect(formatNodeAttributes(undefined)).toEqual([]);
  });

  it('includes assumes and epistemic_type', () => {
    const lines = formatNodeAttributes(beliefsNode.graph_attributes);
    expect(lines.some(l => l.includes('Assumes:'))).toBe(true);
    expect(lines.some(l => l.includes('empirical_claim'))).toBe(true);
  });

  it('filters borderline fallacies', () => {
    const lines = formatNodeAttributes(intentionsNode.graph_attributes);
    expect(lines.some(l => l.includes('false dilemma'))).toBe(true);
    expect(lines.some(l => l.includes('appeal to fear'))).toBe(false);
  });
});

describe('formatTaxonomyContext', () => {
  it('contains all BDI section headers', () => {
    const output = formatTaxonomyContext(buildCtx(), 'accelerationist');
    expect(output).toContain('=== YOUR EMPIRICAL GROUNDING (what you take as true) ===');
    expect(output).toContain('=== YOUR NORMATIVE COMMITMENTS (what you argue should happen) ===');
    expect(output).toContain('=== YOUR REASONING APPROACH (how you construct arguments) ===');
  });

  it('places Beliefs nodes under BELIEFS', () => {
    const output = formatTaxonomyContext(buildCtx(), 'accelerationist');
    const beliefsIdx = output.indexOf('YOUR EMPIRICAL GROUNDING');
    const desiresIdx = output.indexOf('YOUR NORMATIVE COMMITMENTS');
    const nodeIdx = output.indexOf('[acc-data-001]');
    expect(nodeIdx).toBeGreaterThan(beliefsIdx);
    expect(nodeIdx).toBeLessThan(desiresIdx);
  });

  it('places Desires nodes under DESIRES', () => {
    const output = formatTaxonomyContext(buildCtx(), 'accelerationist');
    const desiresIdx = output.indexOf('YOUR NORMATIVE COMMITMENTS');
    const intentionsIdx = output.indexOf('YOUR REASONING APPROACH');
    const nodeIdx = output.indexOf('[acc-goals-001]');
    expect(nodeIdx).toBeGreaterThan(desiresIdx);
    expect(nodeIdx).toBeLessThan(intentionsIdx);
  });

  it('places Intentions nodes under INTENTIONS', () => {
    const output = formatTaxonomyContext(buildCtx(), 'accelerationist');
    const intentionsIdx = output.indexOf('YOUR REASONING APPROACH');
    const nodeIdx = output.indexOf('[acc-methods-001]');
    expect(nodeIdx).toBeGreaterThan(intentionsIdx);
  });

  it('contains POSITIONAL VULNERABILITIES section', () => {
    const output = formatTaxonomyContext(buildCtx(), 'accelerationist');
    expect(output).toContain('=== POSITIONAL VULNERABILITIES');
    expect(output).toContain('Assumes benefits are evenly distributed');
  });

  it('contains REASONING WATCHLIST with likely fallacies only', () => {
    const output = formatTaxonomyContext(buildCtx(), 'accelerationist');
    expect(output).toContain('=== REASONING WATCHLIST');
    expect(output).toContain('false dilemma');
    expect(output).not.toContain('appeal to fear');
  });

  it('contains SITUATIONS section', () => {
    const output = formatTaxonomyContext(buildCtx(), 'accelerationist');
    expect(output).toContain('=== SITUATIONS');
    expect(output).toContain('[cc-001]');
  });

  it('shows the current POV interpretation prominently', () => {
    const output = formatTaxonomyContext(buildCtx(), 'accelerationist');
    expect(output).toContain('Your interpretation: Soon, and we must prepare to benefit.');
  });

  it('shows other POV interpretations in full for primary situation nodes', () => {
    const output = formatTaxonomyContext(buildCtx(), 'accelerationist');
    expect(output).toContain('Safetyist: Possibly soon, which makes alignment urgent.');
    expect(output).toContain('Skeptic: Timelines are speculative and distract from present harms.');
  });

  it('changes interpretation based on POV', () => {
    const accOutput = formatTaxonomyContext(buildCtx(), 'accelerationist');
    const safOutput = formatTaxonomyContext(buildCtx(), 'safetyist');
    expect(accOutput).toContain('Your interpretation: Soon, and we must prepare to benefit.');
    expect(safOutput).toContain('Your interpretation: Possibly soon, which makes alignment urgent.');
  });

  it('omits empty BDI sections', () => {
    const ctx = buildCtx({ povNodes: [beliefsNode] });
    const output = formatTaxonomyContext(ctx, 'accelerationist');
    expect(output).toContain('YOUR EMPIRICAL GROUNDING');
    expect(output).not.toContain('YOUR NORMATIVE COMMITMENTS');
    expect(output).not.toContain('YOUR REASONING APPROACH');
  });

  it('omits vulnerabilities section when no vulnerabilities exist', () => {
    const cleanNode: PovNode = { ...beliefsNode, graph_attributes: { epistemic_type: 'empirical_claim' } };
    const ctx = buildCtx({ povNodes: [cleanNode] });
    const output = formatTaxonomyContext(ctx, 'accelerationist');
    expect(output).not.toContain('POSITIONAL VULNERABILITIES');
  });

  it('omits situations section when no situation nodes', () => {
    const ctx = buildCtx({ situationNodes: [] });
    const output = formatTaxonomyContext(ctx, 'accelerationist');
    expect(output).not.toContain('SITUATIONS');
  });

  it('respects maxNodes limit', () => {
    const output = formatTaxonomyContext(buildCtx(), 'accelerationist', 1);
    // Only the first node (beliefsNode) should appear
    expect(output).toContain('[acc-data-001]');
    expect(output).not.toContain('[acc-goals-001]');
    expect(output).not.toContain('[acc-methods-001]');
  });

  it('section order is Empirical Grounding → Normative Commitments → Reasoning → Vulnerabilities → Situations', () => {
    const output = formatTaxonomyContext(buildCtx(), 'accelerationist');
    const beliefsIdx = output.indexOf('YOUR EMPIRICAL GROUNDING');
    const desiresIdx = output.indexOf('YOUR NORMATIVE COMMITMENTS');
    const intentionsIdx = output.indexOf('YOUR REASONING APPROACH');
    const vulnIdx = output.indexOf('POSITIONAL VULNERABILITIES');
    const ccIdx = output.indexOf('SITUATIONS');

    expect(beliefsIdx).toBeLessThan(desiresIdx);
    expect(desiresIdx).toBeLessThan(intentionsIdx);
    expect(intentionsIdx).toBeLessThan(vulnIdx);
    expect(vulnIdx).toBeLessThan(ccIdx);
  });
});
