// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import {
  buildTaxonomySample,
  documentAnalysisPrompt,
  documentAnalysisContext,
} from './documentAnalysis.js';
import type { DocumentAnalysis } from './types.js';
import type { PovNode, SituationNode } from './taxonomyTypes.js';

// ── Factories ──────────────────────────────────────────────

function makePovNode(id: string, label: string): PovNode {
  return {
    id,
    category: 'Beliefs',
    label,
    description: `Description for ${id}`,
    parent_id: null,
    children: [],
    situation_refs: [],
  };
}

function makeSituationNode(id: string, label: string): SituationNode {
  return {
    id,
    label,
    description: `Desc for ${id}`,
    parent_id: null,
    interpretations: {
      accelerationist: 'a-interp',
      safetyist: 's-interp',
      skeptic: 'k-interp',
    },
    linked_nodes: [],
    conflict_ids: [],
  };
}

function makeTaxonomy(overrides?: {
  accelerationist?: PovNode[];
  safetyist?: PovNode[];
  skeptic?: PovNode[];
  situations?: SituationNode[];
  policies?: { id: string; action: string }[];
}) {
  return {
    accelerationist: { nodes: overrides?.accelerationist ?? [] },
    safetyist: { nodes: overrides?.safetyist ?? [] },
    skeptic: { nodes: overrides?.skeptic ?? [] },
    situations: { nodes: overrides?.situations ?? [] },
    policyRegistry: (overrides?.policies ?? []).map(p => ({ id: p.id, action: p.action })),
  };
}

function makeAnalysis(overrides?: Partial<DocumentAnalysis>): DocumentAnalysis {
  return {
    claims_summary: 'A concise summary of the document.',
    i_nodes: [],
    tension_points: [],
    ...overrides,
  };
}

// ── buildTaxonomySample ────────────────────────────────────

