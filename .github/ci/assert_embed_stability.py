"""Value-stability assertion for the embedding stack (t/1989).

Guards the property the project actually depends on: a freshly-installed
sentence-transformers/transformers/torch stack must still produce the SAME
all-MiniLM-L6-v2 vectors as the precomputed embeddings.json corpus. Shape checks
(len == 384) are version-stable and blind to numerical drift; this asserts VALUE
stability via cosine vs a pinned reference (see embed_reference.json). Shared by
the PR-time python-embed-smoke job (ci.yml) and the weekly embed-drift workflow.

Run with HF_HUB_OFFLINE=1 so a red here is a real incompatibility, not a network
outage (the caller downloads models in a separate, earlier step).
"""
import json
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(HERE, "embed_reference.json"), encoding="utf-8") as fh:
    ref = json.load(fh)

# Import after loading the fixture; an import/API break here is itself a failure.
from sentence_transformers import CrossEncoder, SentenceTransformer

# ── Embedding value-stability (the corpus-critical contract vs embeddings.json) ──
emb = np.asarray(
    SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2").encode(ref["sentence"]),
    dtype=float,
)
assert emb.shape[0] == 384, f"embedding dim broken: expected 384, got {emb.shape[0]}"
r = np.asarray(ref["embedding"], dtype=float)
cos = float(emb @ r / (np.linalg.norm(emb) * np.linalg.norm(r)))
assert cos >= ref["cosine_min"], (
    f"EMBEDDING DRIFT: cosine {cos:.8f} < {ref['cosine_min']} vs the pinned reference "
    f"(all-MiniLM-L6-v2). The installed stack no longer reproduces embeddings.json."
)

# ── CrossEncoder (NLI) load + value stability (contradiction-detection contract) ──
scores = np.asarray(
    CrossEncoder("cross-encoder/nli-deberta-v3-small").predict([tuple(ref["nli_pair"])]),
    dtype=float,
)
assert scores.shape[-1] == 3, f"NLI shape broken: expected 3 logits, got {scores.shape}"
maxdiff = float(np.max(np.abs(scores[0] - np.asarray(ref["nli_logits"], dtype=float))))
assert maxdiff <= ref["nli_atol"], (
    f"NLI DRIFT: max|Δlogit| {maxdiff:.6f} > atol {ref['nli_atol']} vs the pinned "
    f"reference (cross-encoder/nli-deberta-v3-small)."
)

print(
    f"OK: embedding cosine={cos:.8f} (>= {ref['cosine_min']}); "
    f"NLI max|Δlogit|={maxdiff:.6f} (<= {ref['nli_atol']})",
    file=sys.stdout,
)
