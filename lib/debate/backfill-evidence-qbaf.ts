#!/usr/bin/env npx tsx
// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Backfill evidence QBAFs on existing debate Belief nodes.
 *
 * Scans all debate sessions, finds Belief nodes without evidence_graph,
 * runs the evidence retriever + QBAF pipeline, and updates the nodes.
 *
 * Usage:
 *   npx tsx lib/debate/backfill-evidence-qbaf.ts [options]
 *
 * Options:
 *   --dry-run         Log what would change without writing (default: true)
 *   --write           Actually write changes to disk
 *   --model <id>      Model for LLM classification (default: gemini-3.1-flash-lite-preview)
 *   --throttle <ms>   Delay between LLM calls in ms (default: 500)
 *   --limit <n>       Max debates to process (default: all)
 *   --top-k <n>       Evidence items per claim (default: 10)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { retrieveEvidence, clearSourceIndex } from './evidenceRetriever.js';
import { buildEvidenceQbaf } from './evidenceQbaf.js';
import type { EvidenceQbafResult } from './evidenceQbaf.js';
import { createCLIAdapter } from './aiAdapter.js';
import { resolveRepoRoot, resolveDataRoot, resolveSourcesDir } from './taxonomyLoader.js';
import type { ArgumentNetworkNode } from './types.js';

// ── CLI argument parsing ─────────────────────────────────

interface BackfillOptions {
  dryRun: boolean;
  model: string;
  throttleMs: number;
  limit: number;
  topK: number;
}

function parseArgs(): BackfillOptions {
  const args = process.argv.slice(2);
  const opts: BackfillOptions = {
    dryRun: !args.includes('--write'),
    model: 'gemini-3.1-flash-lite-preview',
    throttleMs: 500,
    limit: Infinity,
    topK: 10,
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--model' && args[i + 1]) opts.model = args[++i];
    if (args[i] === '--throttle' && args[i + 1]) opts.throttleMs = parseInt(args[++i], 10);
    if (args[i] === '--limit' && args[i + 1]) opts.limit = parseInt(args[++i], 10);
    if (args[i] === '--top-k' && args[i + 1]) opts.topK = parseInt(args[++i], 10);
  }

  return opts;
}

// ── Logging ──────────────────────────────────────────────

function log(msg: string): void {
  process.stderr.write(`[backfill] ${msg}\n`);
}

// ── Evidence cache ───────────────────────────────────────

const evidenceCache = new Map<string, EvidenceQbafResult>();

function cacheKey(claimText: string): string {
  // Normalize whitespace for cache hits across debates
  return claimText.trim().toLowerCase().replace(/\s+/g, ' ');
}

// ── Throttle ─────────────────────────────────────────────

let lastCallTime = 0;

async function throttle(ms: number): Promise<void> {
  if (ms <= 0 || lastCallTime === 0) {
    lastCallTime = Date.now();
    return;
  }
  const elapsed = Date.now() - lastCallTime;
  if (elapsed < ms) {
    await new Promise(r => setTimeout(r, ms - elapsed));
  }
  lastCallTime = Date.now();
}

// ── Main ─────────────────────────────────────────────────

interface BackfillStats {
  debatesScanned: number;
  debatesModified: number;
  nodesTotal: number;
  nodesSkipped: number;
  nodesProcessed: number;
  nodesUpdated: number;
  nodesNoEvidence: number;
  nodesFailed: number;
  cacheHits: number;
  strengthChanges: { nodeId: string; debateId: string; oldStrength: number; newStrength: number }[];
}