describe('buildTaxonomySample', () => {
  it('includes all three POV sections with header and id: label lines', () => {
    const taxonomy = makeTaxonomy({
      accelerationist: [makePovNode('acc-beliefs-001', 'Acc Node A')],
      safetyist: [makePovNode('saf-beliefs-001', 'Saf Node A')],
      skeptic: [makePovNode('skp-beliefs-001', 'Skp Node A')],
    });

    const result = buildTaxonomySample(taxonomy);

    expect(result).toContain('ACCELERATIONIST NODES:');
    expect(result).toContain('  acc-beliefs-001: Acc Node A');
    expect(result).toContain('SAFETYIST NODES:');
    expect(result).toContain('  saf-beliefs-001: Saf Node A');
    expect(result).toContain('SKEPTIC NODES:');
    expect(result).toContain('  skp-beliefs-001: Skp Node A');
  });

  it('includes situations section when present', () => {
    const taxonomy = makeTaxonomy({
      situations: [makeSituationNode('sit-001', 'A Situation')],
    });

    const result = buildTaxonomySample(taxonomy);

    expect(result).toContain('SITUATION NODES:');
    expect(result).toContain('  sit-001: A Situation');
  });

  it('includes policy section when present', () => {
    const taxonomy = makeTaxonomy({
      policies: [{ id: 'pol-001', action: 'Regulate frontier AI' }],
    });

    const result = buildTaxonomySample(taxonomy);

    expect(result).toContain('POLICY ITEMS:');
    expect(result).toContain('  pol-001: Regulate frontier AI');
  });

  it('skips empty POV sections entirely', () => {
    const taxonomy = makeTaxonomy({
      accelerationist: [makePovNode('acc-beliefs-001', 'Acc Node A')],
      safetyist: [],
      skeptic: [],
    });

    const result = buildTaxonomySample(taxonomy);

    expect(result).toContain('ACCELERATIONIST NODES:');
    expect(result).not.toContain('SAFETYIST NODES:');
    expect(result).not.toContain('SKEPTIC NODES:');
  });

  it('skips situations section when empty', () => {
    const taxonomy = makeTaxonomy({
      accelerationist: [makePovNode('acc-beliefs-001', 'Acc Node A')],
    });

    const result = buildTaxonomySample(taxonomy);

    expect(result).not.toContain('SITUATION NODES:');
  });

  it('skips policies section when empty', () => {
    const taxonomy = makeTaxonomy({
      accelerationist: [makePovNode('acc-beliefs-001', 'Acc Node A')],
    });

    const result = buildTaxonomySample(taxonomy);

    expect(result).not.toContain('POLICY ITEMS:');
  });

  it('includes all nodes when no nodeScores provided', () => {
    const nodes = Array.from({ length: 50 }, (_, i) =>
      makePovNode(`acc-beliefs-${String(i + 1).padStart(3, '0')}`, `Node ${i + 1}`),
    );
    const taxonomy = makeTaxonomy({ accelerationist: nodes });

    const result = buildTaxonomySample(taxonomy);

    // All 50 nodes should appear
    expect(result).toContain('acc-beliefs-001');
    expect(result).toContain('acc-beliefs-050');
  });

  it('ranks nodes by score descending and caps at 40 per POV when nodeScores provided', () => {
    const nodes = Array.from({ length: 50 }, (_, i) =>
      makePovNode(`acc-beliefs-${String(i + 1).padStart(3, '0')}`, `Node ${i + 1}`),
    );
    // Score nodes in reverse: node 50 gets highest score (0.50), node 1 gets lowest (0.01)
    const nodeScores = new Map(nodes.map((n, i) => [n.id, (i + 1) / 100]));
    const taxonomy = makeTaxonomy({ accelerationist: nodes });

    const result = buildTaxonomySample(taxonomy, nodeScores);

    // Node 50 (score=0.50) should appear — it's in the top 40
    expect(result).toContain('acc-beliefs-050');
    // Node 1 (score=0.01, rank 50) should be dropped — outside top 40
    expect(result).not.toContain('acc-beliefs-001');
    // Node 11 (score=0.11, rank 40) should appear — exactly at the cap
    expect(result).toContain('acc-beliefs-011');
    // Node 10 (score=0.10, rank 41) should be dropped
    expect(result).not.toContain('acc-beliefs-010');
  });

  it('caps situations at 15 when nodeScores provided', () => {
    const sitNodes = Array.from({ length: 20 }, (_, i) =>
      makeSituationNode(`sit-${String(i + 1).padStart(3, '0')}`, `Sit ${i + 1}`),
    );
    // Score in ascending order so sit-020 has highest score
    const nodeScores = new Map(sitNodes.map((n, i) => [n.id, (i + 1) / 100]));
    const taxonomy = makeTaxonomy({ situations: sitNodes });

    const result = buildTaxonomySample(taxonomy, nodeScores);

    // sit-020 (rank 1) should appear
    expect(result).toContain('sit-020');
    // sit-006 (rank 15) should appear — exactly at the cap
    expect(result).toContain('sit-006');
    // sit-005 (rank 16) should be dropped
    expect(result).not.toContain('sit-005');
    // sit-001 (rank 20) should be dropped
    expect(result).not.toContain('sit-001');
  });

  it('caps policies at 15 when policyRegistry has more than 15 entries', () => {
    const policies = Array.from({ length: 20 }, (_, i) => ({
      id: `pol-${String(i + 1).padStart(3, '0')}`,
      action: `Policy action ${i + 1}`,
    }));
    const taxonomy = makeTaxonomy({ policies });

    const result = buildTaxonomySample(taxonomy);

    // Policies are not scored — plain slice(0, 15)
    expect(result).toContain('pol-001');
    expect(result).toContain('pol-015');
    expect(result).not.toContain('pol-016');
  });

  it('produces empty string when all inputs are empty', () => {
    const taxonomy = makeTaxonomy();
    const result = buildTaxonomySample(taxonomy);
    expect(result.trim()).toBe('');
  });

  it('uses uppercase POV key in the header', () => {
    const taxonomy = makeTaxonomy({
      accelerationist: [makePovNode('acc-beliefs-001', 'A')],
    });
    const result = buildTaxonomySample(taxonomy);
    expect(result).toContain('ACCELERATIONIST NODES:');
    expect(result).not.toContain('accelerationist NODES:');
  });

  it('nodes with no score sort to 0 (bottom) when nodeScores provided but missing entries', () => {
    const high = makePovNode('acc-beliefs-001', 'High');
    const unscored = makePovNode('acc-beliefs-002', 'Unscored');
    const nodeScores = new Map([['acc-beliefs-001', 0.9]]); // acc-beliefs-002 absent
    const taxonomy = makeTaxonomy({ accelerationist: [high, unscored] });

    const result = buildTaxonomySample(taxonomy, nodeScores);

    // Both appear (only 2 nodes, well under the cap)
    expect(result).toContain('acc-beliefs-001: High');
    expect(result).toContain('acc-beliefs-002: Unscored');
    // High score node should appear before unscored in the output
    expect(result.indexOf('acc-beliefs-001')).toBeLessThan(result.indexOf('acc-beliefs-002'));
  });
});

