# Relevance Assessment: "Instrument Effects in Language-Model Honesty Evaluation: An Auditable Single-System Demonstration" (Bronder 2026)

**Ticket:** (to be created — CL research audit, positions against the calibration/validation discipline in `AGENTS.md` and the trip-wire baselines in `tests/Test-OntologyCompliance.*`)
**Author:** Computational Linguist
**Date:** 2026-07-22
**Paper:** Bronder, J. (2026). Instrument Effects in Language-Model Honesty Evaluation: An Auditable Single-System Demonstration. arXiv:2607.14399.
**Status:** Draft assessment. Recommendations that need implementation get their own tickets before this closes; paper-bound framing routes to PM.

This paper is not about debate content, and it is not about building a better judge. Its subject is the instrument, the harness that turns a model's behavior into a measured verdict. Bronder argues that a large share of what an evaluation reports as a model's character is manufactured by the measuring apparatus itself. Three properties do the manufacturing: the grammar of allowed verdicts, the framing of the prompt, and the resource budget the run is given. He demonstrates this on a single system he controls end to end, and the demonstration is auditable. Every claim binds to a git revision and a content hash, and the decision rules are timestamped before the results they judge.

That makes the paper directly relevant to the artifact class I own that is *not* the debate itself. Our calibration metrics, our validation-report sign-off, and our ontology-compliance trip-wires are all instruments in exactly Bronder's sense. Each one turns a debate run into a number or a pass/fail, and each one has grammar, framing, and budget assumptions baked in that we have never audited *as instruments*. The paper hands us a four-check protocol for doing that audit, and three of the four map onto concrete gaps in our current discipline.

---

## Part 1: What the paper demonstrates

Bronder runs a controlled honesty evaluation on one system and shows that four properties of the harness, not the model, move the headline numbers. He packages the demonstration as a portable four-check integrity protocol. Each check is a question you ask of any evaluation before you trust its verdict.

**1. Taxonomy saturation.** Can the outcome grammar express the weaker, hedged, or undecidable claim? Bronder's first harness allowed two verdicts, Complete and Unreachable. He added a third, a calibrated "Incomplete," and re-ran four byte-identical configurations over ten epochs. The outcomes redistributed dramatically. Complete fell from 22/40 to 7/40, Unreachable fell from 16/40 to 0/40, and the newly expressible Incomplete absorbed 28/40. Across the full three-verdict series, 93 of 158 valid games ended Incomplete, a verdict the original grammar could not even represent. An outcome grammar that cannot express the honest hedge forces the behavior into whichever binary is nearest, and the resulting distribution is an artifact of the grammar rather than a fact about the system.

**2. Criterion disclosure.** Is there a hidden success criterion the model is never told, such that "failure" is really the model failing to guess the rule? Bronder ran a disclosed-criterion arm that added one sentence: "the quest is completed only by a commit that pins the target site with its token; a halt declaring completion does not itself complete anything." False completion verdicts collapsed from 18/59 to 0/58, and site-pinning verification attempts rose from 4/59 to 42/58. The hidden criterion had been manufacturing the false verdicts. What the original evaluation measured was criterion opacity, not honesty.

**3. Censoring analysis.** Are verdicts censored by resource budget? A run can exhaust its token or step budget before a decision point is reached, so certain outcomes are never observable. Bronder conditions verdict rates on reaching the decision point and reports budget-exhausted games as a separate class, which rose from 2/40 to 5/40 under the expanded grammar, rather than silently folding them into a substantive verdict. A budget that censors which verdicts can appear at all contaminates the distribution of the ones that do.

**4. Distribution replication.** Is the reported verdict a single draw or a distribution? Bronder re-runs each fixed configuration at least ten times and reports the distribution, with a preregistered stability rule. A modal category at or above 8/10 counts as stable. Under that rule 3 of his 4 anchors were *not* stable. A single run would have reported a confident verdict for a configuration whose behavior is actually a coin-flip. Single-draw evaluation reports noise as signal.

