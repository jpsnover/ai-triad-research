// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { subScoreTip } from './INodeRow';
import type { ArgumentNetworkNode, ArgumentNetworkEdge } from '../../../../types/debate';

vi.mock('../../../../utils/qbafExplain', () => ({
  explainNodeStrength: vi.fn(() => ({ summary: 'accepted because evidence is strong', attributions: [] })),
}));

vi.mock('../../../../types/debate', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    POVER_INFO: {
      accelerationist: { label: 'Accelerationist' },
      safetyist: { label: 'Safetyist' },
      skeptic: { label: 'Skeptic' },
    },
  };
});

// --- subScoreTip ---

describe('subScoreTip', () => {
  it('returns Strong band for values >= 0.7', () => {
    const tip = subScoreTip('evidence_quality', 0.85);
    expect(tip).toContain('Strong');
    expect(tip).toContain('0.85');
  });

  it('returns Moderate band for values >= 0.4 and < 0.7', () => {
    const tip = subScoreTip('evidence_quality', 0.55);
    expect(tip).toContain('Moderate');
  });

  it('returns Weak band for values < 0.4', () => {
    const tip = subScoreTip('evidence_quality', 0.2);
    expect(tip).toContain('Weak');
  });

  it('returns known tip text for evidence_quality', () => {
    const tip = subScoreTip('evidence_quality', 0.5);
    expect(tip).toContain('Evidence Quality');
    expect(tip).toContain('How well-supported');
  });

  it('returns known tip text for source_reliability', () => {
    const tip = subScoreTip('source_reliability', 0.5);
    expect(tip).toContain('Source Reliability');
    expect(tip).toContain('credible');
  });

  it('returns known tip text for falsifiability', () => {
    const tip = subScoreTip('falsifiability', 0.5);
    expect(tip).toContain('Falsifiability');
    expect(tip).toContain('tested or disproven');
  });

  it('returns known tip text for values_grounding', () => {
    const tip = subScoreTip('values_grounding', 0.5);
    expect(tip).toContain('Values Grounding');
  });

  it('returns known tip text for tradeoff_acknowledgment', () => {
    const tip = subScoreTip('tradeoff_acknowledgment', 0.5);
    expect(tip).toContain('Tradeoff Acknowledgment');
  });

  it('returns known tip text for precedent_citation', () => {
    const tip = subScoreTip('precedent_citation', 0.5);
    expect(tip).toContain('Precedent Citation');
  });

  it('returns known tip text for mechanism_specificity', () => {
    const tip = subScoreTip('mechanism_specificity', 0.5);
    expect(tip).toContain('Mechanism Specificity');
  });

  it('returns known tip text for scope_bounding', () => {
    const tip = subScoreTip('scope_bounding', 0.5);
    expect(tip).toContain('Scope Bounding');
  });

  it('returns known tip text for failure_mode_addressing', () => {
    const tip = subScoreTip('failure_mode_addressing', 0.5);
    expect(tip).toContain('Failure Mode Addressing');
  });

  it('returns key name for unknown keys', () => {
    expect(subScoreTip('unknown_key', 0.5)).toBe('unknown_key');
  });

  it('includes scoring info for belief sub-scores', () => {
    const tip = subScoreTip('evidence_quality', 0.5);
    expect(tip).toContain('Belief');
    expect(tip).toContain('slider');
  });

  it('includes scoring info for desire sub-scores', () => {
    const tip = subScoreTip('values_grounding', 0.5);
    expect(tip).toContain('Desire');
  });

  it('includes scoring info for intention sub-scores', () => {
    const tip = subScoreTip('mechanism_specificity', 0.5);
    expect(tip).toContain('Intention');
  });

  it('boundary: exactly 0.7 is Strong', () => {
    expect(subScoreTip('evidence_quality', 0.7)).toContain('Strong');
  });

  it('boundary: exactly 0.4 is Moderate', () => {
    expect(subScoreTip('evidence_quality', 0.4)).toContain('Moderate');
  });

  it('boundary: 0.39 is Weak', () => {
    expect(subScoreTip('evidence_quality', 0.39)).toContain('Weak');
  });
});

// --- INodeRow rendering ---

// Lazy-import to ensure mocks are set up first
async function getINodeRow() {
  const mod = await import('./INodeRow');
  return mod.INodeRow;
}

function makeNode(overrides: Partial<ArgumentNetworkNode> = {}): ArgumentNetworkNode {
  return {
    id: 'claim-001',
    text: 'AI development should be regulated',
    speaker: 'safetyist',
    source_entry_id: 'entry-1',
    taxonomy_refs: ['saf-B-001'],
    turn_number: 1,
    base_strength: 0.6,
    computed_strength: 0.7,
    ...overrides,
  };
}

function makeEdge(overrides: Partial<ArgumentNetworkEdge> = {}): ArgumentNetworkEdge {
  return {
    id: 'edge-001',
    source: 'claim-002',
    target: 'claim-001',
    type: 'attacks',
    weight: 0.8,
    ...overrides,
  };
}

