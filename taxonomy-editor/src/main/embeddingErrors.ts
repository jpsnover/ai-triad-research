// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Embedding-failure error assembly (t/2057). Pure, electron-free (imports only ActionableError
// + the Python diagnostic) so it is directly unit-testable without mocking electron/embeddings.
// Used by the embedding IPC handlers in ipc/aiHandlers.ts.

import { ActionableError } from '../../../lib/debate/errors.js';
import { diagnosePythonEmbeddings } from './diagnosePython.js';

// A DirectML (GPU) execution-provider out-of-memory: onnxruntime surfaces HRESULT 8007000E /
// E_OUTOFMEMORY ("Not enough memory resources are available") when the DML EP exhausts GPU
// memory during inference. This is a DISTINCT failure from a missing Python sentence-transformers
// fallback — the handlers previously appended diagnosePythonEmbeddings() to EVERY embedding
// failure unconditionally, so a GPU OOM surfaced a misleading "install sentence-transformers"
// message that sent devs down the wrong path (t/2057).
export const DML_OOM_RE = /8007000E|E_OUTOFMEMORY|not enough memory/i;

/**
 * Build the surfaced ActionableError for an embedding-path failure (t/2057).
 *
 * On a DirectML GPU OOM, lead with the real GPU cause and demote the Python-fallback status to a
 * secondary clause; otherwise keep the prior Python-diagnosis behavior byte-for-byte. `diagnose`
 * is injectable so tests need not spawn Python subprocesses (default = the real probe).
 *
 * NOTE (t/2058): this only fixes the error MESSAGE. Actually recovering from a GPU OOM by
 * retrying on the CPU execution provider lives in lib/embeddings/onnxEmbedding.ts (Shared Lib).
 */
export function buildEmbeddingFailureError(
  goal: string,
  location: string,
  problemPrefix: string,
  err: unknown,
  diagnose: () => string = diagnosePythonEmbeddings,
): ActionableError {
  const msg = err instanceof Error ? err.message : String(err);
  if (DML_OOM_RE.test(msg)) {
    return new ActionableError({
      goal,
      problem: `DirectML (GPU) execution provider ran out of GPU memory (${msg.trim()}). `
        + `Python sentence-transformers fallback also unavailable: ${diagnose()}`,
      location,
      nextSteps: [
        'Close other GPU-intensive applications to free VRAM, then retry',
        'Automatic CPU-provider fallback on a GPU OOM is tracked in t/2058 — until it lands, restarting the app may select the CPU provider',
        'Or install Python sentence-transformers (pip3 install sentence-transformers) for a CPU-based fallback',
      ],
    });
  }
  return new ActionableError({
    goal,
    problem: `${problemPrefix}: ${msg}. ${diagnose()}`,
    location,
    nextSteps: [
      'Verify Python is installed and accessible on PATH',
      'Run "pip install sentence-transformers" to install the embedding model',
      'Check the console log for detailed Python diagnostics',
    ],
  });
}
