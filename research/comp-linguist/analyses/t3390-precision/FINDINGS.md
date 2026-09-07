# t/3390 — generator concept-selection precision: prompt-tuning frontier (the "path back to A")

**Verdict: prompt-tuning trades precision against recall along a frontier that peaks ~0.68 F1 — the locked ≥0.80 concept-anchored floor is NOT reachable by prompt-tuning. Option A does not reopen via a prompt fix; C stands.**

## Method

Same 61 frozen t/3381 nodes (`sample-manifest.json`), same blind `REFERENCE_ABOUT` gold, same
ref-level per-row about-F1 over the 55 concept-anchored rows (identical to `score_about_golden.py`).
Three prompt framings run **same-session** (`remeasure.py` runs v1+v2, `run_v3.py` runs v3) so the
A/B isolates the prompt effect from model/re-run variance. Topical selection = `about[]` ∪
`topical_candidates.refs` (version-agnostic). Model: `gemini-3.5-flash-lite`, temp 0.2.

## Result

| Prompt | mean per-row F1 | micro P | micro R | FP | FN | behavior |
|---|---|---|---|---|---|---|
| **v1** production (control) | 0.665 | 0.561 | 0.946 | 68 | 5 | over-includes |
| **v2** precision-first (aggressive "prefer omit / 0–2 items") | 0.676 | **0.849** | 0.609 | 10 | 36 | over-excludes |
| **v3** balanced (targeted exclusions, recall-preserving) | 0.654 | 0.534 | 0.935 | 75 | 6 | over-includes |

(v1 here = 0.665 reproduces the frozen t/3381 baseline 0.636 within re-run variance — same over-inclusion signature.)

## Finding

1. **The over-inclusion IS prompt-controllable.** v2's three targeted exclusions (excluded-foil,
   thematic-halo, lexical-coincidence) cut micro FP **68 → 10**, lifting precision **0.56 → 0.85**.
   The failure taxonomy from t/3381 was correct and the fixes bite.
2. **But the LLM's concept-selection is near-binary**, not smoothly tunable: it sits either permissive
   (P ≈ 0.53–0.56, R ≈ 0.94) or strict (P ≈ 0.85, R ≈ 0.61). v3's recall-preserving language collapsed
   straight back to v1's over-inclusion; no framing found a balanced middle.
3. **The F1 envelope tops out ~0.68** across all three framings. The extra refs a permissive prompt adds
   and the genuine refs a strict prompt drops are the **same ambiguous marginal concepts** (v2's 36 FN
   are real gold subjects like `documented_present_harm`, `capabilities_hazard`, `accountability_market`
   — not junk). The classes overlap irreducibly, the same pattern the register records for
   `crux_undecided_rate` (dialectical/topical marginal cases not separable by the available instrument).
4. **≥0.80 F1 needs BOTH P and R high (~0.80/0.80); the frontier does not offer that point.** So the
   pre-committed floor is not reachable by prompt-tuning. **Per the locked e/145 rule, A does not reopen.**

## Implications (for the group — not decided here)

- **C stands** as the convention (the F1 floor is unmet by the only lever in scope here).
- **Reopening A would need a MECHANISM change, not a prompt** — e.g. a two-stage *select-then-verify*
  (generate candidate topical refs, then a second pass adjudicates each against the proposition), better
  upstream concept-ref grounding, or a different instrument for the marginal class. That is a new design +
  a fresh pre-committed re-measure, not a tweak.
- **If a precision-first operating point is ever wanted for `topical_candidates` quality** (independent of
  A): v2 is the recommended prompt (**P = 0.85** at R = 0.61). But that is a *metric change* (F1 → precision@k)
  and a separate pre-committed decision — it does NOT reopen A under the current F1 rule.

## Layer-owner decision (e/145#18–#19): KEEP v1 recall-first; do NOT regenerate with v2

TL surfaced that v2's P=0.849 could upgrade the `topical_candidates` layer today under C. **Decision (CL, as layer owner): keep the v1 recall-first layer (0.54); no data change.** `topical_candidates` is a *candidate* layer — recall-oriented by name and intended role (topical retrieval/grounding candidates); a downstream filter prunes false positives, but v2's 40% recall loss drops genuine subjects (`documented_present_harm`, `capabilities_hazard`, `accountability_market`) that are unrecoverable downstream. v2 is not more *validated* (same unvalidated status, different P/R point), there are no consumers today (dark layer, t/3353), and the in-data marking already makes the 0.54 noise legible. **Revisit trigger:** a future consumer that genuinely needs a precision-first topical index — at which point the mechanism-change path (select-then-verify) could give both axes rather than forcing the trade. v2 is the recorded precision-first operating point until then.

## Do not land

The v2/v3 prompts are **measured artifacts, not for production**: (a) neither clears the floor; (b) the
prompt is shared with PS `LogicalFormPass.ps1` (any change needs the t/3389 condition-3 PS↔TS parity);
(c) changing selection behavior is out of scope while "C stands." Kept here as the evidence trail.
