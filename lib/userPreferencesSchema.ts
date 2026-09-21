// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Shared UserPreferences Zod schema (t/3534). Single source of truth for both
// read boundaries — ElectronMain's get-preferences IPC handler and ServerAPI's
// GET /api/preferences — so Electron and web can never silently diverge on the
// same preferences file (dual-build parity class, root AGENTS.md).
// bridge/types.ts re-exports UserPreferences/ViewMode from here; renderer call
// sites are unaffected (same names, same shape).

import { z } from 'zod';
import { getGlobalRecorder } from './flight-recorder/index.js';

export const ViewModeSchema = z.enum(['simple', 'advanced']);
export type ViewMode = z.infer<typeof ViewModeSchema>;

// `.passthrough()` = tolerant reader (SO e/183#2, condition (a); matches the lib/entities/* fwd-compat
// convention). This file is READ-MODIFY-WRITTEN by multiple independently-deployed consumers on a
// dual-build surface (ElectronMain IPC, ServerAPI GET/PUT). Default strict `z.object` STRIPS unknown
// keys, so an older build round-tripping a newer build's added field (e.g. a future `fontSize`) would
// SILENTLY DESTROY it — invalid to nobody, no WARN, invisible-degradation shaped. Passthrough keeps
// unknown keys intact across the parse so a version-skewed writer preserves fields it doesn't know.
// (If preferences ever become security-adjacent and unknown keys should be treated as corruption,
// this is the deliberate line to revisit.)
export const UserPreferencesSchema = z.object({ viewMode: ViewModeSchema }).passthrough();
export type UserPreferences = z.infer<typeof UserPreferencesSchema>;

export const DEFAULT_USER_PREFERENCES: UserPreferences = { viewMode: 'simple' };

/**
 * Validate parsed-but-untrusted preferences JSON. Never throws — a corrupt/
 * hand-edited/stale-schema file must degrade to defaults, not crash the read
 * (root AGENTS.md fallback-path-logging rule: every fallback logs WHY).
 * `component` distinguishes the caller (e.g. 'prefsHandlers' vs 'server') in
 * the flight-recorder record.
 *
 * Contract: pass the parsed contents of an EXISTING file. Missing-file ("no
 * file yet") is a DIFFERENT case owned by the caller (return null / defaults
 * without a WARN) — do NOT feed `undefined` here or it becomes a spurious
 * "invalid file" WARN. Fallback is all-or-nothing today (one bad field → whole
 * object defaults), correct at one field; if the schema grows past ~3 fields,
 * switch to per-field `.catch(DEFAULT.<field>)` so one corrupt value doesn't
 * reset every preference (users experience a full reset as "the app forgot my
 * settings").
 */
export function validateUserPreferencesOrDefault(raw: unknown, component: string): UserPreferences {
  const result = UserPreferencesSchema.safeParse(raw);
  if (result.success) return result.data;
  const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
  getGlobalRecorder()?.record({
    type: 'system.error', component, level: 'warn',
    message: `Invalid preferences file — falling back to defaults: ${issues}`,
  });
  return DEFAULT_USER_PREFERENCES;
}
