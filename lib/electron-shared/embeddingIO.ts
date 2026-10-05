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
const PYTHON_EMBED_TIMEOUT_MS = 60_000;

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
      // eslint-disable-next-line local/require-warn-on-degraded-catch-return -- observable, not silent: the null fallback records via the injected recordError(err) seam AND console.warn. electron-shared is dependency-injected shared code and cannot use getGlobalRecorder/log.* (the transports the rule recognizes) — recordError IS its structured-logging seam (t/3224 Phase A).
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
        { timeout: PYTHON_EMBED_TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024, windowsHide: true },
        (err, stdout, stderr) => {
          if (err) {
            // A timeout kills the child with no Python traceback, so err.message alone reads as an
            // unexplained "Command failed" — name the kill/signal/exit code so it's diagnosable.
            const how = err.killed
              ? `killed (signal ${err.signal ?? 'unknown'}) — likely the ${PYTHON_EMBED_TIMEOUT_MS / 1000}s timeout; each call cold-loads the model`
              : `exit code ${err.code ?? 'unknown'}`;
            reject(new Error(`Python embed failed: ${how}: ${err.message}\n${stderr}`));
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
