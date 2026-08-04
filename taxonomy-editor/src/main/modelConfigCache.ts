// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import fs from 'fs';
import { buildModelEntryMap } from '../../../lib/ai-client/registry.js';
import type { ModelEntry, ModelRegistry } from '../../../lib/ai-client/registry.js';
import { getGlobalRecorder } from '../../../lib/flight-recorder/index.js';

let _modelMapCache: Record<string, ModelEntry> | null = null;
let _modelMapMtime = 0;

/**
 * Load and cache the model entry map from `configPath`.
 *
 * Uses a single file descriptor for stat + read (js/file-system-race, t/2022),
 * strips a leading UTF-8 BOM before parsing (t/1702A), and advances the mtime
 * guard on parse failure so a broken file is not re-read on every call (t/1702B).
 */
export function resolveModelEntry(configPath: string, friendlyId: string): ModelEntry | undefined {
  let statMtime = 0;
  let fd: number | undefined;
  try {
    // Open ONE descriptor and fstat+read through it — statting a path then reading
    // the same path is a TOCTOU; operating on a single fd is race-free (t/2022).
    fd = fs.openSync(configPath, 'r');
    const stat = fs.fstatSync(fd);
    statMtime = stat.mtimeMs;
    if (!_modelMapCache || stat.mtimeMs !== _modelMapMtime) {
      // Strip a leading UTF-8 BOM (EF BB BF) — ai-models.json has been saved with
      // one, which makes JSON.parse throw `Unexpected token` (t/1702A). ﻿ is the BOM.
      const raw = fs.readFileSync(fd, 'utf-8').replace(/^﻿/, '');
      const config = JSON.parse(raw) as ModelRegistry;
      _modelMapCache = buildModelEntryMap(config);
      _modelMapMtime = stat.mtimeMs;
      console.log(`[model-map] Loaded ${Object.keys(_modelMapCache).length} mappings from ${configPath}`);
    }
  } catch (err) {
    getGlobalRecorder()?.record({
      type: 'system.error',
      component: 'modelConfigCache',
      level: 'error',
      message: 'Operation failed',
      // Name the file being parsed so the recorder error is self-describing (t/1704).
      data: { configPath },
      error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
    });
    if (!_modelMapCache) _modelMapCache = {} as Record<string, ModelEntry>;
    // Advance the mtime guard so a file that was statted-but-failed-to-parse is not
    // re-read (and re-recorded) on every subsequent call (t/1702B). statMtime is 0
    // only when openSync/fstatSync threw (missing file) — leave guard zero so a
    // later-created file is picked up when it appears.
    if (statMtime !== 0) _modelMapMtime = statMtime;
    console.error(`[model-map] FAILED to load model map: ${err instanceof Error ? err.message : err}`);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
  return _modelMapCache?.[friendlyId];
}

/** Reset the in-memory cache. Call in test beforeEach to ensure isolation between cases. */
export function resetModelMapCache(): void {
  _modelMapCache = null;
  _modelMapMtime = 0;
}
