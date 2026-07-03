// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * CLI script to batch re-link `used_by_nodes` for all standardized vocabulary
 * terms via embedding similarity.
 *
 * Usage:
 *   npx tsx lib/debate/relinkVocabulary.ts [--dry-run] [--threshold 0.55] [--max-per-term 25]
 *
 * Embeds each term's definition using all-MiniLM-L6-v2 (batch mode), compares
 * against all POV node embeddings (678 acc/saf/skp nodes), and merges new
 * matches into each term's `used_by_nodes` array. Existing manual links are
 * preserved.
 *
 * --dry-run         Print what would change without writing files.
 * --threshold N     Cosine similarity threshold (default 0.55).
 * --max-per-term N  Max total used_by_nodes per term (default 25). Keeps top-N
 *                   by similarity, always preserving existing manual links.
 */

import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { resolveRepoRoot, resolveDataRoot } from './taxonomyLoader.js';
import { getGlobalRecorder } from '../flight-recorder/index.js';

// ── Types ─────────────────────────────────────────────

interface StandardizedTerm {
  canonical_form: string;
  display_form: string;
  definition: string;
  primary_camp_origin: string;
  used_by_nodes: string[];
  [key: string]: unknown;
}

interface EmbeddingsFile {
  model: string;
  dimension: number;
  node_count: number;
  nodes: Record<string, { pov: string; vector: number[] }>;
}

interface RelinkResult {
  term: string;
  existing: number;
  added: string[];
  capped: number;
  total: number;
}

// ── Helpers ──────────────────────────────────────────

function loadJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8').replace(/^\uFEFF/, '')) as T;
}

function findEmbedScript(repoRoot: string): string {
  const candidate = path.join(repoRoot, 'scripts', 'embed_taxonomy.py');
  if (fs.existsSync(candidate)) return candidate;
  throw new Error(`embed_taxonomy.py not found at ${candidate}`);
}

function embedBatchLocal(script: string, items: { id: string; text: string }[]): Map<string, number[]> {
  const python = process.platform === 'win32' ? 'python' : 'python3';
  const input = JSON.stringify(items);
  const stdout = execFileSync(python, [script, 'batch-encode'], {
    input,
    timeout: 120_000,
    maxBuffer: 50 * 1024 * 1024,
  }).toString('utf-8');
  // stdout: {"id1": [vec], "id2": [vec], ...}  — may have info lines before JSON
  const jsonStart = stdout.indexOf('{');
  if (jsonStart === -1) throw new Error('No JSON object in batch-encode output');
  const parsed = JSON.parse(stdout.slice(jsonStart)) as Record<string, number[]>;
  return new Map(Object.entries(parsed));
}

import { cosineSimilarity } from '../embeddings/similarity.js';

