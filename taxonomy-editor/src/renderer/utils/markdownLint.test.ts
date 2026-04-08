// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Inline validation: every <Markdown> component MUST use remarkGfm.
 * Without it, GFM features like **bold**, tables, and strikethrough
 * render as literal text instead of formatted output.
 *
 * This test prevents the recurring synthesis rendering bug where
 * markdown content displays raw `**bold**` markers.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

function findTsxFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== 'node_modules') {
      results.push(...findTsxFiles(full));
    } else if (entry.name.endsWith('.tsx')) {
      results.push(full);
    }
  }
  return results;
}

describe('Markdown rendering guard', () => {
  const srcDir = path.resolve(__dirname, '../../');
  const tsxFiles = findTsxFiles(srcDir);

  it('all <Markdown> usages must include remarkGfm plugin', () => {
    const violations: string[] = [];

    for (const file of tsxFiles) {
      const content = fs.readFileSync(file, 'utf-8');
      // Skip files that don't use <Markdown>
      if (!content.includes('<Markdown')) continue;

      // Check that remarkGfm is imported
      if (!content.includes('remarkGfm')) {
        violations.push(`${path.relative(srcDir, file)}: imports Markdown but not remarkGfm`);
        continue;
      }

      // Find bare <Markdown> without remarkPlugins — match <Markdown> followed by {
      // but NOT <Markdown remarkPlugins
      const barePattern = /<Markdown>(?!\s*\{\/\*)/g;
      let match;
      while ((match = barePattern.exec(content)) !== null) {
        const line = content.substring(0, match.index).split('\n').length;
        violations.push(`${path.relative(srcDir, file)}:${line}: <Markdown> without remarkPlugins`);
      }
    }

    expect(violations).toEqual([]);
  });
});
