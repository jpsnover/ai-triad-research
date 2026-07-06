// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import path from 'path';
import { execFile } from 'child_process';
import { resolveDataPath, PROJECT_ROOT } from './fileIO';
import { getGlobalRecorder } from '../../../lib/flight-recorder/index.js';
import {
  createEmbeddingIO,
  type EmbeddingsFile,
  type EmbeddingNode,
} from '../../../lib/electron-shared/embeddingIO.js';

const EMBED_SCRIPT = path.join(PROJECT_ROOT, 'scripts', 'embed_taxonomy.py');
const PYTHON = process.platform === 'win32' ? 'python' : 'python3';

const io = createEmbeddingIO({
  resolveDataPath,
  embedScriptPath: EMBED_SCRIPT,
});

export { type EmbeddingsFile, type EmbeddingNode };

/**
 * Load all pre-computed embeddings from embeddings.json.
 * Returns a map of node ID → vector, or null if the file is unavailable.
 */
export function loadEmbeddings(): Record<string, number[]> | null {
  const data = io.loadEmbeddingsFile();
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
          getGlobalRecorder()?.record({
            type: 'system.error',
            component: 'embeddings',
            level: 'error',
            message: 'Failed to parse batch-encode output',
            error: { name: (parseErr as Error).name ?? 'Error', message: String(parseErr) },
          });
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
  return io.computeQueryViaLocalPython(text);
}
