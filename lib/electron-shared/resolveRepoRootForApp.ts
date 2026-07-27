// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import fs from 'fs';
import path from 'path';

/**
 * Resolve the repo root for an **Electron app main process**. Walks up from `startDir`
 * to a directory containing `.aitriad.json` or `scripts/AITriad`; if no marker is found
 * on disk (e.g. a packaged asar build), returns `packagedFallback` — callers pass
 * `path.dirname(app.getAppPath())`.
 *
 * ⚠ NOT the same as `resolveRepoRoot` in `lib/debate/taxonomyLoader.ts`, which is the
 * CLI/node resolver: it walks to `.aitriad.json` only (no `scripts/AITriad` marker) and
 * THROWS an ActionableError when not found (no packaged fallback). Use THIS one from
 * Electron main processes (they need the `app.getAppPath()` fallback for packaged builds);
 * use that one from CLI/debate code. Don't cross the wires. (t/1721)
 */
export function resolveRepoRootForApp(startDir: string, packagedFallback: string): string {
  let dir = path.resolve(startDir);
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, '.aitriad.json')) ||
        fs.existsSync(path.join(dir, 'scripts', 'AITriad'))) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  return packagedFallback;
}
