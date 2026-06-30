// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { parseHashParams } from '../../lib/parseHash';

/** What the popout window should (re)load — drives the error screen's "Try Again". */
export interface DebateLoadTarget {
  id: string;
  community: boolean;
}

/**
 * Parse the popout window hash (e.g. "#/debate?id=<id>&source=community") into a
 * load target, or null when no debate id is present (t/941). Pure + testable.
 * Uses the shared `parseHashParams` util (t/1177) rather than a hand-rolled regex.
 */
export function parseDebateHash(hash: string): DebateLoadTarget | null {
  const params = parseHashParams(hash);
  const id = params.get('id');
  if (!id) return null;
  return { id, community: params.get('source') === 'community' };
}

/**
 * The popout takes over the whole window with a full-screen error ONLY for
 * load/startup failures — i.e. when no debate is active. Once a debate is loaded,
 * transient errors (rate-limits etc.) render inline in DebateWorkspace's action bar
 * instead of hijacking the screen (t/953). Pure + testable.
 */
export function shouldShowLoadError(displayError: string | null, activeDebateId: string | null): boolean {
  return !!displayError && !activeDebateId;
}
