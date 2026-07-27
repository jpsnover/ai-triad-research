// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// IPC registrar (ADR-007 file-size-budget split, t/1689).
//
// This file was a single 1762-LOC function registering all main-process IPC
// handlers. Per ADR-007 it is now a thin registrar: the handlers live in
// cohesive per-domain modules under ./ipc/, each exporting a registerXHandlers()
// function, and this file installs each group. The SET of registered channel
// names is identical before/after — that identity is the no-behavior-change
// proof (mirrors the web-bridge/electron-bridge contract). Add new handlers to
// the appropriate ./ipc/ module (or a new one wired here), not inline.

import { registerTaxonomyHandlers } from './ipc/taxonomyHandlers.js';
import { registerSourceHandlers } from './ipc/sourceHandlers.js';
import { registerAiHandlers } from './ipc/aiHandlers.js';
import { registerDebateHandlers } from './ipc/debateHandlers.js';
import { registerChatHandlers } from './ipc/chatHandlers.js';
import { registerApiKeyHandlers } from './ipc/apiKeyHandlers.js';
import { registerDataRepoHandlers } from './ipc/dataRepoHandlers.js';
import { registerOrganizationHandlers } from './ipc/organizationHandlers.js';
import { registerEntityHandlers } from './ipc/entityHandlers.js';
import { registerFlightRecorderHandlers } from './ipc/flightRecorderHandlers.js';
import { registerCommunityHandlers } from './ipc/communityHandlers.js';
import { registerSystemHandlers } from './ipc/systemHandlers.js';

export function registerIpcHandlers(): void {
  registerTaxonomyHandlers();
  registerSourceHandlers();
  registerAiHandlers();
  registerDebateHandlers();
  registerChatHandlers();
  registerApiKeyHandlers();
  registerDataRepoHandlers();
  registerOrganizationHandlers();
  registerEntityHandlers();
  registerFlightRecorderHandlers();
  registerCommunityHandlers();
  registerSystemHandlers();
}
