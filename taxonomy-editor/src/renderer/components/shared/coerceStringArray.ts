// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Coerce a polymorphic real-world entity field into a `string[]`.
 *
 * Two `Entity` fields typed `string[]` are polymorphic in the stored data (Design field
 * audit, t/1882#7 / t/1884#4): `aliases` is array(24) | null(32) | bare-string(22, e.g.
 * "GDPR"), and `source_refs` is array(67) | bare-string(11). A `?? []` guard only fixes
 * null; a bare string still throws on `.some`/`.map`/`.join`, and `field[0]` on a string
 * yields its first CHARACTER. This normalizes all shapes. (Design confirmed these two are
 * the ONLY varying UI-rendered fields.) The load-bearing fix is server-side normalization
 * at the endpoint (t/1964); this is renderer defense-in-depth — don't assume array.
 */
export function coerceStringArray(value: string[] | string | null | undefined): string[] {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  return [value]; // a bare string is one element, not an array of characters
}
