// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import { computeAgentUtility } from './agentUtility.js';
import type { ArgumentNetworkNode, ArgumentNetworkEdge } from './types.js';

function makeNode(
  id: string,
  speaker: string,
  overrides: Partial<ArgumentNetworkNode> = {},
): ArgumentNetworkNode {
  return {
    id,
    text: `Claim ${id}`,
    speaker: speaker as ArgumentNetworkNode['speaker'],
    source_entry_id: 'e1',
    taxonomy_refs: [],
    turn_number: 1,
    base_strength: 0.5,
    computed_strength: 0.5,
    ...overrides,
  };
}

describe('computeAgentUtility — steelman classification', () => {
  it('steelman node belongs to steelmanned camp, not author, for position_strength', () => {
    // AN-10: authored by accelerationist, steelmans skeptic.
    // When computing skeptic's utility, effectiveCamp(AN-10)=skeptic → agentNodes includes it.
    const steelmanNode = makeNode('AN-10', 'accelerationist', {
      steelman_of: 'skeptic',
      computed_strength: 0.8,
    });
    const regularSkpNode = makeNode('AN-11', 'skeptic', { computed_strength: 0.7 });

    const result = computeAgentUtility('skeptic', [steelmanNode, regularSkpNode], []);

    // Both AN-10 (steelman) and AN-11 (own) should count as skeptic's nodes.
    // position_strength = mean of undefeated (both >= 0.3) = (0.8 + 0.7) / 2 = 0.75
    expect(result.position_strength).toBeCloseTo(0.75, 2);
  });

  it('steelman node is excluded from opponentNodes for its author', () => {
    // AN-10: authored by accelerationist, steelmans skeptic.
    // When computing accelerationist's utility, effectiveCamp(AN-10)=skeptic !== accelerationist
    // → AN-10 is in opponentNodes (not agentNodes).
    const steelmanNode = makeNode('AN-10', 'accelerationist', {
      steelman_of: 'skeptic',
      computed_strength: 0.8,
    });
    const accNode = makeNode('AN-11', 'accelerationist', { computed_strength: 0.7 });

    const result = computeAgentUtility('accelerationist', [steelmanNode, accNode], []);

    // agentNodes = [AN-11] only. position_strength = 0.7.
    expect(result.position_strength).toBeCloseTo(0.7, 2);
  });
});
