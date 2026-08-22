// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Coverage for setFindMode clearing the sticky semantic embeddingError (t/2931). The bug:
// embeddingError was only reset at the START of runSemanticSearch, so it stuck in the
// wildcard/raw view until reload. Fix clears it when leaving semantic — but NOT when staying
// in semantic (a new semantic failure must still surface).

import { describe, it, expect, vi } from 'vitest';

vi.mock('@bridge', () => ({ api: {} }));
vi.mock('@lib/flight-recorder/index', () => ({ getGlobalRecorder: () => ({ record: vi.fn() }) }));

const { createSearchSlice } = await import('./searchSlice');

// Minimal harness: capture the partial passed to set(); get() is unused by setFindMode.
function makeSlice() {
  const setCalls: Array<Record<string, unknown>> = [];
  const set = (partial: unknown) => { setCalls.push(partial as Record<string, unknown>); };
  const get = () => ({}) as never;
  // StateCreator signature is (set, get, api) — api unused here.
  const slice = createSearchSlice(set as never, get, {} as never);
  return { slice, setCalls };
}

describe('searchSlice.setFindMode — embeddingError stickiness (t/2931)', () => {
  it('clears embeddingError when switching to wildcard', () => {
    const { slice, setCalls } = makeSlice();
    slice.setFindMode('wildcard');
    expect(setCalls[0]).toEqual({ findMode: 'wildcard', embeddingError: null });
  });

  it('clears embeddingError when switching to raw', () => {
    const { slice, setCalls } = makeSlice();
    slice.setFindMode('raw');
    expect(setCalls[0]).toMatchObject({ findMode: 'raw', embeddingError: null });
  });

  it('does NOT clear embeddingError when staying in semantic (new failures must still show)', () => {
    const { slice, setCalls } = makeSlice();
    slice.setFindMode('semantic');
    expect(setCalls[0]).toEqual({ findMode: 'semantic' });
    expect('embeddingError' in setCalls[0]).toBe(false);
  });
});
