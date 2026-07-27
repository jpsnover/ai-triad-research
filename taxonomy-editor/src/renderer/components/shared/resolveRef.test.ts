// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetEntity = vi.fn();
let mockState: any;

vi.mock('@bridge', () => ({ api: { getEntity: (ref: string) => mockGetEntity(ref) } }));
vi.mock('../../hooks/useTaxonomyStore', () => ({
  useTaxonomyStore: { getState: () => mockState },
}));

import { resolveRef } from './resolveRef';

beforeEach(() => {
  mockGetEntity.mockReset();
  mockState = {
    accelerationist: { nodes: [{ id: 'acc-desires-001', label: 'Accelerate' }] },
    safetyist: { nodes: [] },
    skeptic: { nodes: [] },
    situations: { nodes: [{ id: 'sit-003', label: 'A situation' }] },
    policyRegistry: [{ id: 'pol-010', action: 'Pause training', source_povs: ['saf'], member_count: 3 }],
  };
});

describe('resolveRef — client-side kinds (no bridge round-trip)', () => {
  it('resolves a node from the taxonomy store', async () => {
    const detail = await resolveRef({ kind: 'node', id: 'acc-desires-001' });
    expect(detail).toEqual({
      kind: 'node',
      ref: { kind: 'node', id: 'acc-desires-001' },
      record: { id: 'acc-desires-001', label: 'Accelerate' },
    });
    expect(mockGetEntity).not.toHaveBeenCalled();
  });

  it('resolves a situation from the situations file', async () => {
    const detail = await resolveRef({ kind: 'situation', id: 'sit-003' });
    expect(detail.kind).toBe('situation');
    expect(mockGetEntity).not.toHaveBeenCalled();
  });

  it('resolves a policy from the registry (registry entry satisfies PolicyAction)', async () => {
    const detail = await resolveRef({ kind: 'policy', id: 'pol-010' });
    expect(detail.kind).toBe('policy');
    if (detail.kind === 'policy') expect(detail.record.action).toBe('Pause training');
    expect(mockGetEntity).not.toHaveBeenCalled();
  });

  it('returns not_found (carrying the ref) for an id absent from the store', async () => {
    const detail = await resolveRef({ kind: 'node', id: 'acc-desires-999' });
    expect(detail).toEqual({ kind: 'not_found', ref: { kind: 'node', id: 'acc-desires-999' } });
    expect(mockGetEntity).not.toHaveBeenCalled();
  });
});

describe('resolveRef — server-only kinds (via getEntity bridge)', () => {
  it.each([
    ['organization', 'org-001'],
    ['entity', 'ent-001'],
    ['term', 'term:agi'],
  ] as const)('delegates %s to the getEntity bridge with the raw token', async (kind, id) => {
    mockGetEntity.mockResolvedValue({ kind, ref: { kind, id }, record: {} });
    const detail = await resolveRef({ kind, id } as any);
    expect(mockGetEntity).toHaveBeenCalledWith(id);
    expect(detail.kind).toBe(kind);
  });
});