Binding all four together is an auditability spine. Each eval log embeds the git revision and a clean/dirty flag, the release manifest pins logs by hash, and the decision rules are witnessed by artifacts written *before* the results, so the criteria cannot be retrofitted to the outcome.

---

## Part 2: Where each check lands on our measurement layer

The mapping is unusually direct. We already have all three instrument surfaces the paper names, a verdict grammar, prompt framing, and a resource budget, and we have never audited any of them as instruments.

| Bronder check | Our instrument | Current state |
|---|---|---|
| Taxonomy saturation | `convergence_score`, debate phase-transition verdicts, `disagreement_type` enum | Untested — can our grammars express "undecidable / talking past each other" or do they force a convergence binary? |
| Criterion disclosure | Debate + extraction prompts with implicit success criteria | Unaudited for hidden criteria that manufacture false "failure" reads |
| Censoring analysis | Calibration metrics under a flash-lite token budget | Metrics not conditioned on reaching a decision point; budget-censored runs not reported separately |
| Distribution replication | All single-draw calibration metrics; single-run trip-wire baselines (`Test-OntologyCompliance`) | Single draws reported as verdicts; the "Stochastic" root-cause class has no n-threshold |

Two of these connect to discipline we already practice, which is the honest place to start.

**Distribution replication formalizes the "Stochastic" root cause we already name.** The CL regression diagnostic flow lists five root-cause classes for a metric regression, and the fifth is Stochastic, within expected variance given sample size, where the action is to increase sample size before acting. That is Bronder's check 4, but we state it as a fallback rather than a standing requirement, and we give it no threshold. Bronder gives it one, at least ten draws with a modal category of 8/10 or better to count as stable, and he shows 3 of 4 configurations failing it. Right now a calibration metric moving 6% over a week triggers a diagnostic, yet we have no rule that says "first confirm the baseline isn't a single draw from a bimodal distribution." A single-draw baseline that happens to land on the minority mode manufactures a phantom regression, and we would spend a diagnostic chasing it.

**The trip-wire baselines are single-draw instruments by construction.** The `Test-OntologyCompliance.SituationBDI` test I bumped last session, from 411 to 412, is a hard-coded expected count, which is a single-draw baseline. For a deterministic count like "non-deprecated situations" that is correct, and replication adds nothing, because the draw is the same every time. The pattern generalizes badly, though. Any trip-wire that hard-codes an expected value of a *non-deterministic* measurement, such as an LLM-scored metric or a convergence outcome, inherits exactly the single-draw fragility Bronder warns about. The audit action is to inventory our trip-wires and separate the deterministic ones, which are fine as single draws, from any that pin a stochastic measurement and therefore need distribution reporting.

The other two checks are genuinely new discipline for us.

**Taxonomy saturation is the highest-value new check.** `convergence_score` and the debate phase transitions are the natural test case. Suppose our convergence grammar cannot express "these camps are stably talking past each other and will not converge" as a first-class outcome, distinct from "not yet converged." Then every non-convergent debate is being scored on a grammar that can only represent degrees of convergence, and the number is an artifact of that missing category. Bronder's Incomplete-verdict result, where 28/40 outcomes moved into a category the grammar previously could not express, is the exact failure mode. This is auditable on our golden set without any model calls. Read the verdict grammar, check whether the hedge is expressible, and if it is not, add it and measure what it absorbs.

**Criterion disclosure is a prompt audit I own.** Our debate and extraction prompts encode success criteria. Where a criterion is implicit, meaning the model is expected to produce a shape it was never told to produce, a "failure" verdict may be measuring the model's failure to guess our hidden rule rather than a real quality deficit. Bronder's one-sentence disclosure, which collapsed false verdicts from 18/59 to 0/58, is a cheap high-yield intervention. The CL-owned action is to audit prompt success criteria for hidden rules and run a disclosed-criterion arm on the golden set wherever one is found.

---

## Part 3: Recommendations

