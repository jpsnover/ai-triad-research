#!/usr/bin/env node
// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.
//
// t/3198 — CI harness for the real-ONNX same-EP bit-exact equivalence check (t/3181 condition 3).
//
// WHY a harness and not the vitest test: `offThreadEmbedding.test.ts`'s equivalence case is
// SKIP-GUARDED and only runs where onnxruntime-node + the fp32 model.onnx are present. Under vitest
// the real worker cannot spawn — `defaultWorkerFactory` does `new Worker(new URL('./embeddingWorker.js',
// import.meta.url))` against the SOURCE tree, where no compiled `embeddingWorker.js` sibling exists,
// and vitest does not transform code inside a spawned node worker_thread. So the equivalence is
// exercised here against the BUILT server dist (`build:server` emits the runnable worker + all sibling
// .js to taxonomy-editor/dist/server/lib/embeddings/ — the exact artifacts prod ships). This closes the
// t/3189 "only-runs-on-one-box" gap: the check now runs in CI (the embedding-onnx-equivalence job)
// whenever the ONNX-node model is provisioned, not just on a maintainer's local box.
//
// Contract: worker vectors (intra-op=1, off-thread) must be BIT-EXACT vs the in-thread default path on
// the same execution provider, compared at the fp32 boundary (see the compare loop for why fp32 is
// the correct precision). No tolerance at that boundary — any divergence is a real finding (report,
// don't relax). The local t/3181 run reported maxAbsDiff=0 (bit-exact intraOp=1 vs default).
//
// Requires: AI_TRIAD_ONNX_MODEL_DIR pointing at a dir with model.onnx + tokenizer.json +
// tokenizer_config.json, and onnxruntime-node installed. Run AFTER `build:server`.
//
// Exit 0 = bit-exact (or clean skip when the model is absent — printed VISIBLY, never silent).
// Exit 1 = divergence or a setup/runtime failure.

import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));            // <repo>/lib/embeddings
const REPO_ROOT = resolve(HERE, '..', '..');                    // <repo>
const DIST_EMB = join(REPO_ROOT, 'taxonomy-editor', 'dist', 'server', 'lib', 'embeddings');

// Same texts as offThreadEmbedding.test.ts's equivalence case — keep them in sync so the harness and
// the (locally-run) vitest test assert the identical contract.
const TEXTS = ['AI policy alignment', 'open-source model release', 'compute governance regime'];

function fail(msg) {
  console.error(`[onnx-equivalence-check] FAIL — ${msg}`);
  process.exit(1);
}

// ── Preconditions (fail LOUD, never silently green) ───────────────────────────
const modelDir = process.env.AI_TRIAD_ONNX_MODEL_DIR?.trim();
if (!modelDir) {
  // A green run must never read as "equivalence verified" when it was actually a no-op. This harness
  // is only invoked by the CI job that provisions the model, so an unset var here is a wiring bug.
  fail('AI_TRIAD_ONNX_MODEL_DIR is not set — the CI job must provision the fp32 model before running this harness.');
}
if (!existsSync(join(modelDir, 'model.onnx'))) {
  fail(`model.onnx not found under AI_TRIAD_ONNX_MODEL_DIR="${modelDir}" — provision the flat fp32 model set first.`);
}
const offThreadEntry = join(DIST_EMB, 'offThreadEmbedding.js');
const onnxEntry = join(DIST_EMB, 'onnxEmbedding.js');
if (!existsSync(offThreadEntry) || !existsSync(onnxEntry)) {
  fail(`built dist modules missing under ${DIST_EMB} — run \`npm run build:server\` (in taxonomy-editor) before this harness.`);
}
if (!existsSync(join(DIST_EMB, 'embeddingWorker.js'))) {
  fail(`embeddingWorker.js missing under ${DIST_EMB} — the worker entry did not emit (check tsconfig.server.json \`include\`).`);
}

