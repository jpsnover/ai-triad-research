// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/4034: the TS recount mirrors PowerShell's Update-PolicyMemberCounts (node-scoped). The cases follow
// tests/Update-PolicyRegistry.NodeScoped.Tests.ps1 and the three details PowerShell confirmed in e/264#3.

import { describe, it, expect } from 'vitest';
import { ActionableError } from '../debate/errors.js';
import { recountPolicyMembers, serializePolicyRegistry, POLICY_POV_FILES, type PolicyRegistry, type PolicyPovFileData, type PolicyPovFiles } from './registryRecount.js';

const node = (id: string, ...policyIds: (string | null | undefined)[]) => ({
  id,
  graph_attributes: { policy_actions: policyIds.map((policy_id) => ({ action: `a-${id}`, framing: 'f', ...(policy_id === undefined ? {} : { policy_id }) })) },
});
const file = (...nodes: ReturnType<typeof node>[]): PolicyPovFileData => ({ nodes });
/** All four POV files (the contract requires every one, each non-empty); any not given holds one node with no references. */
const povs = (given: Partial<PolicyPovFiles> = {}): PolicyPovFiles => ({
  accelerationist: file(node('acc-x')), safetyist: file(node('saf-x')), skeptic: file(node('skp-x')), situations: file(node('sit-x')), ...given,
});

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
    const { registry: r, updated } = recountPolicyMembers(registry(), povs({
      skeptic: file(node('skp-1', 'pol-001')),
      accelerationist: file(node('acc-1', 'pol-001')),
    }), ['pol-001']);
    expect(byId(r, 'pol-001')).toMatchObject({ member_count: 2, source_povs: ['accelerationist', 'skeptic'] });
    expect(updated).toEqual([{ id: 'pol-001', member_count: 2, source_povs: ['accelerationist', 'skeptic'] }]);
  });

  it('decrements to 0 for an id the node dropped, keeps its source_povs, and leaves an unrelated stale count alone', () => {
    const { registry: r } = recountPolicyMembers(registry(), povs({ skeptic: file(node('skp-1')) }), ['pol-001']);
    expect(byId(r, 'pol-001')).toMatchObject({ member_count: 0, source_povs: ['skeptic'] });
    expect(byId(r, 'pol-004')).toEqual(registry().policies[3]); // not a target: untouched, stale count and all
  });

  it('counts ENTRIES, not nodes: a node listing the same id twice counts 2 (PowerShell e/264#3 detail 1)', () => {
    const { registry: r } = recountPolicyMembers(registry(), povs({ safetyist: file(node('saf-1', 'pol-002', 'pol-002')) }), ['pol-002']);
    expect(byId(r, 'pol-002')).toMatchObject({ member_count: 2, source_povs: ['safetyist'] });
  });

  it('only a truthy policy_id is a reference: null, undefined and empty string are unregistered (detail 2)', () => {
    const reg = registry();
    // Ids that a falsy value would stringify to: they must stay unreferenced by null / '' entries.
    reg.policies.push({ id: 'null', action: 'x', member_count: 5, status: 'active' }, { id: '', action: 'y', member_count: 5, status: 'active' });
    const { registry: r } = recountPolicyMembers(reg, povs({
      skeptic: file(node('skp-1', null, undefined, '', 'pol-001')),
    }), ['pol-001', 'null', '']);
    expect(byId(r, 'pol-001').member_count).toBe(1);
    expect(byId(r, 'null').member_count).toBe(0);
    expect(byId(r, '').member_count).toBe(0);
  });

  it('source_povs is sorted, not scan order: skeptic is scanned before situations', () => {
    const { registry: r } = recountPolicyMembers(registry(), povs({
      skeptic: file(node('skp-1', 'pol-004')),
      situations: file(node('sit-1', 'pol-004')),
    }), ['pol-004']);
    expect(byId(r, 'pol-004').source_povs).toEqual(['situations', 'skeptic']);
  });

  it('adds status "active" only when the property is missing; an existing status is preserved (detail 3)', () => {
    const { registry: r } = recountPolicyMembers(registry(), povs(), ['pol-002', 'pol-003']);
    expect(byId(r, 'pol-002').status).toBe('superseded');
    expect(byId(r, 'pol-003').status).toBe('active');
  });

  it('ignores unknown ids, and reports each known target once in first-seen order', () => {
    const { updated } = recountPolicyMembers(registry(), povs({ skeptic: file(node('skp-1', 'pol-003')) }), ['pol-999', 'pol-003', 'pol-001', 'pol-003']);
    expect(updated.map((u) => u.id)).toEqual(['pol-003', 'pol-001']);
  });

  it('scans only the four POV files, and tolerates nodes without graph_attributes and a lone object', () => {
    const files = {
      ...povs(),
      skeptic: { nodes: [{ id: 'skp-1' }, { id: 'skp-2', graph_attributes: null }, { id: 'skp-3', graph_attributes: { policy_actions: { policy_id: 'pol-001' } } }] },
      conflicts: file(node('x', 'pol-001')), // not one of the four: never scanned
    } as unknown as PolicyPovFiles;
    const { registry: r } = recountPolicyMembers(registry(), files, ['pol-001']);
    expect(byId(r, 'pol-001')).toMatchObject({ member_count: 1, source_povs: ['skeptic'] });
  });

  it('preserves every other field and policy, and never mutates the input', () => {
    const input = registry();
    const snapshot = JSON.stringify(input);
    const { registry: r } = recountPolicyMembers(input, povs({ skeptic: file(node('skp-1', 'pol-001')) }), ['pol-001']);
    expect(JSON.stringify(input)).toBe(snapshot);
    expect(r._doc).toBe('doc');
    expect(r.policy_count).toBe(4);
    expect(byId(r, 'pol-001').real_world_refs).toEqual([{ x: 1 }]);
    expect(r.policies.map((p) => p.id)).toEqual(['pol-001', 'pol-002', 'pol-003', 'pol-004']);
  });
});

