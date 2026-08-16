# AFFECT_PHASE_BASELINES — v2 fit on the pruned-lexicon corpus (t/2680)

**Status:** provisional (upgraded evidence pointer). **NOT `derived`.** Supersedes the v1 provisional fit (`provisional-fit.md`, 39 un-pruned transcripts, t/1771/#2675).

## What changed since v1

- **v1** (t/1771#4, PR #1070 / value in t/2675): baselines fit from `computeAffectProfile` recomputed over **39** local transcripts on the **un-pruned** lexicon. Empathy/fear dominated (~0.40/~0.36) — a **lexicon-breadth artifact** (ubiquitous tokens like *people/workers/risk*), not a measured register.
- **t/2677** (`018b6dbf`): pruned those ubiquitous tokens from the fear/empathy `AFFECT_LEXICONS`.
- **t/2676** (`8289ae30`): logs `affect_profile_by_phase` per debate — per-phase mean of share-normalized per-turn profiles + `n_turns`.
- **v2 (this doc):** fit directly from `affect_profile_by_phase` on a **deliberate 66-debate corpus generated on the pruned lexicon** (DebateTool, t/2680), turn-weighted. No transcript re-run — the logged shares are the fit input.

## Corpus

- Source: `C:/tmp/t2680-affect-batch/calibration/**/calibration-log.jsonl` (isolated; main cal-log untouched).
- **66 unique `debate_id`s**, all carrying `affect_profile_by_phase` (≥30 trigger met). `gemini-3.5-flash-lite`, tight pacing, AI-policy topics.
- Cal-log **double-writes** (2 core + 2 users rows/debate); dedup by `debate_id`, verified 0 non-identical duplicate rows.

## Method

Per phase, baseline = **turn-weighted** mean of the logged `profile_mean` across debates: `Σ nᵢ·profileᵢ / Σ nᵢ` (using logged `n_turns`), then renormalized to shares (sum→1.0). Debate-weighted mean reported as a cross-check. Script: `fit-baselines-v2.py`.

## Fitted baselines

| Phase | debates | turns | urgency | fear | hope | outrage | empathy |
|---|---|---|---|---|---|---|---|
| confrontation | 66 | 301 | 0.18 | 0.39 | 0.16 | 0.09 | 0.18 |
| argumentation | 65 | 155 | 0.19 | 0.37 | 0.23 | 0.06 | 0.15 |
| **concluding** | **0** | **0** | — | — | — | — | — |

Debate-weighted cross-check is near-identical (max per-cell Δ ≤ 0.01) — no outlier-debate skew. Empathy collapses from the v1 ~0.40 to ~0.16 — the intended t/2677 effect.

## Degeneracy re-check (t/2680 AC3) — PASS

`degeneracy-check-v2.mts`, using the **shipped** `computeAffectProfile` (post-prune lexicon):

- **Neutral academic paragraph** → all-category profile 0.000 → `total = 0` → appropriateness **`null`** (no-evidence), NOT a spurious high score. The t/1771 "no-lose bucket" is gone because t/2677 removed the ubiquitous-token saturation.
- High-affect rhetorical → 0.66–0.69 (new baselines); mixed-balanced → 0.49–0.54. Sensible spread, no saturation to ~1.0.

## Calibration effect (per-phase mean profile, current provisional vs v2 baselines)

| Phase | median (cur→v2) | below-0.60 (cur→v2) |
|---|---|---|
| confrontation | 0.615 → **0.723** | 28/66 → **9/66** |
| argumentation | 0.522 → **0.633** | 43/65 → **29/65** |

Centering improves; spread preserved (still discriminating).

## Why this stays provisional, not `derived`

1. **Concluding phase has zero data.** Tight pacing produced no concluding-phase turns across all 66 debates. That phase cannot be grounded on this corpus; its baseline is left **unchanged** (still the v1 provisional value, itself un-pruned-artifact-bearing). Follow-up: a `moderate`-pacing batch to cover concluding.
2. **Single-model / single-pacing corpus.** All 66 are `gemini-3.5-flash-lite` / tight. The lexicon reads any text, but the share *distribution* is that generation regime's; `affect_appropriateness` also scores Opus-main debates, so a defensible `derived` claim wants model spread. Follow-up: multi-model corpus before final promotion.

## Landing

- **Values (confrontation + argumentation only):** land in `lib/debate/affectSignals.ts` `AFFECT_PHASE_BASELINES` via DebateTool (CL specifies, DebateTool edits — same split as t/2675). Concluding row **unchanged**.
- **Cutover:** the pruned-lexicon + v2-baseline change is a **third non-comparability boundary** for `affect_appropriateness` (after t/1785 units fix and t/2677 lexicon prune). No trend may span it.
- **Provenance:** `AFFECT_PHASE_BASELINES` and `affect_appropriateness` stay **stipulated/provisional** with this doc as the upgraded evidence pointer; promotion to `derived` gated on the two follow-ups above.
