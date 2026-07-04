import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';

export interface EmbeddingNode {
  pov: string;
  vector: number[];
  [key: string]: unknown;
}

export interface EmbeddingsFile {
  model: string;
  dimension: number;
  node_count: number;
  nodes: Record<string, EmbeddingNode>;
}

export interface EmbeddingIODeps {
  resolveDataPath: (subPath: string) => string;
  embedScriptPath: string;
  recordError?: (err: unknown) => void;
}

const PYTHON = process.platform === 'win32' ? 'python' : 'python3';

export function createEmbeddingIO(deps: EmbeddingIODeps) {
  let cache: EmbeddingsFile | null = null;
  let cachePath: string | null = null;

  function getEmbeddingsPath(): string {
    return path.join(deps.resolveDataPath('taxonomy/Origin'), 'embeddings.json');
  }

  function loadEmbeddingsFile(): EmbeddingsFile | null {
    const filePath = getEmbeddingsPath();
    if (cache && cachePath === filePath) return cache;
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      cache = JSON.parse(raw) as EmbeddingsFile;
      cachePath = filePath;
      console.log(`[embeddings] Loaded ${cache.node_count} local embeddings (${cache.dimension}d)`);
      return cache;
    } catch (err) {
      deps.recordError?.(err);
      console.warn('[embeddings] Could not load embeddings.json:', err);
      return null;
    }
  }

  function computeQueryViaLocalPython(text: string): Promise<number[]> {
    return new Promise((resolve, reject) => {
      execFile(
        PYTHON,
        [deps.embedScriptPath, 'encode', text],
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
            deps.recordError?.(parseErr);
            reject(new Error(`Failed to parse Python output: ${parseErr}`));
          }
        },
      );
    });
  }

  function invalidateCache(): void {
    cache = null;
    cachePath = null;
  }

  return { getEmbeddingsPath, loadEmbeddingsFile, computeQueryViaLocalPython, invalidateCache };
}
