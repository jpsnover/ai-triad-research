# t/2341 — Mechanism #5 validation results (A(b) per-key_point retrieval)

**Author:** Computational Linguist · **Date:** 2026-08-09 · **Status:** results in — routing to TL for GO/NO-GO + the v2 divergence-variant decision.
**Provenance:** derived (this study). Arm 1 = observed (t/2294 case_1). Arm 2 / Q3 = automated, **n=140 safetyist assignments**, non-random sample (first 140 key_points by filename) — structural arms are robust; the *misfire-rate* arm is pending CL adjudication (see §5).

## Method
Per-key_point `retrieval_confidence` = cosine(key_point `attribution_text` embedding, **assigned** node vector); assigned node's **rank** among all 336 safetyist node vectors. Query embeddings via `Invoke-BatchEmbeddings` (same all-MiniLM-L6-v2 model as production); node vectors from `embeddings.json`. Gate = 0.45 (the shipped t/2288 bi-encoder gate). Harness: `scratchpad/arm2q3.ps1` (+ `arm1.ps1` for case_1). Faithful to the production instrument; deterministic (per t/2306, sample-breadth not replication is the axis).

## Arm 1 — misfire mitigation (t/2294 case_1) — **PASS**
`Get-RelevantTaxonomyNodes -POV safetyist -MaxTotal 80 -Threshold 0`, three key_point query fields:

| query field | saf-167 (wrong) | saf-171 | saf-104 |
|---|---|---|---|
| attribution_text | **absent (>80)** | **rank 1** (0.649) | rank 4 (0.588) |
| verbatim_excerpt | **absent (>80)** | **rank 1** (0.522) | rank 2 (0.408) |
| canonical_proposition | absent (>80) | absent | rank 40 (0.515) |

The wrong node is unreachable per-key_point (→ retrieval_confidence ≈ 0, well below 0.45 → **flagged**); the correct youth family surfaces top-1/top-2 on the two natural queries. Matches the fixture's "mitigate (flag + surface), not auto-correct" expectation. **`attribution_text` and `verbatim` are the right per-key_point queries; `canonical_proposition` is over-abstracted — do not use it as the retrieval query.**

## Arm 2 — clean-case regression surface — **strong**
n=140. Median retrieval_confidence **0.77**. Assigned == per-key_point top-1: **59 (42%)**; in top-3: **75 (54%)**.
**Flagged (conf < 0.45): 3 (2%).** These 3 are the *only* assignments A(b) acts on (A(b) fires only on low-confidence + divergent). The confident 98% are structurally untouched → **A(b)'s worst-case regression is bounded at ~2%.** The 3 flagged are genuine retrieval-wrong catches (e.g. `saf-beliefs-046` conf 0.387, ranks **295th** for its own key_point). A(b) clears Arm 2 structurally: it cannot flip a confident-correct pick because it never examines one.

## Q3 — high-confidence-misfire miss rate (the ceiling the flag-gate caps)
Assigned-node per-key_point **rank** distribution: rank 1 = 42%, 2–3 = 11%, 4–10 = 8%, 11–30 = 15%, **>30 = 24%**.

Refined "confident-divergent" (conf ≥ 0.45 AND assigned not the retrieval top-1), by divergence severity:
- rank > 3: **44%** (mild+ — mostly near-ties, not actionable)
- rank > 10: **36%** (material)
- rank > 30: **21%** (severe — assigned node confident yet far from per-key_point retrieval)

**Finding:** the flag-gate (v1, conf<0.45) touches only 2%, but **≥21% of assignments are confident-yet-severely-divergent** — invisible to the flag-gate. Per TL's condition (t/2341#2), this band is **material**, so a **divergence-triggered variant is warranted for evaluation.**

**Caveat (load-bearing — do not over-read):** rank-divergence is an **upper bound on missed misfires, not a misfire count.** Three confounds: (1) the cosine scale is compressed (median 0.77; many nodes score 0.6–0.7 to any safetyist query), so a rank-38/conf-0.69 assignment can be *correct* amid near-ties; (2) the production LLM legitimately picks context-justified nodes that aren't the bare per-key_point cosine top-1; (3) per-key_point top-1 is **not** ground truth — in one sampled case the per-key_point top-1 is *itself* `saf-167` (the node that was wrong in case_1's context). The rank>30 tail also clusters in a few documents (possible per-doc artifact of the non-random sample). **True precision of the divergent band requires CL adjudication.**

## Ruling (two-arm bar, per t/2306)
- **A(b) flag-gated v1 → GO-candidate.** Arm 2 regression surface = 2% (structurally safe); Arm 1 mitigation confirmed on the labeled case; catches the clear retrieval-unreachable misfire class (saf-167-style). Ship target confirmed.
- **Divergence-triggered v2 → WARRANTED but ADJUDICATION-GATED.** The divergent band is material (21–36%), so the variant is worth evaluating — **but it must not auto-act until its precision is measured.** Firing on 21–36% of assignments without knowing the misfire rate inside that band would reintroduce exactly the Arm-2 regression the flag-gate avoids. v2 = **surface-for-review only** until adjudication sets a rank/margin threshold with acceptable precision.
- **Calibration note for TL:** the 0.45 absolute-cosine gate flags only 2% of real assignments — permissive on this dense taxonomy. **Rank-based divergence is a stronger misfire signal than absolute cosine here**; the v2 threshold should be rank/margin-based, not a lower absolute gate.

## 5. Remaining before PS implements
1. **CL adjudication study** (next): random sample across all 756 summaries (not first-140) + the confident-divergent rank>30 band; CL-judge each assigned node correct/misfire → (a) real misfire-reduction rate for v1, (b) **precision of the divergent band** to set the v2 rank/margin threshold (or NO-GO v2 if precision is low).
2. Then the final GO/NO-GO returns to TL with misfire-rate numbers; **PS implements v1** (`Invoke-DocumentSummary` per-key_point re-retrieval seam, flag-gated, surface + auto-correct-on-decisive-bi-encoder-margin) — PS ticket routes to **Main (TL)**, register/provenance in the same PR.

**Bottom line:** A(b) flag-gated is regression-safe and ready to build; the divergence variant is justified but needs a precision measurement first. No production code until the adjudication closes the misfire-rate arm and TL rules.
