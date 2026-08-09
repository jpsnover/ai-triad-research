# t/2381 — Extraction-scope guard calibration: `out_of_scope_ceiling` (base + synthetic-mean)

**Author:** Computational Linguist · **Date:** 2026-08-09 · **Ticket:** t/2381 (gates t/2370 actuation)
**Provenance of this study:** empirical, **observed** cases (real production summaries). Harness: `t2381_calib.py` (committed alongside).

## TL;DR — FAILED VALIDATION. Actuation NO-GO on this signal.

The `out_of_scope_ceiling = 0.30` guard routes a key_point to `unmapped_concepts` when its POV-filtered **top-1** cosine is `< 0.30` (Arm A) — the premise being "even the best node in the POV camp has no home." Per the t/2294 reproduce-before-assert rule, this must be confirmed against the two named adjudication misfires before nulling is enabled.

**It does not reproduce.** Both named "out-of-scope" cases have top-1 ≈ **0.64** — nowhere near 0.30, and *above* the in-scope control median. The guard's Arm A (and Arm C) would **never fire** on either of the two cases that motivated it. The absolute-low-ceiling premise is falsified.

## Method

- **Query:** each case's real `attribution_text` (the field the guard scores — verified against the summary objects).
- **Base space** (what the guard uses — `Invoke-Mechanism5RetrievalPass` / `Invoke-RetrievalConfidencePass` score `$script:CachedEmbeddings`, one vector/node): cosine to each POV-filtered (`saf-`) node's `embeddings.json` `vector`; report top-1.
- **Synthetic-mean space** (what candidate retrieval uses — `Get-RelevantTaxonomyNodes.ps1:264-285`): per node, cosine to each synthetic paraphrase vector (`synthetic/embeddings_saf.npy` via `index_saf.json`), ranked, **mean of top-N (N=3)**; base fallback for the 21 base-only nodes. Report top-1.
- Model: `all-MiniLM-L6-v2` (matches `embeddings.json` `model`). 336 base / 315 synthetic `saf-` nodes.

## Results — the two named misfires (AC#1)

| Case (source doc) | Ticket claim | Base top-1 | Synth top-1 | `saf-int-212` probe | Assigned-node rank |
|---|---|---|---|---|---|
| **saf-intentions-008** — "integration of clean energy and demand-side flexibility to preserve **grid reliability**…" (`clean-energy-resources-meet-data-center-…`) | out-of-scope (no home) | **saf-intentions-212 @0.636** (rank 1) | saf-intentions-047 @0.598; **212 @0.590 (rank 2)** | base 0.636 (r1) / syn 0.590 (r2) | 008 @0.490 (base r110) |
| **saf-beliefs-129** — "human **deliberation** is inherently provisional… defeasible reasoning" (`advancing-deliberative-discourse-…`) | out-of-scope (no home) | saf-intentions-174 @0.637 | saf-beliefs-255 @0.622 | base 0.390 (r297) | 129 @0.568 (base r34) |

**Interpretation:**
1. **saf-intentions-008 (grid) is NOT out-of-scope — it is retrieval-fixable.** The renewable-energy node **saf-intentions-212** *is* a plausible home and ranks **#1 in base (0.636)** / #2 in synthetic (0.590), vastly better than the assigned power-seeking node saf-intentions-008 (0.490, rank 110). The assigned node was a literal "power-grid" vs "power-seeking" vocabulary collision from LLM free-selection. Margin over assigned = 0.636 − 0.490 = **0.146 > 0.06**, so **Mechanism #5 v1 (t/2357) already surfaces saf-intentions-212 for this key_point.** This matches the t/2341 adjudication's own classification (line 20: grid → saf-intentions-212, *retrieval-fixable*) and contradicts the t/2370/t/2381 ticket text that labeled it out-of-scope.
2. **saf-beliefs-129 (human-deliberation) scores 0.637 against a false home** (saf-intentions-174). Whether or not 174 is a correct home, its top-1 is ≈0.64 — the low-ceiling detector cannot see it. Genuine "no home" here manifests as a *high-score false match*, not a low absolute score.

## Results — control set, both spaces (AC#3)

14 in-scope `saf-` key_points (real summaries):

| | base top-1 | synth top-1 |
|---|---|---|
| min | 0.430 | 0.475 |
| median | 0.515 | 0.586 |
| max | 0.624 | 0.683 |
| ≥ 0.45 | 11/14 | 14/14 |

Synthetic-mean runs ~0.05–0.07 above base (augmentation lift). **No separation exists:** the two named misfires (base 0.636/0.637) sit *above* the control median — an out-of-scope classifier keyed on absolute top-1 cannot distinguish them from genuinely in-scope key_points. (Control caveat: selection was first-per-file, not strictly assigned==top-1; it establishes the in-scope band, n=14, not a precision estimate.)

## AC dispositions

- **AC#1 (two-space reproduction):** DONE. Both cases reported in base + synthetic. Neither reaches `< 0.30` in either space (both ≈0.64).
- **AC#2 (ceiling derivation/retune):** **FAILED VALIDATION.** 0.30 cannot be confirmed, and cannot be retuned to any value that separates these cases from in-scope — they are high-scoring, not low. `out_of_scope_ceiling` **stays `stipulated`** with this failed-validation finding recorded (failed-validation ≠ derived).
- **AC#3 (control both spaces):** DONE. In-scope band base med 0.515 / synth 0.586; overlaps the misfires entirely → no threshold separates.
- **AC#4 (design decision — synthetic-mean 4th arm vs base-only):** **MOOT.** The base-vs-synthetic asymmetry is irrelevant because the absolute-low-ceiling *premise itself* fails in both spaces. If out-of-scope detection is ever revisited it needs a **different signal** (not absolute top-1), and the two-space question is re-opened then.
- **AC#5:** this doc + register update land together (this PR).

## Recommendation

1. **Out-of-scope actuation (null → `unmapped_concepts`) = NO-GO on the absolute-low-ceiling signal.** On both motivating cases the shipped three-arm guard would never fire (Arm A: top-1 ≥ 0.30; Arm C: a ≥0.45 candidate exists). Enabling nulling adds regression surface with zero demonstrated benefit on the very cases it targets.
2. **The grid case is already covered** by Mechanism #5 v1 surfacing (t/2357) — it is a retrieval-fixable misfire, not out-of-scope. No new mechanism needed.
3. **Keep t/2370 flag-only** (or reconsider removing it): the `out_of_scope_flag` will rarely fire correctly. If out-of-scope detection is still wanted, the real signal for "no home" here is a *high-score false match*, which requires a different discriminator (e.g. human/LLM adjudication of the top-1, or a coverage-gap route via t/2371) — not an absolute cosine floor.
4. Route the actuation GO/NO-GO to TL (actuation is a downstream PS ticket gated on this study).

## Limitation

n = 2 named cases (the ACs' required targets) + 14 controls. Both named cases fail the premise decisively; a broader observed out-of-scope sample would strengthen a general "no absolute ceiling works" claim but is not required to reject the 0.30 ceiling against its own motivating set.