// ── documentAnalysisPrompt ─────────────────────────────────

describe('documentAnalysisPrompt', () => {
  const SHORT_CONTENT = 'This document argues that AI safety is important.';
  const REFINED_TOPIC = 'Should AI development be regulated?';
  const ACTIVE_POVERS = ['accelerationist', 'safetyist', 'skeptic'];
  const TAXONOMY_SAMPLE = 'ACCELERATIONIST NODES:\n  acc-beliefs-001: Capability growth';

  it('returns an object with prompt and truncationMetrics', () => {
    const result = documentAnalysisPrompt(SHORT_CONTENT, REFINED_TOPIC, ACTIVE_POVERS, TAXONOMY_SAMPLE);
    expect(result).toHaveProperty('prompt');
    expect(result).toHaveProperty('truncationMetrics');
  });

  it('short content is not truncated (ratio=1, chars_truncated=0)', () => {
    const result = documentAnalysisPrompt(SHORT_CONTENT, REFINED_TOPIC, ACTIVE_POVERS, TAXONOMY_SAMPLE);
    const { truncationMetrics } = result;

    expect(truncationMetrics.stage).toBe('document_truncation');
    expect(truncationMetrics.ratio).toBe(1);
    expect(truncationMetrics.flags.chars_truncated).toBe(0);
    expect(truncationMetrics.in_count).toBe(SHORT_CONTENT.length);
    expect(truncationMetrics.out_count).toBe(SHORT_CONTENT.length);
  });

  it('short content appears verbatim in the prompt', () => {
    const result = documentAnalysisPrompt(SHORT_CONTENT, REFINED_TOPIC, ACTIVE_POVERS, TAXONOMY_SAMPLE);
    expect(result.prompt).toContain(SHORT_CONTENT);
  });

  it('prompt includes the refined topic', () => {
    const result = documentAnalysisPrompt(SHORT_CONTENT, REFINED_TOPIC, ACTIVE_POVERS, TAXONOMY_SAMPLE);
    expect(result.prompt).toContain(REFINED_TOPIC);
  });

  it('prompt includes all active POVs joined by comma', () => {
    const result = documentAnalysisPrompt(SHORT_CONTENT, REFINED_TOPIC, ACTIVE_POVERS, TAXONOMY_SAMPLE);
    expect(result.prompt).toContain('accelerationist, safetyist, skeptic');
  });

  it('prompt includes the taxonomy sample', () => {
    const result = documentAnalysisPrompt(SHORT_CONTENT, REFINED_TOPIC, ACTIVE_POVERS, TAXONOMY_SAMPLE);
    expect(result.prompt).toContain(TAXONOMY_SAMPLE);
  });

  it('prompt includes SOURCE DOCUMENT and END SOURCE DOCUMENT markers', () => {
    const result = documentAnalysisPrompt(SHORT_CONTENT, REFINED_TOPIC, ACTIVE_POVERS, TAXONOMY_SAMPLE);
    expect(result.prompt).toContain('=== SOURCE DOCUMENT ===');
    expect(result.prompt).toContain('=== END SOURCE DOCUMENT ===');
  });

  it('prompt includes TAXONOMY NODES markers', () => {
    const result = documentAnalysisPrompt(SHORT_CONTENT, REFINED_TOPIC, ACTIVE_POVERS, TAXONOMY_SAMPLE);
    expect(result.prompt).toContain('=== AVAILABLE TAXONOMY NODES ===');
    expect(result.prompt).toContain('=== END TAXONOMY NODES ===');
  });

  it('content exceeding DOC_TRUNCATION_LIMIT gets truncated and a notice appended', () => {
    // DOC_TRUNCATION_LIMIT is 50_000 chars
    const longContent = 'A'.repeat(51_000);
    const result = documentAnalysisPrompt(longContent, REFINED_TOPIC, ACTIVE_POVERS, TAXONOMY_SAMPLE);

    expect(result.prompt).toContain('[Document truncated at ~50K characters.');
    expect(result.truncationMetrics.flags.chars_truncated).toBe(1000);
    expect(result.truncationMetrics.ratio).toBeLessThan(1);
  });

  it('truncationMetrics.ratio is computed as limit/originalLength rounded to 4dp', () => {
    const originalLen = 60_000;
    const longContent = 'B'.repeat(originalLen);
    const result = documentAnalysisPrompt(longContent, REFINED_TOPIC, ACTIVE_POVERS, TAXONOMY_SAMPLE);

    const expected = Math.round((50_000 / originalLen) * 10000) / 10000;
    expect(result.truncationMetrics.ratio).toBe(expected);
  });

  it('truncationMetrics.in_units and out_units are "chars"', () => {
    const result = documentAnalysisPrompt(SHORT_CONTENT, REFINED_TOPIC, ACTIVE_POVERS, TAXONOMY_SAMPLE);
    expect(result.truncationMetrics.in_units).toBe('chars');
    expect(result.truncationMetrics.out_units).toBe('chars');
  });

  it('truncation notice includes last markdown heading when present', () => {
    // Build content with a heading just before the truncation boundary
    const prefix = '# Introduction\n\nSome intro text.\n\n## Key Findings\n\n';
    const body = 'C'.repeat(50_000 - prefix.length); // heading at boundary
    const tail = 'D'.repeat(5_000);
    const content = prefix + body + tail;

    const result = documentAnalysisPrompt(content, REFINED_TOPIC, ACTIVE_POVERS, TAXONOMY_SAMPLE);

    // The notice should mention the last heading seen before the cut
    expect(result.prompt).toContain("after 'Key Findings'");
  });

  it('truncation notice uses generic form when no heading precedes the cut', () => {
    const longContent = 'No heading here. '.repeat(3_500); // ~60K chars
    const result = documentAnalysisPrompt(longContent, REFINED_TOPIC, ACTIVE_POVERS, TAXONOMY_SAMPLE);

    expect(result.prompt).toContain('[Document truncated at ~50K characters.]');
    // Should NOT have "after '...'" since no heading exists
    expect(result.prompt).not.toContain("after '");
  });

  it('sections_lost counts headings in the truncated tail', () => {
    const mainBody = 'Text here. '.repeat(5_000); // ~55K chars, exceeds limit
    const headingTail = '\n## Lost Section 1\nsome text\n## Lost Section 2\nmore text\n';
    // Build: 50K of body + heading tail beyond the 50K boundary
    const bodyBefore = 'X'.repeat(50_000);
    const content = bodyBefore + headingTail;

    const result = documentAnalysisPrompt(content, REFINED_TOPIC, ACTIVE_POVERS, TAXONOMY_SAMPLE);
    expect(result.truncationMetrics.flags.sections_lost).toBe(2);

    // Suppress unused variable warning
    void mainBody;
  });

  it('handles single active POV — no comma-separated list in the perspectives line', () => {
    const result = documentAnalysisPrompt(SHORT_CONTENT, REFINED_TOPIC, ['safetyist'], TAXONOMY_SAMPLE);
    // The perspectives line should read "safetyist" with no comma joining multiple POVs
    expect(result.prompt).toContain('The debate will involve these perspectives: safetyist.');
    expect(result.prompt).not.toContain('The debate will involve these perspectives: safetyist,');
  });
});

