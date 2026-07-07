// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { povTaxonomyFileSchema, situationsFileSchema, conflictFileSchema } from './validation';

const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..');
const configPath = join(REPO_ROOT, '.aitriad.json');

function resolveDataRoot(): string | null {
  if (!existsSync(configPath)) return null;
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  const root = resolve(REPO_ROOT, config.data_root);
  return existsSync(root) ? root : null;
}

const dataRoot = resolveDataRoot();
const skipReason = dataRoot ? '' : 'Data repo not available (expected at ../ai-triad-data)';

describe.skipIf(!dataRoot)('Schema safety net — validation.ts vs real production data', () => {
  const config = dataRoot ? JSON.parse(readFileSync(configPath, 'utf8')) : { taxonomy_dir: '', conflicts_dir: '' };
  const taxonomyDir = join(dataRoot ?? '', config.taxonomy_dir);
  const conflictsDir = join(dataRoot ?? '', config.conflicts_dir);

  describe('POV taxonomy files', () => {
    const povFiles = ['accelerationist.json', 'safetyist.json', 'skeptic.json'];

    it.each(povFiles)('%s parses without errors', (filename) => {
      const filePath = join(taxonomyDir, filename);
      expect(existsSync(filePath), `${filePath} must exist`).toBe(true);
      const data = JSON.parse(readFileSync(filePath, 'utf8'));
      const result = povTaxonomyFileSchema.safeParse(data);
      if (!result.success) {
        const summary = result.error.issues
          .slice(0, 10)
          .map(i => `  ${i.path.join('.')}: ${i.message}`)
          .join('\n');
        expect.fail(
          `${filename} fails povTaxonomyFileSchema:\n${summary}` +
          (result.error.issues.length > 10 ? `\n  ...and ${result.error.issues.length - 10} more` : ''),
        );
      }
    });
  });

  describe('Situations file', () => {
    it('situations.json parses without errors', () => {
      const filePath = join(taxonomyDir, 'situations.json');
      expect(existsSync(filePath), `${filePath} must exist`).toBe(true);
      const data = JSON.parse(readFileSync(filePath, 'utf8'));
      const result = situationsFileSchema.safeParse(data);
      if (!result.success) {
        const summary = result.error.issues
          .slice(0, 10)
          .map(i => `  ${i.path.join('.')}: ${i.message}`)
          .join('\n');
        expect.fail(
          `situations.json fails situationsFileSchema:\n${summary}` +
          (result.error.issues.length > 10 ? `\n  ...and ${result.error.issues.length - 10} more` : ''),
        );
      }
    });
  });

  describe('Conflict files', () => {
    const conflictFiles = existsSync(join(dataRoot ?? '', config.conflicts_dir))
      ? readdirSync(join(dataRoot ?? '', config.conflicts_dir))
          .filter(f => f.startsWith('conflict-') && f.endsWith('.json'))
      : [];

    it.skipIf(conflictFiles.length === 0)
      .each(conflictFiles.length > 0 ? conflictFiles : ['none'])('%s parses without errors', (filename) => {
      const filePath = join(conflictsDir, filename);
      const data = JSON.parse(readFileSync(filePath, 'utf8'));
      const result = conflictFileSchema.safeParse(data);
      if (!result.success) {
        const summary = result.error.issues
          .slice(0, 10)
          .map(i => `  ${i.path.join('.')}: ${i.message}`)
          .join('\n');
        expect.fail(
          `${filename} fails conflictFileSchema:\n${summary}` +
          (result.error.issues.length > 10 ? `\n  ...and ${result.error.issues.length - 10} more` : ''),
        );
      }
    });
  });
});
