# D3b — First `formalization_accuracy` measurement (t/3126)

**Inputs:** the PowerShell `Invoke-LogicalFormPass` batch (t/3215), `ai-triad-data` commit `853b2938`
— 39 committed `logical_form`s across 17 summaries (factual 16 / intention 12 / belief 9 / desire 2,
all `status:proposed`), produced after the prompt sort-fix (`90ce0d3e`) and the coercion/cap fix (PR #1814).

**Method.** None of the three D3a observed golden nodes (`skp-beliefs-231`, `skp-beliefs-098`,
`saf-beliefs-250`) were in the batch — `-MaxClaims 40` selected a different set, so the pre-authored
D3a references have zero overlap with the pass output. I therefore grew an **observed golden set from the
batch**: 10 claims stratified across all four categories (factual ×4, intention ×2, belief ×2, desire ×2),
CL-authored **blind** (references written from `proposition` + `entity_refs` only, with the pass output
withheld — see `worksheet.py`), then scored pass-vs-reference with `score_golden.py`.
Artifacts: `golden_set_d3b.json` (references), `candidates_d3b.json` (the frozen pass forms scored).

## Headline

**`formalization_accuracy = 0.803` (n=10)**, convention-pinned. Per component:

| component | score | reading |
|---|---|---|
| polarity  | 1.00 | perfect |
| modality  | 1.00 | perfect (holder←POV, attitude←category, null for factual) |
| temporal  | 1.00 | perfect |
| about     | 1.00 | perfect **under the pinned superset convention** (see below) |
| predicate | 0.50 | the real weak axis |
| args      | 0.32 | strict role-sensitive F1; substantially deflated by minimalist refs + patient/theme labeling |

## Confound decomposition (why the raw number understates the pass)

t/2294 discipline — the disagreements were read, not just tallied. Three scoring variants isolate
metric/convention artifacts from real error:

| variant | OVERALL | about | args |
|---|---|---|---|
| V1 as-first-authored (about[] excludes participants) | 0.686 | 0.30 | 0.32 |
| **V2 about[]=superset (pinned)** — **canonical** | **0.803** | 1.00 | 0.32 |
| V3 V2 + role-agnostic args (patient≡theme, participant-set overlap) | 0.826 | 1.00 | 0.46 |

- **`about[]` convention artifact (+0.117).** My first references excluded a resolved entity from `about[]`
  when it already filled an `args` role (the con-1 precedent); the pass **includes** it. Schema rule (b)
  already *permits* a ref in both, and rule (e) frames `about[]` as "the logical-form projection of the
  claim's already-resolved `entity_refs[]`" — i.e. a **complete topical index**. This measurement pins that
  ambiguity: **`about[]` = every topical resolved entity, INCLUDING those also filling an arg role
  (superset).** The pass already complied; the 0.00s in V1 were an unpinned-convention artifact, not a pass
  error. Schema updated (`logical-form-schema.md` rule b/e).
- **patient/theme role-label noise (+0.023).** On b-19/b-29/b-39 the pass and I pick the same participant
  but label it `patient` vs `theme` — a thematic-role ambiguity scored as a double miss. Kept role-sensitive
  in the canonical metric (agent/patient *does* matter for FOL export); V3 is diagnostic only.

## Real signal (genuine pass behavior, not artifact)

- **`predicate` = 0.50 concentrates on multi-clause meta-descriptive BDI claims** — exactly the hard 71%
  from D3a. Two failure sub-modes:
  1. **Attitude leaks into the predicate** (b-04): the pass formalized "skeptics **support** rights"
     (`predicate:support`, `agent:skeptics`) instead of the embedded "GDPR **protects** autonomy" — duplicating
     `modality.desire` in the predicate. The meta-descriptive prompt rule strips "the document discusses…"
     but does **not** strip the attribution clause ("Skeptics support…"); that's the next prompt hardening.
  2. **Embedded-clause selection** (b-09 obstruct/hinder synonymy; b-13, b-23): on props with several
     candidate assertions the pass picks a different — usually more surface — clause than the CL reference.
     Often a defensible reading, but it lowers reference agreement and is genuine variance.
- **The pass is systematically *more complete* on args** (b-05/b-07/b-19/b-28 add `goal`/`instrument`/`manner`
  the minimal reference omits). This *lowers* strict F1 (precision penalty) while being a quality *positive* —
  a note for both future reference authoring (be exhaustive) and metric design (participant-recall vs
  role-exact are different questions).

## Coverage gaps (this measurement is a seed, not the full set)

- **match_level is `exact` for all 45 entity_refs in the batch** — no superclass/subclass/related. The
  match_level axis (where the schema warns formalization error concentrates, §6/R4) is **untested** here;
  only the constructed `con-2` row exercises it.
- **n=10**, meta-descriptive-heavy, no `status:rejected` case (the batch's grounded set carried none).
- The three **bias-free D3a references** (authored before any pass output existed) remain unscored — a
  targeted top-up (PS offered; cap now bounds spend) would add the least-anchored rows.

## Provenance

`formalization_accuracy` moves **stipulated → measured (seed)**: `0.803` (n=10, convention-pinned; `0.686`
as-first-authored pre-pin). Not yet `derived` — that needs n≥30 with match_level diversity and the bias-free
rows. Register updated. Follow-ups filed: prompt hardening (strip attribution clause), metric refinement
(predicate synonymy, participant-recall arg score), golden-set expansion + match_level diversity, bias-free
top-up.

## Reproduce

```
python score_golden.py --golden golden_set_d3b.json --self                 # references schema-valid
python score_golden.py --golden golden_set_d3b.json --candidates candidates_d3b.json   # -> 0.803
```
