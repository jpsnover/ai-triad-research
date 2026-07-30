// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Guards the security invariant behind t/2024 Fix A (CodeQL js/incomplete-multi-
// character-sanitization + js/bad-tag-filter): generateContent no longer HTML-sanitizes
// AI text — the regex sanitizer was bypassable AND redundant, so it was removed
// (TL-approved p/56#192). Safety instead relies on the renderer displaying AI text ONLY
// via react-markdown, which does not execute raw HTML unless the `rehype-raw` plugin is
// enabled. This test goes red if anyone reintroduces a raw-HTML sink in the renderer,
// which would reopen the XSS surface the removed sanitizer nominally (but ineffectively)
// covered.

const rendererDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'renderer');

function collectSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectSourceFiles(full));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe('summary-viewer HTML-safety invariant (t/2024 Fix A)', () => {
  const files = collectSourceFiles(rendererDir);

  it('has renderer source files to scan', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('never uses dangerouslySetInnerHTML in the renderer', () => {
    const offenders = files
      .filter((f) => fs.readFileSync(f, 'utf-8').includes('dangerouslySetInnerHTML'))
      .map((f) => path.relative(rendererDir, f));
    expect(offenders).toEqual([]);
  });

  it('never enables rehype-raw (which would make react-markdown execute raw HTML)', () => {
    const offenders = files
      .filter((f) => /rehype-raw/.test(fs.readFileSync(f, 'utf-8')))
      .map((f) => path.relative(rendererDir, f));
    expect(offenders).toEqual([]);
  });
});
