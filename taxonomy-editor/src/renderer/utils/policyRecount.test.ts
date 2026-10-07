// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi } from 'vitest';
import { buildPolicyIdBaseline, affectedPolicyIds, runPolicyRecount, mergePolicyCounts } from './policyRecount';

// t/4034
const node = (id: string, ...policyIds: Array<string | null>) =>
  ({ id, graph_attributes: { policy_actions: policyIds.map(policy_id => ({ policy_id })) } });

describe('affectedPolicyIds (t/4034)', () => {
  const before = [node('acc-beliefs-001', 'pol-001'), node('acc-beliefs-002', 'pol-002'), node('saf-beliefs-001', 'pol-009')];
  const baseline = buildPolicyIdBaseline(before);

  it('an unchanged save recounts nothing', () => {
    expect(affectedPolicyIds(before, before, baseline)).toEqual([]);
  });

  it('adding an action recounts the added id only', () => {
    const now = [node('acc-beliefs-001', 'pol-001', 'pol-005'), before[1], before[2]];
    expect(affectedPolicyIds(now, now, baseline)).toEqual(['pol-001', 'pol-005']);
  });

  it('removing an action recounts the removed id (so its count goes down)', () => {
    const now = [node('acc-beliefs-001'), before[1], before[2]];
    expect(affectedPolicyIds(now, now, baseline)).toEqual(['pol-001']);
  });

  it('reordering actions is not a change; a duplicated id is (member_count counts entries)', () => {
    const b = buildPolicyIdBaseline([node('acc-beliefs-003', 'pol-001', 'pol-002')]);
    expect(affectedPolicyIds([node('acc-beliefs-003', 'pol-002', 'pol-001')], [node('acc-beliefs-003', 'pol-002', 'pol-001')], b)).toEqual([]);
    const dup = [node('acc-beliefs-003', 'pol-001', 'pol-002', 'pol-002')];
    expect(affectedPolicyIds(dup, dup, b)).toEqual(['pol-001', 'pol-002']);
  });

  it('a deleted node recounts its prior ids; a node in an unsaved file is not treated as deleted', () => {
    const saved = [before[1]]; // acc file saved without acc-beliefs-001
    const all = [before[1], before[2]]; // saf-beliefs-001 still loaded, just not saved
    expect(affectedPolicyIds(saved, all, baseline)).toEqual(['pol-001']);
  });

  it('a new node contributes its ids; empty and null policy ids are ignored', () => {
    const now = [...before, node('acc-beliefs-099', 'pol-007', null, '')];
    expect(affectedPolicyIds(now, now, baseline)).toEqual(['pol-007']);
  });
});

describe('runPolicyRecount (t/4034)', () => {
  const upd = [{ id: 'pol-001', member_count: 3, source_povs: ['accelerationist'] }];

  it('no ids: never calls the backend', async () => {
    const recount = vi.fn();
    expect(await runPolicyRecount([], recount)).toEqual({ updates: [], notice: null });
    expect(recount).not.toHaveBeenCalled();
  });

  it('written: returns the updates; unchanged: nothing to merge', async () => {
    expect(await runPolicyRecount(['pol-001'], async () => ({ status: 'written', updated: upd }))).toEqual({ updates: upd, notice: null });
    expect(await runPolicyRecount(['pol-001'], async () => ({ status: 'unchanged', updated: [] }))).toEqual({ updates: [], notice: null });
  });

  it('refused (any reason) or a rejected call: a notice, never a throw', async () => {
    expect(await runPolicyRecount(['pol-001'], async () => ({ status: 'refused', reason: 'locked', updated: [] })))
      .toEqual({ updates: [], notice: { kind: 'not-updated', ids: ['pol-001'], reason: 'locked' } });
    expect(await runPolicyRecount(['pol-001'], async () => { throw new Error('no handler'); }))
      .toEqual({ updates: [], notice: { kind: 'not-updated', ids: ['pol-001'], reason: 'failed' } });
  });

  it('desktop (registry left uncommitted): a write also gives a needs-commit notice; unchanged does not (e/264#26)', async () => {
    const desktop = { leavesRegistryUncommitted: true };
    expect(await runPolicyRecount(['pol-001', 'pol-002'], async () => ({ status: 'written', updated: upd }), desktop))
      .toEqual({ updates: upd, notice: { kind: 'needs-commit', ids: ['pol-001'], reason: 'uncommitted' } });
    expect(await runPolicyRecount(['pol-001'], async () => ({ status: 'unchanged', updated: [] }), desktop))
      .toEqual({ updates: [], notice: null });
  });
});

describe('mergePolicyCounts (t/4034)', () => {
  it('updates only the recounted entries and keeps their other fields', () => {
    const reg = [{ id: 'pol-001', action: 'a', member_count: 1, source_povs: [] as string[] }, { id: 'pol-002', action: 'b', member_count: 5, source_povs: ['safetyist'] }];
    const out = mergePolicyCounts(reg, [{ id: 'pol-001', member_count: 3, source_povs: ['accelerationist'] }])!;
    expect(out[0]).toEqual({ id: 'pol-001', action: 'a', member_count: 3, source_povs: ['accelerationist'] });
    expect(out[1]).toBe(reg[1]);
    expect(mergePolicyCounts(null, [])).toBeNull();
  });
});
