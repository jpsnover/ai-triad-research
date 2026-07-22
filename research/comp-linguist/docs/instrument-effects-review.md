# External Paper Review — Instrument Effects in Language-Model Honesty Evaluation

**Last updated:** 2026-07-22
**Author:** Computational Linguist (Orca)
**Review type:** External literature review (not a PR gate) with adoption recommendations for our calibration/debate-measurement system
**Paper:** *Instrument Effects in Language-Model Honesty Evaluation: An Auditable Single-System Demonstration*
**Author (paper):** Justin Bronder, Corabo Inc.
**Venue / ID:** arXiv:2607.14399v1 [cs.AI, cs.CL], 2026-07-15
**Source PDF:** https://arxiv.org/pdf/2607.14399

---

## Verdict

**approve-with-notes** — The paper is methodologically sound and directly relevant to the four artifact classes I own (prompts, algorithmic parameters, quality metrics, ontology compliance). Its central result — that the *measurement apparatus* moves measured behavior more than the model does — applies with little translation to our calibration harness. I recommend adopting four of its checks as standing calibration discipline. No claim in the paper contradicts our current methodology; the gaps it exposes in our harness are real and actionable. Notes = the five tracked recommendations below.

The paper is not a merge candidate, so there is nothing to block. The `approve-with-notes` verdict applies to the **recommendation to adopt its protocol**, and the notes are the follow-up tickets required before this review is complete.

---

## 1. What the paper is

A single-system, fully-auditable demonstration that **evaluation-instrument choices — not model behavior — produced the largest measured swings in an LLM "honesty" evaluation.** The model under test is held byte-fixed across arms; only the instrument is varied.

### 1.1 Design

- **Testbed:** a text-adventure world with planted, engine-held ground truth. Each quest is objectively *completable*, *unreachable*, or *not-yet-decidable*, known to the engine.
- **Roles:** player model = **GLM-5.2** (the system under test); narrator + interpreter = **Haiku-4.5** (the presentation channel). The player explores a site graph under a per-operation budget and must eventually assert a terminal verdict about its quest.
- **No model judge:** because the engine knows what it planted, every player verdict is scored against ground truth mechanically. This removes LLM-as-judge bias — the instrument effects the paper finds sit *upstream* of scoring, in the presentation channel, and one of them is produced by a model (the narrator) that judge-bias literature does not treat as part of the instrument.
- **Gated pre-result rules:** each series ran behind decision rules committed to the repo before results were read, with three disclosed tiers of evidentiary strength — Gate 0 drafted mid-run before samples were read; Gate 1 ratified in substance, header formalized retrospectively; Gate 2 used a full pre-launch ratification ceremony. Run artifacts bind the git revision they executed (clean/dirty flag); silent deviation voids a gate.

### 1.2 The four measured instrument effects (player model held fixed)

| # | Instrument knob | Manipulation | Measured effect | Status |
|---|-----------------|--------------|-----------------|--------|
| i | **Outcome grammar** | Expand verdict taxonomy 2→3 (add "incomplete") on byte-identical instances, 10 epochs each | Complete verdicts **22/40 → 7/40**; unreachable **16/40 → 0/40**; incomplete **0/40 (inexpressible) → 28/40**; budget-exhaustion 2/40 → 5/40. Across all 158 valid three-verdict games, **93 ended incomplete.** | Confirmatory (anchor replication) |
| ii | **Criterion disclosure** | Add one sentence naming the win mechanism | False verdicts **18/59 (hidden) → 0/58 (disclosed)**; redirected play from assertion to verification; also reduced how many games reached a halt. | Confirmatory |
| iii | **Budget rendering** | Render the same budget as a mortality-coded "lantern" vs. an affectless "meter" | Strong-claim rate **.150 (lantern) vs .383 (meter)**; changed how much budget players abandoned at halt. Budget *rendering* moved verdicts more than register *content*. | Hypothesis-generating |
| iv | **Register presence** | Add any narrative voice vs. bare cell | Strong claims **roughly doubled**: 55/180 (voiced) vs 9/60 (bare). The preregistered *content gradient* across different voices was **falsified**. | Hypothesis-generating (confounded with prompt composition) |

### 1.3 The distributional ground result (underneath all four)

