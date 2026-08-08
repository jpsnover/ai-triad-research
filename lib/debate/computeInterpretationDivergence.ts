// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * CLI script to batch-compute interpretation divergence scores for all situation nodes.
 *
 * Usage:
 *   npx tsx lib/debate/computeInterpretationDivergence.ts [--dry-run]
 *
 * For each situation node, embeds the three POV interpretations using
 * all-MiniLM-L6-v2 (local Python), computes mean pairwise cosine distance,
 * and stores `interpretation_divergence` (0–1) on the node.
 *
 * Per-POV interpretation embeddings are stored in `interpretation_embeddings.json`.
 *
 * --dry-run  Print distribution report without writing files.
 */

import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { resolveRepoRoot, resolveDataRoot } from './taxonomyLoader.js';
import { cosineSimilarity } from './taxonomyRelevance.js';
import { isBdiInterpretation } from './taxonomyTypes.js';
import type { SituationNode, Interpretation } from './taxonomyTypes.js';
import { getGlobalRecorder } from '../flight-recorder/index.js';

// ── Helpers ─────────────────────────────────────────────

function loadJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8').replace(/^\uFEFF/, '')) as T;
}

function findEmbedScript(repoRoot: string): string {
  const candidate = path.join(repoRoot, 'scripts', 'embed_taxonomy.py');
  if (fs.existsSync(candidate)) return candidate;
  throw new Error(`embed_taxonomy.py not found at ${candidate}`);
}

function embedTextLocal(script: string, text: string): number[] {
  const python = process.platform === 'win32' ? 'python' : 'python3';
  const stdout = execFileSync(python, [script, 'encode', text], {
    timeout: 60_000,
    maxBuffer: 10 * 1024 * 1024,
  }).toString('utf-8');
  const jsonStart = stdout.indexOf('[');
  if (jsonStart === -1) throw new Error('No JSON array in embed output');
  return JSON.parse(stdout.slice(jsonStart)) as number[];
}

/** Batch-encode multiple texts in a single Python process invocation. */
function batchEncodeLocal(script: string, items: { id: string; text: string }[]): Record<string, number[]> {
  if (items.length === 0) return {};
  const python = process.platform === 'win32' ? 'python' : 'python3';
  const input = JSON.stringify(items);
  const stdout = execFileSync(python, [script, 'batch-encode'], {
    input,
    timeout: 300_000,
    maxBuffer: 100 * 1024 * 1024,
  }).toString('utf-8');
  const jsonStart = stdout.indexOf('{');
  if (jsonStart === -1) throw new Error('No JSON object in batch-encode output');
  return JSON.parse(stdout.slice(jsonStart)) as Record<string, number[]>;
}

/**
 * Build a full text string from an interpretation for embedding.
 * For BDI-decomposed: concatenates belief + desire + intention + summary.
 * For legacy string: uses the string directly.
 */
function interpretationToEmbedText(interp: Interpretation): string {
  if (isBdiInterpretation(interp)) {
    return [interp.belief, interp.desire, interp.intention, interp.summary]
      .filter(Boolean)
      .join(' ');
  }
  return typeof interp === 'string' ? interp : '';
}

/**
 * Compute mean pairwise cosine distance across three POV embeddings.
 * Returns a value in [0, 1] where 0 = identical and 1 = orthogonal.
 */
function computeDivergence(
  accEmbed: number[],
  safEmbed: number[],
  skpEmbed: number[],
): number {
  const dAccSaf = 1 - cosineSimilarity(accEmbed, safEmbed);
  const dAccSkp = 1 - cosineSimilarity(accEmbed, skpEmbed);
  const dSafSkp = 1 - cosineSimilarity(safEmbed, skpEmbed);
  return (dAccSaf + dAccSkp + dSafSkp) / 3;
}

// ── Embedding cache ─────────────────────────────────────

interface InterpretationEmbeddingsFile {
  model: string;
  dimension: number;
  node_count: number;
  nodes: Record<string, {
    accelerationist: number[];
    safetyist: number[];
    skeptic: number[];
  }>;
}

