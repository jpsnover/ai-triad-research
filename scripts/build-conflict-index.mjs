#!/usr/bin/env node
// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * build-conflict-index.mjs — Consolidate individual conflict files into
 * a single _conflict-index.json for bulk loading via API.
 *
 * Individual files remain the source of truth. The index is a read-only
 * optimization (1 API call instead of 1,244).
 *
 * Usage: node scripts/build-conflict-index.mjs
 */

import fs from 'node:fs';
import path from 'node:path';

const SCRIPT_DIR = path.dirname(new URL(import.meta.url).pathname);
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, '..');

function resolveDataRoot() {
  const envRoot = process.env.AI_TRIAD_DATA_ROOT;
  if (envRoot) return path.resolve(envRoot);

  const configPath = path.join(PROJECT_ROOT, '.aitriad.json');
  if (fs.existsSync(configPath)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      const dataRoot = cfg.data_root || '../ai-triad-data';
      return path.resolve(PROJECT_ROOT, dataRoot);
    } catch { /* fall through */ }
  }
  return path.resolve(PROJECT_ROOT, '..', 'ai-triad-data');
}

const DATA_ROOT = resolveDataRoot();
const CONFLICTS_DIR = path.join(DATA_ROOT, 'conflicts');
const OUTPUT_FILE = path.join(CONFLICTS_DIR, '_conflict-index.json');

function main() {
  console.log('Building conflict index...');
  console.log(`  Conflicts dir: ${CONFLICTS_DIR}`);

  if (!fs.existsSync(CONFLICTS_DIR)) {
    console.error(`Conflicts directory not found: ${CONFLICTS_DIR}`);
    process.exit(1);
  }

  const files = fs.readdirSync(CONFLICTS_DIR)
    .filter(f => f.endsWith('.json') && !f.startsWith('_'))
    .sort();

  console.log(`  Found ${files.length} conflict files`);

  const conflicts = {};
  let errors = 0;

  for (const filename of files) {
    const filepath = path.join(CONFLICTS_DIR, filename);
    try {
      const content = JSON.parse(fs.readFileSync(filepath, 'utf-8'));
      conflicts[filename] = content;
    } catch (err) {
      console.warn(`  SKIP ${filename}: ${err.message}`);
      errors++;
    }
  }

  const index = {
    version: 1,
    generated: new Date().toISOString(),
    count: Object.keys(conflicts).length,
    conflicts,
  };

  const json = JSON.stringify(index, null, 2);
  fs.writeFileSync(OUTPUT_FILE, json + '\n', 'utf-8');

  const sizeMB = (Buffer.byteLength(json, 'utf-8') / (1024 * 1024)).toFixed(1);
  console.log(`  Written: ${OUTPUT_FILE}`);
  console.log(`  ${Object.keys(conflicts).length} conflicts, ${sizeMB} MB`);
  if (errors > 0) console.log(`  ${errors} files skipped due to errors`);
}

main();
