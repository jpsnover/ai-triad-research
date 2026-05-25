// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * CLI script to batch-assign Belief confidence, doctrinal anchoring, and Desire priority
 * to all POV taxonomy nodes.
 *
 * Usage:
 *   npx tsx lib/debate/assignWeights.ts [--dry-run]
 *
 * Loads taxonomy data from disk, computes multi-signal confidence for Beliefs,
 * applies doctrinal anchoring (requires GEMINI_API_KEY), assigns hierarchy-based
 * priority for Desires, and writes updated JSON back.
 *
 * --dry-run  Print what would change without writing files.
 */

import fs from 'fs';
import path from 'path';
import { resolveRepoRoot, resolveDataRoot } from './taxonomyLoader.js';
import { assignBeliefConfidences } from './beliefConfidence.js';
import type { BeliefConfidenceInput } from './beliefConfidence.js';
import { assignDesirePriorities } from './desirePriority.js';
import { assignIntentionOperationality } from './intentionOperationality.js';
import { computeDoctrinalAnchoring, checkThresholdAnomalies } from './doctrinalAnchoring.js';
import type { AnchoringResult, BoundaryEmbeddings } from './doctrinalAnchoring.js';
import { POVER_INFO } from './types.js';
import type { PovNode, EdgesFile } from './taxonomyTypes.js';
import type { Edge } from './taxonomyTypes.js';
import { execFileSync } from 'child_process';

// ── Helpers ─────────────────────────────────────────────

interface SourceEvidenceIndex {
  [nodeId: string]: { facts: { doc_id: string }[] };
}

function loadJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8').replace(/^\uFEFF/, '')) as T;
}

function countSourceDocs(nodeId: string, index: SourceEvidenceIndex): number {
  const entry = index[nodeId];
  if (!entry?.facts) return 0;
  const uniqueDocs = new Set(entry.facts.map(f => f.doc_id));
  return uniqueDocs.size;
}

// ── Main ────────────────────────────────────────────────

const POV_FILES: { key: string; speakerId: 'accelerationist' | 'safetyist' | 'skeptic'; file: string }[] = [
  { key: 'accelerationist', speakerId: 'accelerationist', file: 'accelerationist.json' },
  { key: 'safetyist', speakerId: 'safetyist', file: 'safetyist.json' },
  { key: 'skeptic', speakerId: 'skeptic', file: 'skeptic.json' },
];

// ── Doctrinal boundary embedding (local Python, all-MiniLM-L6-v2) ──

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
  // stdout may have "Loading model..." lines before the JSON array
  const jsonStart = stdout.indexOf('[');
  if (jsonStart === -1) throw new Error('No JSON array in embed output');
  return JSON.parse(stdout.slice(jsonStart)) as number[];
}

