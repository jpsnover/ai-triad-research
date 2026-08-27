// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Client-side batch chunking for POST /api/embeddings/compute (t/3072).
//
// The server processes the whole request inside a single 50s withEndpointTimeout('embeddings-compute')
// window — it compute-chunks internally at EMBEDDING_COMPUTE_CHUNK=256 (t/2914), but all within that
// one timeout. A single oversized batch blows the 50s ceiling → 504 → 500 → 'mutation' circuit-breaker
// cascade (incident e8760507 sent 2587 items; prior calls of 643 and 792 succeeded). Bounding each POST
// to a safe size turns one catastrophic timeout into sequential, recoverable chunks.

const EMBEDDINGS_COMPUTE_PATH = '/api/embeddings/compute';

/**
 * Max texts per compute POST. Provisional (t/3072): 512 = 2× the server compute-chunk
 * (EMBEDDING_COMPUTE_CHUNK=256, t/2914). Chosen SAFELY BELOW the known-good 792/643-item calls from
 * incident e8760507 (2587 items was the failure) so a full chunk completes well under the 50s
 * 'embeddings-compute' endpoint timeout even under load — a valid safe cap without production
 * calibration. t/3071's batch_size observability is only needed to tune this UP later; recalibrate
 * here (one line) once that data lands, and never raise it above the smallest observed failure
 * without evidence.
 */
export const EMBEDDINGS_MAX_BATCH = 512;

/** Minimal shape of web-bridge's generic `post` used here (path, JSON body, idempotent flag). */
type EmbeddingsPost = <T = unknown>(
  path: string,
  body?: unknown,
  opts?: { idempotent?: boolean },
) => Promise<T>;

/**
 * Split texts/ids into ≤EMBEDDINGS_MAX_BATCH slices and POST them SEQUENTIALLY — never
 * concurrently, which would re-burst the very server this guards (TL, t/3072). Vectors are
 * concatenated in input order, so the return shape is identical to a single compute call. Each
 * chunk keeps idempotent:true so a load-shed 503 (retryable + Retry-After) still gets its one
 * retry, and embeddings are a pure function of inputs (t/2922).
 */
export async function computeEmbeddingsChunked(
  post: EmbeddingsPost,
  texts: string[],
  ids?: string[],
): Promise<{ vectors: number[][] }> {
  if (texts.length <= EMBEDDINGS_MAX_BATCH) {
    return post<{ vectors: number[][] }>(EMBEDDINGS_COMPUTE_PATH, { texts, ids }, { idempotent: true });
  }
  const vectors: number[][] = [];
  for (let i = 0; i < texts.length; i += EMBEDDINGS_MAX_BATCH) {
    const textChunk = texts.slice(i, i + EMBEDDINGS_MAX_BATCH);
    const idChunk = ids ? ids.slice(i, i + EMBEDDINGS_MAX_BATCH) : undefined;
    // Awaited in the loop → strictly sequential; the next chunk starts only after this one resolves.
    const res = await post<{ vectors: number[][] }>(
      EMBEDDINGS_COMPUTE_PATH,
      { texts: textChunk, ids: idChunk },
      { idempotent: true },
    );
    vectors.push(...res.vectors);
  }
  return { vectors };
}
