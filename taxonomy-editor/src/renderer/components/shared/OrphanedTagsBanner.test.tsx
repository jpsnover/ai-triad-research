// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/3984 — the orphaned-POV-tags notice renders iff the last successful save carried untouched nodes with
// tags no longer in the registry, names them, and its dismiss clears them. (Store-side population is
// covered in useTaxonomyStore.test.ts "pov_tags save gate".)

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { OrphanedTagsBanner } from './OrphanedTagsBanner';

const mockState: { orphanedTagNodeIds: string[]; dismissOrphanedTagNotice: () => void } = {
  orphanedTagNodeIds: [],
  dismissOrphanedTagNotice: vi.fn(),
};
vi.mock('../../hooks/useTaxonomyStore', () => ({
  useTaxonomyStore: (selector: (s: typeof mockState) => unknown) => selector(mockState),
}));

describe('OrphanedTagsBanner (t/3984)', () => {
  beforeEach(() => {
    cleanup();
    mockState.orphanedTagNodeIds = [];
    (mockState.dismissOrphanedTagNotice as ReturnType<typeof vi.fn>).mockClear();
  });

  it('renders nothing when the last save carried no orphaned tags', () => {
    const { container } = render(<OrphanedTagsBanner />);
    expect(container.firstChild).toBeNull();
  });

  it('names the node (singular) when one node carries orphaned tags', () => {
    mockState.orphanedTagNodeIds = ['acc-beliefs-001'];
    render(<OrphanedTagsBanner />);
    const text = screen.getByRole('status').textContent ?? '';
    expect(text).toContain('1 node carries POV tags no longer in the registry (acc-beliefs-001)');
  });

  it('names the first three and counts the rest', () => {
    mockState.orphanedTagNodeIds = ['acc-beliefs-001', 'acc-beliefs-002', 'saf-desires-003', 'skp-beliefs-004', 'skp-beliefs-005'];
    render(<OrphanedTagsBanner />);
    expect(screen.getByRole('status').textContent).toContain('5 nodes carry POV tags no longer in the registry (acc-beliefs-001, acc-beliefs-002, saf-desires-003, +2 more)');
  });

  it('dismiss clears the notice', () => {
    mockState.orphanedTagNodeIds = ['acc-beliefs-001'];
    render(<OrphanedTagsBanner />);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss orphaned-tags notice' }));
    expect(mockState.dismissOrphanedTagNotice).toHaveBeenCalledTimes(1);
  });
});