describe('INodeRow', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('hides claim text when collapsed (default)', async () => {
    const INodeRow = await getINodeRow();
    render(
      <INodeRow
        node={makeNode()}
        attacks={[]}
        supports={[]}
        allNodes={[makeNode()]}
        allEdges={[]}
        isSource={false}
        strengthMap={new Map()}
        onUpdateSubScore={vi.fn()}
      />,
    );
    expect(screen.queryByText('AI development should be regulated')).not.toBeInTheDocument();
  });

  it('renders claim text when expanded', async () => {
    const INodeRow = await getINodeRow();
    render(
      <INodeRow
        node={makeNode()}
        attacks={[]}
        supports={[]}
        allNodes={[makeNode()]}
        allEdges={[]}
        isSource={false}
        strengthMap={new Map()}
        onUpdateSubScore={vi.fn()}
        defaultExpanded
      />,
    );
    expect(screen.getByText('AI development should be regulated')).toBeInTheDocument();
  });

  it('renders the node ID', async () => {
    const INodeRow = await getINodeRow();
    render(
      <INodeRow
        node={makeNode()}
        attacks={[]}
        supports={[]}
        allNodes={[makeNode()]}
        allEdges={[]}
        isSource={false}
        strengthMap={new Map()}
        onUpdateSubScore={vi.fn()}
      />,
    );
    expect(screen.getByText('claim-001')).toBeInTheDocument();
  });

  it('renders strength badge with band label and computed value', async () => {
    const INodeRow = await getINodeRow();
    const { container } = render(
      <INodeRow
        node={makeNode({ base_strength: 0.60, computed_strength: 0.75 })}
        attacks={[]}
        supports={[]}
        allNodes={[makeNode()]}
        allEdges={[]}
        isSource={false}
        strengthMap={new Map()}
        onUpdateSubScore={vi.fn()}
      />,
    );
    // Strength rendered as title attribute: "Strength: 0.75 (base: 0.60, delta: +0.15)"
    const strengthEl = container.querySelector('[title*="Strength: 0.75"]');
    expect(strengthEl).toBeTruthy();
  });

  it('renders attack edges when expanded', async () => {
    const INodeRow = await getINodeRow();
    const attackerNode = makeNode({ id: 'claim-002', text: 'Innovation outpaces regulation', speaker: 'accelerationist' });
    const edge = makeEdge({ source: 'claim-002', target: 'claim-001' });

    render(
      <INodeRow
        node={makeNode()}
        attacks={[edge]}
        supports={[]}
        allNodes={[makeNode(), attackerNode]}
        allEdges={[edge]}
        isSource={false}
        strengthMap={new Map([['claim-002', 0.5]])}
        onUpdateSubScore={vi.fn()}
        defaultExpanded
      />,
    );

    expect(screen.getByText('CA-node')).toBeInTheDocument();
    expect(screen.getByText('Innovation outpaces regulation')).toBeInTheDocument();
  });

  it('renders BDI sub-scores when expanded', async () => {
    const INodeRow = await getINodeRow();
    render(
      <INodeRow
        node={makeNode({
          bdi_category: 'belief',
          bdi_sub_scores: {
            evidence_quality: 0.7,
            source_reliability: 0.5,
            falsifiability: 0.3,
          },
        })}
        attacks={[]}
        supports={[]}
        allNodes={[makeNode()]}
        allEdges={[]}
        isSource={false}
        strengthMap={new Map()}
        onUpdateSubScore={vi.fn()}
        defaultExpanded
      />,
    );
    expect(screen.getByText(/Evidence Quality/i)).toBeInTheDocument();
  });

  it('renders speaker label', async () => {
    const INodeRow = await getINodeRow();
    render(
      <INodeRow
        node={makeNode({ speaker: 'safetyist' })}
        attacks={[]}
        supports={[]}
        allNodes={[makeNode()]}
        allEdges={[]}
        isSource={false}
        strengthMap={new Map()}
        onUpdateSubScore={vi.fn()}
      />,
    );
    expect(screen.getByText('Safetyist')).toBeInTheDocument();
  });

  it('renders claim_taxonomy_attribution when present', async () => {
    const INodeRow = await getINodeRow();
    render(
      <INodeRow
        node={makeNode({
          claim_taxonomy_attribution: {
            primary_ref: 'saf-B-001',
            attribution_confidence: 0.82,
            secondary_refs: [],
          },
        })}
        attacks={[]}
        supports={[]}
        allNodes={[makeNode()]}
        allEdges={[]}
        isSource={false}
        strengthMap={new Map()}
        onUpdateSubScore={vi.fn()}
      />,
    );
    expect(screen.getByText(/saf-B-001/)).toBeInTheDocument();
    expect(screen.getByText(/0.82/)).toBeInTheDocument();
  });

  it('has sliders for belief sub-scores when expanded', async () => {
    const INodeRow = await getINodeRow();
    const onUpdate = vi.fn();
    render(
      <INodeRow
        node={makeNode({
          bdi_category: 'belief',
          bdi_sub_scores: {
            evidence_quality: 0.5,
            source_reliability: 0.5,
            falsifiability: 0.5,
          },
        })}
        attacks={[]}
        supports={[]}
        allNodes={[makeNode()]}
        allEdges={[]}
        isSource={false}
        strengthMap={new Map()}
        onUpdateSubScore={onUpdate}
        defaultExpanded
      />,
    );
    const sliders = screen.getAllByRole('slider');
    expect(sliders.length).toBe(3);
  });

  it('renders inline NL strength explanation when expanded with edges', async () => {
    const INodeRow = await getINodeRow();
    const supporterNode = makeNode({ id: 'claim-002', text: 'Evidence supports regulation', speaker: 'safetyist' });
    const supportEdge = makeEdge({ id: 'edge-sup', source: 'claim-002', target: 'claim-001', type: 'supports', weight: 0.8 });

    render(
      <INodeRow
        node={makeNode({ base_strength: 0.5, computed_strength: 0.8 })}
        attacks={[]}
        supports={[supportEdge]}
        allNodes={[makeNode(), supporterNode]}
        allEdges={[supportEdge]}
        isSource={false}
        strengthMap={new Map([['claim-002', 0.7]])}
        computedStrength={0.8}
        onUpdateSubScore={vi.fn()}
        defaultExpanded
      />,
    );
    expect(screen.getByText(/accepted.*because.*Evidence supports regulation/)).toBeInTheDocument();
  });
});
