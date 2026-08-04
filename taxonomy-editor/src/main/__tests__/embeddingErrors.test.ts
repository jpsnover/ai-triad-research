// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import { buildEmbeddingFailureError, DML_OOM_RE } from '../embeddingErrors.js';
import { ActionableError } from '../../../../lib/debate/errors.js';

/**
 * t/2057: an embedding failure caused by a DirectML GPU out-of-memory used to surface a
 * misleading "sentence-transformers is missing / pip install" message, because the IPC handlers
 * appended the Python diagnosis to EVERY failure unconditionally. `buildEmbeddingFailureError`
 * now leads with the real GPU cause on an OOM and keeps the Python-diagnosis behavior otherwise.
 * `diagnose` is injected here so the test never spawns a Python subprocess.
 */
const DIAG = 'FAKE-PY-DIAGNOSIS';
const diag = (): string => DIAG;

// The real onnxruntime DML OOM string (FR flight-recorder-2026-07-31T18-10-25, seq 179/234).
const DML_OOM_MSG =
  'Error: Non-zero status code returned while running Add node. 8007000E Not enough memory resources are available';

describe('buildEmbeddingFailureError — DirectML OOM (t/2057)', () => {
  it('leads with the GPU OOM cause, NOT the Python diagnosis', () => {
    const e = buildEmbeddingFailureError('Update embeddings', 'loc', 'Embedding update failed', new Error(DML_OOM_MSG), diag);
    expect(e).toBeInstanceOf(ActionableError);
    expect(e.problem).toMatch(/^DirectML \(GPU\) execution provider ran out of GPU memory/);
    expect(e.problem).toContain('8007000E');                 // the real cause is surfaced
    expect(e.problem).toContain(`also unavailable: ${DIAG}`); // Python status demoted to secondary
    // The FIRST next step must not send the dev to pip-install (the bug being fixed).
    expect(e.nextSteps[0]).not.toMatch(/pip.*sentence-transformers/i);
    expect(e.nextSteps[0]).toMatch(/GPU|VRAM/);
  });

  it('matches the OOM on each known HRESULT / phrasing', () => {
    for (const m of ['8007000E', 'E_OUTOFMEMORY', 'Not enough memory resources are available']) {
      expect(DML_OOM_RE.test(m)).toBe(true);
      const e = buildEmbeddingFailureError('g', 'loc', 'prefix', new Error(`onnx: ${m}`), diag);
      expect(e.problem).toMatch(/ran out of GPU memory/);
    }
  });
});

describe('buildEmbeddingFailureError — non-OOM failure keeps Python-diagnosis behavior (t/2057)', () => {
  it('uses the problem prefix + appends the Python diagnosis, with Python next steps', () => {
    const e = buildEmbeddingFailureError('Compute query embedding', 'loc', 'Query embedding failed', new Error('boom'), diag);
    expect(e.problem).toBe(`Query embedding failed: boom. ${DIAG}`);
    expect(e.problem).not.toMatch(/GPU memory/);
    expect(e.nextSteps[0]).toMatch(/Python.*PATH/i);
    expect(e.nextSteps.some(s => /pip install sentence-transformers/.test(s))).toBe(true);
  });

  it('handles a non-Error thrown value', () => {
    const e = buildEmbeddingFailureError('g', 'loc', 'Prefix', 'string failure', diag);
    expect(e.problem).toBe(`Prefix: string failure. ${DIAG}`);
  });
});
