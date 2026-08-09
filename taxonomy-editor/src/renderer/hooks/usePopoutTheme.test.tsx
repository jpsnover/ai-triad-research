// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { act } from 'react';
import { usePopoutTheme } from './usePopoutTheme';
import { THEME_STORAGE_KEY } from '../utils/theme';

// Controllable matchMedia: tests flip `prefersDark` and fire captured change listeners.
let prefersDark = false;
let mediaListeners: Array<() => void> = [];

function installMatchMedia() {
  prefersDark = false;
  mediaListeners = [];
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      get matches() { return prefersDark; },
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: (_: string, cb: () => void) => { mediaListeners.push(cb); },
      removeEventListener: (_: string, cb: () => void) => {
        mediaListeners = mediaListeners.filter((l) => l !== cb);
      },
      dispatchEvent: vi.fn(),
    })),
  });
}

function fireOsFlip(dark: boolean) {
  prefersDark = dark;
  act(() => { mediaListeners.forEach((l) => l()); });
}

/** Simulate the main window persisting a theme, which fires `storage` in this window. */
function fireStorage(newValue: string | null) {
  act(() => {
    window.dispatchEvent(new StorageEvent('storage', { key: THEME_STORAGE_KEY, newValue }));
  });
}

const theme = () => document.documentElement.getAttribute('data-theme');

describe('usePopoutTheme', () => {
  beforeEach(() => {
    installMatchMedia();
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  afterEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  describe('mount-apply reads localStorage, not OS', () => {
    it.each(['light', 'dark', 'bkc', 'harvard'] as const)(
      'applies the selected %s theme on mount',
      (scheme) => {
        localStorage.setItem(THEME_STORAGE_KEY, scheme);
        renderHook(() => usePopoutTheme());
        expect(theme()).toBe(scheme);
      },
    );

    it('defaults to harvard when nothing is stored (not OS light/dark)', () => {
      prefersDark = true; // OS says dark; selected theme must still win
      renderHook(() => usePopoutTheme());
      expect(theme()).toBe('harvard');
    });

    it('resolves system → dark/light via prefers-color-scheme', () => {
      localStorage.setItem(THEME_STORAGE_KEY, 'system');
      prefersDark = true;
      renderHook(() => usePopoutTheme());
      expect(theme()).toBe('dark');
    });

    it('overrides a stale data-theme already on the root', () => {
      document.documentElement.setAttribute('data-theme', 'light');
      localStorage.setItem(THEME_STORAGE_KEY, 'bkc');
      renderHook(() => usePopoutTheme());
      expect(theme()).toBe('bkc');
    });
  });

  describe('live-update via storage event (the cross-window transport)', () => {
    it('follows a main-window switch to a non-OS scheme (bkc)', () => {
      localStorage.setItem(THEME_STORAGE_KEY, 'light');
      renderHook(() => usePopoutTheme());
      expect(theme()).toBe('light');

      localStorage.setItem(THEME_STORAGE_KEY, 'bkc');
      fireStorage('bkc');
      expect(theme()).toBe('bkc');
    });

    it('follows a switch to harvard', () => {
      renderHook(() => usePopoutTheme());
      fireStorage('harvard');
      expect(theme()).toBe('harvard');
    });

    it('falls back to stored default when newValue is null (removeItem/clear)', () => {
      localStorage.setItem(THEME_STORAGE_KEY, 'dark');
      renderHook(() => usePopoutTheme());
      // localStorage still resolves to dark; a null newValue must not blank the theme.
      fireStorage(null);
      expect(theme()).toBe('dark');
    });

    it('ignores storage events for unrelated keys', () => {
      localStorage.setItem(THEME_STORAGE_KEY, 'bkc');
      renderHook(() => usePopoutTheme());
      act(() => {
        window.dispatchEvent(new StorageEvent('storage', { key: 'some-other-key', newValue: 'light' }));
      });
      expect(theme()).toBe('bkc');
    });
  });

  describe('live-update on OS flip while system is selected', () => {
    it('re-resolves when the OS toggles dark and scheme is system', () => {
      localStorage.setItem(THEME_STORAGE_KEY, 'system');
      renderHook(() => usePopoutTheme());
      expect(theme()).toBe('light');
      fireOsFlip(true);
      expect(theme()).toBe('dark');
    });

    it('ignores OS flips when a fixed scheme is selected', () => {
      localStorage.setItem(THEME_STORAGE_KEY, 'bkc');
      renderHook(() => usePopoutTheme());
      fireOsFlip(true);
      expect(theme()).toBe('bkc');
    });
  });

  describe('cleanup', () => {
    it('removes both listeners on unmount', () => {
      localStorage.setItem(THEME_STORAGE_KEY, 'light');
      const { unmount } = renderHook(() => usePopoutTheme());
      unmount();

      // After unmount, neither transport should mutate the root.
      localStorage.setItem(THEME_STORAGE_KEY, 'bkc');
      fireStorage('bkc');
      expect(theme()).toBe('light');

      localStorage.setItem(THEME_STORAGE_KEY, 'system');
      fireOsFlip(true);
      expect(theme()).toBe('light');
    });
  });
});
