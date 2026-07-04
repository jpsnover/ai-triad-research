// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { z } from 'zod';

// IPC input schemas for high-risk handlers. Extracted from ipcHandlers.ts so they
// can be unit-tested directly (ipcHandlers imports Electron and can't load in vitest).

export const VALID_POV = z.enum(['accelerationist', 'safetyist', 'skeptic', 'situations', 'cross_cutting']);

export const SafePath = z.string().min(1).max(500);

/**
 * Node ID validator. Accepts:
 *  - `{pov}-{category}-NNN` (e.g. `acc-belief-001`)
 *  - `sit-NNN` — situations (formerly cross-cutting `cc-NNN`; migrated t/1308, mapping: `taxonomy/Origin/cc-to-sit-mapping.json`)
 *  - `pol-NNN` — policy actions
 *
 * `cc-` is no longer accepted — removed in t/1316 Phase 2 after the cc→sit migration applied.
 */
export const NodeId = z.string().regex(/^[a-z]{2,3}-[a-z]+-\d{3}$|^sit-\d{3}$|^pol-\d{3}$/);
