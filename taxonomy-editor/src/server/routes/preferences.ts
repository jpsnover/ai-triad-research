// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/2119: web-build transport for user preferences. GET returns the stored
// UserPreferences object or null (client falls back to default 'simple').
// PUT validates the body with Zod (400 on bad schema) and persists to a
// per-user JSON file; returns 204. Shape matches UserPreferences in bridge/types.ts.

import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import type { Router } from '../httpKit.js';
import type { ServerCtx } from './context.js';
import { json, error } from '../httpKit.js';
import { getGlobalRecorder } from '../../../../lib/flight-recorder/index.js';
import { resolveDataPath } from '../config.js';
import { getStorageUserId } from '../security/userContext.js';

const UserPreferencesSchema = z.object({
  viewMode: z.enum(['simple', 'advanced']),
});

function prefsFilePath(): string {
  return resolveDataPath(path.join('preferences', `${getStorageUserId()}.json`));
}

export function registerPreferencesRoutes(r: Router, _ctx: ServerCtx): void {
  const { get, put } = r;

  // GET /api/preferences — null when no file yet (client defaults to 'simple').
  // NB: path is a string literal (not a const) so extractRoutes.ts can see it.
  get('/api/preferences', async (_req, res) => {
    try {
      const raw = fs.readFileSync(prefsFilePath(), 'utf8');
      json(res, JSON.parse(raw));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') { json(res, null); return; }
      getGlobalRecorder()?.record({
        type: 'system.error', component: 'server', level: 'error',
        message: 'Failed to read preferences',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
      error(res, String(err), 500, err);
    }
  });

  // PUT /api/preferences — Zod-validated; 400 on bad schema, 204 on success.
  put('/api/preferences', async (_req, res, body) => {
    try {
      const parsed = UserPreferencesSchema.safeParse(body);
      if (!parsed.success) {
        error(res, 'Invalid preferences: ' + parsed.error.message, 400);
        return;
      }
      const filePath = prefsFilePath();
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, JSON.stringify(parsed.data), 'utf8');
      json(res, null, 204);
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error', component: 'server', level: 'error',
        message: 'Failed to write preferences',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
      error(res, String(err), 500, err);
    }
  });
}
