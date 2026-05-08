#!/usr/bin/env npx tsx
/**
 * Migration script: debate phase name renames (t/410)
 *
 * Renames phase string values throughout debate session JSON files:
 *   "thesis-antithesis" → "confrontation"
 *   "exploration"       → "argumentation"
 *   "synthesis"         → "concluding"
 *
 * Targets: transcript[*].type, transcript[*].metadata.debate_phase,
 *   adaptive_staging_diagnostics.phases[*].phase, and all other "phase" fields.
 *
 * Does NOT rename object keys (e.g., metadata.synthesis stays as-is since
 * it's a data payload key, not a phase value).
 *
 * Usage:
 *   npx tsx lib/debate/migrate-phase-names.ts                  # dry-run (default)
 *   npx tsx lib/debate/migrate-phase-names.ts --apply          # write changes
 *   npx tsx lib/debate/migrate-phase-names.ts --dir /path/to   # custom data dir
 */

import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join, resolve } from 'path';

const PHASE_RENAMES: Record<string, string> = {
  'thesis-antithesis': 'confrontation',
  exploration: 'argumentation',
  synthesis: 'concluding',
};

/** Fields whose string values should be checked for phase renames. */
const PHASE_VALUE_FIELDS = new Set([
  'type',           // transcript entry type
  'phase',          // phase state, diagnostics
  'debate_phase',   // metadata.debate_phase
  'current_phase',  // top-level phase state
  'new_phase',      // transition records
  'from_phase',     // regression records
  'to_phase',       // regression records
]);

interface MigrationResult {
  file: string;
  changesCount: number;
  details: string[];
}

function walkAndRename(obj: unknown, path: string, details: string[]): number {
  if (obj === null || obj === undefined) return 0;

  let count = 0;

  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      count += walkAndRename(obj[i], `${path}[${i}]`, details);
    }
  } else if (typeof obj === 'object') {
    const record = obj as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      const val = record[key];
      if (typeof val === 'string' && PHASE_VALUE_FIELDS.has(key) && val in PHASE_RENAMES) {
        const newVal = PHASE_RENAMES[val];
        details.push(`${path}.${key}: ${val} → ${newVal}`);
        record[key] = newVal;
        count++;
      } else {
        count += walkAndRename(val, `${path}.${key}`, details);
      }
    }
  }

  return count;
}

function migrateFile(filePath: string): MigrationResult | null {
  const raw = readFileSync(filePath, 'utf-8');
  const data = JSON.parse(raw);

  const details: string[] = [];
  const changesCount = walkAndRename(data, '$', details);

  if (changesCount === 0) return null;

  return { file: filePath, changesCount, details };
}

function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const dirIdx = args.indexOf('--dir');
  const dataDir = dirIdx !== -1 && args[dirIdx + 1]
    ? resolve(args[dirIdx + 1])
    : resolve(import.meta.dirname ?? '.', '../../../ai-triad-data/debates');

  console.log(`Mode: ${apply ? 'APPLY' : 'DRY-RUN'}`);
  console.log(`Data dir: ${dataDir}\n`);

  const files = readdirSync(dataDir)
    .filter(f => f.endsWith('.json'))
    .map(f => join(dataDir, f));

  let totalFiles = 0;
  let totalChanges = 0;
  const results: MigrationResult[] = [];

  for (const file of files) {
    try {
      const result = migrateFile(file);
      if (result) {
        results.push(result);
        totalFiles++;
        totalChanges += result.changesCount;

        if (apply) {
          // Re-parse, re-apply (idempotent), write
          const data = JSON.parse(readFileSync(file, 'utf-8'));
          walkAndRename(data, '$', []);
          writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf-8');
        }
      }
    } catch (err) {
      console.error(`ERROR processing ${file}: ${err}`);
    }
  }

  for (const r of results) {
    console.log(`${r.file} (${r.changesCount} changes)`);
    if (r.details.length <= 5) {
      for (const d of r.details) console.log(`  ${d}`);
    } else {
      for (const d of r.details.slice(0, 3)) console.log(`  ${d}`);
      console.log(`  ... and ${r.details.length - 3} more`);
    }
  }

  console.log(`\n--- Summary ---`);
  console.log(`Files scanned: ${files.length}`);
  console.log(`Files ${apply ? 'modified' : 'to modify'}: ${totalFiles}`);
  console.log(`Values ${apply ? 'renamed' : 'to rename'}: ${totalChanges}`);
  if (!apply) {
    console.log(`\nRe-run with --apply to write changes.`);
  }
}

main();
