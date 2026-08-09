// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * usePopoutTheme (t/2338) — shared theme hook for all popout windows.
 *
 * Popout BrowserWindows don't mount MainApp, so nothing sets their `data-theme`.
 * Historically each popout read OS `prefers-color-scheme` once at mount, so it
 * ignored the user's selected ColorScheme (bkc/harvard were impossible) and never
 * live-updated. This hook fixes both, sharing one resolver with the main window
 * (utils/theme.ts) so the two paths can't drift.
 *
 * Behavior:
 *  - Mount: apply the selected theme from localStorage (the source of truth) —
 *    unconditionally, so any stale/OS default gets corrected.
 *  - Live update: a same-origin `storage` event fires in *other* windows when the
 *    main window's applyTheme persists, so the popout follows theme changes with
 *    no IPC. Also follows OS light/dark flips while the selected scheme is `system`.
 *  - Cleans up both listeners on unmount.
 *
 * Drop-in for the 4 popout entry points: call `usePopoutTheme()` once at the top
 * of the window component; no args, no return.
 */

import { useEffect } from 'react';
import { applyThemeToRoot, getStoredTheme, parseColorScheme, THEME_STORAGE_KEY } from '../utils/theme';

export function usePopoutTheme(): void {
  useEffect(() => {
    // Mount: localStorage is the source of truth (not OS prefers-color-scheme).
    applyThemeToRoot(getStoredTheme());

    // Live update: the main window's applyTheme localStorage write fires `storage`
    // in this (other) same-origin window.
    const onStorage = (e: StorageEvent) => {
      if (e.key !== THEME_STORAGE_KEY) return;
      // newValue is null on removeItem/clear — fall back to the stored default.
      const scheme = parseColorScheme(e.newValue) ?? getStoredTheme();
      applyThemeToRoot(scheme);
    };
    window.addEventListener('storage', onStorage);

    // Live update for OS-level light/dark flips, but only while `system` is selected.
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onMediaChange = () => {
      if (getStoredTheme() === 'system') applyThemeToRoot('system');
    };
    media.addEventListener('change', onMediaChange);

    return () => {
      window.removeEventListener('storage', onStorage);
      media.removeEventListener('change', onMediaChange);
    };
  }, []);
}
