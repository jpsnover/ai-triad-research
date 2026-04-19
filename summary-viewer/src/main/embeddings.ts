// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { resolveDataPath } from './fileIO';

const PROJECT_ROOT = path.resolve(__dirname, '../../..');
const EMBED_SCRIPT = path.join(PROJECT_ROOT, 'scripts', 'embed_taxonomy.py');
const PYTHON = process.platform === 'win32' ? 'python' : 'python3';

// ---------- Local embeddings from embeddings.json ----------

interface EmbeddingsFile {
  model: string;
  dimension: number;
  node_count: number;
  nodes: Record<string, { pov: string; vector: number[] }>;
}

let embeddingsCache: EmbeddingsFile | null = null;
let embeddingsCachePath: string | null = null;

function getEmbeddingsPath(): string {
  return path.join(resolveDataPath('taxonomy/Origin'), 'embeddings.json');
}

function loadEmbeddingsFile(): EmbeddingsFile | null {
  const filePath = getEmbeddingsPath();
  if (embeddingsCache && embeddingsCachePath === filePath) {
    return embeddingsCache;
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    embeddingsCache = JSON.parse(raw) as EmbeddingsFile;
    embeddingsCachePath = filePath;
    console.log(`[embeddings] Loaded ${embeddingsCache.node_count} local embeddings (${embeddingsCache.dimension}d)`);
    return embeddingsCache;
  } catch (err) {
    console.warn('[embeddings] Could not load embeddings.json:', err);
    return null;
  }
}

/**
 * Load all pre-computed embeddings from embeddings.json.
 * Returns a map of node ID → vector, or null if the file is unavailable.
 */
export function loadEmbeddings(): Record<string, number[]> | null {
  const data = loadEmbeddingsFile();
  if (!data) return null;
  const result: Record<string, number[]> = {};
  for (const [id, entry] of Object.entries(data.nodes)) {
    result[id] = entry.vector;
  }
  return result;
}

/**
 * Compute embeddings for arbitrary texts via local Python batch-encode.
 * Used for within-document semantic search (paragraphs not in embeddings.json).
 */
export function computeEmbeddings(texts: string[]): Promise<number[][]> {
  const items = texts.map((text, i) => ({ id: String(i), text }));
  const inputJson = JSON.stringify(items);

  return new Promise((resolve, reject) => {
    const child = execFile(
      PYTHON,
      [EMBED_SCRIPT, 'batch-encode'],
      { timeout: 120_000, maxBuffer: 50 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          reject(new Error(`Python batch-encode failed: ${err.message}\n${stderr}`));
          return;
        }
        try {
          const result = JSON.parse(stdout) as Record<string, number[]>;
          const vectors = texts.map((_, i) => result[String(i)]);
          if (vectors.some(v => !v)) {
            reject(new Error('Python batch-encode returned incomplete results'));
            return;
          }
          resolve(vectors);
        } catch (parseErr) {
          reject(new Error(`Failed to parse batch-encode output: ${parseErr}`));
        }
      },
    );
    child.stdin!.write(inputJson);
    child.stdin!.end();
  });
}

/**
 * Compute a query embedding for a single text.
 * Uses the local Python sentence-transformers model (same model as embeddings.json).
 */
export function computeQueryEmbedding(text: string): Promise<number[]> {
  return computeQueryViaLocalPython(text);
}

// ---------- Local Python embedding ----------

function computeQueryViaLocalPython(text: string): Promise<number[]> {
  return new Promise((resolve, reject) => {
    execFile(
      PYTHON,
      [EMBED_SCRIPT, 'encode', text],
      { timeout: 60_000, maxBuffer: 10 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          reject(new Error(`Python embed failed: ${err.message}\n${stderr}`));
          return;
        }
        try {
          const vector = JSON.parse(stdout) as number[];
          if (!Array.isArray(vector) || vector.length === 0) {
            reject(new Error('Python embed returned empty vector'));
            return;
          }
          resolve(vector);
        } catch (parseErr) {
          reject(new Error(`Failed to parse Python output: ${parseErr}`));
        }
      },
    );
  });
}
