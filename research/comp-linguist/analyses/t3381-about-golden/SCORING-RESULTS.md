# about[]-component re-measure — results (t/3381)

**Acceptance axis (pre-committed, SO e/145; register § "Pre-committed acceptance rule"):**
Option A stands iff **overall `formalization_accuracy` ≥ 0.753 AND concept-anchored
`about[]`-component ≥ 0.80**. A miss on either arm → **fallback to Option C**.

## Verdict: FAIL → Option A falls to Option C

| Arm | Requirement | Measured | Result |
|-----|-------------|----------|--------|
| Overall `formalization_accuracy` | ≥ 0.753 | 0.778 (v2 census, n=45, current prompt; register-canonical) | PASS |
| **Concept-anchored `about[]`-component** | **≥ 0.80** | **0.6357** | **FAIL** |

Both arms are required (AND). The about-component arm misses by **0.164**, well outside
the register's stated −0.20 distribution-shift tolerance framed around the floor. Per the
pre-committed rule, **Option A does not clear its condition and falls to Option C** (retain
the ent-only convention that preserves a scored metric; do not bless the mixed-convention
generator output as-is).

## Metric

- **Sample:** frozen `sample-manifest.json` — n=61 (concept-only 46 · mixed 9 · entity-only 6),
  deterministic draw from the production distribution + entity-minority control + the
  force-included match_level-diversity node `skp-beliefs-170`.
- **Reference:** CL blind labels in `about-golden-worksheet.md` (`REFERENCE_ABOUT`), authored
  from Proposition + candidate refs only, never the generator's `about[]` (t/3342 blindness).
- **Primary metric — ref-level, concept-anchored rows:** mean per-row about-F1, keyed on
  **ref** (not `(ref, match_level)`), over the 55 concept-anchored rows (concept-only + mixed).
  Per-row F1 follows the logical-form scorer's `_f1` semantics exactly (both-empty → 1.0,
  one-empty → 0.0, else harmonic mean of P/R). Scorer: `score_about_golden.py`.
- **Keying divergence (deliberate, recorded):** the logical-form scorer keys about-F1 on
  `(ref, match_level)`. Here the floor is a claim about **concept selection** ("pick the
  correct topical concept, not echo an id" — register), the blind labels are ref-level, and
  `match_level` is the exact axis t/3379 flagged as the enum-leak bug (every non-`exact`
  value in this sample — 10/169 — is concentrated on the single force-included node
  `skp-beliefs-170`). Keying the floor on a known-buggy, blind-unlabeled attribute would
  measure the wrong thing. Ref-level is authoritative; the strict `(ref, match_level)`
  mean-F1 is reported as a diagnostic (**0.6333** — essentially identical, so the verdict is
  not an artifact of the keying choice).

## Failure mode: concept OVER-selection (precision), not coverage (recall)

| | micro | mean per-row |
|---|---|---|
| Precision | 0.537 | 0.572 |
| Recall | 0.946 | 0.809 |
| F1 | 0.685 | **0.636** |

- **Recall is near-perfect** — 87 TP vs only **5 FN** across 55 rows. The generator almost
  always *includes* the correct topical concept.
- **Precision is the failure** — **75 false positives** vs 87 TP. The generator systematically
  attaches loosely-associated concepts. Recurring FP patterns:
  - **Excluded-foil attachment:** the claim's `Excludes:` concept is emitted anyway
    (`term:deployment_gated` on acc-beliefs-003 / -088 / acc-intentions-001;
    `term:governance_oversight` on acc-desires-010; `term:documented_present_harm` on
    skp-beliefs-244).
  - **Thematic-halo attachment:** `term:safety_existential` sprayed onto claims it is not
    about (saf-beliefs-225 psychological/affective, saf-desires-023 whistleblower-protection,
    saf-intentions-086 cognitive-displacement, skp-desires-070/-077).
  - **Retrieval lexical false-matches surfacing as about-refs:** `ent-360` "Scale AI" on
    saf-intentions-202 ("**Scale** AI Safety…", verb) and skp-beliefs-054 ("large-**scale** AI
    models"); `ent-124` "The Bitter Lesson" on skp-beliefs-115 where it is an `Excludes:` foil.
  - **Bulk over-generation:** `skp-beliefs-170` emitted 12 refs (10 `instance_of`) against a
    3-ref gold (P=0.25); `saf-intentions-204` 8 vs 2 (P=0.25).

## Robustness — the verdict does not hinge on the contestable labels

The 9 rows scoring 0.0 are exactly the 9 rows I blind-labeled `none` (the claim is about no
offered concept — meta-attitudes, Excluded-only foils, or pools with no genuine topical
match). These are the most contestable calls. Under the **maximally generous counterfactual**
— forgive all 9, i.e. assume every `none` call is wrong and the generator's attachment is
fully correct — the concept-anchored mean rises only to **0.7994, still below 0.80**. The
FAIL is therefore **insensitive to labeler strictness on the contestable rows**; it is carried
by FP-driven precision loss spread across the non-`none` rows, not by a handful of harsh calls.

Per-profile (ref-level mean about-F1): concept-only 0.608 · mixed 0.775 · entity-only 0.500
(control). The entity-only control at 0.500 (id-projection is *not* the trivial 1.00 seen on
the old ent-only golden — the retrieval pool now injects entity distractors too) is context,
not part of the floor.

## Disposition

1. **Pre-committed outcome stands: Option A → C.** Pre-committal exists precisely so the miss
   is honored without post-hoc rescue. The §109 disposition (execute C: keep `about[].ref ∈
   {ent-*}`, retain the ent-only scored metric) is a schema/data-model decision owned by the
   ratifying group (SO + TL + CL, e/145) — routed, not executed unilaterally here.
2. **Separate, non-relitigating observation for the group:** the failure is generator
   *precision* (over-selection), with recall near-perfect. That is a property of the *current
   generator*, arguably distinct from the *schema* question A posed. If the group ever wants to
   revisit a mixed convention, the unblock is an about[] precision pass (e.g., drop Excluded-foil
   refs, gate retrieval false-matches, cap ref count) followed by a fresh pre-committed
   re-measure — filed as a follow-up, explicitly **not** a reason to reopen this pre-committed
   result.
