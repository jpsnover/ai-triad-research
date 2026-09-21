// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// @vitest-environment node
// t/3535 — both-arms proof for the shared UserPreferences validator (TL design t/3534#2):
// a valid payload round-trips unchanged; any invalid payload returns DEFAULT_USER_PREFERENCES
// AND records exactly one flight-recorder WARN naming the offending field. The fallback path
// MUST be logged (root AGENTS.md fallback-path-logging) — a silent degrade to defaults is the
// invisible-degradation class this schema exists to close.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { FlightRecorder, RecordInput } from './flight-recorder/index.js';
import { setGlobalRecorder, clearGlobalRecorder } from './flight-recorder/index.js';
import {
  UserPreferencesSchema,
  DEFAULT_USER_PREFERENCES,
  validateUserPreferencesOrDefault,
  type UserPreferences,
} from './userPreferencesSchema.js';

// Minimal fake recorder: capture record() calls without a real ring buffer.
const record = vi.fn<(e: RecordInput) => void>();
const fakeRecorder = { record } as unknown as FlightRecorder;

beforeEach(() => { record.mockClear(); setGlobalRecorder(fakeRecorder); });
afterEach(() => { clearGlobalRecorder(); });

describe('validateUserPreferencesOrDefault — valid arm', () => {
  it('round-trips a valid payload unchanged and records nothing', () => {
    const out = validateUserPreferencesOrDefault({ viewMode: 'advanced' }, 'test');
    expect(out).toEqual({ viewMode: 'advanced' });
    expect(record).not.toHaveBeenCalled();
  });

  it('accepts the default shape too', () => {
    expect(validateUserPreferencesOrDefault({ viewMode: 'simple' }, 'test')).toEqual({ viewMode: 'simple' });
    expect(record).not.toHaveBeenCalled();
  });

  it('PRESERVES unknown keys (tolerant reader — SO e/183#2): a version-skew field is not stripped', () => {
    // The hazard the condition closes: an older build read-modify-writing a newer build's field must
    // NOT destroy it. `.passthrough()` keeps `fontSize` intact through the parse; strict-strip would drop it.
    const out = validateUserPreferencesOrDefault({ viewMode: 'advanced', fontSize: 14 }, 'test');
    expect(out).toEqual({ viewMode: 'advanced', fontSize: 14 });
    expect(record).not.toHaveBeenCalled();
  });
});

describe('validateUserPreferencesOrDefault — invalid arm → defaults + exactly one WARN', () => {
  // Common assertions for every invalid input: defaults returned, exactly one system.error WARN,
  // caller label threaded, and the "falling back" reason logged (fallback-path-logging rule).
  const expectDefaultedWithWarn = (raw: unknown): { message?: string } => {
    const out = validateUserPreferencesOrDefault(raw, 'prefsHandlers');
    expect(out).toEqual(DEFAULT_USER_PREFERENCES);
    expect(out).toEqual({ viewMode: 'simple' });
    expect(record).toHaveBeenCalledTimes(1);
    const ev = record.mock.calls[0][0];
    expect(ev.type).toBe('system.error');
    expect(ev.level).toBe('warn');
    expect(ev.component).toBe('prefsHandlers');
    expect(ev.message).toContain('falling back to defaults');
    return ev;
  };

  // Object-shaped but the field is wrong → the offending PATH is `viewMode`.
  const fieldInvalidCases: [string, unknown][] = [
    ['wrong enum value', { viewMode: 'expert' }],
    ['missing field', {}],
    ['non-string field', { viewMode: 123 }],
  ];
  for (const [label, raw] of fieldInvalidCases) {
    it(`${label} → defaults + WARN naming the viewMode field`, () => {
      const ev = expectDefaultedWithWarn(raw);
      expect(ev.message).toContain('viewMode'); // offending path surfaced from error.issues
    });
  }

  // Not even an object → the offending thing is the root shape; the WARN names the type mismatch.
  const shapeInvalidCases: [string, unknown][] = [
    ['null', null],
    ['number', 42],
    ['string', 'simple'], // a bare string is not the object shape
  ];
  for (const [label, raw] of shapeInvalidCases) {
    it(`${label} → defaults + WARN naming the shape mismatch`, () => {
      const ev = expectDefaultedWithWarn(raw);
      expect(ev.message).toContain('expected object'); // root-level Zod reason
    });
  }

  it('returns a fresh copy — never leaks a mutable shared default', () => {
    // Callers must not be able to mutate DEFAULT_USER_PREFERENCES through the return value.
    const out = validateUserPreferencesOrDefault({}, 'test');
    expect(out).toEqual(DEFAULT_USER_PREFERENCES);
  });
});

describe('validateUserPreferencesOrDefault — no recorder wired (never throws)', () => {
  it('degrades to defaults without throwing when there is no global recorder', () => {
    clearGlobalRecorder();
    expect(() => validateUserPreferencesOrDefault({ viewMode: 'nope' }, 'test')).not.toThrow();
    expect(validateUserPreferencesOrDefault({ viewMode: 'nope' }, 'test')).toEqual(DEFAULT_USER_PREFERENCES);
  });
});

describe('schema/type exports', () => {
  it('UserPreferencesSchema parses the closed enum set and rejects others', () => {
    expect(UserPreferencesSchema.safeParse({ viewMode: 'simple' }).success).toBe(true);
    expect(UserPreferencesSchema.safeParse({ viewMode: 'advanced' }).success).toBe(true);
    expect(UserPreferencesSchema.safeParse({ viewMode: 'other' }).success).toBe(false);
  });

  it('DEFAULT_USER_PREFERENCES satisfies the schema (guards against a default drifting invalid)', () => {
    expect(UserPreferencesSchema.safeParse(DEFAULT_USER_PREFERENCES).success).toBe(true);
    // Type-level: DEFAULT is assignable to the inferred type.
    const typed: UserPreferences = DEFAULT_USER_PREFERENCES;
    expect(typed.viewMode).toBe('simple');
  });
});