// ── Main ────────────────────────────────────────────────

const POVS = ['accelerationist', 'safetyist', 'skeptic'] as const;

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const repoRoot = resolveRepoRoot(process.cwd());
  const dataRoot = resolveDataRoot(repoRoot);

  const config = JSON.parse(
    fs.readFileSync(path.join(repoRoot, '.aitriad.json'), 'utf-8').replace(/^\uFEFF/, ''),
  ) as { taxonomy_dir: string };
  const taxonomyDir = path.join(dataRoot, config.taxonomy_dir);

  console.log(`Repo root:    ${repoRoot}`);
  console.log(`Data root:    ${dataRoot}`);
  console.log(`Taxonomy dir: ${taxonomyDir}`);
  console.log(`Mode:         ${dryRun ? 'DRY RUN' : 'WRITE'}`);
  console.log();

  // Load situations
  const sitPath = path.join(taxonomyDir, 'situations.json');
  if (!fs.existsSync(sitPath)) {
    console.error(`situations.json not found at ${sitPath}`);
    process.exit(1);
  }
  const sitData = loadJson<{ nodes: SituationNode[] }>(sitPath);
  const situations = sitData.nodes ?? [];
  console.log(`Loaded ${situations.length} situation nodes.\n`);

  if (situations.length === 0) {
    console.log('No situation nodes to process.');
    return;
  }

  // Load or initialize interpretation embeddings cache
  const interpEmbPath = path.join(taxonomyDir, 'interpretation_embeddings.json');
  let interpEmbs: InterpretationEmbeddingsFile;
  if (fs.existsSync(interpEmbPath)) {
    interpEmbs = loadJson<InterpretationEmbeddingsFile>(interpEmbPath);
    console.log(`Loaded cached interpretation embeddings (${Object.keys(interpEmbs.nodes).length} nodes).`);
  } else {
    interpEmbs = { model: 'all-MiniLM-L6-v2', dimension: 384, node_count: 0, nodes: {} };
    console.log('No cached interpretation embeddings found — will compute all.');
  }

  const script = findEmbedScript(repoRoot);
  let skippedCount = 0;

  // Collect texts needing embedding (skip already-cached)
  const batchItems: { id: string; text: string }[] = [];
  const idToPov = new Map<string, { sitId: string; pov: string }>();

  for (const sit of situations) {
    if (interpEmbs.nodes[sit.id]) {
      skippedCount++;
      continue;
    }
    for (const pov of POVS) {
      const interp = sit.interpretations[pov];
      let text = interpretationToEmbedText(interp);
      if (!text || text.trim().length === 0) {
        console.warn(`  [${sit.id}] Empty ${pov} interpretation — using label+description fallback`);
        text = `${sit.label} ${sit.description}`;
      }
      const batchId = `${sit.id}::${pov}`;
      batchItems.push({ id: batchId, text });
      idToPov.set(batchId, { sitId: sit.id, pov });
    }
  }

  console.log(`\nSkipped ${skippedCount} already-cached situations.`);
  console.log(`Batch-encoding ${batchItems.length} texts (${batchItems.length / 3} situations x 3 POVs)...\n`);

  // Single batch call — one model load, all embeddings at once
  if (batchItems.length > 0) {
    const vectors = batchEncodeLocal(script, batchItems);
    for (const [batchId, vec] of Object.entries(vectors)) {
      const mapping = idToPov.get(batchId);
      if (!mapping) continue;
      const { sitId, pov } = mapping;
      if (!interpEmbs.nodes[sitId]) {
        interpEmbs.nodes[sitId] = {} as InterpretationEmbeddingsFile['nodes'][string];
      }
      (interpEmbs.nodes[sitId] as Record<string, number[]>)[pov] = vec;
    }
    console.log(`Batch embedding complete: ${batchItems.length} texts encoded.\n`);
  } else {
    console.log('All situations already cached — nothing to encode.\n');
  }

  // Compute divergence scores
  const divergences: { id: string; score: number }[] = [];
  for (const sit of situations) {
    const embs = interpEmbs.nodes[sit.id];
    if (!embs) {
      console.warn(`  [${sit.id}] Missing embeddings — skipping divergence computation`);
      continue;
    }

    // Guard: a partially-populated cache entry (e.g. from an interrupted run or a partial
    // batch-encode result) would pass the !embs check but crash cosineSimilarity with
    // undefined input.  Skip and warn instead of throwing.
    const missingPovs = (['accelerationist', 'safetyist', 'skeptic'] as const).filter(p => !embs[p]?.length);
    if (missingPovs.length > 0) {
      console.warn(`  [${sit.id}] Partial embeddings (missing: ${missingPovs.join(', ')}) — skipping divergence computation`);
      continue;
    }

    const score = computeDivergence(embs.accelerationist, embs.safetyist, embs.skeptic);
    const rounded = Math.round(score * 1000) / 1000; // 3 decimal places
    sit.interpretation_divergence = rounded;
    divergences.push({ id: sit.id, score: rounded });
  }

  // Distribution report
  const low = divergences.filter(d => d.score < 0.20);
  const medium = divergences.filter(d => d.score >= 0.20 && d.score <= 0.40);
  const high = divergences.filter(d => d.score > 0.40);

  console.log('─'.repeat(50));
  console.log('Divergence Distribution:');
  console.log(`  Low    (<0.20): ${low.length} situations`);
  console.log(`  Medium (0.20–0.40): ${medium.length} situations`);
  console.log(`  High   (>0.40): ${high.length} situations`);
  console.log();

  if (divergences.length > 0) {
    const scores = divergences.map(d => d.score);
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    const min = Math.min(...scores);
    const max = Math.max(...scores);
    console.log(`  avg=${avg.toFixed(3)}  min=${min.toFixed(3)}  max=${max.toFixed(3)}`);
  }

  // Top 5 most divergent
  const sorted = [...divergences].sort((a, b) => b.score - a.score);
  if (sorted.length >= 5) {
    console.log('\n  Top 5 most divergent:');
    for (const d of sorted.slice(0, 5)) {
      const sit = situations.find(s => s.id === d.id);
      console.log(`    ${d.id} (${d.score.toFixed(3)}): ${sit?.label ?? '?'}`);
    }
  }

  // Bottom 5 least divergent
  if (sorted.length >= 5) {
    console.log('\n  Bottom 5 least divergent:');
    for (const d of sorted.slice(-5).reverse()) {
      const sit = situations.find(s => s.id === d.id);
      console.log(`    ${d.id} (${d.score.toFixed(3)}): ${sit?.label ?? '?'}`);
    }
  }

  console.log();

  // Write
  if (!dryRun) {
    // Write updated situations with interpretation_divergence
    const sitJson = JSON.stringify(sitData, null, 2) + '\n';
    // codeql[js/file-system-race] accepted risk: TOCTOU inherent to read-process-write in single-user batch tools
    fs.writeFileSync(sitPath, sitJson, 'utf-8');
    console.log(`Written: ${sitPath}`);

    // Write interpretation embeddings
    interpEmbs.node_count = Object.keys(interpEmbs.nodes).length;
    const embJson = JSON.stringify(interpEmbs, null, 2) + '\n';
    // codeql[js/file-system-race] accepted risk: TOCTOU inherent to read-process-write in single-user batch tools
    fs.writeFileSync(interpEmbPath, embJson, 'utf-8');
    console.log(`Written: ${interpEmbPath}`);

    console.log('\nDivergence computation complete.');
  } else {
    console.log('Dry run complete — no files were modified.');
    console.log('Run without --dry-run to write changes.');
  }
}

main().catch(err => {
  console.error(err);
  getGlobalRecorder()?.record({
    type: 'system.error',
    level: 'error',
    component: 'compute-interpretation-divergence',
    message: 'Fatal unhandled error',
    error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
  });
  process.exit(1);
});
