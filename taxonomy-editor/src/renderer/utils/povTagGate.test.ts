import { describe, it, expect, vi } from 'vitest';
import type { PovNode } from '../types/taxonomy';
import { povTagMembership } from './povTagGate';

vi.mock('@lib/flight-recorder/index', () => ({
  getGlobalRecorder: () => ({ record: vi.fn() }),
}));

// t/3961: the editor edits tags, so membership blocks only tags ADDED since the baseline.
// The save-path wiring (baseline, WARN, notice) is covered in useTaxonomyStore.test.ts (t/3973, t/3984).
describe('povTagMembership: added-only (t/3961)', () => {
  const registry = { version: 1, povs: { accelerationist: [{ id: 'critical', label: 'Critical', soul_doc: 'accelerationist.critical', description: 'd' }] } };
  const before = { 'acc-beliefs-001': JSON.stringify(['critical', 'retired']) };
  const node = (pov_tags: string[]) => ({ id: 'acc-beliefs-001', pov_tags }) as unknown as PovNode;

  it('removing a valid tag from a node that keeps an orphan saves; the orphan is still reported', () => {
    const r = povTagMembership([node(['retired'])], before, registry);
    expect(r.errors).toEqual({});
    expect(r.orphanedNodeIds).toEqual(['acc-beliefs-001']);
  });

  it('reordering tags that include an orphan saves', () => {
    expect(povTagMembership([node(['retired', 'critical'])], before, registry).errors).toEqual({});
  });

  it('ADDING an unregistered tag next to a kept orphan blocks, naming only the added tag', () => {
    const r = povTagMembership([node(['critical', 'retired', 'made-up'])], before, registry);
    expect(r.errors['nodes.acc-beliefs-001.pov_tags']).toContain('"made-up"');
    expect(r.errors['nodes.acc-beliefs-001.pov_tags']).not.toContain('"retired"');
    expect(r.orphanedNodeIds).toEqual(['acc-beliefs-001']);
  });
});
