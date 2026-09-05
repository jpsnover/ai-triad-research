# Cross-conflict pairing (t/3339) — candidate generation + precision golden

Fork-B's benefit arm folded here (TL ruling t/3336#12): the same-doc lever alone missed the bar
(×2.12 conflicts / 9.5% nodes, below ≥2×/≥10%). This lever pairs the **457 one-sided-stance
single-instance conflicts** with **observed opposing claims elsewhere in the corpus**, turning them into
multi-instance conflicts with adversarial (attack) edges. Cluster-only (85% in-corpus availability); no
generation. Union Δ (same-doc ∪ cross-conflict contradicts) is measured against the same bar.

## Pipeline (TL-approved design, t/3339#6) — CLASSIFY-BEFORE-MERGE
1. `build_candidates.py` → `candidates.json`: for each one-sided stance, top-K=3 cross-conflict neighbors
   in cosine band **[0.55, 0.90)** (0.90 excludes near-dup/entail; 0.55 topical floor). No data write.
   1055 pairs, 391/457 stances covered, 669 distinct opposing claims.
2. **Classifier (PowerShell enrich)** judges each pair A-vs-B → `{pair_id, predicted, confidence}`.
3. `build_golden_xc.py --make` → blind precision golden (shuffled predicted-contradict + predicted-other);
   CL blind-labels; `--score` computes Wilson-95 LB precision on the classifier's contradict calls.
   **GATE (TL-GV'd): LB ≥ 0.85** on this cross-conflict distribution before any contradict counts.
4. Only **confirmed contradict @ conf ≥ 0.90** merge (≤1 opposing instance/stance), symmetric attack edge,
   provenance `origin=semantic-cluster, claim_origin=observed` (extends t/3302#24 edge provenance).

## Bar integrity (TL rulings)
- Union measured **observed-only**; synthetic attacks never count toward ≥10% (generation ≈ 0 here anyway).
- Observed/synthesized **split → PI**.
- **Denominator pinned** = current qbaf-conflict set (338) as the fixed baseline; the 432-non-conflict
  demotion ships as a **separate diff** so it can't silently inflate the ×2.
- An observed union that still misses = a **real finding** (intrinsically low-adversarial corpus), NOT a
  cue to synthesize attacks to hit 10% (TL p/349#185). Recalibrate the bar, don't game it.

## Files
- `candidates.json` — the 1055 candidate pairs (classifier input).
- `build_candidates.py` — candidate construction (reads conflicts.json + the singleton classification).
- `build_golden_xc.py` — blind precision golden builder + Wilson-LB scorer.
