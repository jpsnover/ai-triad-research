// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Off-thread embedding worker entry (t/3181, item A — the shared prerequisite for B/C).
 *
 * Runs in a Node/Electron `worker_thread`, owns the ONNX session EXCLUSIVELY, and computes
 * embeddings off the main event loop so a large batch can't starve request handling (the durable
 * fix for the t/3165 starvation class). The manager (`offThreadEmbedding.ts`) is the only caller.
 *
 * Protocol (mirrored by the manager):
 *   in :  { id, texts }
 *   out:  { type:'heartbeat', id, chunk }                              — forward-progress ping
 *         { type:'result', id, ok:true, buffer, count, dim }          — packed vectors, buffer TRANSFERRED
 *         { type:'result', id, ok:false, error }                      — compute failed (manager load-sheds)
 *
 * Design invariants (t/2977#6):
 *   - SINGLE worker-owned session (this module is the only place ONNX is created post-migration —
 *     the manager never warms/computes in-thread, so the ~250MB model is resident once, not twice).
 *   - ONNX intra/interOp pinned to 1 (C2) so onnxruntime can't oversubscribe the host's 1–2 vCPUs.
 */

import { parentPort } from 'node:worker_threads';
import { computeEmbeddings, setSessionThreadOptions, EMBEDDING_DIM } from './onnxEmbedding.js';

interface EmbedRequest {
  id: number;
  texts: string[];
}

if (!parentPort) {
  throw new Error('embeddingWorker.ts must be run as a worker_thread — parentPort is null');
}
const port = parentPort;

// C2 (worker-ONLY, TL Q3): pin ONNX to a single op thread BEFORE the session is created, so the
// worker's inference can't spin up a thread per core and contend with the main event loop. The
// in-thread path deliberately keeps its default threading (byte-identical baseline) — this pin
// lives here, not module-wide.
setSessionThreadOptions({ intraOpNumThreads: 1, interOpNumThreads: 1 });

async function handleRequest(msg: EmbedRequest): Promise<void> {
  const { id, texts } = msg;
  try {
    // Emit a forward-progress heartbeat after each chunk resolves. The manager's watchdog resets on
    // each one, so a healthy-but-slow large batch is not false-killed, while a genuinely wedged
    // worker (no chunk completes) is caught within ~one chunk's timeout window.
    const vectors = await computeEmbeddings(texts, (chunk) => {
      port.postMessage({ type: 'heartbeat', id, chunk });
    });

    // Pack N×dim fp32 into ONE contiguous Float32Array and TRANSFER its ArrayBuffer (zero-copy — the
    // manager slices it back into N views). Empty batch → zero-length buffer, still a valid transfer.
    const dim = vectors.length > 0 ? vectors[0].length : EMBEDDING_DIM;
    const packed = new Float32Array(vectors.length * dim);
    for (let i = 0; i < vectors.length; i++) packed.set(vectors[i], i * dim);
    port.postMessage(
      { type: 'result', id, ok: true, buffer: packed.buffer, count: vectors.length, dim },
      [packed.buffer],
    );
  } catch (err) {
    // Report the failure; the manager rejects the caller with an ActionableError → load-shed. There
    // is deliberately NO in-thread fallback anywhere (running ONNX on the main thread on failure
    // reintroduces the exact t/3165 starvation under its own trigger) — fail loud instead.
    port.postMessage({
      type: 'result',
      id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// `handleRequest` is async but the listener signature is void — the errors it can throw are already
// caught + reported inside it, so voiding the returned promise is safe (nothing to await).
port.on('message', (msg: EmbedRequest) => { void handleRequest(msg); });
