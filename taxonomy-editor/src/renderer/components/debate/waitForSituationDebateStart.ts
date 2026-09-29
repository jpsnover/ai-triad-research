// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useDebateStore } from '../../hooks/useDebateStore';

/**
 * Fire `onStart` the moment a situation debate for `nodeId` becomes the store's
 * `activeDebate` (t/3752). `createSituationDebate`'s returned promise doesn't resolve
 * until the full watch-only opening round finishes generating (`enterClarificationOrBegin`,
 * t/3629) — that's intentional and shouldn't change — but `activeDebate` is set much
 * earlier, inside `createDebate()`, before that wait even starts. Subscribing here lets
 * callers navigate as soon as the record exists instead of blocking on generation.
 *
 * The `id !== prevState.activeDebate?.id` check is load-bearing, not cosmetic: without
 * it, a *past* debate for the same node already sitting in `activeDebate` (e.g. loaded
 * from "Past Debates") would falsely match on the next unrelated store update, firing
 * `onStart` for the old debate before the new one is even created.
 *
 * Returns an unsubscribe function — call it once matched, and defensively in the
 * creation promise's `.finally()` in case creation throws before `activeDebate` is ever set.
 */
export function subscribeToSituationDebateStart(nodeId: string, onStart: (debateId: string) => void): () => void {
  return useDebateStore.subscribe((state, prevState) => {
    const session = state.activeDebate;
    if (
      session &&
      session.id !== prevState.activeDebate?.id &&
      session.source_type === 'situations' &&
      session.source_ref === nodeId
    ) {
      onStart(session.id);
    }
  });
}
