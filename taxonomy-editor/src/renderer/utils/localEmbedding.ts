// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Renderer-local embedding via WebNN (NPU) or WASM (CPU).
 *
 * Uses @huggingface/transformers (Transformers.js v4) to run all-MiniLM-L6-v2
 * directly in the renderer process, avoiding IPC to main. Falls back to the
 * bridge API when neither WebNN nor WASM is available.
 *
 * Fallback chain: WebNN (NPU) > WASM (CPU) > bridge API (main/server process).
 */

import { getGlobalRecorder } from '@lib/flight-recorder/index';

// Transformers.js is loaded dynamically to avoid blocking renderer startup
// and to gracefully handle environments where it's not available.

type Pipeline = (texts: string | string[], options?: Record<string, unknown>) => Promise<{ data: Float32Array; dims: number[] }>;

let _pipeline: Pipeline | null = null;
let _initPromise: Promise<boolean> | null = null;
let _backend: 'webnn' | 'wasm' | 'none' = 'none';
let _ready = false;
// Set by the caller when a bridge/server-side embedding fallback is active.
// When true, WASM-init-failed is harmless noise and logged at debug, not warn.
let _hasBridgeFallback = false;

/** Call before tryInitLocalEmbedding when a bridge/ONNX fallback is available. */
export function notifyBridgeFallback(): void {
  _hasBridgeFallback = true;
}

/** Return the active backend ('webnn', 'wasm', or 'none'). */
export function getLocalEmbeddingBackend(): string {
  return _backend;
}

/** Whether local embedding is initialized and ready. */
export function isLocalEmbeddingReady(): boolean {
  return _ready;
}

/**
 * Try to initialize the local embedding pipeline.
 * Returns true if ready, false if initialization failed.
 * Safe to call multiple times — subsequent calls return the cached result.
 */
export async function tryInitLocalEmbedding(): Promise<boolean> {
  if (_ready) return true;
  if (_initPromise) return _initPromise;

  _initPromise = doInit();
  return _initPromise;
}

async function doInit(): Promise<boolean> {
  try {
    const { pipeline, env } = await import('@huggingface/transformers');

    // Disable remote model downloads — use cached models only after first load
    env.allowLocalModels = true;
    env.allowRemoteModels = true; // Allow download on first use

    // Try WebNN first (NPU acceleration)
    const hasWebNN = 'ml' in navigator;
    if (hasWebNN) {
      try {
        _pipeline = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
          device: 'webnn',
          dtype: 'fp32',
        }) as unknown as Pipeline;
        _backend = 'webnn';
        _ready = true;
        console.log('[localEmbedding] Ready via WebNN (NPU)');
        getGlobalRecorder()?.record({
          type: 'system.info',
          component: 'localEmbedding',
          level: 'info',
          message: `Local embedding ready via WebNN (NPU)`,
        });
        return true;
      } catch (err) {
        console.warn('[localEmbedding] WebNN init failed, trying WASM:', err);
        getGlobalRecorder()?.record({
          type: 'system.error',
          component: 'localEmbedding',
          level: 'warn',
          message: 'WebNN init failed, falling back to WASM',
          error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
        });
      }
    }

    // Fall back to WASM (CPU)
    try {
      _pipeline = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
        device: 'wasm',
        dtype: 'fp32',
      }) as unknown as Pipeline;
      _backend = 'wasm';
      _ready = true;
      console.log('[localEmbedding] Ready via WASM (CPU)');
      getGlobalRecorder()?.record({
        type: 'system.info',
        component: 'localEmbedding',
        level: 'info',
        message: `Local embedding ready via WASM (CPU)`,
      });
      return true;
    } catch (err) {
      const wasmFailLevel = _hasBridgeFallback ? 'debug' : 'warn';
      // Bridge fallback active → WASM failure is harmless noise, so suppress the
      // console warn (the flight recorder still captures it at debug for diagnostics).
      if (!_hasBridgeFallback) console.warn('[localEmbedding] WASM init failed:', err);
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'localEmbedding',
        level: wasmFailLevel,
        message: 'WASM init failed',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
    }

    _backend = 'none';
    return false;
  } catch (err) {
    console.warn('[localEmbedding] Transformers.js import failed:', err);
    getGlobalRecorder()?.record({
      type: 'system.error',
      component: 'localEmbedding',
      level: 'error',
      message: 'Transformers.js import failed',
      error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
    });
    _backend = 'none';
    return false;
  }
}

/**
 * Compute a 384-dim L2-normalized embedding for a single text.
 * Throws if not initialized — call tryInitLocalEmbedding() first.
 */
export async function localComputeEmbedding(text: string): Promise<number[]> {
  if (!_pipeline) throw new Error('Local embedding not initialized');
  const output = await _pipeline(text, { pooling: 'mean', normalize: true });
  return Array.from(output.data);
}

/**
 * Compute 384-dim L2-normalized embeddings for a batch of texts.
 * Processes sequentially to avoid OOM in WASM. For WebNN, batching
 * may be supported in future Transformers.js releases.
 */
export async function localComputeEmbeddings(texts: string[]): Promise<number[][]> {
  if (!_pipeline) throw new Error('Local embedding not initialized');
  const results: number[][] = [];
  for (const text of texts) {
    const output = await _pipeline(text, { pooling: 'mean', normalize: true });
    results.push(Array.from(output.data));
  }
  return results;
}
