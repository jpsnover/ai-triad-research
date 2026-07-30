// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Batch edge weight modulation by endpoint confidence and priority.
 *
 * Usage:
 *   npx tsx lib/debate/modulateEdgeWeights.ts [--dry-run]
 *
 * Prerequisite: Run assignWeights.ts first to populate confidence/priority on nodes.
 *
 * For each edge in edges.json, computes modulated_weight = weight × modulation_factor
 * where the factor depends on endpoint BDI categories and edge type.
 *
 * See docs/weighted-bdi-proposal.md §"Edge Weight Modulation by Confidence and Priority"
 */

import fs from 'fs';
import path from 'path';
import { resolveRepoRoot, resolveDataRoot } from './taxonomyLoader.js';
import type { PovNode, Edge, EdgesFile } from './taxonomyTypes.js';
import { extractCategoryFromId } from './validateNodeId.js';
import type { Category } from './taxonomyTypes.js';
import { getGlobalRecorder } from '../flight-recorder/index.js';
import { serializeEdgesJson } from '../edges/serializeEdges.js';

// ── Helpers ─────────────────────────────────────────────

function loadJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8').replace(/^\uFEFF/, '')) as T;
}

interface NodeIndex {
  category?: Category;
  confidence?: number;
  priority?: number;
  doctrinally_anchored?: boolean;
}

function buildNodeIndex(taxonomyDir: string): Map<string, NodeIndex> {
  const index = new Map<string, NodeIndex>();
  for (const file of ['accelerationist.json', 'safetyist.json', 'skeptic.json']) {
    const filePath = path.join(taxonomyDir, file);
    if (!fs.existsSync(filePath)) continue;
    const data = loadJson<{ nodes: PovNode[] }>(filePath);
    for (const node of data.nodes ?? []) {
      index.set(node.id, {
        category: node.category,
        confidence: node.confidence,
        priority: node.priority,
        doctrinally_anchored: node.doctrinally_anchored,
      });
    }
  }
  return index;
}

// ── Modulation logic ────────────────────────────────────

const ATTACK_TYPES = new Set(['CONTRADICTS', 'WEAKENS']);
const SUPPORT_TYPES = new Set(['SUPPORTS', 'ASSUMES']);

export function computeModulationFactor(
  edge: Edge,
  sourceNode: NodeIndex | undefined,
  targetNode: NodeIndex | undefined,
): number {
  const srcCat = sourceNode?.category ?? extractCategoryFromId(edge.source);
  const tgtCat = targetNode?.category ?? extractCategoryFromId(edge.target);

  let factor = 1.0;

  // B→B edges
  if (srcCat === 'Beliefs' && tgtCat === 'Beliefs') {
    if (ATTACK_TYPES.has(edge.type)) {
      // CONTRADICTS/WEAKENS: min(source.confidence, target.confidence)
      const srcConf = sourceNode?.confidence;
      const tgtConf = targetNode?.confidence;
      if (srcConf !== undefined && tgtConf !== undefined) {
        factor = Math.min(srcConf, tgtConf);
      }
    } else if (SUPPORT_TYPES.has(edge.type)) {
      // SUPPORTS/ASSUMES: source.confidence
      if (sourceNode?.confidence !== undefined) {
        factor = sourceNode.confidence;
      }
    }
  }

  // D→I edges (SUPPORTS)
  else if (srcCat === 'Desires' && tgtCat === 'Intentions') {
    if (SUPPORT_TYPES.has(edge.type) && sourceNode?.priority !== undefined) {
      factor = sourceNode.priority / 5;
    }
  }

  // B→I edges (SUPPORTS/ASSUMES)
  else if (srcCat === 'Beliefs' && tgtCat === 'Intentions') {
    if (SUPPORT_TYPES.has(edge.type) && sourceNode?.confidence !== undefined) {
      factor = sourceNode.confidence;
    }
  }

  // B→D edges (ASSUMES — rare)
  else if (srcCat === 'Beliefs' && tgtCat === 'Desires') {
    if (sourceNode?.confidence !== undefined) {
      factor = sourceNode.confidence;
    }
  }

  // Doctrinal anchoring multiplier
  if (ATTACK_TYPES.has(edge.type) && targetNode?.doctrinally_anchored) {
    factor = Math.min(1.0, factor * 1.2);
  } else if (SUPPORT_TYPES.has(edge.type) && sourceNode?.doctrinally_anchored) {
    factor = Math.min(1.0, factor * 1.1);
  }

  return Math.round(factor * 1000) / 1000; // 3 decimal places
}

// ── Validation report ───────────────────────────────────

interface ValidationReport {
  totalEdges: number;
  modulatedEdges: number;
  unchangedEdges: number;
  skippedNoWeight: number;
  significantDelta: number; // |modulated - raw| > 0.1
  nearZero: number;        // modulated_weight < 0.05
  doctrinallyTouched: number;
  byType: Record<string, { count: number; avgFactor: number }>;
}

