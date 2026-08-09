// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// saveDebate communityReadOnly guard (t/2401). A read-only community debate must never
// PUT to the personal endpoint, even when a component-level caller (the DebateWorkspace
// auto-save timer, ClarificationPanel) bypasses the store.ts subscriber guard. The harness
// (all vi.mock/vi.hoisted setup) is imported FIRST so its hoisted mocks register before the
// store import resolves.
import { describe, it, expect } from 'vitest';
import { mockApi, makeSession } from './storeTestHarness';
import { useDebateStore } from '../../useDebateStore';

describe('saveDebate — communityReadOnly guard (t/2401)', () => {
  it('does NOT persist when the loaded debate is read-only community', async () => {
    useDebateStore.getState().loadDebateFromData(makeSession(), { readOnly: true });
    expect(useDebateStore.getState().communityReadOnly).toBe(true);

    await useDebateStore.getState().saveDebate('test-mutation');

    expect(mockApi.saveDebateSession).not.toHaveBeenCalled();
  });

  it('persists normally for an editable (personal) debate', async () => {
    useDebateStore.getState().loadDebateFromData(makeSession(), { readOnly: false });
    expect(useDebateStore.getState().communityReadOnly).toBe(false);

    await useDebateStore.getState().saveDebate('test-mutation');

    expect(mockApi.saveDebateSession).toHaveBeenCalledTimes(1);
  });
});