// Pin the CPU EP for BOTH paths (before the dist modules init onnxruntime). The bit-exact contract
// (t/3181 condition 3) holds on the CPU EP — the EP CI (ubuntu, no GPU) and prod (ACA, no GPU)
// actually run. A GPU EP (dml/cuda) is non-deterministic across two sessions with different intra-op
// thread counts (worker=1 vs in-thread default) — ~1e-8 kernel noise that is NOT a real divergence —
// so on a GPU dev box the zero-tolerance check would spuriously fail. Forcing CPU makes the check
// deterministic and portable. Honored by onnxEmbedding.ts (t/3198).
process.env.AI_TRIAD_ONNX_FORCE_CPU ??= '1';

console.log(`[onnx-equivalence-check] model dir: ${modelDir}`);
console.log(`[onnx-equivalence-check] dist:      ${DIST_EMB}`);
console.log(`[onnx-equivalence-check] texts:     ${TEXTS.length}`);
console.log(`[onnx-equivalence-check] EP:        cpu (AI_TRIAD_ONNX_FORCE_CPU=${process.env.AI_TRIAD_ONNX_FORCE_CPU})`);

// ── Run both paths on the same EP and compare bit-exact ───────────────────────
const { computeEmbeddingsOffThread, shutdownEmbeddingWorker } = await import(pathToFileURL(offThreadEntry).href);
const { computeEmbeddings } = await import(pathToFileURL(onnxEntry).href);

let exitCode = 0;
try {
  const [offThread, inThread] = await Promise.all([
    computeEmbeddingsOffThread(TEXTS, { requester: 'ci-equivalence-harness' }),
    computeEmbeddings(TEXTS),
  ]);

  if (offThread.length !== inThread.length) {
    fail(`vector count mismatch: off-thread=${offThread.length} vs in-thread=${inThread.length}`);
  }

  let maxAbsDiff = 0;
  let firstDivergence = null;
  for (let i = 0; i < inThread.length; i++) {
    // Compare at the fp32 boundary — the precision embeddings are actually stored and consumed at
    // (embeddings.json is fp32; the worker marshals vectors OUT via a Float32Array transfer buffer,
    // so its output is already fp32). The in-thread path's l2Normalize returns number[] (fp64 JS
    // doubles), so a raw fp32-vs-fp64 compare is off by ~fp32 epsilon (~1e-8) BY CONSTRUCTION — a
    // comparison artifact, not a compute divergence. Quantizing the in-thread side to fp32 makes the
    // contract genuinely BIT-EXACT (maxAbsDiff=0), which is what "equivalence" means for fp32
    // embeddings (t/3198; corrects the latent fp32-vs-fp64 mismatch in offThreadEmbedding.test.ts).
    const a = Array.from(offThread[i]);                     // worker: already fp32
    const b = Array.from(new Float32Array(inThread[i]));    // in-thread fp64 → fp32 boundary
    if (a.length !== b.length) {
      fail(`dim mismatch at text ${i}: off-thread=${a.length} vs in-thread=${b.length}`);
    }
    for (let j = 0; j < a.length; j++) {
      const d = Math.abs(a[j] - b[j]);
      if (d > maxAbsDiff) maxAbsDiff = d;
      if (d !== 0 && firstDivergence === null) firstDivergence = { text: i, dim: j, off: a[j], in: b[j] };
    }
  }

  if (maxAbsDiff !== 0) {
    console.error(`[onnx-equivalence-check] DIVERGENCE — maxAbsDiff=${maxAbsDiff}`);
    console.error(`[onnx-equivalence-check] first at text ${firstDivergence.text} dim ${firstDivergence.dim}: off=${firstDivergence.off} in=${firstDivergence.in}`);
    console.error('[onnx-equivalence-check] Contract is BIT-EXACT (no tolerance). Investigate EP/thread-config drift before relaxing (t/3181 condition 3).');
    exitCode = 1;
  } else {
    console.log(`[onnx-equivalence-check] OK — bit-exact (maxAbsDiff=0) across ${inThread.length} vectors, off-thread intra-op=1 vs in-thread default on the same EP.`);
  }
} catch (err) {
  console.error(`[onnx-equivalence-check] runtime error: ${err?.stack || err}`);
  exitCode = 1;
} finally {
  // Release the persistent worker so the process can exit cleanly.
  try { shutdownEmbeddingWorker(); } catch { /* best-effort */ }
}

process.exit(exitCode);
