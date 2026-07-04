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
 *  - `cc-NNN`  — legacy cross-cutting nodes
 *  - `sit-NNN` — cross-cutting → situations migration (t/1308; migrated range sit-201..sit-446)
 *  - `pol-NNN` — policy actions
 *
 * The `cc-` branch is retained during the cc→sit migration for dual tolerance; it is
 * removed in Phase 2 once PowerShell posts apply-complete (t/1316 Phase 2).
 */
export const NodeId = z.string().regex(/^[a-z]{2,3}-[a-z]+-\d{3}$|^cc-\d{3}$|^sit-\d{3}$|^pol-\d{3}$/);
