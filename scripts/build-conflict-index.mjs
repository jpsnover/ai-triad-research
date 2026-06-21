#!/usr/bin/env node
// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Build a lightweight conflict index from the consolidated conflicts.json.
 *
 * Produces _conflict-index.json with summary fields only (no instances array),
 * for fast bulk loading by the container snapshot and GitHub API backend.
 *
 * Usage:
 *   node scripts/build-conflict-index.mjs
 *
 * Environment:
 *   AI_TRIAD_DATA_ROOT  Path to ai-triad-data repo (default: ../ai-triad-data)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_ROOT = process.env.AI_TRIAD_DATA_ROOT || path.resolve(__dirname, '..', '..', 'ai-triad-data');
const CONFLICTS_DIR = path.join(DATA_ROOT, 'conflicts');
const INPUT_FILE = path.join(CONFLICTS_DIR, 'conflicts.json');
const OUTPUT_FILE = path.join(CONFLICTS_DIR, '_conflict-index.json');

function main() {
  if (!fs.existsSync(INPUT_FILE)) {
    console.error(`conflicts.json not found at ${INPUT_FILE}`);
    process.exit(1);
  }

  const raw = JSON.parse(fs.readFileSync(INPUT_FILE, 'utf-8'));
  const entries = raw.conflicts || [];

  const conflicts = {};
  for (const c of entries) {
    if (!c.claim_id) continue;
    conflicts[c.claim_id] = {
      claim_label: c.claim_label || '',
      description: c.description || '',
      status: c.status || 'open',
      linked_taxonomy_nodes: c.linked_taxonomy_nodes || [],
      instance_count: (c.instances || []).length,
    };
  }

  const output = {
    version: 1,
    generated: new Date().toISOString(),
    conflict_count: Object.keys(conflicts).length,
    conflicts,
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
  console.log(`Wrote ${OUTPUT_FILE}`);
  console.log(`  ${output.conflict_count} conflicts indexed`);
}

main();
