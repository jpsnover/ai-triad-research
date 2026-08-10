# Proposal: Regenerate the taxonomy embeddings at a weighted composition (option B, t/2440)

**Author:** Computational Linguist · **Route:** → Technical Lead → PI · **Status:** proposal (no corpus changes)
**Last updated:** 2026-08-10 · **Parent:** t/2425 (option A, landed); **filed by:** t/2440

---

## 1. TL;DR / the decision this asks for

t/2425 established that the live `embeddings.json` is **description-only** (single-field `description`, `w=1.0`) and aligned everything to it (envelope, generator default, drift gate). This proposal asks the PI to decide whether to **move the canonical composition to a *weighted* blend**, either the register's "0.611/0.389" or the golden-set-validated **0.8/0.2**, to recover retrieval quality.

The honest headline: the register's "**0.611/0.389 → +14% MRR**" is **not a clean validated result** (see §2). The *best-evidenced* weighted composition is **0.8/0.2 (MRR 0.1834)** from the t/519 golden-set study, roughly 10 to 15% above the pre-weighting states. The live corpus **silently regressed** to description-only, so we are very likely **already leaving that ~12% on the table today**. The exact gain on the *current* 2871-node corpus, though, is **unmeasured**.

**Recommendation: run a Stage-0 experiment first** (cheap, no production change) to establish the real gain, then decide. And a hard prerequisite either way: the **taxonomy-editor** embedding path must be taught the weighted composition, or any regenerate silently decays back to description-only (§6). I do **not** recommend a blind regenerate to 0.611/0.389 on the strength of the register line.

---

## 2. Does the MRR derivation still hold on the 2871-node corpus? (Unknown; must be re-derived)

The provenance for the two candidate weightings:

- **0.8/0.2** was validated in the **t/507/t/519 golden-set study (2026-06-08)**: 515 golden claims × 76 to 165 same-POV Belief candidates, all-MiniLM-L6-v2, production MRR moving from **0.1558 to 0.1834 (+0.028, +18%)** as the label prefix was removed and the assumes weight was tuned to 0.2. This is the strongest evidence we have, and it points at **0.8/0.2**, not 0.611/0.389.
- **0.611/0.389** appears only as **condition B ("no lineage")** in `research/comp-linguist/ablation_lineage.py`, a renormalization of a `(0.55, 0.35, 0.10)` lineage-inclusive scheme. I found **no saved result** establishing that 0.611/0.389 beats 0.8/0.2 (or description-only) by +14% on a golden set. The register's "+14%" attribution is **unverified and possibly conflated** with the t/519 0.8/0.2 win.

Three reasons it cannot be assumed to hold now:

1. The corpus has grown to **2871 entries** (including the t/2408 and t/2426 additions) and the POV mix has shifted since the 2026-06 study.
2. The golden set (515 claims) is about two months old and may not reflect current node coverage.
3. The study's baseline was not the current production state. The corpus is description-only *now*; the t/519 comparison was against a different pre-weighting configuration. The delta available today (description-only to weighted) has to be measured directly, not inherited.

So the +14% (and even the +12%) figure is a prior, not a current measurement. Stage 0 (§7) re-derives it before any commitment.

---

## 3. Blast radius

A regenerate rewrites **every** vector in `embeddings.json` (all 2871). Cosine geometry shifts corpus-wide, so **every consumer of all-MiniLM cosines moves**, including:

- `retrieval_confidence` (bi-encoder cosine; t/2288) and the **0.45** confidence gate.
- **Mechanism #5** retrieval-pass candidates and margin surfacing (t/2357).
- `situation_crux_alignment` and situation selection scoring.
- Claim dedup **0.82** threshold; `CRUX_MATCH_SIMILARITY_THRESHOLD` **0.5**; `FRAME_PRESENCE_THRESHOLD` **0.5**; entity name-matching; org-stance retrieval.
- The **t/2408 coverage-gap** homes and the **SAF-167** fixture expectations.

Every one of those thresholds was tuned against the *current* (description-only) vector space. A new space can move their operating points even when aggregate MRR improves. That re-validation, not the regenerate itself, is the main cost.

---

## 4. Calibration validation plan

Pre-registered, blind where possible:

1. **Retrieval MRR gate (the go/no-go).** Re-run the t/507 golden set on the current corpus for `{description-only (baseline), 0.8/0.2, 0.611/0.389, 0.55/0.35/0.10 (lineage)}`. Pre-register a bar (for example **≥ +5% MRR** over the description-only baseline *and* no Top-1 regression) before looking at results. Refresh the golden set if node coverage has drifted, and keep labels blind to similarities (the t/1853 register/basis-mismatch lesson).
2. **Threshold re-baseline.** For each embedding-threshold metric in §3, measure the score-distribution shift on a fixed sample and re-fit or re-confirm the threshold. Any threshold that moves materially gets its own pre-registered re-validation rather than a silent inheritance.
3. **Fixture regression.** Confirm SAF-167 and the t/2408 coverage-gap candidates still resolve to their correct homes under the new composition (the gap nodes must stay rank-1 for their source queries).
4. **Drift-gate update and both-arms re-proof.** The gate's `CANONICAL_WEIGHTS` (currently `1,0,0,0,0`) and the envelope both move to the new composition atomically with the regenerate, then `--selftest` re-runs in CI (clean arm plus planted-drift) to reprove both arms against the new canonical.
5. **Censoring and window hygiene.** Calibration metrics computed across the cutover commit are not comparable, because the vector space differs. Mark the cutover in the register so windows are read un-pooled across it (cf. the t/1671 censoring-gate discipline).