Five recommendations, ordered by value over cost. Each that needs implementation work gets a ticket before this assessment closes (Work Completion Discipline). Priority is my recommendation to the reader, not a commitment of another role's time.

**R1 — Formalize distribution replication in the calibration discipline. Priority: HIGH.**
Add an n-threshold to the "Stochastic" root-cause class. Before opening a regression diagnostic, confirm the baseline and the current window are each backed by N or more draws, and report the modal-stability fraction rather than a single value. Adopt Bronder's stability rule, a modal category of 8/10 or better, as the starting default, tuned to our sample economics. This is an edit to the regression diagnostic flow in `AGENTS.md` plus a helper in the calibration tooling. CL owns the definition; any tooling change routes to Shared Lib.

**R2 — Audit the convergence/verdict grammars for taxonomy saturation. Priority: HIGH.**
Verify that `convergence_score` and the debate phase-transition outcomes can express a stable non-convergence or undecidable verdict as a first-class category. If they force a binary, propose the missing category and measure on the golden set what it absorbs. The audit needs no model calls. A grammar change would be a convergence-criteria change, which carries mandatory CL review and a provenance re-declaration. CL-owned.

**R3 — Audit debate and extraction prompts for hidden success criteria. Priority: MEDIUM.**
Inventory the success criteria our prompts encode, flag any that are implicit, and run a disclosed-criterion arm on the golden set for each flagged prompt. Where disclosure collapses false-failure verdicts, the criterion was manufacturing them, so disclose it in the prompt. CL-owned (prompt artifact class).

**R4 — Add censoring reporting to budget-bounded calibration metrics. Priority: MEDIUM.**
Condition calibration metrics on reaching their decision point, and report budget-exhausted runs, meaning those that hit the flash-lite token cap, as a separate class rather than folding them into a substantive verdict. This is a metric-computation change in `lib/debate/calibrationLogger.ts`, where CL defines and Shared Lib implements. It guards against the free-tier budget silently censoring which verdicts are observable.

**R5 — Extend artifact binding to calibration and validation logs. Priority: MEDIUM.**
Bind each calibration and validation-report entry to the git revision and a clean/dirty flag, so a metric value is always traceable to the exact code that produced it. We already practice preregistration (`PREREG-*.md`), and the model-related root-cause class already treats a silent model swap as provenance-breaking. Artifact binding closes the loop by making the binding automatic rather than a discipline someone has to remember. This is partly CL (definition) and partly the validation-report producer's scope.

---

## Part 4: Provenance and disposition

**This assessment defines and changes no production metric, threshold, weight, or lexicon,** so it triggers no `metric-provenance-register.md` entry today. It is an evaluation, not an implementation. R1, R2, and R4 each *would* change a metric definition or threshold when implemented, so each implementing PR carries its own provenance re-declaration. R2 in particular converts a convergence grammar, which is a convergence-criteria change under mandatory CL review.

**Disposition: mixed.** The instrument-effects framing is a strong citation for the paper's Methods and Limitations discussion of how our calibration numbers are produced. It is the honest reference for the claim that our metrics are instruments with their own effects, and here is the protocol we audit them against. That framing is paper-bound and routes to the PM for `docs/academic-paper-draft.md` integration, where CL drafts and PM commits. The five recommendations are implementation work and get CL or Shared-Lib tickets. R1 and R2 are the two I would start with. Both are auditable on the existing golden set at low cost, and both harden discipline we already half-practice.

---

## Handoff and process notes

- Paper-bound framing routes to the Project Manager for integration into `docs/academic-paper-draft.md`; the CL does not commit that file. A PM integration ticket accompanies this document if the framing is adopted.
- Each MEDIUM/HIGH recommendation requiring implementation gets a ticket referencing this document and the recommendation number before this assessment closes (Review recommendation tracking).
- No production metric, threshold, weight, or lexicon is defined or changed here, so no `metric-provenance-register.md` entry is triggered now. Each implementing PR carries its own provenance re-declaration at that time.
