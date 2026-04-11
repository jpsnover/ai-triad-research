#!/usr/bin/env node
// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Pre-compute semantic clusters for conflict files.
 *
 * Reads all conflict JSON files, computes embeddings + agglomerative clustering
 * in Python (scikit-learn), labels clusters via Gemini, and writes
 * _conflict-clusters.json to the data directory.
 *
 * Usage:
 *   node scripts/compute-conflict-clusters.mjs
 *   node scripts/compute-conflict-clusters.mjs --max-clusters 12
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_ROOT = process.env.AI_TRIAD_DATA_ROOT || path.resolve(__dirname, '..', '..', 'ai-triad-data');
const CONFLICTS_DIR = path.join(DATA_ROOT, 'conflicts');
const OUTPUT_FILE = path.join(DATA_ROOT, 'conflicts', '_conflict-clusters.json');

// Parse args
const args = process.argv.slice(2);
const maxClustersArg = args.indexOf('--max-clusters');
const MAX_CLUSTERS = maxClustersArg >= 0 ? parseInt(args[maxClustersArg + 1], 10) : 15;

// ── Load conflicts ──────────────────────────────────────────────

function loadConflicts() {
  const files = fs.readdirSync(CONFLICTS_DIR)
    .filter(f => f.endsWith('.json') && !f.startsWith('_'));
  const conflicts = [];
  for (const f of files) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(CONFLICTS_DIR, f), 'utf-8'));
      conflicts.push({
        claim_id: data.claim_id,
        claim_label: data.claim_label || '',
        description: data.description || '',
        status: data.status || 'open',
      });
    } catch (err) {
      console.warn(`  Skipping ${f}: ${err.message}`);
    }
  }
  return conflicts.sort((a, b) => a.claim_label.localeCompare(b.claim_label));
}

// ── Compute embeddings + clustering in Python ───────────────────

function embedAndCluster(texts, ids, maxClusters) {
  const tmpDir = os.tmpdir();
  const inputFile = path.join(tmpDir, 'conflict-cluster-input.json');
  const outputFile = path.join(tmpDir, 'conflict-cluster-output.json');
  const scriptFile = path.join(tmpDir, 'conflict-cluster.py');

  fs.writeFileSync(inputFile, JSON.stringify({ texts, ids, max_clusters: maxClusters }));
  fs.writeFileSync(scriptFile, `
import json
import numpy as np
from sentence_transformers import SentenceTransformer
from sklearn.cluster import AgglomerativeClustering
from sklearn.metrics.pairwise import cosine_similarity

with open(${JSON.stringify(inputFile.replace(/\\/g, '/'))}) as f:
    data = json.load(f)

texts = data['texts']
ids = data['ids']
max_clusters = data['max_clusters']

print(f"Encoding {len(texts)} texts...")
model = SentenceTransformer('all-MiniLM-L6-v2')
embeddings = model.encode(texts, show_progress_bar=True)

print(f"Clustering into max {max_clusters} clusters...")
# Normalize embeddings so euclidean distance ~ cosine distance
from sklearn.preprocessing import normalize
embeddings_norm = normalize(embeddings)
# Ward linkage produces more balanced clusters
clustering = AgglomerativeClustering(
    n_clusters=max_clusters,
    linkage='ward',
)
labels = clustering.fit_predict(embeddings_norm)

# Group IDs by cluster label
clusters = {}
for idx, label in enumerate(labels):
    label = int(label)
    if label not in clusters:
        clusters[label] = []
    clusters[label].append(ids[idx])

result = list(clusters.values())
print(f"Formed {len(result)} clusters")

with open(${JSON.stringify(outputFile.replace(/\\/g, '/'))}, 'w') as f:
    json.dump(result, f)
print("Done.")
`);

  console.log(`  Computing embeddings + clustering for ${texts.length} texts...`);
  execSync(`python "${scriptFile}"`, {
    maxBuffer: 1024 * 1024 * 200,
    encoding: 'utf-8',
    stdio: 'inherit',
  });

  const result = JSON.parse(fs.readFileSync(outputFile, 'utf-8'));

  // Cleanup
  try { fs.unlinkSync(inputFile); } catch { /* ignore */ }
  try { fs.unlinkSync(outputFile); } catch { /* ignore */ }
  try { fs.unlinkSync(scriptFile); } catch { /* ignore */ }

  return result;
}

// ── Label clusters via Gemini ───────────────────────────────────