function printReport(report: ValidationReport): void {
  console.log('\n── Validation Report ──────────────────────────');
  console.log(`Total edges:             ${report.totalEdges}`);
  console.log(`Modulated:               ${report.modulatedEdges}`);
  console.log(`Unchanged (factor=1.0):  ${report.unchangedEdges}`);
  console.log(`Skipped (no weight):     ${report.skippedNoWeight}`);
  console.log(`Significant delta (>0.1): ${report.significantDelta}`);
  console.log(`Near-zero (<0.05):       ${report.nearZero}`);
  console.log(`Doctrinal endpoints:     ${report.doctrinallyTouched}`);
  console.log();
  console.log('By edge type:');
  for (const [type, data] of Object.entries(report.byType).sort((a, b) => a[0].localeCompare(b[0]))) {
    console.log(`  ${type.padEnd(18)} ${String(data.count).padStart(5)} edges  avg factor: ${data.avgFactor.toFixed(3)}`);
  }
}

// ── Main ────────────────────────────────────────────────

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const repoRoot = resolveRepoRoot(process.cwd());
  const dataRoot = resolveDataRoot(repoRoot);
  const config = loadJson<{ taxonomy_dir: string }>(path.join(repoRoot, '.aitriad.json'));
  const taxonomyDir = path.join(dataRoot, config.taxonomy_dir);

  console.log(`Taxonomy dir: ${taxonomyDir}`);
  console.log(`Mode:         ${dryRun ? 'DRY RUN' : 'WRITE'}`);
  console.log();

  // Build node index from POV files
  console.log('Loading node data...');
  const nodeIndex = buildNodeIndex(taxonomyDir);
  const withConfidence = [...nodeIndex.values()].filter(n => n.confidence !== undefined).length;
  const withPriority = [...nodeIndex.values()].filter(n => n.priority !== undefined).length;
  console.log(`  ${nodeIndex.size} nodes indexed (${withConfidence} with confidence, ${withPriority} with priority)`);

  if (withConfidence === 0 && withPriority === 0) {
    console.error('\nNo nodes have confidence or priority assigned. Run assignWeights.ts first.');
    process.exit(1);
  }

  // Load edges
  const edgesPath = path.join(taxonomyDir, 'edges.json');
  if (!fs.existsSync(edgesPath)) {
    console.error(`edges.json not found at ${edgesPath}`);
    process.exit(1);
  }
  const edgesFile = loadJson<EdgesFile>(edgesPath);
  const edges = edgesFile.edges ?? [];
  console.log(`  ${edges.length} edges loaded`);
  console.log();

  // Modulate
  const report: ValidationReport = {
    totalEdges: edges.length,
    modulatedEdges: 0,
    unchangedEdges: 0,
    skippedNoWeight: 0,
    significantDelta: 0,
    nearZero: 0,
    doctrinallyTouched: 0,
    byType: {},
  };

  for (const edge of edges) {
    if (edge.weight == null) {
      report.skippedNoWeight++;
      continue;
    }

    const srcNode = nodeIndex.get(edge.source);
    const tgtNode = nodeIndex.get(edge.target);

    const factor = computeModulationFactor(edge, srcNode, tgtNode);
    const modulated = Math.round(edge.weight * factor * 1000) / 1000;

    edge.modulated_weight = modulated;

    // Track stats
    const typeKey = edge.type;
    if (!report.byType[typeKey]) report.byType[typeKey] = { count: 0, avgFactor: 0 };
    report.byType[typeKey].count++;
    report.byType[typeKey].avgFactor += factor;

    if (Math.abs(factor - 1.0) < 0.001) {
      report.unchangedEdges++;
    } else {
      report.modulatedEdges++;
    }

    if (Math.abs(modulated - edge.weight) > 0.1) {
      report.significantDelta++;
    }
    if (modulated < 0.05 && edge.weight >= 0.05) {
      report.nearZero++;
    }
    if (srcNode?.doctrinally_anchored || tgtNode?.doctrinally_anchored) {
      report.doctrinallyTouched++;
    }
  }

  // Compute average factors
  for (const data of Object.values(report.byType)) {
    data.avgFactor = data.count > 0 ? data.avgFactor / data.count : 1.0;
  }

  printReport(report);

  // Write
  if (!dryRun) {
    edgesFile.last_modified = new Date().toISOString();
    // codeql[js/file-system-race] accepted risk: TOCTOU inherent to read-process-write in single-user batch tools
    fs.writeFileSync(edgesPath, serializeEdgesJson(edgesFile), 'utf-8');
    console.log(`\nWritten: ${edgesPath}`);
  } else {
    console.log('\nDry run complete — no files were modified.');
  }
}

main().catch(err => {
  console.error(err);
  getGlobalRecorder()?.record({
    type: 'system.error',
    level: 'error',
    component: 'modulate-edge-weights',
    message: 'Fatal unhandled error',
    error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
  });
  process.exit(1);
});
