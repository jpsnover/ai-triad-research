// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// loadDebateFromData read-only default (t/2399, TL#6.3 + Diagnostics test item 4).
// The harness (all vi.mock/vi.hoisted setup) is imported FIRST so its hoisted mocks
// register before the store import resolves.
import { describe, it, expect } from 'vitest';
import { makeSession } from './storeTestHarness';
import { useDebateStore } from '../../useDebateStore';

describe('loadDebateFromData — communityReadOnly default (t/2399)', () => {
  it('defaults to read-only (fail-safe) when readOnly is not specified', () => {
    // loadDebateFromData is the raw-data load entry; its only caller is the community
    // popout (readOnly:true). A caller that omits readOnly is loading data of unknown
    // provenance and must NOT become silently editable + auto-saving over it.
    useDebateStore.getState().loadDebateFromData(makeSession());
    expect(useDebateStore.getState().communityReadOnly).toBe(true);
  });

  it('honors an explicit readOnly:true (community load)', () => {
    useDebateStore.getState().loadDebateFromData(makeSession(), { readOnly: true });
    expect(useDebateStore.getState().communityReadOnly).toBe(true);
  });

  it('honors an explicit readOnly:false (caller opts into editability)', () => {
    useDebateStore.getState().loadDebateFromData(makeSession(), { readOnly: false });
    expect(useDebateStore.getState().communityReadOnly).toBe(false);
  });
});
