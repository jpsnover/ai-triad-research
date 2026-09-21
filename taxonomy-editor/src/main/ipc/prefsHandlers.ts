// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// User preferences IPC handlers (t/2118). Backs the get-preferences /
// set-preferences channels wired in electron-bridge.ts by t/2117.

import { ipcMain, app } from 'electron';
import fsp from 'fs/promises';
import path from 'path';
import { getGlobalRecorder } from '../../../../lib/flight-recorder/index.js';
import { validateUserPreferencesOrDefault, type UserPreferences } from '../../../../lib/userPreferencesSchema.js';

function prefsFilePath(): string {
  return path.join(app.getPath('userData'), 'preferences.json');
}

export function registerPrefsHandlers(): void {
  // t/3536: validated via the shared lib/userPreferencesSchema.ts (t/3535) instead of
  // returning the parsed file contents as-is — a corrupt/hand-edited/stale-schema file now
  // degrades to DEFAULT_USER_PREFERENCES (+ FR WARN naming the field) instead of handing an
  // unvalidated blob to every renderer call site that trusts the declared UserPreferences
  // type. Missing file stays a distinct `null` case (contract: only feed the schema PARSED
  // contents of an EXISTING file — never `undefined`, or it logs a spurious WARN).
  ipcMain.handle('get-preferences', async (): Promise<UserPreferences | null> => {
    try {
      const raw = await fsp.readFile(prefsFilePath(), 'utf-8');
      const parsed = JSON.parse(raw) as unknown;
      return validateUserPreferencesOrDefault(parsed, 'prefsHandlers');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      getGlobalRecorder()?.record({ type: 'system.error', component: 'prefsHandlers', level: 'error', message: 'get-preferences failed', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
      return null;
    }
  });

  // Atomic write: write to a .tmp sidecar then rename into place so a crash
  // mid-write never leaves a truncated preferences file.
  ipcMain.handle('set-preferences', async (_event, prefs: unknown): Promise<void> => {
    const dest = prefsFilePath();
    const tmp = `${dest}.tmp`;
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    await fsp.writeFile(tmp, JSON.stringify(prefs, null, 2) + '\n', 'utf-8');
    await fsp.rename(tmp, dest);
  });
}