describe('changed: so a caller skips the write when nothing moved (PowerShell e/264#7 point 1)', () => {
  it('is false when the recomputed values equal what is stored', () => {
    expect(recountPolicyMembers(registry(), povs({ skeptic: file(node('skp-1', 'pol-001')) }), ['pol-001']).changed).toBe(false);
  });
  it('is false for an unreferenced id whose count is already 0 and has no source_povs', () => {
    const r = registry();
    r.policies.push({ id: 'pol-005', action: 'five', member_count: 0, status: 'active' });
    expect(recountPolicyMembers(r, povs(), ['pol-005']).changed).toBe(false);
  });
  it('is true when a count, the source_povs, or a missing status changes', () => {
    expect(recountPolicyMembers(registry(), povs(), ['pol-001']).changed).toBe(true); // 1 -> 0
    expect(recountPolicyMembers(registry(), povs({ safetyist: file(node('s', 'pol-001')) }), ['pol-001']).changed).toBe(true); // povs
    const r = registry();
    r.policies[2] = { ...r.policies[2], member_count: 0 };
    expect(recountPolicyMembers(r, povs(), ['pol-003']).changed).toBe(true); // status added
  });
  it('is false when no target id is known', () => {
    expect(recountPolicyMembers(registry(), povs(), ['pol-999']).changed).toBe(false);
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

describe('a partial corpus is refused, never recounted (t/4034, #3048 review)', () => {
  // A POV that failed to load must not read as "referenced nowhere": that would write member_count 0 for every
  // policy it references. The type requires all four; these arms cover what slips past the type (casts, JSON).
  const throwsNaming = (files: unknown, pov: string) => {
    let thrown: unknown;
    try {
      recountPolicyMembers(registry(), files as PolicyPovFiles, ['pol-001']);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(ActionableError);
    expect((thrown as ActionableError).problem).toContain(pov);
  };

  it.each(POLICY_POV_FILES)('throws an ActionableError naming %s when it is missing', (pov) => {
    const files: Partial<PolicyPovFiles> = povs();
    delete files[pov];
    throwsNaming(files, pov);
  });

  it('throws when a file is present but null, or has no nodes array', () => {
    throwsNaming({ ...povs(), safetyist: null }, 'safetyist');
    throwsNaming({ ...povs(), situations: {} }, 'situations');
    throwsNaming({ ...povs(), skeptic: { nodes: 'x' } }, 'skeptic');
  });

  it('throws when a file has an EMPTY nodes array: no real POV is empty, and it would zero every count (SO e/274#2)', () => {
    throwsNaming({ ...povs(), accelerationist: { nodes: [] } }, 'accelerationist');
  });

  it('names every bad file at once, and the no-argument case', () => {
    throwsNaming({ skeptic: file(node('skp-1')) }, 'accelerationist, safetyist, situations');
    throwsNaming(undefined, 'accelerationist, safetyist, skeptic, situations');
  });

  it('a complete corpus with no references to the target is fine: zero is a real answer when every file loaded', () => {
    expect(byId(recountPolicyMembers(registry(), povs(), ['pol-001']).registry, 'pol-001').member_count).toBe(0);
  });
});
