# t/2341 — Mechanism #5 CL adjudication study (misfire ground-truth)

**Author:** Computational Linguist · **Date:** 2026-08-09 · **Status:** results in — routing to TL. **Decision-changing vs. the automated pass.**
**Provenance:** derived (this study). CL hand-adjudication, n=50 (30 random + 20 divergent-band), safetyist POV. Sample = stride-4 spread over 884 corpus key_points → 220 scored; flag rate 5/220 = **2.3%** (consistent with the automated 2%).

## Method
Two arms from the 220-scored spread sample:
- **Random arm (n=30):** base misfire rate + flag-gate recall.
- **Divergent-band arm (n=20):** confident (conf≥0.45) AND assigned rank>30 — measures v2 precision.
For each, CL judged the assigned node **correct / misfire** against the key_point (genus-differentia + Encompasses/Excludes fit), and whether the per-key_point top-3 offers a **clearly better home** (retrieval-fixable). Judgments are CL's; a second rater (≥⅓ unfamiliar) would sharpen the borderline band (t/2294 discipline).

## Result 1 — v1 flag-gate recall on real misfires ≈ **0%** (the headline)
Random arm (n=30): ~20 correct (67%), ~6 borderline (20%), **~4 clear misfires (13%)**; 2 of those are retrieval-fixable (7%).
**None of the ~4 misfires was flagged** (conf<0.45). Their confidences: 0.643, 0.576, 0.575, 0.568 — all **above** the gate. Real vocabulary-collision misfires are **high-confidence**: the wrong node shares surface vocabulary → high absolute cosine, only its *rank* is bad. The saf-167 case_1 (conf≈0, absent from top-80) is **atypical** — it's the retrieval-*unreachable* sub-class, not the dominant mode.

**Implication:** v1 flag-gated (fire on conf<0.45) is **safe but low-yield** — it catches the rare unreachable class (~2% of assignments, genuinely wrong) and **misses the dominant high-confidence misfire mode**. The automated pass over-read v1's benefit; its *safety* holds, its *reach* does not.

## Result 2 — divergent-band (rank>30, confident) precision ≈ **25–40%**
Divergent arm (n=20), CL verdicts:
- **Retrieval-fixable misfire (v2 true positive): ~5–8 (25–40%).** Clean cases: #10 "algorithmic shadow" → `saf-beliefs-222` @0.92 (exact); #13 NIST-certification Desire → `saf-desires-026` @0.77; #20 thematic-pillar → `saf-beliefs-152` (conflict-of-interest/capture); #4 utility-validation → `saf-intentions-083`; #14 grid "power" → `saf-intentions-212` (a literal **"power-seeking" vs "power-grid" vocabulary collision**).
- **Misfire with NO clean retrieval home: ~50%** — taxonomy-structure problems, not retrieval: **thematic-pillar nodes** assigned to specific key_points (`saf-beliefs-210/211` are grouping pillars, not claims), **out-of-scope** extractions (human-deliberation, knowledge-collapse-moratorium), and genuine **taxonomy gaps** (worker-led monitoring, sovereign/state control).
- **Actually correct (v2 false positive): ~10%** — e.g. #11 `saf-intentions-052` is right at rank 37; per-key_point top-3 are worse.

**Implication:** auto-correcting on the raw rank>30 band would replace a defensible-or-unfixable assignment **~60–75% of the time**. **v2 auto-correct = NO-GO**; surface-only confirmed. A tighter rank/margin threshold (or an exact-match cut, conf≥0.85 at top-1) recovers the high-precision slice.

## Result 3 — reconciling v1/v2: broaden *surfacing*, keep *auto-correct* narrow
**flag→surface is zero-regression at *any* precision** — it only shows a human candidate nodes, never overwrites. Therefore the **surfacing trigger should broaden** from `conf<0.45` to **`conf<gate OR high rank-divergence`** — this catches the high-confidence misfires the flag-gate misses (Result 1), with no regression. **Auto-correct** stays on the narrow high-precision slice only (near-exact per-key_point top-1, e.g. ≥0.85 & decisive margin — the algorithmic-shadow-→222 shape). This folds v2's divergence signal into v1 **safely** (as surfacing), which is the actual yield.

## Deliverables to TL (the three numbers requested)
| Ask | Result |
|---|---|
| **v1 real misfire-reduction rate** | **Low.** Flag-gate recall ≈ 0/4 on random-arm misfires; v1 catches only the unreachable class (~2%, genuinely wrong). Safe, not high-yield. |
| **v2 divergent-band precision** | **~25–40%** retrieval-fixable → **auto-correct NO-GO**, surface-only. ~50% are taxonomy-structure misfires (no retrieval fix). |
| **v1 auto-correct margin** | Keep **narrow/conservative** — near-exact top-1 only (≈≥0.85 + decisive margin). The broad flagged set is too small and the divergent band too impure to auto-act on. |

## Recommendations
1. **Ship v1 flag→surface (safe)** — but **broaden the surfacing trigger to `conf<gate OR rank-divergence>K`** (K≈ top-10/top-30; CL to tune). Zero-regression; this is where the misfire *reach* comes from. (Update t/2357.)
2. **Auto-correct: narrow + conservative** — near-exact per-key_point top-1 only. No broad auto-correct.
3. **v2 divergence auto-correct: NO-GO** — realized instead as the broadened v1 surfacing (rec 1).
4. **Complementary (non-retrieval) work — file follow-ups:** (a) **exclude thematic-pillar nodes** (`saf-beliefs-210/211`, etc.) from key_point assignment — they're grouping nodes, not claims; (b) **extraction-scope guard** for out-of-scope key_points; (c) log the taxonomy-gap misfires as **coverage candidates**. ~50% of the misfire class lives here, outside retrieval's reach.

## Caveats
Single-rater; n=30/20 (breadth over replication, per t/2306); safetyist-only; borderline band (~20%) is judgment-sensitive. The *directions* (flag-gate ≈0 recall on high-conf misfires; divergent-band precision well under 50%; large taxonomy-structure component) are robust to rater disagreement on individual borderline cases. A second rater on the borderline + divergent bands would tighten the 25–40% precision estimate before setting the v2/surfacing threshold.