Repeated runs of a **fixed** configuration produced **non-stable verdict distributions** on some instances — **3 of 4 instances non-stable at n=10.** Therefore **single-run evals report samples as dispositions.** This is the load-bearing finding for us: it says a single debate run's calibration numbers are a *draw from a distribution*, not a *property of the configuration*.

### 1.4 The "But I do not halt yet" case (§4.6)

Late in one run the player wrote *"But I do not halt yet."* The measurement layer recorded that message as a **halt, verdict complete, confidence 0.75** — the verdict carried the instrument's fingerprint, not the model's intent. Most effects are subtler, but share this structure: reading a verdict as pure model behavior misattributes it.

### 1.5 Scarcity compression (narrator channel)

**95% (387/407)** of narrator quantity errors *understated* the budget, and clustered at round-number landmarks (1/3, 1/2, 1/4). The presentation channel systematically distorts a scalar the player reasons over — a model-in-the-loop instrument artifact.

---

## 2. The portable contribution — the four-check integrity protocol (§5.3, verbatim intent)

The paper is explicit that **the effect sizes are NOT expected to transport** (one player-narrator pairing, one world, one instrument revision). The portable claim is the **protocol**, reproduced here because it maps one-to-one onto our harness:

1. **Taxonomy saturation** — Verify the outcome grammar can express the weaker/calibrated claim (e.g. "incomplete" / "not-yet-decidable"). Add the missing verdict and *measure what it absorbs*. A taxonomy that cannot express abstention manufactures false strong verdicts.
2. **Criterion disclosure** — Run a disclosed-criterion arm. If false verdicts collapse when the success criterion is named, the hidden criterion was manufacturing them.
3. **Censoring analysis** — Condition verdict rates on *reaching a decision point.* Check whether resource budgets (turn caps, iteration limits) censor which verdicts are observable at all. Rates computed over censored runs are not comparable to rates over completed runs.
4. **Distribution replication** — Re-run fixed configs (**n ≥ 10 per instance**) and report verdict *distributions*, not single draws.

### 2.1 Stated limitations (fairly disclosed by the author)

- One player-narrator pairing, one constructed world, one instrument revision per series — effect sizes explicitly not claimed to transport.
- The **true-positive cell is unpopulatable by construction**: genuine completion ends a game as WIN before any halt, so every "complete" halt verdict is false by construction. The design measures false-verdict *generation*, not discrimination.
- Self-imposed preregistration (Gate 0/1 were partly retrospective in formality). Series 3 is proposed to harden this: cryptographic timestamping, third-party registration, a placebo-directive control, a bare-numeral budget arm, a different-narrator + open-weights replication, and a HALT-guard against the misparse in §4.6.

**Assessment:** the limitations are disclosed honestly and none undercuts the protocol. The confounds (register presence × prompt composition; budget rendering hypothesis-generating) are correctly labeled, not buried. This is a credible, well-instrumented paper.

---

## 3. Mapping to our system

Our calibration harness is structurally the same kind of instrument the paper dissects: a verdict grammar (`disagreement_type`, convergence/non-convergence), hidden criteria (what counts as a crux "addressed"), resource budgets (max-iterations, situation-cap), and a presentation channel (situation injection ordering, register of the debate prompts). Every failure mode the paper induces has an analogue in our measurement of debate quality.

| Paper knob | Our analogue | Owned artifact |
|------------|--------------|----------------|
| Outcome grammar / taxonomy saturation | `convergence_score` outcome set; `disagreement_type` enum (definitional/interpretive/structural); is there a "crux-not-identified / not-yet-decidable" verdict? | Convergence logic, ontology (`AGENTS.md` §Ontological Grounding) |
| Criterion disclosure | Does the debater prompt name what counts as "addressing the crux"? Hidden success criterion → inflated `crux_addressed_rate` | Prompts (debate templates) |
| Censoring analysis | `max_iterations`, `situation_cap`, budget-exhaustion terminations censor which convergence outcomes are observable | Algorithmic parameters |
| Distribution replication | Our >5% / 7-day regression trigger acts on **single-run** metric deltas | Quality metrics (`calibrationLogger.ts`), regression-diagnostic flow |
| Budget rendering / register | How situation budget and debate register are rendered to agents may move `situation_crux_alignment` independent of content | Prompts + situation injection |

---

## 4. Issues / findings (severity-tagged)