function embedBoundariesLocal(repoRoot: string): BoundaryEmbeddings {
  const script = findEmbedScript(repoRoot);
  const result: BoundaryEmbeddings = {};
  const speakerIds = ['accelerationist', 'safetyist', 'skeptic'] as const;
  for (const speakerId of speakerIds) {
    const pov = POVER_INFO[speakerId].pov;
    const strings = POVER_INFO[speakerId].doctrinal_boundaries;
    console.log(`  Embedding ${strings.length} boundary strings for ${pov}...`);
    result[pov] = strings.map(s => embedTextLocal(script, s.replace(/^REJECT:\s*/i, '')));
  }
  return result;
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const repoRoot = resolveRepoRoot(process.cwd());
  const dataRoot = resolveDataRoot(repoRoot);

  // Read .aitriad.json for taxonomy_dir
  const config = JSON.parse(
    fs.readFileSync(path.join(repoRoot, '.aitriad.json'), 'utf-8').replace(/^\uFEFF/, ''),
  ) as { taxonomy_dir: string };
  const taxonomyDir = path.join(dataRoot, config.taxonomy_dir);

  console.log(`Repo root:    ${repoRoot}`);
  console.log(`Data root:    ${dataRoot}`);
  console.log(`Taxonomy dir: ${taxonomyDir}`);
  console.log(`Mode:         ${dryRun ? 'DRY RUN' : 'WRITE'}`);
  console.log();

  // Load edges
  const edgesPath = path.join(taxonomyDir, 'edges.json');
  const edgesFile = fs.existsSync(edgesPath)
    ? loadJson<EdgesFile>(edgesPath)
    : null;
  const edges: Edge[] = edgesFile?.edges ?? [];

  // Load source evidence index
  const evidencePath = path.join(taxonomyDir, 'source_evidence_index.json');
  const evidenceIndex: SourceEvidenceIndex = fs.existsSync(evidencePath)
    ? loadJson<SourceEvidenceIndex>(evidencePath)
    : {};

  // Load node embeddings for doctrinal anchoring
  const embeddingsPath = path.join(taxonomyDir, 'embeddings.json');
  const embeddingsRaw = fs.existsSync(embeddingsPath)
    ? loadJson<{ nodes?: Record<string, { pov: string; vector: number[] }> }>(embeddingsPath)
    : { nodes: {} };
  const nodeEmbeddings = embeddingsRaw.nodes ?? {};

  // Embed doctrinal boundary strings (local Python, same model as embeddings.json)
  let boundaryEmbeddings: BoundaryEmbeddings | null = null;
  console.log('Embedding doctrinal boundaries (all-MiniLM-L6-v2)...');
  try {
    boundaryEmbeddings = embedBoundariesLocal(repoRoot);
    console.log('  Done.\n');
  } catch (err) {
    console.error(`  Failed: ${err instanceof Error ? err.message : err}`);
    console.error('  Continuing without doctrinal anchoring.\n');
  }

  const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  let totalBeliefs = 0;
  let totalDesires = 0;
  let totalIntentions = 0;
  let totalAnchored = 0;
  let totalFloorApplied = 0;

  for (const { key, speakerId, file } of POV_FILES) {
    const filePath = path.join(taxonomyDir, file);
    if (!fs.existsSync(filePath)) {
      console.log(`[${key}] File not found: ${filePath} — skipping`);
      continue;
    }

    const data = loadJson<{ nodes: PovNode[] }>(filePath);
    const nodes = data.nodes ?? [];

    // ── Belief confidence ─────────────────────────────
    const beliefInputs: BeliefConfidenceInput[] = nodes
      .filter(n => n.category === 'Beliefs')
      .map(n => ({ node: n, sourceDocCount: countSourceDocs(n.id, evidenceIndex) }));

    const beliefResults = assignBeliefConfidences(beliefInputs, edges, date);
    totalBeliefs += beliefResults.length;

    // ── Doctrinal anchoring ───────────────────────────
    let anchoringResults: AnchoringResult[] = [];
    if (boundaryEmbeddings?.[key]) {
      anchoringResults = computeDoctrinalAnchoring(
        nodes, boundaryEmbeddings[key], nodeEmbeddings,
      );
      const anchored = anchoringResults.filter(r => r.anchored).length;
      const floored = anchoringResults.filter(r => r.floorApplied).length;
      totalAnchored += anchored;
      totalFloorApplied += floored;

      const anomaly = checkThresholdAnomalies(anchoringResults, beliefResults.length);
      if (anomaly) console.log(`  ${anomaly.warning}`);
    }

    // ── Desire priority ───────────────────────────────
    // No doctrinal boundary node IDs defined yet — pass empty set.
    // Priority 5 ("Core") is reserved for future manual curation.
    const desireResults = assignDesirePriorities(nodes, new Set<string>(), date);
    totalDesires += desireResults.length;

    // ── Intention operationality ──────────────────────
    const intentionResults = assignIntentionOperationality(nodes, date);
    totalIntentions += intentionResults.length;

    // ── Summary ───────────────────────────────────────
    console.log(`[${key}]`);
    console.log(`  Beliefs:    ${beliefResults.length} nodes assigned confidence`);
    if (beliefResults.length > 0) {
      const confs = beliefResults.map(r => r.confidence);
      const avg = confs.reduce((a, b) => a + b, 0) / confs.length;
      const min = Math.min(...confs);
      const max = Math.max(...confs);
      console.log(`    avg=${avg.toFixed(2)}  min=${min.toFixed(2)}  max=${max.toFixed(2)}`);
    }
    if (anchoringResults.length > 0) {
      const anchored = anchoringResults.filter(r => r.anchored).length;
      const floored = anchoringResults.filter(r => r.floorApplied).length;
      console.log(`    anchored: ${anchored}/${beliefResults.length}  floor applied: ${floored}`);
    }

    console.log(`  Desires:    ${desireResults.length} nodes assigned priority`);
    if (desireResults.length > 0) {
      const counts = [0, 0, 0, 0, 0, 0]; // index 1-5
      for (const r of desireResults) counts[r.priority]++;
      const dist = [1, 2, 3, 4, 5].map(p => `P${p}:${counts[p]}`).join('  ');
      console.log(`    ${dist}`);
    }

    console.log(`  Intentions: ${intentionResults.length} nodes assigned operationality`);
    if (intentionResults.length > 0) {
      const counts = [0, 0, 0, 0, 0, 0]; // index 1-5
      for (const r of intentionResults) counts[r.operationality]++;
      const dist = [1, 2, 3, 4, 5].map(p => `O${p}:${counts[p]}`).join('  ');
      console.log(`    ${dist}`);
    }
    console.log();

    // ── Write back ────────────────────────────────────
    if (!dryRun) {
      const json = JSON.stringify(data, null, 2) + '\n';
      fs.writeFileSync(filePath, json, 'utf-8');
      console.log(`  Written: ${filePath}`);
    }
  }

  console.log('─'.repeat(50));
  console.log(`Total: ${totalBeliefs} Beliefs, ${totalDesires} Desires, ${totalIntentions} Intentions`);
  if (boundaryEmbeddings) {
    console.log(`Anchoring: ${totalAnchored} doctrinally anchored, ${totalFloorApplied} confidence floors applied`);
  }
  if (dryRun) {
    console.log('\nDry run complete — no files were modified.');
    console.log('Run without --dry-run to write changes.');
  } else {
    console.log('\nWeight assignment complete.');
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
