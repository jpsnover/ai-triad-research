// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// The TS model-literal lint's file collection (IO), moved UNCHANGED out of modelLiteralLint.test.ts (t/3553 item 1)
// so the lint and the code-referenced-models generator scan exactly the same files: one extractor, two callers
// (TL t/3553#10 — no third extractor). The predicate stays pure in modelLiteralLint.ts.

import { readFileSync, readdirSync } from 'fs';
import path from 'path';
import type { SourceFile } from './modelLiteralLint.js';

const SCAN_ROOTS = ['lib', 'taxonomy-editor/src'];
const EXCLUDE_DIR = new Set(['node_modules', 'dist', '__tests__', '__mocks__', 'fixtures', '.git']);
function isExcludedFile(name: string): boolean {
  return (
    /\.(test|spec)\.tsx?$/.test(name) ||
    /\.d\.ts$/.test(name) ||
    /\.testHelpers\.ts$/.test(name) ||
    /\.mock\.ts$/.test(name) ||
    name === 'generatedAIModelIds.ts'
  );
}

/** Production TS files under lib/ and taxonomy-editor/src, as repo-relative POSIX paths. */
export function collectProductionTsFiles(repoRoot: string): SourceFile[] {
  const out: SourceFile[] = [];
  const walk = (absDir: string, relDir: string): void => {
    for (const ent of readdirSync(absDir, { withFileTypes: true })) {
      if (ent.isDirectory()) {
        if (EXCLUDE_DIR.has(ent.name)) continue;
        walk(path.join(absDir, ent.name), `${relDir}/${ent.name}`);
      } else if (/\.tsx?$/.test(ent.name) && !isExcludedFile(ent.name)) {
        const rel = `${relDir}/${ent.name}`;
        out.push({ path: rel, content: readFileSync(path.join(absDir, ent.name), 'utf-8') });
      }
    }
  };
  for (const root of SCAN_ROOTS) walk(path.join(repoRoot, root), root);
  return out;
}
