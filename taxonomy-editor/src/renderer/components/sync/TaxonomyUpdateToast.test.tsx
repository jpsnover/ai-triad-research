// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import type { TaxonomyUpdatedEvent } from './TaxonomyUpdateToast';

// Flight recorder is a no-op in tests.
vi.mock('@lib/flight-recorder/index', () => ({
  getGlobalRecorder: () => null,
}));

// Controllable bridge mock — `emit` pushes an event to the subscribed callback.
let subscriber: ((evt: TaxonomyUpdatedEvent) => void) | null = null;
let hasMethod = true;
const unsub = vi.fn();
vi.mock('@bridge', () => ({
  api: {
    get onTaxonomyUpdated() {
      if (!hasMethod) return undefined;
      return (cb: (evt: TaxonomyUpdatedEvent) => void) => {
        subscriber = cb;
        return unsub;
      };
    },
  },
}));

function emit(evt: TaxonomyUpdatedEvent) {
  act(() => { subscriber?.(evt); });
}

// Import after mocks are registered.
const { TaxonomyUpdateToast } = await import('./TaxonomyUpdateToast');

describe('TaxonomyUpdateToast', () => {
  beforeEach(() => {
    subscriber = null;
    hasMethod = true;
    unsub.mockClear();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders nothing until an event arrives', () => {
    const { container } = render(<TaxonomyUpdateToast />);
    expect(container.firstChild).toBeNull();
  });

  it('shows a toast describing who changed what', () => {
    render(<TaxonomyUpdateToast />);
    emit({ user: 'Alice', nodeCount: 3, povs: ['accelerationist', 'safetyist'] });
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText(/updated 3 nodes in Accelerationist, Safetyist/)).toBeInTheDocument();
  });

  it('singularizes a one-node change', () => {
    render(<TaxonomyUpdateToast />);
    emit({ user: 'Bob', nodeCount: 1, povs: ['skeptic'] });
    expect(screen.getByText(/updated 1 node in Skeptic/)).toBeInTheDocument();
  });

  it('auto-dismisses after the TTL', () => {
    render(<TaxonomyUpdateToast />);
    emit({ user: 'Alice', nodeCount: 2, povs: ['accelerationist'] });
    expect(screen.getByText('Alice')).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(8000); });
    expect(screen.queryByText('Alice')).toBeNull();
  });

  it('renders nothing (and never subscribes) when the bridge lacks the method — Electron/older bridge', () => {
    hasMethod = false;
    const { container } = render(<TaxonomyUpdateToast />);
    expect(container.firstChild).toBeNull();
    expect(subscriber).toBeNull();
  });

  it('unsubscribes on unmount', () => {
    const { unmount } = render(<TaxonomyUpdateToast />);
    emit({ user: 'Alice', nodeCount: 1, povs: [] });
    unmount();
    expect(unsub).toHaveBeenCalled();
  });
});