// ── documentAnalysisContext ────────────────────────────────

describe('documentAnalysisContext', () => {
  it('output starts with DOCUMENT ANALYSIS marker and ends with END marker', () => {
    const analysis = makeAnalysis();
    const result = documentAnalysisContext(analysis);

    expect(result).toContain('=== DOCUMENT ANALYSIS ===');
    expect(result).toContain('=== END DOCUMENT ANALYSIS ===');
    // END marker should come after the opening marker
    expect(result.indexOf('=== DOCUMENT ANALYSIS ===')).toBeLessThan(
      result.indexOf('=== END DOCUMENT ANALYSIS ==='),
    );
  });

  it('includes claims_summary with SUMMARY: prefix', () => {
    const analysis = makeAnalysis({ claims_summary: 'The document argues X.' });
    const result = documentAnalysisContext(analysis);

    expect(result).toContain('SUMMARY: The document argues X.');
  });

  it('formats i_nodes as id: "text" [type] lines', () => {
    const analysis = makeAnalysis({
      i_nodes: [
        {
          id: 'D-1',
          text: 'AI regulation reduces risk.',
          type: 'normative',
          taxonomy_refs: [],
          policy_refs: [],
        },
      ],
    });
    const result = documentAnalysisContext(analysis);

    expect(result).toContain('D-1: "AI regulation reduces risk." [normative]');
  });

  it('appends arrow notation with taxonomy refs when present', () => {
    const analysis = makeAnalysis({
      i_nodes: [
        {
          id: 'D-1',
          text: 'Claim with refs.',
          type: 'empirical',
          taxonomy_refs: ['acc-beliefs-001', 'saf-beliefs-002'],
          policy_refs: [],
        },
      ],
    });
    const result = documentAnalysisContext(analysis);

    expect(result).toContain('D-1: "Claim with refs." [empirical] → acc-beliefs-001, saf-beliefs-002');
  });

  it('appends arrow notation with policy refs when present', () => {
    const analysis = makeAnalysis({
      i_nodes: [
        {
          id: 'D-2',
          text: 'Policy-linked claim.',
          type: 'normative',
          taxonomy_refs: [],
          policy_refs: ['pol-001'],
        },
      ],
    });
    const result = documentAnalysisContext(analysis);

    expect(result).toContain('D-2: "Policy-linked claim." [normative] → pol-001');
  });

  it('combines taxonomy refs and policy refs in the arrow notation', () => {
    const analysis = makeAnalysis({
      i_nodes: [
        {
          id: 'D-3',
          text: 'Mixed refs.',
          type: 'definitional',
          taxonomy_refs: ['acc-beliefs-001'],
          policy_refs: ['pol-002'],
        },
      ],
    });
    const result = documentAnalysisContext(analysis);

    expect(result).toContain('D-3: "Mixed refs." [definitional] → acc-beliefs-001, pol-002');
  });

  it('omits arrow entirely when both taxonomy_refs and policy_refs are empty', () => {
    const analysis = makeAnalysis({
      i_nodes: [
        {
          id: 'D-4',
          text: 'No refs.',
          type: 'assumption',
          taxonomy_refs: [],
          policy_refs: [],
        },
      ],
    });
    const result = documentAnalysisContext(analysis);

    expect(result).toContain('D-4: "No refs." [assumption]');
    // Should not have an arrow for this node
    const line = result.split('\n').find(l => l.startsWith('D-4:'));
    expect(line).toBeDefined();
    expect(line).not.toContain(' → ');
  });

  it('omits TENSION POINTS section when tension_points is empty', () => {
    const analysis = makeAnalysis({ tension_points: [] });
    const result = documentAnalysisContext(analysis);

    expect(result).not.toContain('TENSION POINTS:');
  });

  it('includes TENSION POINTS section when tension_points exist', () => {
    const analysis = makeAnalysis({
      tension_points: [
        {
          description: 'Core disagreement on risk.',
          i_node_ids: ['D-1', 'D-3'],
          pov_tensions: [
            { pov: 'accelerationist', stance: 'Risk is overstated.' },
            { pov: 'safetyist', stance: 'Risk is severe.' },
          ],
        },
      ],
    });
    const result = documentAnalysisContext(analysis);

    expect(result).toContain('TENSION POINTS:');
  });

  it('formats tension point with i_node_ids joined by " vs "', () => {
    const analysis = makeAnalysis({
      tension_points: [
        {
          description: 'Tension between growth and safety.',
          i_node_ids: ['D-1', 'D-3'],
          pov_tensions: [
            { pov: 'accelerationist', stance: 'Growth matters.' },
            { pov: 'safetyist', stance: 'Safety first.' },
          ],
        },
      ],
    });
    const result = documentAnalysisContext(analysis);

    expect(result).toContain('D-1 vs D-3: Tension between growth and safety.');
  });

  it('formats pov_tensions as "pov: stance" joined by ". "', () => {
    const analysis = makeAnalysis({
      tension_points: [
        {
          description: 'Disagreement.',
          i_node_ids: ['D-2'],
          pov_tensions: [
            { pov: 'accelerationist', stance: 'Pro-growth stance.' },
            { pov: 'skeptic', stance: 'Uncertain stance.' },
          ],
        },
      ],
    });
    const result = documentAnalysisContext(analysis);

    expect(result).toContain('accelerationist: Pro-growth stance.. skeptic: Uncertain stance.');
  });

  it('tension point line is formatted as "- {ids}: {description}. {stances}"', () => {
    const analysis = makeAnalysis({
      tension_points: [
        {
          description: 'X vs Y.',
          i_node_ids: ['D-1'],
          pov_tensions: [
            { pov: 'safetyist', stance: 'Concerned.' },
          ],
        },
      ],
    });
    const result = documentAnalysisContext(analysis);
    const tpLine = result.split('\n').find(l => l.startsWith('- D-1:'));

    expect(tpLine).toBeDefined();
    expect(tpLine).toBe('- D-1: X vs Y.. safetyist: Concerned.');
  });

  it('handles multiple i_nodes and multiple tension points correctly', () => {
    const analysis = makeAnalysis({
      i_nodes: [
        { id: 'D-1', text: 'First claim.', type: 'empirical', taxonomy_refs: [], policy_refs: [] },
        { id: 'D-2', text: 'Second claim.', type: 'normative', taxonomy_refs: ['saf-beliefs-001'], policy_refs: [] },
        { id: 'D-3', text: 'Third claim.', type: 'evidence', taxonomy_refs: [], policy_refs: ['pol-001'] },
      ],
      tension_points: [
        {
          description: 'First tension.',
          i_node_ids: ['D-1', 'D-2'],
          pov_tensions: [{ pov: 'accelerationist', stance: 'A.' }],
        },
        {
          description: 'Second tension.',
          i_node_ids: ['D-2', 'D-3'],
          pov_tensions: [{ pov: 'safetyist', stance: 'B.' }],
        },
      ],
    });
    const result = documentAnalysisContext(analysis);

    expect(result).toContain('D-1: "First claim." [empirical]');
    expect(result).toContain('D-2: "Second claim." [normative] → saf-beliefs-001');
    expect(result).toContain('D-3: "Third claim." [evidence] → pol-001');
    expect(result).toContain('D-1 vs D-2: First tension.');
    expect(result).toContain('D-2 vs D-3: Second tension.');
  });

  it('output is a string (not undefined or null)', () => {
    const result = documentAnalysisContext(makeAnalysis());
    expect(typeof result).toBe('string');
  });
});
