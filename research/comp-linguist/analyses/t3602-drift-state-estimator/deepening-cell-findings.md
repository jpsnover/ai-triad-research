# Deepening-cell hypothesis check (t/3602)

**Author:** Computational Linguist
**What this is:** an empirical **precondition check** of the drift-estimator design's load-bearing hypothesis (design.md §4): does ArCo-binary (a single seed-similarity threshold) misclassify turns that engage an active crux as "drift"? Reproduce with `deepening_cell.py` (`AI_TRIAD_DATA_ROOT=<data> python deepening_cell.py`).

**What this is NOT:** validation. These are un-annotated cosine scores; "high `s_crux` = legitimate deepening" is a stipulated interpretation the human study (AC 3-4) must still confirm. This check only asks whether the cell the crux dimension exists to catch is real and material. Per the ticket, this metric **gates nothing** until reliability is established.

## Method

- **Turn vectors:** persisted `turn_embeddings` (engine ONNX all-MiniLM-L6-v2), the ~half of the corpus that carries them.
- **Seed vector:** embed `topic.scope.core_proposition` (fallback `topic.final`) via `scripts/embed_taxonomy.py batch-encode` (pytorch sentence-transformers, same model).
- **Crux vectors:** embed each `crux_tracker[].description` likewise.
- `s_seed = cos(turn, seed)`; `s_crux = max_c cos(turn, crux_c)`.
- Corpus: 147 debates carrying both `turn_embeddings` and `crux_tracker`; **1,562 turns**.

**Embedder-compatibility caveat:** the persisted turn vectors and the freshly embedded seed/crux vectors come from two backends (engine ONNX vs pytorch sentence-transformers). On a short turn they agree at cosine **0.9776**, so a ~0.02 systematic offset is mixed in. The effect sizes below (~0.2) dwarf it, so the qualitative conclusion holds; a fully rigorous run would re-embed turns through the same path.

**Seed-anchor finding:** `topic.final` is often literally `"Discuss: <url>"` (a URL, not a proposition), a poor anchor. `topic.scope.core_proposition` is the real seed and was used where present (119 of 147 debates; 28 fell back to `topic.final`). **Design refinement:** the estimator's seed anchor should be `core_proposition`, not raw `topic.final`.

## Result: hypothesis strongly confirmed

| Quantity | Value |
|---|---|
| turns analyzed | 1,562 (147 debates) |
| `s_seed` median / mean | 0.426 / 0.427 |
| `s_crux` median / mean | 0.568 / 0.568 |
| corr(`s_seed`, `s_crux`) | **0.245** (weakly related; they measure different things) |
| ArCo-binary drift set (`s_seed` < 0.5) | **1,041 turns = 66.6% of all** |
| **deepening cell** (`s_seed`<0.5 AND `s_crux`>=0.5) | **716 turns = 45.8% of all; 68.8% of the drift set** |
| ... at `s_crux`>=0.45 / 0.40 / 0.35 | 55.3% / 61.1% / 64.2% of all |
| low-seed turns with `s_crux` > `s_seed` | 992 / 1,041 (95%); median gap **+0.20** |

Two findings, both strengthening the design:

1. **The crux dimension is essential, not optional.** Of the turns ArCo-binary would flag as drift, **~69% engage a crux** at `s_crux>=0.5`. A single seed-similarity threshold cannot tell those apart from genuine drift; the crux dimension can. The design's §4 hypothesis is confirmed at scale (with the un-annotated caveat).

2. **ArCo's 0.5 cutoff is miscalibrated for this use.** It flags **two-thirds of all turns** as drift, which is prima facie wrong (a debate is not off-topic two turns in three). The binary baseline's problem is therefore twofold: wrong cutoff **and** no crux dimension. The threshold-tuning phase (AC 4) must recalibrate the cutoffs against human labels, not inherit `ARCO_DRIFT_THRESHOLD = 0.5`.

## Consequences for the ticket

- **AC 3 (validation set):** the deepening cell is large (45.8% of turns), so the annotation study is clearly warranted and the discriminating cases are abundant. Oversampling low-`s_seed` turns will not be starved.
- **AC 4 (tuning):** the ArCo-binary baseline the 3-band estimator is compared against should use a **tuned** seed cutoff, not 0.5, so the comparison isolates the crux dimension's contribution rather than crediting it for fixing a bad threshold.
- **Design refinement:** seed anchor = `core_proposition` (not raw `topic.final`).
- Still un-validated: whether high-`s_crux`/low-`s_seed` turns are genuinely *deepening* vs *drift onto a different active crux* is exactly what human annotation resolves. This check establishes the cell exists and is material; it does not label it.
