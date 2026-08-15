# t/1771 — Provisional affect-baseline fit (2026-08-15)

**Author:** Computational Linguist · **Status:** provisional (not a `derived` promotion) · **Ticket:** t/1771

## What this is

A provisional refit of `AFFECT_PHASE_BASELINES` (`lib/debate/affectSignals.ts`) to the
empirical per-phase affect-profile *shares* observed in real debates, after the t/1785
construct fix (share-normalization) made the old stipulated baselines mis-calibrated
(post-fix, 100% of real turns scored below the 0.60 target; observed ceiling 0.580 —
the target was mathematically unreachable).

Landing decision: **land provisional now** (owner, 2026-08-15) — the metric is unusable as
shipped, so a fit that restores discrimination is a strict improvement even before the durable
work lands.

## Method (faithful to the shipped pipeline)

`fit-baselines.mts` imports the **shipped** `computeAffectProfile` and `getDebatePhase` and
mirrors `calibrationLogger/extract-metrics.ts::computeAffectSignals` turn-filtering exactly
(opening/statement turns, excluding system/moderator, non-empty content, profile null-guard,
`total<=0` skip). For each qualifying turn it share-normalizes the profile
(`profile[cat]/Σprofile`) and buckets by `getDebatePhase(round, maxRound)`. The fitted baseline
per phase is the mean share vector across that phase's turns, renormalized to sum 1.

Run: `cd research/comp-linguist/analyses/t1771-affect && npx tsx fit-baselines.mts`
(reads `$AI_TRIAD_DATA_ROOT`). Machine-readable output: `fitted-baselines.json`.

## Sample (provisional — this is the constraint)

Unique real-prose debates (calibration MSL≥10): **171**. Of these, only **39** have a transcript
on disk (the rest were pruned; 158 debate JSONs deleted across data-repo history). Fit rests on
those 39 debates = **435 turns**: confrontation 188 / argumentation 214 / **concluding 33**.
The concluding phase in particular is thin.

## Result

| Phase | | urgency | fear | hope | outrage | empathy |
|-------|--|--------|------|------|---------|---------|
| confrontation | current | 0.30 | 0.20 | 0.17 | 0.17 | 0.14 |
| | **fitted** | 0.06 | 0.36 | 0.09 | 0.10 | 0.40 |
| argumentation | current | 0.20 | 0.12 | 0.30 | 0.09 | 0.24 |
| | **fitted** | 0.07 | 0.39 | 0.09 | 0.08 | 0.37 |
| concluding | current | 0.25 | 0.08 | 0.39 | 0.04 | 0.29 |
| | **fitted** | 0.09 | 0.30 | 0.10 | 0.11 | 0.40 |

**Calibration effect** (baselines refit, `MAX_ACCEPTABLE_DEVIATION` unchanged at 0.35):
median `affect_appropriateness` 0.40 → **0.63**; below-0.60 rate 372/435 → 181/435. The
unreachable-target problem is resolved without touching MAX_DEV — so this fit changes **only**
`AFFECT_PHASE_BASELINES`, nothing else.

## Known limitation — lexicon-breadth artifact (why this stays `stipulated`, not `derived`)

The dominant empathy (~0.40) and fear (~0.36) shares are substantially an artifact of lexicon
breadth, not measured rhetorical register. A deliberately *neutral* academic sentence
("...how people and communities in practice experience the impact on individuals when a system
is deployed, and the risk that it may undermine institutions...") scores
`{urgency:0, fear:1, hope:1, outrage:0, empathy:1}` — the empathy lexicon matches *people,
communities, impact on, workers, in practice, individual(s)*; fear matches *risk, undermine*.
These tokens are ubiquitous in AI-policy prose.

Consequence: fitting baselines to these shares makes the metric self-consistent and discriminating
again (good enough to ship provisionally), but bakes a word-frequency prior into the definition
of "appropriate register." That is **not** a defensible basis for a `stipulated → derived`
promotion. The empathy and fear lexicons should be tightened (drop ubiquitous tokens) *before*
any fit is promoted.

## Provenance disposition

`AFFECT_PHASE_BASELINES` and `affect_appropriateness` **stay `stipulated`** with a provisional-fit
evidence pointer to this document. They do **not** move to `derived`. Path to `derived` (durable):
1. Tighten empathy/fear lexicons (drop ubiquitous tokens) — CL-specified, DebateTool-owned.
2. Log per-category affect profile at scale (DebateTool) so the fit rests on the full population,
   not 39 locally-retained transcripts.
3. Re-fit on the cleaned lexicons + full population; re-derive `MAX_ACCEPTABLE_DEVIATION`; promote.

## Follow-up tickets

- Land provisional fitted baselines in `affectSignals.ts` (DebateTool) — value change, exact vector above.
- Log per-category affect profile at scale (DebateTool) — durable step 2.
- Tighten empathy/fear lexicons (DebateTool, CL-specified) — precondition for `derived`.
