#!/usr/bin/env npx tsx
/**
 * Migration script: scoring_method enum value renames (Tier 3, t/407)
 *
 * Renames in argument_network.nodes[*].scoring_method:
 *   "ai_rubric"       → "bdi_criteria"
 *   "default_pending"  → "unscored"
 *
 * Usage:
 *   npx tsx lib/debate/migrate-scoring-method.ts                  # dry-run (default)
 *   npx tsx lib/debate/migrate-scoring-method.ts --apply          # write changes
 *   npx tsx lib/debate/migrate-scoring-method.ts --dir /path/to   # custom data dir
 */

import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join, resolve } from 'path';

const RENAMES: Record<string, string> = {
  ai_rubric: 'bdi_criteria',
  default_pending: 'unscored',
};

interface MigrationResult {
  file: string;
  nodesChanged: number;
  details: string[];
}

function migrateFile(filePath: string): MigrationResult | null {
  const raw = readFileSync(filePath, 'utf-8');
  const data = JSON.parse(raw);

  const nodes = data?.argument_network?.nodes;
  if (!Array.isArray(nodes)) return null;

  const details: string[] = [];
  let changed = 0;

  for (const node of nodes) {
    const old = node.scoring_method;
    if (typeof old === 'string' && old in RENAMES) {
      node.scoring_method = RENAMES[old];
      details.push(`${node.id ?? '?'}: ${old} → ${RENAMES[old]}`);
      changed++;
    }
  }

  if (changed === 0) return null;

  return { file: filePath, nodesChanged: changed, details };
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
  let totalNodes = 0;
  const results: MigrationResult[] = [];

  for (const file of files) {
    try {
      const result = migrateFile(file);
      if (result) {
        results.push(result);
        totalFiles++;
        totalNodes += result.nodesChanged;

        if (apply) {
          const data = JSON.parse(readFileSync(file, 'utf-8'));
          const nodes = data.argument_network.nodes;
          for (const node of nodes) {
            const old = node.scoring_method;
            if (typeof old === 'string' && old in RENAMES) {
              node.scoring_method = RENAMES[old];
            }
          }
          writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf-8');
        }
      }
    } catch (err) {
      console.error(`ERROR processing ${file}: ${err}`);
    }
  }

  for (const r of results) {
    console.log(`${r.file}`);
    for (const d of r.details) {
      console.log(`  ${d}`);
    }
  }

  console.log(`\n--- Summary ---`);
  console.log(`Files scanned: ${files.length}`);
  console.log(`Files ${apply ? 'modified' : 'to modify'}: ${totalFiles}`);
  console.log(`Nodes ${apply ? 'renamed' : 'to rename'}: ${totalNodes}`);
  if (!apply) {
    console.log(`\nRe-run with --apply to write changes.`);
  }
}

main();
