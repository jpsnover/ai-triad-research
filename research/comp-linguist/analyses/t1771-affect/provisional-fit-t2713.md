# AFFECT_PHASE_BASELINES — concluding-row fit (t/2713)

**Status:** provisional. **NOT `derived`.** Completes the concluding row the v2 fit
(`provisional-fit-v2.md`, t/2680) left ungrounded. conf/arg rows are **unchanged** — this
ticket lands the **concluding row only**.

## Why a separate batch was needed

The v2 tight-pacing corpus produced **0 concluding-phase turns**. Root cause is structural,
not merely "pacing too tight" (t/2713#1): the affect fit's phase label comes from the
fixed-round `getDebatePhase(entryRound, statementCount)`, whose concluding rule is
`entryRound > max(statementCount - 2, 8)` — a turn is concluding-phase **only if the debate
produces ≥9 statement-rounds**. Pacing caps (`phaseTransitions.ts`): tight `maxTotalRounds=4`,
thorough `=8`, moderate `=10`. Only **moderate** clears the floor of 8. A moderate smoke debate
verified concluding is populated (12 rounds → concluding `n=2`).

## Corpus

- Source: `C:/tmp/t2713-affect-batch/calibration/**/calibration-log.jsonl` (isolated; main
  cal-log untouched).
- **30 unique `debate_id`s**, all carrying `affect_profile_by_phase`. `gemini-3.5-flash-lite`,
  **moderate pacing + `allowEarlyTermination:false`**, same 30 AI-policy topics as the v2 batch.
- Concluding coverage: **30 debates / 54 turns** (confrontation 30/142, argumentation 30/224).
- Cal-log double-writes; dedup by `debate_id`, **verified 0 non-identical duplicate rows**.
- DebateTool ran the ~4 h batch (long sequential batch un-hostable from CL turns; t/2680#4).
  Debate 23 needed one retry (transient `toLowerCase` error), then landed; 30/30 complete.

## Method

Identical to v2: per phase, baseline = **turn-weighted** mean of the logged `profile_mean`
across debates (`Σ nᵢ·profileᵢ / Σ nᵢ`, using logged `n_turns`), renormalized to shares.
Debate-weighted mean reported as a cross-check. 2-dp rounding by the largest-remainder method so
the row sums to exactly 1.00. Scripts: `fit-baselines-t2713.py`, `degeneracy-check-t2713.mts`.

## Fitted concluding baseline

| Phase | debates | turns | urgency | fear | hope | outrage | empathy |
|---|---|---|---|---|---|---|---|
| **concluding (NEW)** | **30** | **54** | **0.17** | **0.44** | **0.21** | **0.04** | **0.14** |
| concluding (OLD, un-pruned provisional) | 0 | 0 | 0.09 | 0.30 | 0.10 | 0.11 | 0.40 |

Turn-weighted raw (4-dp): `urgency 0.1759, fear 0.4428, hope 0.2071, outrage 0.0378,
empathy 0.1364`. Debate-weighted cross-check near-identical (max per-cell Δ ≤ 0.02:
fear 0.44→0.45, hope 0.21→0.20, empathy 0.14→0.13, outrage 0.04→0.03) — no outlier-debate skew.
**Empathy collapses 0.40 → 0.14** — the same t/2677 pruned-lexicon correction the v2 conf/arg rows
showed (the empathy over-weight was a lexicon-breadth artifact, not a measured register).

## Regime cross-check (why conf/arg are NOT re-fit here)

Recomputing conf/arg on this moderate + no-early-termination batch gives values that differ from
the v2 tight-pacing rows by up to ~0.10, confirming the fit is regime-sensitive:

| Phase | v2 (tight, shipped) | this batch (moderate) |
|---|---|---|
| confrontation | 0.18 / 0.39 / 0.16 / 0.09 / 0.18 | 0.16 / 0.42 / 0.19 / 0.07 / 0.16 |
| argumentation | 0.19 / 0.37 / 0.23 / 0.06 / 0.15 | 0.17 / 0.41 / 0.13 / 0.09 / 0.20 |

Because the regimes differ, the conf/arg rows stay on their v2 (tight) values; only the concluding
row is landed, on this moderate corpus. **Regime boundary to record:** the concluding baseline is
derived under moderate + no-early-termination, a different regime than the v2 conf/arg rows (tight).
Acceptable while all rows remain provisional pending the multi-model corpus.

## Degeneracy re-check (t/2680 AC3, concluding) — PASS

`degeneracy-check-t2713.mts`, using the **shipped** `computeAffectProfile` (post-prune lexicon):

- **Neutral academic paragraph** → all-category profile 0.000 → `total = 0` → appropriateness
  **`null`** (no-evidence), NOT a spurious high score. The t/1771 no-lose bucket stays gone.
- High-affect rhetorical → **0.632** against the new concluding baseline; mixed-balanced → **0.600**
  (vs the old concluding row's 0.604 / 0.314). Sensible spread, no saturation to ~1.0.

## Why this stays provisional, not `derived`

The concluding-coverage follow-up from `provisional-fit-v2.md` §"Why this stays provisional" item 1
is now **resolved** (concluding grounded on 30 debates / 54 turns). Item 2 remains:

- **Single-model corpus.** All 30 are `gemini-3.5-flash-lite`. `affect_appropriateness` also scores
  Opus-main debates, so a defensible `derived` claim still wants model spread (the t/2712/t2714
  multi-model corpus). Until then, the whole `AFFECT_PHASE_BASELINES` family stays
  **stipulated/provisional**.

## Landing

- **Value (concluding row only):** land in `lib/debate/affectSignals.ts` `AFFECT_PHASE_BASELINES`
  via **DebateTool** (CL specifies, DebateTool edits — same split as t/2675 / v2). conf/arg rows
  unchanged.

  ```ts
  concluding: { urgency: 0.17, fear: 0.44, hope: 0.21, outrage: 0.04, empathy: 0.14 },
  ```

- **Cutover:** the concluding-row value changes at the t/2713 landing, distinct from the t/2680
  v2 conf/arg landing, so it is a **fourth** `affect_appropriateness` non-comparability boundary —
  after t/1785 units, t/2677 lexicon, and the t/2680 v2 conf/arg baselines (this is the boundary
  DebateTool labels "fourth cutover" in the `affectSignals.ts` comment). No concluding-phase trend
  may span it.
- **Provenance:** `AFFECT_PHASE_BASELINES` / `affect_appropriateness` stay **stipulated/provisional**
  with this doc + `provisional-fit-v2.md` as the evidence pointers; promotion to `derived` gated on
  the remaining multi-model corpus.
