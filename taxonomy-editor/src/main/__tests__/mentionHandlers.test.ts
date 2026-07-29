// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * t/1903: the `get-container-mentions` IPC handler is the desktop transport for the
 * getContainerMentions bridge method — a thin pass-through over
 * fileIO.readContainerMentions. mentionHandlers imports electron (ipcMain) + the main
 * data layer, so we mock electron (capture the registered handler) and ../fileIO.js
 * (make readContainerMentions observable + return-controllable). Asserts the handler
 * forwards the containerId and returns whatever the reader gives (record | null).
 */

const h = vi.hoisted(() => ({
  handlers: new Map<string, (...a: unknown[]) => unknown>(),
  mentions: null as unknown,
  lastContainerId: undefined as string | undefined,
}));

vi.mock('electron', () => ({
  ipcMain: { handle: (ch: string, fn: (...a: unknown[]) => unknown) => { h.handlers.set(ch, fn); } },
}));

vi.mock('../fileIO.js', () => ({
  readContainerMentions: (containerId: string) => { h.lastContainerId = containerId; return h.mentions; },
}));

// Imported AFTER the mocks so mentionHandlers binds the mocked deps.
import { registerMentionHandlers } from '../ipc/mentionHandlers.js';

function getContainerMentions(containerId: string): unknown {
  const fn = h.handlers.get('get-container-mentions');
  if (!fn) throw new Error('get-container-mentions not registered');
  return fn({}, containerId);
}

beforeEach(() => {
  h.handlers.clear();
  h.mentions = null;
  h.lastContainerId = undefined;
  registerMentionHandlers();
});

describe('get-container-mentions IPC handler (t/1903)', () => {
  it('forwards the containerId and returns the container mentions from readContainerMentions', () => {
    h.mentions = { text_sha256: 'abc123', extracted_at: '2026-07-29T00:00:00Z', mentions: [{ entity_ref: 'ent-001' }] };
    expect(getContainerMentions('acc-desires-001')).toEqual(h.mentions);
    expect(h.lastContainerId).toBe('acc-desires-001');   // containerId forwarded verbatim
  });

  it('returns null when the container has no links yet (derived artifact absent)', () => {
    h.mentions = null;
    expect(getContainerMentions('sit-007')).toBeNull();
  });
});
