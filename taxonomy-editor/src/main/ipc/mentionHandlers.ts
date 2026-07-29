// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Container-mention handler (t/1903) — desktop transport for the getContainerMentions
// bridge method (Phase-2 mention read path). Mirrors the getEntity IPC pattern
// (entityHandlers.ts): a thin handler over the main-process fileIO reader
// (readContainerMentions — itself the desktop mirror of the server's storage reader).
// The bridge (T1, Taxonomy Editor) delegates to window.electronAPI.getContainerMentions;
// once this preload exposure lands, that delegation resolves instead of failing loud.

import { ipcMain } from 'electron';
import { readContainerMentions } from '../fileIO.js';
import type { ContainerMentions } from '../../../../lib/entities/mentionTypes.js';

export function registerMentionHandlers(): void {
  // get-container-mentions — desktop mirror of the server mention read path. Returns the
  // container's extracted mentions, or null when there are no links yet (entity_mentions.json
  // is a derived, rebuildable artifact — an absent file/container is not an error).
  // readContainerMentions never throws (it degrades to null + flight-recorder on a bad file),
  // so no catch is needed here.
  ipcMain.handle('get-container-mentions', (_event, containerId: string): ContainerMentions | null => {
    return readContainerMentions(containerId);
  });
}
