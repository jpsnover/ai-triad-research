// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/1987 — one app-level host for the shared ref → DetailPane contract. These tests
// lock the store-fed mount: the pane renders iff the GLOBAL `selectedRef` is set, it
// forwards that ref to the shared DetailPane, and its close control clears the
// selection through `setSelectedRef`.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import type { EntityRef } from '@lib/entities/types';
import { GlobalDetailPaneHost } from './GlobalDetailPaneHost';

const mockDebateStore: Record<string, any> = {
  selectedRef: null as EntityRef | null,
  setSelectedRef: vi.fn((ref: EntityRef | null) => { mockDebateStore.selectedRef = ref; }),
};
vi.mock('../../hooks/useDebateStore', () => ({
  useDebateStore: Object.assign(
    (selector?: any) => (selector ? selector(mockDebateStore) : mockDebateStore),
    { getState: () => mockDebateStore, setState: (p: Record<string, any>) => Object.assign(mockDebateStore, p) },
  ),
}));

// Mock the shared pane to a marker: these tests assert the HOST wiring, not the
// pane's internal ref-resolution (covered by DetailPane.test.tsx).
vi.mock('./DetailPane', () => ({
  DetailPane: ({ selectedRef, className, onClose }: { selectedRef: EntityRef; className?: string; onClose?: () => void }) => (
    <div data-testid="detail-pane" data-classname={className}>
      <span data-testid="pane-ref-id">{selectedRef.id}</span>
      <button onClick={onClose}>close-pane</button>
    </div>
  ),
}));

const REF: EntityRef = { kind: 'node', id: 'acc-beliefs-001' };

describe('GlobalDetailPaneHost (t/1987)', () => {
  beforeEach(() => {
    cleanup();
    mockDebateStore.selectedRef = null;
    mockDebateStore.setSelectedRef.mockClear();
  });

  it('renders nothing when no ref is selected', () => {
    const { container } = render(<GlobalDetailPaneHost />);
    expect(screen.queryByTestId('detail-pane')).toBeNull();
    expect(container.firstChild).toBeNull();
  });

  it('mounts the shared DetailPane with the global selected ref', () => {
    mockDebateStore.selectedRef = REF;
    render(<GlobalDetailPaneHost />);
    expect(screen.getByTestId('detail-pane')).toBeTruthy();
    expect(screen.getByTestId('pane-ref-id').textContent).toBe('acc-beliefs-001');
    // Uses the app-level sizing class, not a per-tab one.
    expect(screen.getByTestId('detail-pane').getAttribute('data-classname')).toBe('app-detail-pane');
  });

  it('clears the selection through setSelectedRef when the pane is closed', () => {
    mockDebateStore.selectedRef = REF;
    render(<GlobalDetailPaneHost />);
    fireEvent.click(screen.getByText('close-pane'));
    expect(mockDebateStore.setSelectedRef).toHaveBeenCalledWith(null);
  });
});
