// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Regression tests for H2 path-traversal fix (t/2528).

import { describe, it, expect } from 'vitest';
import path from 'path';
import { assertSafeDebateId } from './mcpServerGuard.js';

const BASE = path.resolve('/data/debates');

describe('assertSafeDebateId (H2 regression — t/2528)', () => {
  it('accepts a normal UUID-like debate id', () => {
    expect(() => assertSafeDebateId('abc123', BASE)).not.toThrow();
    expect(() => assertSafeDebateId('a1b2c3d4', BASE)).not.toThrow();
    expect(() => assertSafeDebateId('debate-2026-abcd1234', BASE)).not.toThrow();
  });

  it('rejects path traversal via ../ (the H2 attack vector)', () => {
    expect(() => assertSafeDebateId('../../../ai-models', BASE))
      .toThrow(/Invalid debate ID/);
  });

  it('rejects IDs with forward slashes', () => {
    expect(() => assertSafeDebateId('debates/config', BASE))
      .toThrow(/Invalid debate ID/);
  });

  it('rejects IDs with backslashes', () => {
    expect(() => assertSafeDebateId('..\\..\\ai-models', BASE))
      .toThrow(/Invalid debate ID/);
  });

  it('rejects empty ID', () => {
    expect(() => assertSafeDebateId('', BASE))
      .toThrow(/Invalid debate ID/);
  });

  it('rejects IDs with null bytes', () => {
    expect(() => assertSafeDebateId('abc\x00def', BASE))
      .toThrow(/Invalid debate ID/);
  });

  it('rejects IDs with spaces', () => {
    expect(() => assertSafeDebateId('abc def', BASE))
      .toThrow(/Invalid debate ID/);
  });

  it('rejects IDs with dots', () => {
    expect(() => assertSafeDebateId('abc.json', BASE))
      .toThrow(/Invalid debate ID/);
  });
});
