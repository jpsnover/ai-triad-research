// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import { interpretationsKey, buildSituationBaseline, changedSituations, checkSituationBdi } from './situationBdiGate';
import type { SituationNode } from '../types/taxonomy';

const bdi = (t: string) => ({ belief: `${t} b`, desire: `${t} d`, intention: `${t} i`, summary: `${t} s` });
const node = (id: string, interpretations: SituationNode['interpretations'], description = 'A situation that tests the gate.'): SituationNode =>
  ({ id, label: `L ${id}`, description, interpretations, linked_nodes: [], conflict_ids: [] });
const full = { accelerationist: bdi('a'), safetyist: bdi('s'), skeptic: bdi('k') };

describe('situationBdiGate (t/3888)', () => {
  it('interpretationsKey ignores key order, so a reordered object is not "changed"', () => {
    const reordered = { skeptic: { summary: 'k s', intention: 'k i', desire: 'k d', belief: 'k b' }, safetyist: bdi('s'), accelerationist: bdi('a') };
    expect(interpretationsKey(reordered)).toBe(interpretationsKey(full));
  });

  it('a node absent from the baseline counts as changed (SO Q1 condition 2)', () => {
    const baseline = buildSituationBaseline([node('sit-001', full)]);
    expect(changedSituations([node('sit-001', full), node('sit-002', full)], baseline).map(n => n.id)).toEqual(['sit-002']);
  });

  it('only interpretations count as a change, not other fields (SO Q1 condition 1)', () => {
    const baseline = buildSituationBaseline([node('sit-001', full)]);
    expect(changedSituations([{ ...node('sit-001', full), label: 'renamed' }], baseline)).toEqual([]);
  });

  it('an empty baseline gates every node (fails closed, never open)', () => {
    expect(checkSituationBdi([node('sit-001', { ...full, safetyist: 'flat' })], {})).not.toBeNull();
  });

  it('names every failing field of a POV, using only the shared rule', () => {
    const refusal = checkSituationBdi([node('sit-001', { ...full, skeptic: { belief: '', desire: 'TBD', intention: 'real', summary: '' } })], {});
    expect(refusal?.errors['nodes.sit-001.interpretations.skeptic']).toBe('skeptic: belief, desire are empty or a placeholder (N/A, TBD, none…)');
  });
});
