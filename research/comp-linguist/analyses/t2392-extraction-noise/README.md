# t/2392 — Extraction-noise investigation: what actually lives in the low-cosine tail

**Author:** Computational Linguist · **Date:** 2026-08-09 · **Ticket:** t/2392 (CL investigation → design; **do NOT implement**, TL-gated per t/2381#7)
**Provenance:** empirical, **observed** (real production summaries, `../ai-triad-data/summaries/*.json`). Harnesses committed alongside (`classify_noise.py`, `verify_attr.py`, `mode_crosstab.py`). Single-rater hand-labeling (n=50), per t/2306/t/2294 caveat.

## DISPOSITION — CLOSED, no guard (TL ruling, t/2392#1 reply, p/349#32, 2026-08-09)

**Ruled by Technical Lead:** both levers are **NO-GO**. (1) The cosine-cutoff extraction guard is dead — the tail is ~42% real content, the same non-separability as t/2381. (2) A maintained deterministic structural pre-filter is **not** justified: the ~0.6–0.9% true noise is too small and marginal (a subset of the already-redundant t/2288 flags), and structural detectors carry their own false-positive risk. **t/2392 is closed as "characterized — no guard."** This also closes the retrieval-quality program: option A(b) shipped; every other lever is NO-GO with documented rationale.

**Do not re-litigate.** Revisit only if this noise causes a **concrete downstream harm** — if that is observed, flag it (new ticket referencing this doc), do not silently reopen a guard.

## TL;DR — the ticket's premise does not survive measurement

The side-finding was framed as "~2.67% of key_points are **overwhelmingly non-content fragments** (math/OCR/table/PII)." Measured against the full flagged population:

1. **Clear structural noise is a minority of the tail (~⅓), not "overwhelmingly."** In a hand-labeled random 50-sample of the 293 `top-1 < 0.30` key_points: **~32% structural noise**, **~24% off-topic-but-real prose**, **~42% genuine in-scope claims that merely embed weakly.** The vivid math/PII exemplars in the ticket are real but not representative.
2. **A cosine top-1 threshold is the wrong instrument.** Because ~42% of the `<0.30` band is genuine in-scope content, a drop/quarantine filter keyed on `top-1 < 0.30` would have a **~40%+ false-positive rate on real claims** — the precision risk the ticket flagged (its item 3) is the *dominant* effect, not a corner case. **NO-GO on any cosine-cutoff extraction guard.**
3. **The real structural lever is `attribution_text` presence, and it is already decisive.** Of 10,972 assigned key_points, only **2,117 (19%) carry an `attribution_text`; those never score below 0.462** (min 0.462, p1 0.546) — **zero** in any low band. The entire low-cosine tail (293/293 at `<0.30`) is drawn from the **8,855 (81%) without `attribution_text`**.
4. **The noise does not pollute the downstream flags the ticket named.** Mechanism #5 v1 (t/2357) and the t/2288 confidence pass **score `attribution_text` and skip key_points that lack it** (`Invoke-RetrievalConfidencePass.ps1:87`); the out-of-scope guard only examines M5-flagged misfires (`Invoke-OutOfScopeGuardPass.ps1:59`, Arm B). Since the tail is 100% no-`attribution_text`, **none of it reaches M5-v1 surfacing, t/2288, or the OOS guard.** The stated "inflates flag volume" harm does not occur. The real harm is **corpus pollution** — confident *wrong* taxonomy assignments in the persisted key_point set (~2.67%).

## Method

- Reused the t/2381 corpus-scan logic (`t2381_corpus_scan.py`): POV-filtered base top-1 cosine over `saf-/acc-/skp-` `embeddings.json` vectors, `all-MiniLM-L6-v2`, for every assigned key_point.
- **Text field:** the scan (and the pipeline flag) uses `attribution_text` → `verbatim` → `point` fallback. `verify_attr.py` splits the distribution by `attribution_text` present/absent.
- **Classification:** `classify_noise.py` auto-buckets each flagged item (deterministic regex: SSN/PII, table/finding-ID, OCR glue-ratio, math-notation, citation); everything unmatched defaults to `genuine_weak`. Auto is a **lower bound on noise** (defaults to genuine). Hand-labeled a seeded random 50-sample of the `<0.30` band into structural-noise / off-topic-real / genuine-in-scope for the true split.

## Results

### Distribution (AC-1) — matches the side-finding

| band | n | % of 10,972 |
|---|---|---|
| top-1 < 0.30 | 293 | 2.67% |
| top-1 < 0.35 | 734 | 6.69% |
| top-1 < 0.40 | 1,500 | 13.67% |
| top-1 < 0.45 | 2,617 | 23.85% |

### `attribution_text` split — the decisive structural fact

| population | n | min top-1 | median | `<0.30` | `<0.45` |
|---|---|---|---|---|---|
| **WITH** `attribution_text` | 2,117 | **0.462** | 0.767 | 0 (0%) | 0 (0%) |
| **WITHOUT** `attribution_text` | 8,855 | 0.056 | 0.517 | 293 (3.3%) | 2,617 (29.6%) |

`attribution_text` presence is not a pure extraction-mode artifact (present in ~13% of `fire` and ~24% of `single_shot` key_points), but its presence perfectly predicts "not in the low tail."

### Composition of the `<0.30` band (hand-labeled 50-sample)

| population | ~share | what it is | right lever |
|---|---|---|---|
| **structural noise** | ~32% | math/proof notation, OCR-glued spans, citation/author-lists, table/finding-ID rows, bios, PII/conversational | deterministic pre-emission filter (regex/heuristics) |
| **off-topic-but-real** | ~24% | real prose out of AI-safety domain (satellite broadband, stock sales, DEI quotes, energy) | extraction-prompt scope/relevance rules |
| **genuine in-scope, weak** | ~42% | real, relevant claims in non-taxonomy vocabulary (CBRN uplift, power-seeking, deception, lending bias) | **must be preserved — never dropped** |

Auto-classifier lower bound agreed (21.5% clear-noise at `<0.30`, decaying to 9.9% at `<0.40` as the band fills with genuine content).

## Design assessment (AC-2 / AC-3)

**Is a cheap extraction-input guard warranted?** Partially, and only for one population:

- **Cosine-cutoff guard (drop/quarantine on `top-1 < τ`): NO-GO.** ~42% false-positive on genuine claims at `<0.30`, worse at higher τ. Confirms and extends the t/2381 out-of-scope NO-GO — the signal cannot separate noise from weakly-embedded in-scope content at any threshold. No metric threshold to register (nothing derivable).
- **Deterministic structural pre-filter (regex/heuristics) for the ~32% type-1 noise: WARRANTED but low-yield.** High-precision patterns (PII/SSN, `\bT\d+-AT-\d+\b`/`AATMF`/`====` table-IDs, OCR glue-ratio ≥ threshold, math-symbol density, bare author-list/citation shape) catch non-claim fragments **before key_point emission** with near-zero false-positive on prose. Corpus-wide volume is small: ~63–100 key_points (~0.6–0.9%). Value is **corpus hygiene** (removing confident wrong assignments), not downstream-flag reduction (which doesn't occur).
- **Off-topic-but-real (~24%): out of scope for a *structural* filter** — it's a topicality judgment belonging to the extraction prompt's scope rules (cf. topic-scope enforcement), not a noise filter.

**Where is the seam?** Two candidates, both **before** embedding/assignment:
1. **Chunk-ingestion pre-filter** (preferred for OCR-garble/table/PII): reject or clean garbled/tabular/PII spans in `Invoke-DocumentSummary` *before* they reach the LLM — stops the fragment from ever becoming a key_point and saves the extraction call.
2. **Post-extraction structural filter**: drop emitted key_points whose `verbatim`/`point` matches the high-precision noise patterns and that lack an `attribution_text`. Cheaper to add, but the fragment already consumed an extraction slot.

**Precision guardrail (AC-3):** any structural filter must (a) act only on `verbatim`/`point` shape, never on cosine; (b) be validated to **zero** false-positives against a held-out set of genuine `<0.30` in-scope claims (the ~42% population — samples in `verify_attr` output); (c) prefer quarantine-for-review over hard-drop on first ship.

## Recommendation (for TL — no implementation without decision)

1. **Reject the cosine-cutoff extraction guard** — same NO-GO basis as t/2381; no registerable threshold.
2. **If corpus hygiene is wanted,** scope a *narrow deterministic structural pre-filter* (type-1 noise only, ~0.6–0.9%), sited at chunk ingestion, quarantine-first, with a zero-false-positive acceptance gate on genuine-weak claims. Its patterns are a **lexicon** — register them at implementation time (not now).
3. **De-scope the "downstream flag pollution" motivation** — empirically absent (tail is no-`attribution_text`; M5/t2288/OOS skip those). Re-anchor the justification on corpus-hygiene of wrong assignments if the work proceeds.
4. **Off-topic-but-real** is a separate relevance-gate concern — route to the extraction-prompt owner, not this filter.

**Decision (TL, 2026-08-09):** neither guard ships — see DISPOSITION at top. Closed as "characterized — no guard." The narrow pre-filter (rec 2) was judged too small/marginal to maintain given structural detectors' own false-positive risk.

## Limitations

Single-rater hand-labeling, n=50 of 293 (`<0.30`); the three-way split has ±~10pp sampling error but the **decision-relevant fact — a large genuine-in-scope fraction that forbids a cosine cutoff — is robust** (auto lower-bound and hand-label agree that genuine content dominates as the band widens). Category boundaries (off-topic-real vs genuine-weak) are judgment-sensitive; structural-noise vs everything-else is not.
