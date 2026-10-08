// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/4034: the TS recount mirrors PowerShell's Update-PolicyMemberCounts (node-scoped). The cases follow
// tests/Update-PolicyRegistry.NodeScoped.Tests.ps1 and the three details PowerShell confirmed in e/264#3.

import { describe, it, expect } from 'vitest';
import { recountPolicyMembers, serializePolicyRegistry, type PolicyRegistry, type PolicyPovFileData } from './registryRecount.js';

const node = (id: string, ...policyIds: (string | null | undefined)[]) => ({
  id,
  graph_attributes: { policy_actions: policyIds.map((policy_id) => ({ action: `a-${id}`, framing: 'f', ...(policy_id === undefined ? {} : { policy_id }) })) },
});
const file = (...nodes: ReturnType<typeof node>[]): PolicyPovFileData => ({ nodes });

function registry(): PolicyRegistry {
  return {
    _schema_version: 1,
    _doc: 'doc',
    policy_count: 4,
    policies: [
      { id: 'pol-001', action: 'one', source_povs: ['skeptic'], member_count: 1, status: 'active', real_world_refs: [{ x: 1 }] },
      { id: 'pol-002', action: 'two', source_povs: ['safetyist'], member_count: 5, status: 'superseded' },
      { id: 'pol-003', action: 'three', source_povs: ['accelerationist'], member_count: 9 }, // no status
      { id: 'pol-004', action: 'four', source_povs: ['situations'], member_count: 7, status: 'active' }, // unrelated, stale
    ],
  };
}

const byId = (r: PolicyRegistry, id: string) => r.policies.find((p) => p.id === id)!;

describe('recountPolicyMembers: the node-scoped rule (Update-PolicyMemberCounts)', () => {
  it('increments member_count when a node references an existing id, and sets sorted unique source_povs', () => {
    const { registry: r, updated } = recountPolicyMembers(registry(), {
      skeptic: file(node('skp-1', 'pol-001')),
      accelerationist: file(node('acc-1', 'pol-001')),
    }, ['pol-001']);
    expect(byId(r, 'pol-001')).toMatchObject({ member_count: 2, source_povs: ['accelerationist', 'skeptic'] });
    expect(updated).toEqual([{ id: 'pol-001', member_count: 2, source_povs: ['accelerationist', 'skeptic'] }]);
  });

  it('decrements to 0 for an id the node dropped, keeps its source_povs, and leaves an unrelated stale count alone', () => {
    const { registry: r } = recountPolicyMembers(registry(), { skeptic: file(node('skp-1')) }, ['pol-001']);
    expect(byId(r, 'pol-001')).toMatchObject({ member_count: 0, source_povs: ['skeptic'] });
    expect(byId(r, 'pol-004')).toEqual(registry().policies[3]); // not a target: untouched, stale count and all
  });

  it('counts ENTRIES, not nodes: a node listing the same id twice counts 2 (PowerShell e/264#3 detail 1)', () => {
    const { registry: r } = recountPolicyMembers(registry(), { safetyist: file(node('saf-1', 'pol-002', 'pol-002')) }, ['pol-002']);
    expect(byId(r, 'pol-002')).toMatchObject({ member_count: 2, source_povs: ['safetyist'] });
  });

  it('only a truthy policy_id is a reference: null, undefined and empty string are unregistered (detail 2)', () => {
    const reg = registry();
    // Ids that a falsy value would stringify to: they must stay unreferenced by null / '' entries.
    reg.policies.push({ id: 'null', action: 'x', member_count: 5, status: 'active' }, { id: '', action: 'y', member_count: 5, status: 'active' });
    const { registry: r } = recountPolicyMembers(reg, {
      skeptic: file(node('skp-1', null, undefined, '', 'pol-001')),
    }, ['pol-001', 'null', '']);
    expect(byId(r, 'pol-001').member_count).toBe(1);
    expect(byId(r, 'null').member_count).toBe(0);
    expect(byId(r, '').member_count).toBe(0);
  });

  it('source_povs is sorted, not scan order: skeptic is scanned before situations', () => {
    const { registry: r } = recountPolicyMembers(registry(), {
      skeptic: file(node('skp-1', 'pol-004')),
      situations: file(node('sit-1', 'pol-004')),
    }, ['pol-004']);
    expect(byId(r, 'pol-004').source_povs).toEqual(['situations', 'skeptic']);
  });

  it('adds status "active" only when the property is missing; an existing status is preserved (detail 3)', () => {
    const { registry: r } = recountPolicyMembers(registry(), {}, ['pol-002', 'pol-003']);
    expect(byId(r, 'pol-002').status).toBe('superseded');
    expect(byId(r, 'pol-003').status).toBe('active');
  });

  it('ignores unknown ids, and reports each known target once in first-seen order', () => {
    const { updated } = recountPolicyMembers(registry(), { skeptic: file(node('skp-1', 'pol-003')) }, ['pol-999', 'pol-003', 'pol-001', 'pol-003']);
    expect(updated.map((u) => u.id)).toEqual(['pol-003', 'pol-001']);
  });

  it('scans only the four POV files, and tolerates missing files, nodes without graph_attributes, and a lone object', () => {
    const files = {
      skeptic: { nodes: [{ id: 'skp-1' }, { id: 'skp-2', graph_attributes: null }, { id: 'skp-3', graph_attributes: { policy_actions: { policy_id: 'pol-001' } } }] },
      conflicts: file(node('x', 'pol-001')), // not one of the four: never scanned
    } as unknown as Parameters<typeof recountPolicyMembers>[1];
    const { registry: r } = recountPolicyMembers(registry(), files, ['pol-001']);
    expect(byId(r, 'pol-001')).toMatchObject({ member_count: 1, source_povs: ['skeptic'] });
  });

  it('preserves every other field and policy, and never mutates the input', () => {
    const input = registry();
    const snapshot = JSON.stringify(input);
    const { registry: r } = recountPolicyMembers(input, { skeptic: file(node('skp-1', 'pol-001')) }, ['pol-001']);
    expect(JSON.stringify(input)).toBe(snapshot);
    expect(r._doc).toBe('doc');
    expect(r.policy_count).toBe(4);
    expect(byId(r, 'pol-001').real_world_refs).toEqual([{ x: 1 }]);
    expect(r.policies.map((p) => p.id)).toEqual(['pol-001', 'pol-002', 'pol-003', 'pol-004']);
  });
});