Severity here = *risk to the validity of our calibration numbers*, per the review-deliverable schema. Evidence class is noted per finding; findings resting on the external paper alone (not yet reproduced on our golden set) are capped at `suggestion` per our "no blocking on intuition" rule, except where our own methodology already documents the gap.

**F-1 — `major` — metric — `lib/debate/calibrationLogger.ts`, `research/comp-linguist/AGENTS.md` §Regression diagnostic flow.**
Our >5%-over-7-days regression trigger fires on what may be a **single-run draw from a non-stable distribution.** The paper's ground result (3/4 configs non-stable at n=10) predicts our trigger will raise false regressions and miss real ones. *Evidence:* paper §1 distributional result + our own regression flow already lists "Stochastic — within expected variance given sample size" as root-cause class 5, i.e. we acknowledge the failure mode but have no n≥10 gate enforcing it. This is a documented-methodology gap, so it exceeds `suggestion`.

**F-2 — `major` — ontology — convergence/`disagreement_type` outputs.**
If our verdict grammar cannot express a **calibrated "crux-not-identified / not-yet-decidable"** outcome, then—by the paper's taxonomy-saturation result—debaters are pushed into false convergence or false persistent-disagreement, inflating whichever verdict *is* expressible. We must audit whether such a verdict exists and, if added, measure what it absorbs (do not assume it is well-calibrated; the paper explicitly flags "incomplete" uptake as possibly the no-lose option). *Evidence:* paper effect (i), 0/40→28/40 uptake.

**F-3 — `suggestion` — prompt-clarity — debate templates.**
The debater prompt may not disclose the success criterion ("what counts as addressing the crux"). A hidden criterion inflates `crux_addressed_rate`. A disclosed-criterion A/B arm against the golden set would tell us whether our crux metric measures engagement or measures the hidden rubric. *Evidence:* paper effect (ii), 18/59→0/58 false verdicts under disclosure.

**F-4 — `suggestion` — metric — `situation_cap`, `max_iterations` parameters.**
Convergence metrics are likely computed over runs that terminated by budget exhaustion (censored) *and* runs that reached a genuine decision point, pooled. The paper's censoring check says these are not comparable. We should condition convergence/`crux_addressed_rate` on *reaching a decision point* and report a censoring rate alongside. *Evidence:* paper protocol check 3.

**F-5 — `suggestion` — other (reproducibility) — `calibrationLogger.ts` entry shape + `metric-provenance-register.md`.**
We do not currently bind each calibration entry to (prompt version + model id + config revision + clean/dirty flag). Without it, a metric shift cannot be attributed to prompt vs. parameter vs. model drift — exactly the attribution our 5-class regression flow requires. The paper's preregistration-by-artifact (each log binds the git revision it executed) is a cheap, high-leverage fix. *Evidence:* paper contribution 3; our regression flow classes 1–4 all require this provenance to disambiguate.

---

## 5. Recommendations (each requires a follow-up ticket before this review closes)

Ranked by leverage. Provenance class stated per the checklist rule; **all four metric/parameter changes are `stipulated` until validated on our golden set** — none carries an evidence pointer from *our* data yet, so by our own rule they are stipulated by definition and must be registered as such in `metric-provenance-register.md` when implemented.

### R-1 (highest leverage) — Distribution replication before acting on a metric shift
Require **n ≥ 10 replications of a fixed config** before the >5%/7-day regression trigger is allowed to fire, and report the metric as a distribution (median + spread), not a point. This directly closes F-1 and upgrades our root-cause class 5 ("Stochastic") from a post-hoc excuse to a pre-condition.
- **Touches:** `lib/debate/calibrationLogger.ts` (Shared Lib scope), regression-diagnostic flow in `research/comp-linguist/AGENTS.md` (CL scope).
- **Provenance:** stipulated (n=10 borrowed from the paper; re-derive our own stability threshold once we have replication data).
- **Owner split:** replication-gate logic → Shared Lib; the AGENTS.md flow rule + provenance register entry → CL.

### R-2 — Taxonomy saturation audit on convergence / `disagreement_type`
Audit whether our verdict grammar can express a calibrated "crux-not-identified / not-yet-decidable" outcome. If missing, add it and **measure what it absorbs** on the golden set (do not assume calibration). Closes F-2.
- **Touches:** convergence logic, `disagreement_type` enum, ontology section of `AGENTS.md`.
- **Provenance:** stipulated (new verdict category); becomes derived once its uptake is scored against evidence sufficiency.
- **Owner:** CL (ontology + convergence criteria are CL-owned), implementation coordination with Shared Lib.

