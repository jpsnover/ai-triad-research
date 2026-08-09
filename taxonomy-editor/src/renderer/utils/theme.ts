// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Shared theme resolution core (t/2338).
 *
 * Single source of truth for turning a selected `ColorScheme` into a
 * `data-theme` attribute on the document root. Both the main-window path
 * (`applyTheme` in settingsSlice.ts) and the popout path (`usePopoutTheme`)
 * call `applyThemeToRoot` so the resolution logic can never fork — a popout
 * must resolve bkc/harvard/system exactly like the main window.
 *
 * `applyThemeToRoot` deliberately does NOT persist to localStorage: only the
 * main window owns the stored theme; popouts are read-only followers.
 *
 * `ColorScheme` is imported type-only to avoid a runtime import cycle with
 * settingsSlice (which imports the runtime helpers from here).
 */

import { getGlobalRecorder } from '@lib/flight-recorder/index';
import type { ColorScheme } from '../hooks/useTaxonomyStore/slices/settingsSlice';

export const THEME_STORAGE_KEY = 'taxonomy-editor-theme';

const DEFAULT_THEME: ColorScheme = 'harvard';

/** Coerce an arbitrary string (e.g. a localStorage value) to a valid ColorScheme, or null. */
export function parseColorScheme(value: string | null | undefined): ColorScheme | null {
  if (value === 'light' || value === 'dark' || value === 'bkc' || value === 'harvard' || value === 'system') {
    return value;
  }
  return null;
}

/** Read the user's selected theme from localStorage, falling back to the app default. */
export function getStoredTheme(): ColorScheme {
  try {
    return parseColorScheme(localStorage.getItem(THEME_STORAGE_KEY)) ?? DEFAULT_THEME;
  } catch (err) {
    getGlobalRecorder()?.record({ type: 'system.error', component: 'theme', level: 'warn', message: 'Failed to read stored theme from localStorage', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
  }
  return DEFAULT_THEME;
}

/**
 * Resolve a ColorScheme and set `data-theme` on the document root.
 * `system` resolves to light/dark via `prefers-color-scheme`. Does NOT persist.
 */
export function applyThemeToRoot(scheme: ColorScheme): void {
  const root = document.documentElement;
  if (scheme === 'system') {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    root.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
  } else {
    root.setAttribute('data-theme', scheme);
  }
}