describe('changed: so a caller skips the write when nothing moved (PowerShell e/264#7 point 1)', () => {
  it('is false when the recomputed values equal what is stored', () => {
    expect(recountPolicyMembers(registry(), { skeptic: file(node('skp-1', 'pol-001')) }, ['pol-001']).changed).toBe(false);
  });
  it('is false for an unreferenced id whose count is already 0 and has no source_povs', () => {
    const r = registry();
    r.policies.push({ id: 'pol-005', action: 'five', member_count: 0, status: 'active' });
    expect(recountPolicyMembers(r, {}, ['pol-005']).changed).toBe(false);
  });
  it('is true when a count, the source_povs, or a missing status changes', () => {
    expect(recountPolicyMembers(registry(), {}, ['pol-001']).changed).toBe(true); // 1 -> 0
    expect(recountPolicyMembers(registry(), { safetyist: file(node('s', 'pol-001')) }, ['pol-001']).changed).toBe(true); // povs
    const r = registry();
    r.policies[2] = { ...r.policies[2], member_count: 0 };
    expect(recountPolicyMembers(r, {}, ['pol-003']).changed).toBe(true); // status added
  });
  it('is false when no target id is known', () => {
    expect(recountPolicyMembers(registry(), {}, ['pol-999']).changed).toBe(false);
  });
});

describe('serializePolicyRegistry: the committed file format (PowerShell e/264#7 point 3)', () => {
  it('2-space JSON with one trailing LF, so a parse/serialize round trip of a committed file is byte-identical', () => {
    const committed = `${JSON.stringify(registry(), null, 2)}\n`; // the format of taxonomy/Origin/policy_actions.json
    expect(serializePolicyRegistry(JSON.parse(committed))).toBe(committed);
    expect(serializePolicyRegistry(registry()).endsWith('}\n')).toBe(true);
    expect(serializePolicyRegistry(registry())).not.toContain('\r');
  });

  it('a recount of a committed file changes ONLY the recounted ids\' count lines; every other line is byte-identical (TL p/336#587)', () => {
    // The exemption on RecountPolicyMembersResult lapses if the recount writes anything else, so pin it at the byte level.
    const committed = serializePolicyRegistry(registry());
    // All four POV files, each non-empty. pol-001 goes 1 -> 2 and pol-002 goes 5 -> 1; their source_povs are unchanged.
    const povs = {
      accelerationist: file(node('acc-x')),
      safetyist: file(node('saf-1', 'pol-002')),
      skeptic: file(node('skp-1', 'pol-001', 'pol-001')),
      situations: file(node('sit-x')),
    };
    const { registry: next, changed } = recountPolicyMembers(JSON.parse(committed), povs, ['pol-001', 'pol-002']);
    expect(changed).toBe(true);
    const before = committed.split('\n');
    const after = serializePolicyRegistry(next).split('\n');
    expect(after).toHaveLength(before.length);
    const differing = before.flatMap((line, i) => (line === after[i] ? [] : [`${line.trim()} -> ${after[i].trim()}`]));
    expect(differing).toEqual(['"member_count": 1, -> "member_count": 2,', '"member_count": 5, -> "member_count": 1,']);
  });
});
