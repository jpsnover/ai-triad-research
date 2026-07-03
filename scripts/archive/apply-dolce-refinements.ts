// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * CLI script to apply accepted DOLCE refinement proposals to taxonomy source files.
 *
 * Reads `accepted-changes.json` (produced by the review GUI) and patches
 * description + graph_attributes on matching nodes in the POV source files.
 *
 * Usage:
 *   npx tsx scripts/apply-dolce-refinements.ts accepted-changes.json [--dry-run]
 *
 * Safety:
 *   - Validates every node ID exists in the source file before applying
 *   - Creates a backup ({pov}.json.bak.{timestamp}) before writing
 *   - --dry-run shows what would change without writing
 *   - Only patches description and graph_attributes — no structural changes
 */

import fs from 'fs';
import path from 'path';
import { resolveRepoRoot, resolveDataRoot } from '../lib/debate/taxonomyLoader.js';
import type { PovNode } from '../lib/debate/taxonomyTypes.js';

// ── Types ─────────────────────────────────────────────

interface AcceptedChange {
  id: string;
  accepted_at: string;
  edited: boolean;
  proposed_description: string | null;
  proposed_graph_attributes?: Record<string, unknown>;
}

interface AcceptedChangesFile {
  reviewed_at: string;
  reviewer: string;
  source_proposals: string;
  accepted: AcceptedChange[];
}

// ── Helpers ───────────────────────────────────────────

function loadJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8').replace(/^\uFEFF/, '')) as T;
}

/** Derive POV key from node ID prefix. */
function povFromId(id: string): string | null {
  if (id.startsWith('acc-')) return 'accelerationist';
  if (id.startsWith('saf-')) return 'safetyist';
  if (id.startsWith('skp-')) return 'skeptic';
  return null;
}

const POV_FILES: Record<string, string> = {
  accelerationist: 'accelerationist.json',
  safetyist: 'safetyist.json',
  skeptic: 'skeptic.json',
};

// ── Main ──────────────────────────────────────────────

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const args = process.argv.slice(2).filter((a: string) => !a.startsWith('--'));

  if (args.length === 0) {
    console.error('Usage: npx tsx scripts/apply-dolce-refinements.ts <accepted-changes.json> [--dry-run]');
    process.exit(1);
  }

  const inputPath = path.resolve(args[0]);
  if (!fs.existsSync(inputPath)) {
    console.error(`File not found: ${inputPath}`);
    process.exit(1);
  }

  const repoRoot = resolveRepoRoot(process.cwd());
  const dataRoot = resolveDataRoot(repoRoot);
  const config = JSON.parse(
    fs.readFileSync(path.join(repoRoot, '.aitriad.json'), 'utf-8').replace(/^\uFEFF/, ''),
  ) as { taxonomy_dir: string };
  const taxonomyDir = path.join(dataRoot, config.taxonomy_dir);

  console.log(`Input:        ${inputPath}`);
  console.log(`Taxonomy dir: ${taxonomyDir}`);
  console.log(`Mode:         ${dryRun ? 'DRY RUN' : 'APPLY'}`);
  console.log();

  // Load accepted changes
  const changesFile = loadJson<AcceptedChangesFile>(inputPath);
  const changes = changesFile.accepted ?? [];
  console.log(`Reviewer:     ${changesFile.reviewer}`);
  console.log(`Source:       ${changesFile.source_proposals}`);
  console.log(`Accepted:     ${changes.length} changes\n`);

  if (changes.length === 0) {
    console.log('No accepted changes to apply.');
    return;
  }

  // Group changes by POV
  const byPov = new Map<string, AcceptedChange[]>();
  const unknownIds: string[] = [];

  for (const change of changes) {
    const pov = povFromId(change.id);
    if (!pov) {
      unknownIds.push(change.id);
      continue;
    }
    if (!byPov.has(pov)) byPov.set(pov, []);
    byPov.get(pov)!.push(change);
  }

  if (unknownIds.length > 0) {
    console.error(`Unknown POV prefix for node IDs: ${unknownIds.join(', ')}`);
    process.exit(1);
  }

  // Process each POV file
  let totalApplied = 0;

  for (const [pov, povChanges] of byPov) {
    const fileName = POV_FILES[pov];
    if (!fileName) {
      console.error(`No file mapping for POV: ${pov}`);
      process.exit(1);
    }

    const filePath = path.join(taxonomyDir, fileName);
    if (!fs.existsSync(filePath)) {
      console.error(`POV file not found: ${filePath}`);
      process.exit(1);
    }

    const data = loadJson<{ nodes: PovNode[] }>(filePath);
    const nodes = data.nodes ?? [];
    const nodeIndex = new Map<string, PovNode>();
    for (const node of nodes) nodeIndex.set(node.id, node);

    // Validate all node IDs exist
    const missingIds = povChanges.filter(c => !nodeIndex.has(c.id)).map(c => c.id);
    if (missingIds.length > 0) {
      console.error(`Aborting: ${missingIds.length} node IDs not found in ${fileName}: ${missingIds.join(', ')}`);
      process.exit(1);
    }

    console.log(`[${pov}] ${povChanges.length} changes to apply`);

    let descChanged = 0;
    let attrsChanged = 0;

    for (const change of povChanges) {
      const node = nodeIndex.get(change.id)!;

      // Patch description
      if (change.proposed_description != null) {
        if (dryRun) {
          console.log(`  ${change.id}: description change (${node.description.length} → ${change.proposed_description.length} chars)`);
        }
        node.description = change.proposed_description;
        descChanged++;
      }

      // Merge graph_attributes
      if (change.proposed_graph_attributes && Object.keys(change.proposed_graph_attributes).length > 0) {
        const ga = (node.graph_attributes ?? {}) as Record<string, unknown>;
        (node as unknown as Record<string, unknown>).graph_attributes = ga;
        for (const [key, value] of Object.entries(change.proposed_graph_attributes)) {
          if (dryRun) {
            console.log(`  ${change.id}: graph_attributes.${key}: ${JSON.stringify(ga[key])?.slice(0, 60)} → ${JSON.stringify(value)?.slice(0, 60)}`);
          }
          ga[key] = value;
        }
        attrsChanged++;
      }
    }

    console.log(`  Descriptions updated: ${descChanged}`);
    console.log(`  Graph attributes updated: ${attrsChanged}`);

    if (!dryRun) {
      // Create backup
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupPath = `${filePath}.bak.${timestamp}`;
      fs.copyFileSync(filePath, backupPath);
      console.log(`  Backup: ${backupPath}`);

      // Write updated file
      const json = JSON.stringify(data, null, 2) + '\n';
      fs.writeFileSync(filePath, json, 'utf-8');
      console.log(`  Written: ${filePath}`);
    }

    totalApplied += povChanges.length;
    console.log();
  }

  // Summary
  console.log('─'.repeat(50));
  console.log(`Total: ${totalApplied} nodes patched across ${byPov.size} POV file(s)`);
  if (dryRun) {
    console.log('\nDry run complete — no files were modified.');
  } else {
    console.log('\nApply complete. Backups created for all modified files.');
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
