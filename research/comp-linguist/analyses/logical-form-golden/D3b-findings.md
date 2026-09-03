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
python score_golden.py --golden golden_set_d3b.json --candidates candidates_d3b.json   # -> STRICT 0.803
```

`score_golden.py` also prints two **diagnostic-only** components (t/3228, never in the strict OVERALL):
`predicate_syn` (exact 1.0 / CL-curated content-synonym class 0.5 / else 0, + `be-` copula normalization)
and `args_participant` (role-agnostic participant-set F1). On D3b they show how much of the strict miss is
metric-strictness rather than error: `predicate` 0.50 → `predicate_syn` **0.65**, `args` 0.32 →
`args_participant` **0.46**. Strict figures are unchanged, so the 0.803 headline stays comparable over time.

## t/3227 validation (attitude-attribution prompt fix)

The prompt hardening (t/3227, PR #1823 — strip the attitude-attribution clause so a stance verb never
becomes the predicate) was validated on a **DRY synthetic-fixture probe** (PowerShell, prompt `98597d10`,
no data write): the pass re-run over the 8 rows b-04/05/07/09/13/19/23/28, reconstructed from this golden
set's real `proposition` + `entity_refs` + node. Scored vs the same references (`candidates_d3b_t3227probe.json`):

| component | D3b baseline (these 8) | t/3227 probe (these 8) |
|---|---|---|
| predicate | 0.50 (4/8) | **0.75 (6/8)** |
| overall   | ~0.80 | **0.857** |
| controls b-05/b-07/b-19/b-28 | 1.00 | 1.00 (no regression) |

The lift comes from **b-04 `support`→`protect`** and **b-13 `promote`→`prevent`** — the two attitude-leak
cases now formalize the content proposition; no stance verb leaked into any predicate; modality unchanged
(BDI holder/attitude, factual null). b-09 (`preempt`) and b-23 (`democratize`) stay predicate-misses but
are **content verbs, not attitude leaks** — clause-selection/synonymy divergence, tracked in t/3228, not a
regression of this fix.

Caveat: this is an 8-row synthetic-fixture probe (faithful proposition/entity_refs, so args/about are real
not confounded), **not** a full-corpus re-baseline. The corpus-wide re-baseline of `formalization_accuracy`
under the hardened prompt lands with the t/3229 real top-up run.

```
python score_golden.py --golden golden_set_d3b.json --candidates candidates_d3b_t3227probe.json   # -> 0.857 (8 rows)
```

## t/3229 expansion — n=28 observed golden

The seed golden set was expanded from 10 to **28 observed rows** (`golden_set_expanded.json` +
`candidates_expanded.json`): the original 10, plus **15 new** D3b claims CL-authored **blind** (diverse
across factual/belief/intention; the batch's ~14 near-duplicate Trump/AI-Action-Plan intentions were
deliberately not all labelled — see the diversity-ceiling note), plus the **3 bias-free D3a nodes**
(`skp-beliefs-231`, `skp-beliefs-098`, `saf-beliefs-250` — references authored in D3a *before* any pass
output; candidates from the hardened prompt, `ai-triad-data` `78b3ed2f` / t/3238). Plus **4 constructed
axis cases** (reference-only, no candidate) covering match_level `subclass`/`instance_of`/`related` and a
`status:rejected` case.

**Result (STRICT, n=28):**

| component | n=10 seed | n=28 |
|---|---|---|
| predicate | 0.50 | **0.643** |
| args | 0.32 | 0.281 |
| polarity / modality | 1.00 | 1.00 |
| temporal | 1.00 | 0.929 |
| about | 1.00 | 0.893 |
| **OVERALL** | 0.803 | **0.791** |
| *diag* predicate_syn | 0.65 | 0.696 |
| *diag* args_participant | 0.46 | 0.429 |

- **The 3 bias-free rows all matched predicate** (consolidate / exploit / collect) — the least-anchored
  rows (reference written before the pass existed) agree with the hardened pass on the core predicate.
- **predicate 0.643 is a floor, not the hardened-prompt figure.** 25 of the 28 candidates are the
  **old-prompt** D3b batch (pre-t/3227), so b-03/b-04 still show the attitude-leak (`support`) the
  t/3227 fix removes. A clean single-prompt re-baseline needs all-hardened candidates (see below).
- **args (0.28) is the genuine low axis** — richer arg structures in the diverse new claims diverge on
  role labels and completeness; `args_participant` 0.43 shows part is role-labeling, not missed participants.
- temporal 0.929 = two defensible judgment misses (b-08 dates the intention; b-33 before-vs-unspecified).

**Structural finding carried in (t/3238):** every `entity_ref` in the corpus is `match_level:"exact"`
(540/540) because the resolver hardcodes it. The non-exact axis (`subclass`/`instance_of`/`related`;
`superclass` in `golden_set.json` con-2) is **only reachable via constructed cases** and cannot be scored
against real pass output until a hierarchical resolver exists. See `logical-form-schema.md`.

**Still `measured (seed)`, not `derived`.** Blocking: (1) n=28 < 30; (2) **mixed prompt versions** in the
candidate set (25 old-prompt + 3 hardened) — a clean baseline needs one prompt; (3) the batch's diversity
ceiling (~25 distinct claim shapes; the rest are near-duplicates). Path to `derived`: a single all-hardened
re-run over the ~28 golden claims reaching n≥30 (one more PowerShell run). The match_level-diversity part
of the original criterion is **unachievable from real data** (t/3238) and is dropped — non-exact coverage
stays constructed-only.

```
python score_golden.py --golden golden_set_expanded.json --candidates candidates_expanded.json   # -> STRICT 0.791 (n=28)
```
