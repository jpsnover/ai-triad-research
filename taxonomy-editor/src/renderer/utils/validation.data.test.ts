// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { povTaxonomyFileSchema, situationsFileSchema, conflictFileSchema, aggregateConflictsFileSchema } from './validation';

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

    // t/3378: schema-parse passes even when a whole data layer silently vanishes — `logical_form`
    // is optional (t/3375: a strip-then-save deleted 133 acc frames and nothing here caught it).
    // A count-based floor catches a systemic drop that schema validation structurally cannot.
    // Floors are the exact live counts (not "slightly below") — any legitimate removal requires a
    // deliberate edit here, which is the intended friction (TL t/3375#2).
    const LOGICAL_FORM_FRAME_FLOOR: Record<string, number> = {
      'accelerationist.json': 133,
      'safetyist.json': 274,
      'skeptic.json': 234,
    };

    it.each(povFiles)('%s carries at least the baseline logical_form frame count (t/3378)', (filename) => {
      const filePath = join(taxonomyDir, filename);
      expect(existsSync(filePath), `${filePath} must exist`).toBe(true);
      const data = JSON.parse(readFileSync(filePath, 'utf8')) as { nodes: { logical_form?: unknown }[] };
      const count = data.nodes.filter(n => n.logical_form).length;
      const floor = LOGICAL_FORM_FRAME_FLOOR[filename];
      expect(count, `${filename}: ${count} logical_form frames, below the t/3378 floor of ${floor} — a mass strip may have silently deleted frames`).toBeGreaterThanOrEqual(floor);
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

  // t/3358: the aggregate conflicts.json (the data-of-record fork-B census merge + demotion mutate)
  // had NO schema safety net — only the 5 legacy conflict-*.json files (filtered above) were covered.
  describe('Aggregate conflicts.json (t/3358)', () => {
    const aggregatePath = join(conflictsDir, 'conflicts.json');

    it('conflicts.json parses without errors against aggregateConflictsFileSchema', () => {
      expect(existsSync(aggregatePath), `${aggregatePath} must exist`).toBe(true);
      const data = JSON.parse(readFileSync(aggregatePath, 'utf8'));
      const result = aggregateConflictsFileSchema.safeParse(data);
      if (!result.success) {
        const summary = result.error.issues
          .slice(0, 10)
          .map(i => `  ${i.path.join('.')}: ${i.message}`)
          .join('\n');
        expect.fail(
          `conflicts.json fails aggregateConflictsFileSchema:\n${summary}` +
          (result.error.issues.length > 10 ? `\n  ...and ${result.error.issues.length - 10} more` : ''),
        );
      }
    });

    it('rejects a seeded bad status (both-arms gate discipline)', () => {
      expect(existsSync(aggregatePath), `${aggregatePath} must exist`).toBe(true);
      const data = JSON.parse(readFileSync(aggregatePath, 'utf8'));
      expect(data.conflicts?.length, 'live aggregate must have at least one conflict to seed').toBeGreaterThan(0);
      const poisoned = { ...data, conflicts: [{ ...data.conflicts[0], status: 'bogus-status' }, ...data.conflicts.slice(1)] };
      const result = aggregateConflictsFileSchema.safeParse(poisoned);
      expect(result.success, 'a bogus status must fail the aggregate schema').toBe(false);
    });
  });
});
