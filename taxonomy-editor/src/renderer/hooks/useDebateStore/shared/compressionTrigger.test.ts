// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import { isCompressionDue } from './compressionTrigger';

const transcript = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `e${i}` }));

// t/3917: the run loop and DebateWorkspace share this trigger; its thresholds are the ones
// DebateWorkspace used inline before (>= 16 entries, >= 8 uncompressed beyond the last 8).
describe('isCompressionDue', () => {
  it('is false below 16 entries', () => {
    expect(isCompressionDue({ transcript: transcript(15), context_summaries: [] })).toBe(false);
  });

  it('is true at 16 entries with no summary yet (16 - 0 - 8 = 8 uncompressed)', () => {
    expect(isCompressionDue({ transcript: transcript(16), context_summaries: [] })).toBe(true);
  });

  it('counts only entries after the last summary', () => {
    // summary up to e9 → 30 - 10 - 8 = 12 uncompressed → due
    expect(isCompressionDue({ transcript: transcript(30), context_summaries: [{ up_to_entry_id: 'e9' }] })).toBe(true);
    // summary up to e15 → 30 - 16 - 8 = 6 → not due
    expect(isCompressionDue({ transcript: transcript(30), context_summaries: [{ up_to_entry_id: 'e15' }] })).toBe(false);
  });
});