async function main(): Promise<void> {
  const opts = parseArgs();
  const __dir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolveRepoRoot(__dir);
  const dataRoot = resolveDataRoot(repoRoot);
  const debatesDir = path.join(dataRoot, 'debates');
  const sourcesDir = resolveSourcesDir(repoRoot);

  log(`Mode: ${opts.dryRun ? 'DRY RUN' : 'WRITE'}`);
  log(`Model: ${opts.model}`);
  log(`Throttle: ${opts.throttleMs}ms`);
  log(`Top-K: ${opts.topK}`);
  log(`Debates dir: ${debatesDir}`);
  log(`Sources dir: ${sourcesDir ?? 'NOT FOUND'}`);

  if (!sourcesDir) {
    log('ERROR: Sources directory not found. Cannot retrieve evidence.');
    process.exit(1);
  }

  if (!fs.existsSync(debatesDir)) {
    log(`ERROR: Debates directory not found: ${debatesDir}`);
    process.exit(1);
  }

  // Create adapter for LLM classification calls
  const adapter = createCLIAdapter(repoRoot);

  // Find all debate session files
  const debateFiles = fs.readdirSync(debatesDir)
    .filter(f => f.startsWith('debate-') && f.endsWith('.json'))
    .slice(0, opts.limit);

  log(`Found ${debateFiles.length} debate files`);

  const stats: BackfillStats = {
    debatesScanned: 0,
    debatesModified: 0,
    nodesTotal: 0,
    nodesSkipped: 0,
    nodesProcessed: 0,
    nodesUpdated: 0,
    nodesNoEvidence: 0,
    nodesFailed: 0,
    cacheHits: 0,
    strengthChanges: [],
  };

  for (const file of debateFiles) {
    const filePath = path.join(debatesDir, file);
    stats.debatesScanned++;

    let session: { id: string; argument_network?: { nodes: ArgumentNetworkNode[] } };
    try {
      session = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch (err) {
      log(`SKIP ${file}: parse error — ${err instanceof Error ? err.message : err}`);
      continue;
    }

    const nodes = session.argument_network?.nodes;
    if (!nodes || nodes.length === 0) {
      continue;
    }

    // Find qualifying Belief nodes without evidence_graph
    const beliefNodes = nodes.filter(n =>
      n.bdi_category === 'belief' &&
      !n.evidence_graph,
    );

    if (beliefNodes.length === 0) continue;

    stats.nodesTotal += beliefNodes.length;
    let debateModified = false;

    for (const node of beliefNodes) {
      const key = cacheKey(node.text);

      // Check cache first
      if (evidenceCache.has(key)) {
        const cached = evidenceCache.get(key)!;
        stats.cacheHits++;

        if (cached.evidence_items.length === 0) {
          stats.nodesNoEvidence++;
          continue;
        }

        applyResult(node, cached, session.id, stats, opts.dryRun);
        debateModified = true;
        continue;
      }

      // Retrieve evidence
      const evidenceItems = retrieveEvidence(node.text, sourcesDir, { topK: opts.topK });

      if (evidenceItems.length === 0) {
        evidenceCache.set(key, { computed_strength: 0.5, qbaf_iterations: 0, evidence_items: [] });
        stats.nodesNoEvidence++;
        continue;
      }

      // LLM classification + QBAF
      await throttle(opts.throttleMs);
      stats.nodesProcessed++;

      try {
        const result = await buildEvidenceQbaf(
          node.text,
          evidenceItems,
          adapter,
          opts.model,
          { claimBaseStrength: node.base_strength ?? 0.5 },
        );

        evidenceCache.set(key, result);

        if (result.evidence_items.length === 0) {
          stats.nodesNoEvidence++;
          continue;
        }

        applyResult(node, result, session.id, stats, opts.dryRun);
        debateModified = true;
      } catch (err) {
        stats.nodesFailed++;
        log(`  FAIL ${node.id} in ${file}: ${err instanceof Error ? err.message.slice(0, 100) : err}`);
        // Cache failure as empty to avoid retrying same claim
        evidenceCache.set(key, { computed_strength: 0.5, qbaf_iterations: 0, evidence_items: [] });
      }
    }

    // Write updated debate back to disk
    if (debateModified && !opts.dryRun) {
      try {
        fs.writeFileSync(filePath, JSON.stringify(session, null, 2) + '\n', 'utf-8');
        stats.debatesModified++;
        log(`  WROTE ${file}`);
      } catch (err) {
        log(`  WRITE ERROR ${file}: ${err instanceof Error ? err.message : err}`);
      }
    } else if (debateModified) {
      stats.debatesModified++;
      log(`  WOULD WRITE ${file}`);
    }
  }

  // Summary
  log('');
  log('=== BACKFILL SUMMARY ===');
  log(`Debates scanned:  ${stats.debatesScanned}`);
  log(`Debates modified: ${stats.debatesModified}${opts.dryRun ? ' (dry run)' : ''}`);
  log(`Belief nodes:     ${stats.nodesTotal}`);
  log(`  Skipped (have evidence_graph): ${stats.nodesSkipped}`);
  log(`  Processed (LLM calls):         ${stats.nodesProcessed}`);
  log(`  Updated:                       ${stats.nodesUpdated}`);
  log(`  No evidence found:             ${stats.nodesNoEvidence}`);
  log(`  Failed:                        ${stats.nodesFailed}`);
  log(`  Cache hits:                    ${stats.cacheHits}`);
  log('');

  if (stats.strengthChanges.length > 0) {
    log('Strength changes:');
    for (const c of stats.strengthChanges.slice(0, 20)) {
      const delta = c.newStrength - c.oldStrength;
      log(`  ${c.debateId}/${c.nodeId}: ${c.oldStrength.toFixed(2)} → ${c.newStrength.toFixed(2)} (${delta >= 0 ? '+' : ''}${delta.toFixed(2)})`);
    }
    if (stats.strengthChanges.length > 20) {
      log(`  ... and ${stats.strengthChanges.length - 20} more`);
    }
  }

  // Clean up
  clearSourceIndex();
}

function applyResult(
  node: ArgumentNetworkNode,
  result: EvidenceQbafResult,
  debateId: string,
  stats: BackfillStats,
  dryRun: boolean,
): void {
  const oldStrength = node.base_strength ?? 0.5;
  const newStrength = result.computed_strength;

  stats.nodesUpdated++;
  stats.strengthChanges.push({
    nodeId: node.id,
    debateId,
    oldStrength,
    newStrength,
  });

  const supportCount = result.evidence_items.filter(e => e.relation === 'support').length;
  const contradictCount = result.evidence_items.filter(e => e.relation === 'contradict').length;
  const delta = newStrength - oldStrength;

  log(`  ${dryRun ? 'WOULD UPDATE' : 'UPDATE'} ${node.id}: ${oldStrength.toFixed(2)} → ${newStrength.toFixed(2)} (${delta >= 0 ? '+' : ''}${delta.toFixed(2)}, ${supportCount}S/${contradictCount}C)`);

  if (!dryRun) {
    node.base_strength = newStrength;
    node.scoring_method = 'fact_check';
    node.verification_status = newStrength >= 0.6 ? 'verified'
      : newStrength <= 0.4 ? 'disputed' : 'unverifiable';
    node.evidence_graph = {
      evidence_items: result.evidence_items,
      computed_strength: result.computed_strength,
      qbaf_iterations: result.qbaf_iterations,
    };
  }
}

main().catch(err => {
  log(`FATAL: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
