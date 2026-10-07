// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Generator for lib/ai-config/codeReferencedModels.json (t/3553 item 1). `npm run gen:code-referenced-models`.
//
// No third extractor (TL t/3553#10): the TS ids come from the TS lint's own scan (collectProductionTsFiles +
// findModelLiterals); the PS ids come from the PS lint's own scan via `pwsh` (scripts/Get-CodeReferencedModels.ps1,
// owned by PowerShell). Dev-machine only — CI never runs this; it only asserts the committed list is fresh.
//
//   --check   don't write; exit 1 if the committed file differs from what would be generated.

import { spawnSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { collectProductionTsFiles } from './modelLiteralFiles.js';
import {
  buildCodeReferencedModels,
  parsePsEmitterOutput,
  registeredLiteralIds,
  serializeCodeReferencedModels,
} from './codeReferencedModels.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../');
const OUT = path.join(REPO_ROOT, 'lib/ai-config/codeReferencedModels.json');

function main(): number {
  const registry = JSON.parse(readFileSync(path.join(REPO_ROOT, 'ai-models.json'), 'utf-8')) as { models: { id: string }[] };
  const validIds = new Set(registry.models.map((m) => m.id));
  if (validIds.size === 0) throw new Error('ai-models.json is unreadable or empty; refusing to generate an empty list.');

  const tsIds = registeredLiteralIds(collectProductionTsFiles(REPO_ROOT), validIds);
  const run = spawnSync(
    'pwsh',
    ['-NoProfile', '-NonInteractive', '-File', path.join(REPO_ROOT, 'scripts/Get-CodeReferencedModels.ps1'), '-Scope', 'All', '-Json'],
    { cwd: REPO_ROOT, encoding: 'utf-8', windowsHide: true },
  );
  const psIds = parsePsEmitterOutput({ status: run.status, stdout: run.stdout ?? '', stderr: run.stderr ?? '', error: run.error });

  const text = serializeCodeReferencedModels(buildCodeReferencedModels(tsIds, psIds, validIds));
  if (process.argv.includes('--check')) {
    let current = '';
    try {
      current = readFileSync(OUT, 'utf-8');
    } catch {
      // A missing file is simply "not current"; reported below.
    }
    if (current === text) {
      console.log('codeReferencedModels.json is current.');
      return 0;
    }
    console.error('codeReferencedModels.json is stale: run `npm run gen:code-referenced-models` (requires pwsh 7).');
    return 1;
  }
  writeFileSync(OUT, text);
  const file = JSON.parse(text) as { ids: string[]; bySource: { ps: string[]; ts: string[] } };
  console.log(`wrote ${path.relative(REPO_ROOT, OUT)}: ${file.ids.length} ids (ts ${file.bySource.ts.length}, ps ${file.bySource.ps.length})`);
  return 0;
}

try {
  process.exitCode = main();
} catch (err) {
  console.error(`gen:code-referenced-models failed: ${(err as Error).message}`);
  process.exitCode = 1;
}
