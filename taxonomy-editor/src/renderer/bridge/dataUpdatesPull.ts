// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Mechanical extraction from web-bridge.ts (ADR-007 §2 — cohesive split, no behavior change) to make
// room for t/3582's new AppAPI methods without exceeding the file's max-lines ceiling (1500, no
// baseline entry). Picked because it's fully self-contained (bare `fetch`, no web-bridge private state).

import { ActionableError } from '@lib/debate/errors';

/** POST /api/data/pull streams heartbeats + progress lines to prevent proxy timeouts; the final
 *  non-empty line is the JSON result. */
export async function pullDataUpdatesRest(): Promise<unknown> {
  const res = await fetch('/api/data/pull', { method: 'POST' });
  const text = await res.text();
  const lines = text.split('\n').filter(l => l.trim() && !l.startsWith('progress:'));
  if (lines.length === 0) {
    throw new ActionableError({
      goal: 'Pull data updates',
      problem: 'Server returned no result',
      location: 'web-bridge.pullDataUpdates',
      nextSteps: ['Check the server logs', 'Try again'],
    });
  }
  return JSON.parse(lines[lines.length - 1]);
}
