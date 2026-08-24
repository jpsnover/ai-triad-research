// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// T4 Render — deck theme (colors / fonts / logo), kept SEPARATE from the
// JSON→slide logic (TL build condition 2). Camp colors are fixed constants
// shared across every brief (spec §2.3).

/** Camp id → hex color. Fixed constants; the four taxonomy camps + neutral. */
export const CAMP_COLORS: Record<string, string> = {
  acc: '2E7D32', // Accelerationist — green
  saf: '1565C0', // Safetyist — blue
  skp: '6A1B9A', // Skeptic — purple
  cc:  '424242', // Common Concerns / cross-camp — neutral grey
};

/** Fallback color for a camp id not in the fixed map. */
export const CAMP_COLOR_FALLBACK = '37474F';

export function campColor(camp: string): string {
  return CAMP_COLORS[camp] ?? CAMP_COLOR_FALLBACK;
}

export interface DeckTheme {
  name: string;
  colors: {
    background: string;
    text: string;
    subtle: string;
    accent: string;
    /** Verdict badge colors keyed by FactCheckVerdict. */
    verdict: { Supported: string; Disputed: string; Unverifiable: string };
  };
  fonts: { heading: string; body: string };
  /** Optional data-URI logo (embedded, never a network reference). */
  logoDataUri?: string;
}

/** The built-in AITriad house style — used whenever no template is honored. */
export const HOUSE_THEME: DeckTheme = {
  name: 'AITriad House',
  colors: {
    background: 'FFFFFF',
    text: '1A1A1A',
    subtle: '5F6B7A',
    accent: '1565C0',
    verdict: { Supported: '2E7D32', Disputed: 'C62828', Unverifiable: 'F9A825' },
  },
  fonts: { heading: 'Georgia', body: 'Calibri' },
};

/**
 * Resolve the theme for a render. When `.potx` bytes are supplied the template's
 * theme colors and fonts are extracted and applied (v2, t/2820); slide-master
 * honoring is handled as a post-process step in render() via mergePotxMasters().
 * Falls back to HOUSE_THEME with a `template_parse_error` warning if the bytes
 * cannot be read as a valid .potx zip (silent-degradation rule, TL e/113#2 §2a).
 */
export async function resolveTheme(
  template?: Uint8Array,
): Promise<{ theme: DeckTheme; warning?: string }> {
  if (!template) return { theme: HOUSE_THEME };

  try {
    const { extractPotxTheme } = await import('./potxHonor.js');
    const theme = await extractPotxTheme(template);
    return { theme };
  } catch {
    return {
      theme: HOUSE_THEME,
      warning:
        'template_parse_error: the supplied .potx could not be read as a valid ' +
        'Office Open XML zip — house style applied, slide masters not merged.',
    };
  }
}