// ── Main ─────────────────────────────────────────────

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const thresholdIdx = process.argv.indexOf('--threshold');
  const threshold = thresholdIdx >= 0 ? parseFloat(process.argv[thresholdIdx + 1]) : 0.55;
  const maxIdx = process.argv.indexOf('--max-per-term');
  const maxPerTerm = maxIdx >= 0 ? parseInt(process.argv[maxIdx + 1], 10) : 25;

  const repoRoot = resolveRepoRoot(process.cwd());
  const dataRoot = resolveDataRoot(repoRoot);
  const dictDir = path.join(dataRoot, 'dictionary', 'standardized');
  const config = JSON.parse(
    fs.readFileSync(path.join(repoRoot, '.aitriad.json'), 'utf-8').replace(/^\uFEFF/, ''),
  ) as { taxonomy_dir: string };
  const taxonomyDir = path.join(dataRoot, config.taxonomy_dir);

  console.log(`Repo root:      ${repoRoot}`);
  console.log(`Data root:      ${dataRoot}`);
  console.log(`Dict dir:       ${dictDir}`);
  console.log(`Threshold:      ${threshold}`);
  console.log(`Max per term:   ${maxPerTerm}`);
  console.log(`Mode:           ${dryRun ? 'DRY RUN' : 'WRITE'}`);
  console.log();

  // Load node embeddings (acc/saf/skp only)
  const embeddingsPath = path.join(taxonomyDir, 'embeddings.json');
  const embData = loadJson<EmbeddingsFile>(embeddingsPath);
  const povNodes: Record<string, number[]> = {};
  for (const [nodeId, entry] of Object.entries(embData.nodes)) {
    if (entry.pov === 'accelerationist' || entry.pov === 'safetyist' || entry.pov === 'skeptic') {
      povNodes[nodeId] = entry.vector;
    }
  }
  console.log(`Loaded ${Object.keys(povNodes).length} POV node embeddings (${embData.model}, ${embData.dimension}d)`);

  // Load all standardized terms
  const termFiles = fs.readdirSync(dictDir).filter(f => f.endsWith('.json'));
  const terms: { file: string; data: StandardizedTerm }[] = [];
  for (const file of termFiles) {
    const data = loadJson<StandardizedTerm>(path.join(dictDir, file));
    terms.push({ file, data });
  }
  console.log(`Loaded ${terms.length} standardized terms`);
  console.log();

  // Batch-embed all term definitions in one call
  const script = findEmbedScript(repoRoot);
  console.log('Batch-embedding term definitions...');
  const batchItems = terms.map(t => ({ id: t.data.canonical_form, text: t.data.definition }));
  const termEmbeddings = embedBatchLocal(script, batchItems);
  console.log(`Embedded ${termEmbeddings.size} definitions`);
  console.log();

  // Compute similarities and build re-link results
  const results: RelinkResult[] = [];
  let totalAdded = 0;
  // Track all linked nodes for coverage (including dry-run projections)
  const allLinkedNodes = new Set<string>();

  for (const { file, data } of terms) {
    const termVec = termEmbeddings.get(data.canonical_form)!;
    const existing = new Set(data.used_by_nodes ?? []);

    // Add existing links to coverage set
    for (const id of existing) allLinkedNodes.add(id);

    // Score all POV nodes
    const scored: { nodeId: string; score: number }[] = [];
    for (const [nodeId, nodeVec] of Object.entries(povNodes)) {
      const sim = cosineSimilarity(termVec, nodeVec);
      if (sim >= threshold) {
        scored.push({ nodeId, score: sim });
      }
    }
    scored.sort((a, b) => b.score - a.score);

    // Merge: keep existing + add new top matches, capped at maxPerTerm total
    const added: string[] = [];
    const budget = Math.max(0, maxPerTerm - existing.size);
    for (const { nodeId } of scored) {
      if (added.length >= budget) break;
      if (!existing.has(nodeId)) {
        added.push(nodeId);
      }
    }

    // Track new links for coverage
    for (const id of added) allLinkedNodes.add(id);

    if (added.length > 0) {
      const merged = [...(data.used_by_nodes ?? []), ...added];
      const capped = scored.filter(s => !existing.has(s.nodeId)).length - added.length;
      results.push({
        term: data.canonical_form,
        existing: existing.size,
        added,
        capped: capped > 0 ? capped : 0,
        total: merged.length,
      });
      totalAdded += added.length;

      if (!dryRun) {
        data.used_by_nodes = merged;
        const filePath = path.join(dictDir, file);
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
      }
    }
  }

  // Summary
  console.log('─── Results ───────────────────────────────────────');
  for (const r of results) {
    const cappedNote = r.capped > 0 ? ` (${r.capped} above threshold not added — cap)` : '';
    console.log(`${r.term}: ${r.existing} existing + ${r.added.length} new = ${r.total} total${cappedNote}`);
    if (r.added.length <= 15) {
      console.log(`  added: ${r.added.join(', ')}`);
    } else {
      console.log(`  added: ${r.added.slice(0, 15).join(', ')} (+${r.added.length - 15} more)`);
    }
  }
  console.log();
  console.log(`Terms updated: ${results.length} / ${terms.length}`);
  console.log(`New links added: ${totalAdded}`);
  console.log(`Mode: ${dryRun ? 'DRY RUN — no files written' : 'WRITTEN'}`);

  // Coverage report (works correctly in dry-run mode)
  const totalPovNodes = Object.keys(povNodes).length;
  const coverage = (allLinkedNodes.size / totalPovNodes * 100).toFixed(1);
  console.log(`Coverage: ${allLinkedNodes.size} / ${totalPovNodes} nodes (${coverage}%)`);
}

main().catch(err => {
  console.error(err);
  getGlobalRecorder().record({
    type: 'system.error',
    level: 'error',
    component: 'relink-vocabulary',
    message: 'Fatal unhandled error',
    error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
  });
  process.exitCode = 1;
});
