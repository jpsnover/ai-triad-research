// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Apply and live-update theme in popout windows (t/2338).
// Popouts don't go through MainApp (which sets data-theme reactively),
// so they read the stored theme on mount and listen for storage events
// from the main window so a theme change is reflected immediately.

import { useEffect } from 'react';
import { applyThemeToRoot, getStoredTheme, THEME_STORAGE_KEY } from '../utils/theme';

export function usePopoutTheme(): void {
  useEffect(() => {
    // Apply immediately on mount
    applyThemeToRoot(getStoredTheme());

    // Live-update when the main window changes the theme
    const handler = (e: StorageEvent) => {
      if (e.key === THEME_STORAGE_KEY && e.newValue) {
        applyThemeToRoot(e.newValue);
      }
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, []);
}