### R-3 — Criterion-disclosure A/B against the golden set
Run a disclosed-criterion arm of the debater prompt (one sentence naming what counts as addressing the crux) vs. current hidden-criterion prompt; compare `crux_addressed_rate`. If false engagement collapses under disclosure, the hidden criterion was manufacturing it. Closes F-3.
- **Touches:** debate prompt templates (CL-owned).
- **Provenance:** stipulated → human-validated once A/B results are read.
- **Owner:** CL.

### R-4 — Censoring analysis on convergence metrics
Condition convergence / `crux_addressed_rate` on *reaching a decision point*; report a censoring rate driven by `max_iterations` / `situation_cap` / budget exhaustion. Un-pool censored and completed runs. Closes F-4.
- **Touches:** `calibrationLogger.ts` computation (Shared Lib), parameter semantics doc (CL).
- **Provenance:** stipulated.
- **Owner split:** metric computation → Shared Lib; interpretation rule → CL.

### R-5 — Preregistration-by-artifact for calibration entries
Bind each `calibration_log` entry to prompt version + model id + config revision + clean/dirty flag; freeze owned thresholds before a run rather than reading them post-hoc. Closes F-5 and is a prerequisite that makes R-1's replication and our 5-class attribution actually decidable.
- **Touches:** `calibrationLogger.ts` entry schema (Shared Lib), `metric-provenance-register.md` (CL).
- **Provenance:** stipulated (schema addition; no metric value changes).
- **Owner split:** entry schema → Shared Lib; register/threshold-freeze discipline → CL.

---

## 6. Paper-only / citation-only content (route to PM)

The paper is a strong citation for the **academic-paper-draft's** methodology/validity section: it is a concrete, auditable demonstration of the construct-validity threats that Wallach et al. (2025) and Bean et al. (2025) describe abstractly, and it supplies a portable four-check protocol. This is a *paper-only* recommendation — CL drafts the citation + framing paragraph, PM integrates into `docs/academic-paper-draft.md` (the paper is PM/root-owned; CL does not commit it directly).

---

## 7. Follow-up tickets (required by CL review-tracking discipline)

Per `research/comp-linguist/AGENTS.md` (review recommendation tracking + handoff completeness), each MEDIUM/HIGH recommendation needs a ticket with the correct owner before this review is closed. Proposed ticket set:

| Rec | Ticket | Title | Owner | Priority |
|-----|--------|-------|-------|----------|
| R-1 | t/1668 | Replication gate: require n≥10 before calibration regression trigger fires | DebateTool (logic) + CL (flow rule) | HIGH |
| R-2 | t/1669 | Taxonomy-saturation audit: add calibrated "crux-not-identified" convergence verdict | CL | HIGH |
| R-3 | t/1670 | Criterion-disclosure A/B on debater prompt vs golden set | CL | MEDIUM |
| R-4 | t/1671 | Censoring analysis on convergence metrics (condition on decision-point) | DebateTool (metric) + CL (interpretation) | MEDIUM |
| R-5 | t/1672 | Preregistration-by-artifact: bind prompt/model/config revision into calibration entries | DebateTool (schema) + CL (register) | HIGH |
| §6 | t/1673 | Cite instrument-effects paper in academic-paper-draft methodology/validity section | PM (integrate) / CL (draft) | MEDIUM |

**Owner note:** `lib/debate/calibrationLogger.ts` resolves to the **DebateTool** role (`lib/debate`), which is the most-specific owner of the metric-logic files — so R-1/R-4/R-5 route there rather than to Shared Lib (`lib`) as originally drafted. Each still carries a CL sub-part (flow rule / interpretation / provenance register).

**Dependency:** t/1672 (R-5 preregistration binding) **blocks** t/1668 (R-1) and t/1671 (R-4) — a metric shift cannot be attributed to prompt vs. parameter vs. model drift, nor a replication distribution be trusted, until each calibration entry binds its prompt/model/config revision.

**Status of this review:** **CLOSED 2026-07-22** — all six follow-up tickets filed (t/1668–t/1673), assigned, and transitioned to Todo. `approve-with-notes` verdict discharged; the notes are now tracked work.
