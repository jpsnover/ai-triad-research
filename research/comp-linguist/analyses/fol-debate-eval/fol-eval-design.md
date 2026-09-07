# FOL-on-debate: offline evaluation design (t/3354, steps 1-2)

**Authors:** PowerShell 2 (harness architecture, FN-rate measurement, corpus-linking seam) · Computational Linguist (clause-type taxonomy §3, segmentation rules §4, classifier gold set §5)
**Status:** co-signed design — TL-gated. Build authorized on CL co-sign.
**Ground truth:** `fol-debate-sample-findings.md` (this directory, #2026). Single-annotator first-pass, observed sample; no number here anchors a threshold until double-annotated.
**Ticket:** t/3354. Parallel arm: AIF argument-level formalization → t/3355 (CL-owned).

## Sign-off record

- **TL gate (architecture + offline/read-only boundary):** CLEAR (e/141#8, e/141#10). All 4 conditions + both tightenings folded in below (§9 join facts, §10 run bound, §5 classifier-as-instrument gold set, §11 double-annotation-ready persistence; read-only tightening in §1; step-3 line in §12).
- **Main-PS (target-iii join):** confirmed available (e/141#7); field paths + demoted-excluding predicate handed over at build if (iii) is pursued.
- **CL co-sign (this document — §3 label set, §4 segmentation rules, §5 blind gold set):** provided herein.
- **Second Opinion:** not required for this step-1-2 design (read-only research tooling; neither a blocking-gate promotion nor a schema change — TL, e/141#8). Step 3 re-triggers the t/3361 mandatory SO if it gates/changes any metric or schema.

---

## 0. Goal

Decide, **measurement-first and offline**, whether attaching `logical_form` to debate claims adds signal beyond the CL convergence metrics — *before* any in-loop change. This document covers steps 1-2 (the offline harness + the correlation data it emits). Step 3 (grounded-rebuttal A/B) is separate and gated on a go verdict (§12).

## 1. Inputs (read-only)

- Completed debates: `../ai-triad-data/debates/*.json`, `phase=closed`; statement turns in `transcript[]`.
- Formalized POV summary corpus: existing `logical_form` on `pov_summaries.*.key_points[]` + `factual_claims[]`.
- Conflict/QBAF corpus: `conflicts.json` (see §9 for the exact join surface and filters).

**Absolute constraint (TL tightening, e/141#8):** the harness writes **nothing** under `../ai-triad-data` — not outputs, not caches, not temp/intermediate files. All emission goes to a PS-scoped output dir outside the data repo. No in-loop / live path is touched.

## 2. Pipeline (clause-level)

Turn → **segment** (§4) → **classify each clause** (§3) → **coref/attribution** on the assertoric subset (§6, hard prerequisite) → **FOL extraction** (§7) → **contradiction/entailment + FN-rate** (§8). Only the assertoric-factual/assertoric-causal clauses reach FOL; everything else is counted and dropped (per-class distribution reported as a §3 sanity check).

The turn-level filter is dead: no turn is homogeneous (findings, headline). The clause is the classification and formalization unit.

---

## 3. Clause-type taxonomy — CL-AUTHORITATIVE (classifier label set)

A **closed** set of five primary types, mutually exclusive by illocutionary/semantic kind, plus three orthogonal cross-cutting attributes. The primary type decides formalization disposition; the attributes drive the coref stage and contradiction bookkeeping.

### 3.1 Primary types (closed set — exactly one per clause)

| Label | Definition | Disposition | Gold examples (from the 27-turn sample) |
|---|---|---|---|
| `assertoric-factual` | Truth-apt empirical claim asserting a particular or statistical state of the world; cited/quantitative where possible. Self-contained-leaning. | **FORMALIZE** (primary target — cleanest to formalize, cleanest contradiction target) | "seven firms control 35% of the S&P 500"; "data centers consumed 415 TWh in 2024"; "the regime monitors clusters above 10^26 ops" |
| `assertoric-causal` | Truth-apt claim asserting a causal or dispositional generalization; typically a universally-quantified generic, often value-laden. | **FORMALIZE** (secondary target; tag genericity + value-load) | "caps protect incumbents"; "post-disaster penalties cannot rebuild grids" |
| `normative-deontic` | Prescriptive claim carrying deontic force (must / should / ought / is-obligated-to). | **SKIP** (deontic operators are out of neo-Davidsonian assertoric scope; counted, not formalized) | "Congress should bifurcate liability"; "citizens should watch what regulators do" |
| `speech-act / belief-revision-meta` | A move about the discourse itself: concession, retained commitment, or defeater-conditional. | **SKIP for FOL → route to the AIF arm (t/3355)** | "I concede the telemetry point"; "I still hold that the ban is premature"; "I would change my position if <defeater>" |
| `rhetorical / evaluative` | No truth-apt propositional core to formalize: rhetorical question, category-error charge, pure evaluative framing. | **SKIP** | "who gave regulators the authority?"; "comparing a chatbot to a 737 MAX is a category error" |

### 3.2 Cross-cutting attributes (orthogonal; recorded on every clause)

- **`attribution`** ∈ {`own`, `attributed-opponent`, `attributed-third-party`}. An attributed restatement ("Accelerationist proposes that P") is typed by the **embedded proposition P's** kind (usually `assertoric-*`), with `attribution=attributed-opponent`. This cell — attributed + assertoric — is the highest-contradiction-value and highest-anaphora-risk cell; §6 coref gates it.
- **`anaphora_dependency`** ∈ {`self-contained`, `demonstrative`, `topic-ellipsis`, `attributed-restatement`}. Drives the coref coverage-loss report (§6). `assertoric-factual` skews self-contained; `assertoric-causal` and attributed restatements skew anaphoric.
- **`polarity`** ∈ {`asserted`, `negated`}. Load-bearing for contradiction detection — P vs ¬P must survive to §8.

**Why attribution/restatement is an attribute, not a sixth type:** attribution is orthogonal to illocutionary kind (one can attribute a factual, causal, or normative claim), and the same proposition is the formalization target whether asserted in own-voice or restated. Making it a type would conflate two independent axes and fragment the assertoric target set. As an attribute it keeps the primary set clean and lets coref key precisely on the high-risk cell.

### 3.3 Distribution sanity-check (claim-level, single-annotator first-pass ranges)

The classifier's per-class distribution is checked against these bands as a **sanity gate, not a threshold** (single-annotator; ranges, not point precision):

- `assertoric-factual` ~20-25% · `assertoric-causal` ~35-40% (assertoric total ~60%, range 55-65%)
- `normative-deontic` ~15-20%
- `speech-act / belief-revision-meta` ~10-15% (rises to ~25-30% in later-round turns)
- `rhetorical / evaluative` ~8-12%

A classifier distribution far outside these bands is a signal to inspect the classifier or the segmenter before its labels are trusted — not evidence in itself (§5).

---

## 4. Segmentation boundary rules — CL-AUTHORITATIVE

The unit below the turn and below the orthographic sentence.

1. **Unit = the finite clause.** One tensed/finite predicate = one clause = one classification + formalization unit.
2. **Split coordinated finite clauses.** A coordinator (and/but/or) joining two finite predicates is a boundary: "the caps entrench incumbents, and Congress should drop them" → two clauses (`assertoric-causal` + `normative-deontic`).
3. **Split at discourse connectives.** however / but / therefore / so / because start a new clause. The antecedent and consequent of a because/therefore pair are separate clauses with independent types.
4. **The load-bearing rule — fact-dense turn ending on a normative/rhetorical closer.** A trailing closer clause **never** inherits the type of the factual body it follows. Segment so "…and therefore the ban is unjustified" or "…who authorized this?" is its own clause, typed on its own. This is the exact case that killed the turn-level filter.
5. **Attributed-restatement: matrix vs content.** "Safetyist claims that P" → the matrix "Safetyist claims that ___" is a speech-act wrapper (`attribution=attributed-opponent`); the embedded **P** is the assertoric formalization target, segmented as its own clause and typed by P's kind. Formalize P, not the wrapper.
6. **Keep complement/argument clauses with their matrix** *unless* the embedded clause carries an independent assertion attributed to another agent (rule 5). Restrictive relative clauses stay with their head — they restrict a referent, they do not assert independently.
7. **Enumerations.** Each list item that is a full proposition is its own clause.
8. **Sub-clausal fragments** (bare NPs, appositives with no predicate) attach to their host clause; they are not independent units.
9. **Boundary tie-breaker.** When one orthographic sentence mixes a factual antecedent and a normative consequent ("because caps protect incumbents, Congress should not impose them"), split at the connective → antecedent `assertoric-causal`, consequent `normative-deontic`.

---

## 5. Classifier gold set — CL (instrument-integrity, t/3342)

The clause classifier is **itself a new instrument**. Per the distribution-bounded-validation register rule (t/3342), its labels anchor **no** conclusion until spot-validated. The gold set is that validation instrument.

**Construction spec:**
- **Size / stratification:** N ≈ 60 clauses drawn from the 27-turn sample; target ≥8 per primary type and ≥5 per non-`self-contained` anaphora bucket, so per-class precision/recall is estimable (not a single cell).
- **Blind from the prompt.** The gold clauses are **held out of the classifier prompt** — never used as few-shot exemplars. The few-shot exemplars are a **separate, disjoint** set (the §3.1 gold examples may seed exemplars; the blind set shares no items with them). This is the train/test separation the instrument-integrity checklist requires; publishing the blind items in this doc would defeat it, so they live in a **separate held-out artifact** `fol-eval-classifier-gold.jsonl` (built in the pairing pass, not committed to this design doc).
- **Labels per clause:** `{primary_type, attribution, anaphora_dependency, polarity}` (§3), plus stable `id` + `source_span` (debate_id · turn_index · char offsets).
- **Reported:** per-class precision/recall + a confusion matrix, *before* the classifier's full-corpus distribution (§3.3) is read as anything but a sanity check.
- **Provenance:** single-annotator first-pass (same status as the findings). The stable ids + spans make the gold set **double-annotation-ready** (§11) — a second annotator upgrades it without re-labeling from scratch. Until the second annotator runs, κ/α is not established and the gold set spot-checks **direction**, it does not certify precision.

---

## 6. Coref / attribution — HARD PREREQUISITE

~40% of assertoric clauses carry a cross-turn referential dependency that isolated-turn formalization would break (findings (b)): demonstratives ("that approach"), attributed restatements ("Accelerationist proposes that…"), topic ellipsis (bare "the ban" / "the 10^26 threshold"). The **most contradiction-relevant** sub-class — attributed opponent restatements — is also the **most anaphora-dependent** (findings, central tension), so coref gates the whole value case, not a nice-to-have. Resolve demonstratives / attributed restatements / topic ellipsis against the shared debate referent; **report coverage loss** (how many assertoric clauses drop or under-specify) whenever resolution is imperfect, keyed on the §3.2 `anaphora_dependency` attribute.

## 7. FOL extraction

Neo-Davidsonian, on the **resolved** `assertoric-factual` + `assertoric-causal` subset only. Reuses the `Private/LogicalFormPass.ps1` core — **no fork** (TL condition; keeps the debate-FOL and summary-FOL instruments identical so the §8 cross-corpus contradiction check is apples-to-apples). Genericity/value-load tags from §3.1 carry through so a universally-quantified generic is not silently read as an existential particular.

## 8. Contradiction / entailment + PRIMARY METRIC

Two directions: (i) debate clause vs the formalized summary corpus; (ii) intra-debate cross-agent (shared-predicate contradictions — confirmed on real data, findings (c)).

**Primary metric = paraphrase false-negative rate** (make-or-break — NOT raw contradiction counts). One predicate surfaces five ways in the sample ("protects them" / "pull up the drawbridge" / "corporate moats" / "exclusive federal licensing club" / "incumbent compliance cartel"); without predicate + entity normalization, FOL misses real disagreements and looks falsely quiet. The harness emits **both** raw contradictions **and** a labeled FN set (CL's one-predicate/five-surface-forms case is the canonical fixture), reported **with and without** the normalization pass so the normalization's value is isolated.

## 9. Correlation outputs (harness emits; CL analyzes)

Joinable on the claim-level provenance model:

- **(i)** formalized summary corpus.
- **(ii)** CL `crux_addressed_rate` / `convergence_score` — tests CL's prediction that FOL **under-counts** vs `crux_addressed_rate` because of paraphrase FNs; if it does, that quantifies the normalization gap directly.
- **(iii, optional) conflict/QBAF corpus** — Main-PS's seam (e/141#7, baked per TL condition #1):
  - **Correlate on the 15 verified PAIRS, not the 30 directed edges.** Each pair is written as two directed attack edges (`edge_origin=semantic-cluster`, `symmetric=true`); counting edges double-counts.
  - **Exclude `status=demoted` / `claim_type=non_conflict`.** The t/3350 432 single-instance standalone-fact demotions are neutral facts with no opposition — exactly the noise that would inflate the FN denominator. Join against the real-conflict population only.
  - Field paths + the demoted-excluding filter predicate come from Main-PS at build time (they own the corpus).

## 10. Run bounding (TL condition #2)

FOL extraction and the clause classifier are model calls on debate-scale text. Before the first run the harness declares an **explicit sampling plan + hard cap**: `N` debates/run and `M` clauses/debate, with the resulting cost ceiling (model-call count) reported **up front**. Over-cap debates/clauses are **sampled and logged**, never silently truncated (a silent cap reads as "covered everything").

## 11. Double-annotation-ready persistence (TL condition #4)

Raw contradiction pairs and FN labels are emitted with **stable ids, source spans, and per-pair provenance** so CL can upgrade the single-annotator ground truth to double-annotated **without a re-run**. Same requirement applies to the §5 classifier gold set.

## 12. Go / No-go (for step 3)

**Go** only if FOL is **additive** (catches disagreements the convergence metrics miss) at a **trustable FN rate post-normalization**. Redundant-or-high-FN → **no-go + write-up** (a negative result is a result). Thresholds deferred until double-annotation. Step 3 (grounded-rebuttal A/B) crosses the in-loop line: it re-triggers calibration validation, a fresh TL gate, and — if it gates or changes any metric/schema — the **t/3361 mandatory Second Opinion**.

## 13. Non-goals (this ticket)

- Any in-loop change (→ calibration validation).
- AIF argument-level formalization → t/3355 (CL-owned parallel arm). The `speech-act / belief-revision-meta` clauses this design *skips* are precisely the AIF arm's input — complementary, not competing.
