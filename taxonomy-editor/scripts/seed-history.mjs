/**
 * One-time migration: seed label_history and description_history on all POV nodes.
 *
 * Usage:  node scripts/seed-history.mjs [--dry-run]
 *
 * Reads accelerationist.json, safetyist.json, skeptic.json from ai-triad-data,
 * adds initial history entries where missing, and writes back.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dryRun = process.argv.includes('--dry-run');

const config = JSON.parse(readFileSync(join(__dirname, '..', '..', '.aitriad.json'), 'utf-8'));
const dataRoot = join(__dirname, '..', '..', config.data_root);
const taxonomyDir = join(dataRoot, config.taxonomy_dir);

const SEED_DATE = '2026-05-25';
const POV_FILES = ['accelerationist.json', 'safetyist.json', 'skeptic.json'];

let totalSeeded = 0;
let totalSkipped = 0;

for (const filename of POV_FILES) {
  const filePath = join(taxonomyDir, filename);
  const raw = readFileSync(filePath, 'utf-8');
  const data = JSON.parse(raw);

  let fileSeeded = 0;
  let fileSkipped = 0;

  for (const node of data.nodes) {
    if (!node.label_history) {
      node.label_history = [{
        date: SEED_DATE,
        value: node.label,
        source: 'initial',
      }];
      fileSeeded++;
    } else {
      fileSkipped++;
    }

    if (!node.description_history) {
      node.description_history = [{
        date: SEED_DATE,
        value: node.description,
        source: 'initial',
      }];
    }
  }

  if (!dryRun) {
    writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  }

  console.log(`${filename}: ${fileSeeded} seeded, ${fileSkipped} already had history${dryRun ? ' (dry run)' : ''}`);
  totalSeeded += fileSeeded;
  totalSkipped += fileSkipped;
}

console.log(`\nTotal: ${totalSeeded} nodes seeded, ${totalSkipped} skipped${dryRun ? ' (dry run)' : ''}`);
