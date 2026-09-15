// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Tests for the deep-link boot/popstate hook (t/3486). Locks: restore runs once at
// mount, runs again on popstate, and the whole thing no-ops in Electron (no address
// bar there for a restore to make sense against).

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';

const mockIsElectronMode = vi.fn(() => false);
vi.mock('@bridge', () => ({ isElectronMode: () => mockIsElectronMode() }));

const mockRestore = vi.fn();
vi.mock('./appRoutes', () => ({
  findRoute: (pathname: string) => (pathname === '/opeds/set-1' ? { route: { restore: mockRestore }, params: { setId: 'set-1' } } : null),
}));

const { useAppRoute } = await import('./useAppRoute');

function goTo(pathname: string, search = ''): void {
  window.history.pushState({}, '', pathname + search);
}

describe('useAppRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsElectronMode.mockReturnValue(false);
  });
  afterEach(() => { goTo('/'); });

  it('restores from the current location once at mount', () => {
    goTo('/opeds/set-1', '?pov=acc');
    renderHook(() => useAppRoute());
    expect(mockRestore).toHaveBeenCalledTimes(1);
    const [params, query] = mockRestore.mock.calls[0];
    expect(params).toEqual({ setId: 'set-1' });
    expect(query.get('pov')).toBe('acc');
  });

  it('does nothing at mount when the path matches no route', () => {
    goTo('/');
    renderHook(() => useAppRoute());
    expect(mockRestore).not.toHaveBeenCalled();
  });

  it('re-restores on popstate (back/forward)', () => {
    goTo('/');
    renderHook(() => useAppRoute());
    expect(mockRestore).not.toHaveBeenCalled();

    goTo('/opeds/set-1');
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(mockRestore).toHaveBeenCalledTimes(1);
  });

  it('no-ops entirely in Electron — no address bar for a restore to react to', () => {
    mockIsElectronMode.mockReturnValue(true);
    goTo('/opeds/set-1');
    renderHook(() => useAppRoute());
    expect(mockRestore).not.toHaveBeenCalled();
  });
});
