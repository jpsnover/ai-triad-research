import { describe, it, expect } from 'vitest';
import { computeNodeConflicts, type TaxNode } from '../community/nodeConflicts';

// Minimal node factory — `id` plus arbitrary content fields.
function node(id: string, fields: Record<string, unknown> = {}): TaxNode {
  return { id, ...fields };
}

describe('computeNodeConflicts (both-edited detection)', () => {
  it('returns a conflict only when the same node changed on both sides', () => {
    const base = [node('acc-b-001', { label: 'A', summary: 's0' }), node('acc-b-002', { label: 'B' })];
    // Session branch edits 001.summary and 002.label.
    const branch = [node('acc-b-001', { label: 'A', summary: 's-mine' }), node('acc-b-002', { label: 'B-mine' })];
    // Main edits only 001.label.
    const main = [node('acc-b-001', { label: 'A-theirs', summary: 's0' }), node('acc-b-002', { label: 'B' })];

    const conflicts = computeNodeConflicts(base, main, branch, 'accelerationist');
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({
      id: 'acc-b-001',
      pov: 'accelerationist',
      yourFields: ['summary'],
      theirFields: ['label'],
    });
  });

  it('reports overlapping fields on both sides when the same field collides', () => {
    const base = [node('saf-d-001', { label: 'X', priority: 1 })];
    const branch = [node('saf-d-001', { label: 'X-mine', priority: 1 })];
    const main = [node('saf-d-001', { label: 'X-theirs', priority: 2 })];

    const [c] = computeNodeConflicts(base, main, branch, 'safetyist');
    expect(c.yourFields).toEqual(['label']);
    expect(c.theirFields).toEqual(['label', 'priority']);
  });

  it('returns nothing when only one side changed a node', () => {
    const base = [node('acc-b-001', { label: 'A' })];
    const branch = [node('acc-b-001', { label: 'A-mine' })];
    const main = [node('acc-b-001', { label: 'A' })]; // main unchanged
    expect(computeNodeConflicts(base, main, branch, 'accelerationist')).toEqual([]);
  });

  it('returns nothing when both sides changed but different nodes', () => {
    const base = [node('n1', { v: 0 }), node('n2', { v: 0 })];
    const branch = [node('n1', { v: 1 }), node('n2', { v: 0 })];
    const main = [node('n1', { v: 0 }), node('n2', { v: 2 })];
    expect(computeNodeConflicts(base, main, branch, 'skeptic')).toEqual([]);
  });

  it('surfaces the main-side editor identity/time from _edit_meta', () => {
    const base = [node('cc-001', { label: 'L' })];
    const branch = [node('cc-001', { label: 'mine' })];
    const main = [node('cc-001', {
      label: 'theirs',
      _edit_meta: { last_edited_by: 'jpsnover', last_edited_at: '2026-06-10T12:00:00.000Z' },
    })];

    const [c] = computeNodeConflicts(base, main, branch, 'cross-cutting');
    expect(c.theirUser).toBe('jpsnover');
    expect(c.theirEditedAt).toBe('2026-06-10T12:00:00.000Z');
    // _edit_meta is excluded from field diffs (HASH_EXCLUDE) — only content fields show.
    expect(c.yourFields).toEqual(['label']);
    expect(c.theirFields).toEqual(['label']);
  });

  it('treats an add-vs-add of the same id as a conflict (no base node)', () => {
    const base: TaxNode[] = [];
    const branch = [node('new-1', { label: 'mine' })];
    const main = [node('new-1', { label: 'theirs', extra: true })];

    const [c] = computeNodeConflicts(base, main, branch, 'accelerationist');
    expect(c.id).toBe('new-1');
    expect(c.yourFields).toContain('label');
    expect(c.theirFields).toEqual(expect.arrayContaining(['label', 'extra']));
  });

  it('treats delete-on-one-side / edit-on-other as a conflict with empty fields for the delete', () => {
    const base = [node('d-1', { label: 'L' })];
    const branch: TaxNode[] = []; // deleted on session branch
    const main = [node('d-1', { label: 'theirs' })]; // edited on main

    const [c] = computeNodeConflicts(base, main, branch, 'safetyist');
    expect(c.id).toBe('d-1');
    expect(c.yourFields).toEqual([]);       // deletion has no field-level change
    expect(c.theirFields).toEqual(['label']);
  });

  it('returns empty for identical inputs', () => {
    const base = [node('a', { x: 1 })];
    expect(computeNodeConflicts(base, base, base, 'situations')).toEqual([]);
  });
});