async function labelClusters(clusters, labelMap) {
  const multiClusters = clusters.filter(c => c.length > 1);
  if (multiClusters.length === 0) return clusters.map(() => 'Other');

  const prompt = `You are labeling groups of conflicting claims about AI policy.
For each numbered group below, provide a short (2-5 word) topical label.
Return a JSON array of strings, one label per group. No markdown fences.

${multiClusters.map((c, i) => {
    const labels = c.slice(0, 8).map(id => labelMap.get(id) || id);
    return `Group ${i + 1} (${c.length} items): ${labels.join('; ')}`;
  }).join('\n')}`;

  // Try Gemini API
  const apiKey = process.env.GEMINI_API_KEY || process.env.AI_API_KEY;
  if (!apiKey) {
    console.warn('  No GEMINI_API_KEY — using generic labels');
    return clusters.map((c, i) => c.length > 1 ? `Cluster ${i + 1}` : 'Other');
  }

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 4096,
          responseMimeType: 'application/json',
        },
      }),
    });
    const rawText = await resp.text();
    let data;
    try { data = JSON.parse(rawText); } catch {
      console.warn('  Gemini response not valid JSON, raw:', rawText.slice(0, 200));
      throw new Error('Invalid JSON response');
    }
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    if (!text) {
      console.warn('  Gemini returned empty text. Full response:', JSON.stringify(data).slice(0, 500));
      throw new Error('Empty Gemini response');
    }
    console.log('  Gemini raw labels:', text.slice(0, 200));
    const cleaned = text.replace(/```json?\s*/g, '').replace(/```/g, '').trim();
    const labels = JSON.parse(cleaned);

    // Map back to all clusters
    const result = [];
    let multiIdx = 0;
    for (const c of clusters) {
      if (c.length > 1) {
        result.push(labels[multiIdx] || `Cluster ${multiIdx + 1}`);
        multiIdx++;
      } else {
        result.push('');
      }
    }
    return result;
  } catch (err) {
    console.warn(`  Gemini labeling failed: ${err.message}`);
    return clusters.map((c, i) => c.length > 1 ? `Cluster ${i + 1}` : 'Other');
  }
}

// ── Main ────────────────────────────────────────────────────────

async function main() {
  console.log('Loading conflicts...');
  const conflicts = loadConflicts();
  console.log(`  ${conflicts.length} conflicts loaded`);

  if (conflicts.length === 0) {
    console.log('No conflicts found.');
    return;
  }

  // Build embedding texts
  const texts = conflicts.map(c =>
    `[conflict] ${c.claim_label}\n${c.description}`.slice(0, 512)
  );
  const ids = conflicts.map(c => c.claim_id);
  const labelMap = new Map(conflicts.map(c => [c.claim_id, c.claim_label]));

  // Compute embeddings + cluster in Python (fast with sklearn)
  const dynamicMax = Math.max(8, Math.min(MAX_CLUSTERS, Math.ceil(conflicts.length / 50)));
  const rawClusters = embedAndCluster(texts, ids, dynamicMax);
  console.log(`  ${rawClusters.length} clusters formed`);

  // Label
  console.log('Labeling clusters...');
  const labels = await labelClusters(rawClusters, labelMap);

  // Build output
  const multiClusters = [];
  const singletonIds = [];

  for (let i = 0; i < rawClusters.length; i++) {
    if (rawClusters[i].length > 1) {
      const nodeIds = rawClusters[i].sort((a, b) =>
        (labelMap.get(a) || '').localeCompare(labelMap.get(b) || '')
      );
      multiClusters.push({ label: labels[i] || `Cluster ${i + 1}`, nodeIds });
    } else {
      singletonIds.push(...rawClusters[i]);
    }
  }

  // Sort clusters alphabetically
  multiClusters.sort((a, b) => a.label.localeCompare(b.label));

  // Append Other bucket
  if (singletonIds.length > 0) {
    singletonIds.sort((a, b) =>
      (labelMap.get(a) || '').localeCompare(labelMap.get(b) || '')
    );
    multiClusters.push({ label: 'Other', nodeIds: singletonIds });
  }

  const output = {
    generated_at: new Date().toISOString(),
    conflict_count: conflicts.length,
    cluster_count: multiClusters.length,
    clusters: multiClusters,
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
  console.log(`\nWrote ${OUTPUT_FILE}`);
  console.log(`  ${multiClusters.length} clusters, ${conflicts.length} total conflicts`);
  for (const c of multiClusters) {
    console.log(`  ${c.label}: ${c.nodeIds.length} items`);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