---

## 5. Cutover and rollback

Cutover is atomic across five surfaces, since a partial cutover is the state the drift gate now blocks:

1. `ai-triad-data/taxonomy/Origin/embeddings.json`: regenerate at the chosen weights (`embed_taxonomy.py generate --field-weights …`).
2. Envelope `field_weights`: written by the regenerate, matching the new composition.
3. `scripts/embed_taxonomy.py` `DEFAULT_FIELD_WEIGHTS`: set to the chosen weights (PowerShell scope).
4. `check_composition_drift.py` `CANONICAL_WEIGHTS`: updated to the new composition (CL scope).
5. `taxonomy-editor/src/main/embeddings.ts`: teach the editor path the weighted composition (§6, taxonomy-editor scope). Without surface 5 the cutover is not durable.
6. Register cutover note plus a calibration-window marker.

**Rollback.** Record the pre-regenerate `embeddings.json` blob SHA. Rollback is a `git revert` of the regenerate commit (restoring description-only) plus a revert of surfaces 2 through 5. The **drift gate makes rollback safe**: it verifies the reverted corpus matches its declared composition and catches a half-reverted state. Rollback stays cheap and fast as long as the pre-regen SHA is recorded before cutover.

---

## 6. The editor-path composition question (the load-bearing prerequisite)

`taxonomy-editor/src/main/embeddings.ts::updateNodeEmbeddings` embeds a **single text (description-only)** and is the **de-facto corpus maintainer**: it rewrites `embeddings.json` on every node edit. This is the mechanism that produced the t/2425 drift in the first place.

A weighted regenerate that leaves the editor path single-field therefore re-opens the two-generator drift immediately. Every node edited in the editor after cutover reverts to description-only, silently re-regressing retrieval **one node at a time**. Worse, the drift gate would then start **blocking** (declared weighted, actual increasingly mixed), turning a quiet decay into a red CI.

So option B **requires** porting the weighted recipe into `embeddings.ts` (encode description and assumes separately, weighted-sum, single L2, including the ONNX path). That is a real taxonomy-editor engineering task (cross-scope) and the dominant cost of B, ahead of the regenerate itself. Any B decision has to fund it, or B is a temporary win with a built-in decay and a CI-blocking failure mode.

---

## 7. Recommendation and sequencing (after A plus the drift gate)

A is landed and the drift gate guards description-only. B *moves* the canonical, so it sequences strictly after A is stable. I recommend a **staged, experiment-gated** path so we don't pay B's cost on an unverified prior:

- **Stage 0, measure** (cheap, no production change; CL). Run the §4.1 golden-set ablation on the current 2871-node corpus for description-only vs 0.8/0.2 vs 0.611/0.389 vs the lineage variant. Deliverable: the real MRR and Top-1 delta available today. This decides everything and costs a few hours of compute. If Stage 0 shows under 5% gain over the live description-only corpus, B is not worth the editor-path engineering, and we stop here.
- **Stage 1, durability** (only if Stage 0 clears the bar; taxonomy-editor). Port the weighted composition into `updateNodeEmbeddings` and the ONNX path. This is the prerequisite for a lasting cutover.
- **Stage 2, atomic cutover** (CL + PowerShell + DevOps + data). Regenerate at the chosen weights, update all five surfaces (§5), run the §4 validation, re-prove the drift gate's both arms in CI, record the rollback SHA, mark the register.

**My recommendation to the PI: approve Stage 0 only** for now. It is the honest, low-cost way to convert the register's unverified "+14%" into a real number on today's corpus. Fund Stages 1 and 2 only if Stage 0 clears a pre-registered bar. Adopting 0.611/0.389 (or 0.8/0.2) blind, without Stage 0 and without the editor-path fix, would ship an unverified gain on top of a self-reversing corpus, which is not defensible for a research-affecting, corpus-wide rebaseline.

---

## Appendix: evidence pointers

- t/2425 (composition root cause and option A); t/2408 (empirical description-only finding, byte-stability gate); t/2426 (backfill to 2871 nodes).
- `research/comp-linguist/analyses/claim-matching-improvement-hypotheses.md` (t/507; the 0.8/0.2 → MRR 0.1834 result, and the negative results for cross-encoder, larger models, and MRL).
- `research/comp-linguist/ablation_lineage.py` (the 0.611/0.389 "no-lineage" condition).
- `research/comp-linguist/docs/metric-provenance-register.md` row 59 (the "0.611/0.389 +14%, never applied" line this proposal is grounding).
- `research/comp-linguist/analyses/embedding-drift-gate/` (the gate that makes the cutover and rollback safe).
