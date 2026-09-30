// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import { formatEstablishedPoints } from './prompts.js';

describe('formatEstablishedPoints — steelman routing', () => {
  const steelmanNode = {
    id: 'an-10',
    text: 'AI systems require careful oversight to prevent misuse',
    speaker: 'accelerationist',
    steelman_of: 'skeptic',
  };
  const regularAccNode = {
    id: 'an-11',
    text: 'AI development should proceed rapidly to capture benefits',
    speaker: 'accelerationist',
  };
  const regularSkpNode = {
    id: 'an-12',
    text: 'Current AI capabilities are overhyped',
    speaker: 'skeptic',
  };

  it('steelman of skeptic is excluded from otherClaims when skeptic is current speaker', () => {
    // The misfiling the ticket exists to fix: without the fix, steelmanNode.speaker=accelerationist
    // would land in otherClaims (n.speaker !== "skeptic" → true), surfacing it to the Skeptic
    // as an accelerationist claim to attack. With the fix, effectiveCamp=skeptic === currentSpeaker
    // → excluded.
    const result = formatEstablishedPoints(
      [steelmanNode, regularAccNode],
      'skeptic',
    );
    expect(result).not.toContain('an-10');
    expect(result).toContain('an-11');
  });

  it('steelman of skeptic is included in otherClaims when accelerationist is current speaker', () => {
    // Author should not see their own steelman as an opponent claim.
    const result = formatEstablishedPoints(
      [steelmanNode, regularSkpNode],
      'accelerationist',
    );
    // effectiveCamp(steelmanNode) = 'skeptic' !== 'accelerationist' → in otherClaims
    expect(result).toContain('an-10');
    expect(result).toContain('an-12');
  });

  it('steelman node carries CL label — charitable restatement, authored by', () => {
    const result = formatEstablishedPoints(
      [steelmanNode, regularAccNode],
      'accelerationist',
    );
    expect(result).toContain('Charitable restatement of the Skeptic position, authored by Accelerationist');
  });

  it('regular node renders with camp label, not steelman label', () => {
    const result = formatEstablishedPoints(
      [regularAccNode],
      'skeptic',
    );
    expect(result).toContain('Accelerationist');
    expect(result).not.toContain('Charitable restatement');
  });
});
