// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Shared theme utilities for main-window and popout paths (t/2338).
// Centralized here so both callers resolve 'system' identically and
// read/write the same localStorage key — no forking.

export const THEME_STORAGE_KEY = 'taxonomy-editor-theme';

const DEFAULT_THEME = 'harvard';

/** Resolve 'system' to an actual data-theme value; pass named schemes through. */
function resolveScheme(scheme: string): string {
  if (scheme === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return scheme;
}

/** Set data-theme on <html>. Resolves 'system' via media query. */
export function applyThemeToRoot(scheme: string): void {
  document.documentElement.setAttribute('data-theme', resolveScheme(scheme));
}

/** Read the persisted theme from localStorage; defaults to 'harvard'. */
export function getStoredTheme(): string {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored) return stored;
  } catch {
    // localStorage unavailable
  }
  return DEFAULT_THEME;
}
