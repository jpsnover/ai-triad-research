// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import { isCancellationError, makeCancellationError } from '../cancellation';

describe('cancellation tagging (t/2508)', () => {
  it('makeCancellationError produces an AbortError tagged cancelled', () => {
    const e = makeCancellationError();
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe('AbortError');
    expect((e as Error & { cancelled?: boolean }).cancelled).toBe(true);
  });

  it('makeCancellationError carries a custom message', () => {
    expect(makeCancellationError('POST /api/ai/generate cancelled by caller').message)
      .toBe('POST /api/ai/generate cancelled by caller');
  });

  it('isCancellationError recognises a tagged cancellation', () => {
    expect(isCancellationError(makeCancellationError())).toBe(true);
  });

  it('isCancellationError rejects a plain AbortError (e.g. a timeout)', () => {
    // A request timeout surfaces as an untagged AbortError — must NOT read as a user cancel,
    // otherwise a timeout would silently bail instead of retrying/surfacing.
    const timeout = new DOMException('The operation was aborted', 'AbortError');
    expect(isCancellationError(timeout)).toBe(false);
  });

  it('isCancellationError rejects ordinary errors and nullish values', () => {
    expect(isCancellationError(new Error('boom'))).toBe(false);
    expect(isCancellationError(null)).toBe(false);
    expect(isCancellationError(undefined)).toBe(false);
    expect(isCancellationError({ cancelled: false })).toBe(false);
  });
});
