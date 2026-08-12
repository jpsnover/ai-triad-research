// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Regression tests for H2 path-traversal fix in MCP load_debate (t/2528).
// Tests the shared assertSafeId + assertContainedIn helpers wired into loadDebateSession.

import { describe, it, expect } from 'vitest';
import path from 'path';
import { assertSafeId, assertContainedIn } from '../electron-shared/safeId.js';

const BASE = path.resolve('/data/debates');

describe('load_debate path-traversal guard (H2 regression — t/2528)', () => {
  describe('assertSafeId — id format gate', () => {
    it('accepts a normal debate id', () => {
      expect(() => assertSafeId('a1b2c3d4', 'debate id')).not.toThrow();
      expect(() => assertSafeId('debate-2026-abcd', 'debate id')).not.toThrow();
      expect(() => assertSafeId('abc_123', 'debate id')).not.toThrow();
    });

    it('rejects ../../../ai-models (the H2 attack vector)', () => {
      expect(() => assertSafeId('../../../ai-models', 'debate id')).toThrow();
    });

    it('rejects ids with forward slashes', () => {
      expect(() => assertSafeId('debates/config', 'debate id')).toThrow();
    });

    it('rejects ids with backslashes', () => {
      expect(() => assertSafeId('..\\..\\ai-models', 'debate id')).toThrow();
    });

    it('rejects empty id', () => {
      expect(() => assertSafeId('', 'debate id')).toThrow();
    });

    it('rejects ids with null bytes', () => {
      expect(() => assertSafeId('abc\x00def', 'debate id')).toThrow();
    });

    it('rejects ids with spaces', () => {
      expect(() => assertSafeId('abc def', 'debate id')).toThrow();
    });

    it('rejects ids with dots', () => {
      expect(() => assertSafeId('abc.json', 'debate id')).toThrow();
    });
  });

  describe('assertContainedIn — post-resolve containment gate', () => {
    it('accepts a path inside the base dir', () => {
      expect(() => assertContainedIn(path.join(BASE, 'debate-abc123.json'), BASE)).not.toThrow();
    });

    it('rejects a path that escapes the base dir', () => {
      expect(() => assertContainedIn(path.resolve('/data/ai-models.json'), BASE)).toThrow();
    });

    it('rejects the base dir itself (not strictly inside)', () => {
      expect(() => assertContainedIn(BASE, BASE)).toThrow();
    });
  });
});
