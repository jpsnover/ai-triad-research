# Theory of Success: Cruxes

**Author:** Computational Linguist (AI Triad Research). **Ticket:** t/3042. **Date:** 2026-08-26.

## What a Crux is

A Crux (`crux-NNN`) is the load-bearing point of disagreement in a debate: the specific question whose answer would actually move a camp's position. "Does mechanistic interpretability provide a reliable, high-fidelity signal of model intent that can prevent deceptive alignment?" is a crux. A debate is only as good as its ability to find and engage the real crux rather than argue past it.

Structure (as seen in the Cruxes view and the crux registry):
- **Category:** Empirical, Values, or Definitional. The category names how the crux could resolve: by evidence, by a value tradeoff, or by pinning a definition. The corpus is roughly 399 Empirical, 127 Values, 60 Definitional.
- **Resolution status:** Active, Resolved, or Irreducible. Irreducible marks a genuine values-level disagreement that will not resolve, which is a legitimate outcome, not a failure.
- **Source debates** (the `×N` recurrence count): a crux is extracted from debates and often recurs across several.
- **Linked nodes:** the taxonomy positions that diverge at this crux.
- **External evidence:** an evidence URL and note, used mainly for Empirical cruxes.
- **`question_form`:** a neutral, presentational restatement of the crux as a question.

## The theory of success

Finding the true crux is the point of a debate. Two camps can exchange arguments for hours and never touch the question that actually separates them; a crux makes that question explicit, trackable, and, where it is empirical, resolvable by evidence. Cruxes are how disagreement is made precise instead of rhetorical.

**A Crux succeeds when it names the actual disagreement rather than a strawman, is categorized correctly so the right resolution mechanism applies, is engaged by the debaters, and carries a resolution status that honestly reflects reality without false convergence.** The corpus succeeds when cruxes are deduplicated across debates, neutrally phrased, and grounded in linked nodes and (for empirical ones) evidence.

Success criteria, each measurable:
1. **Engagement.** `crux_addressed_rate` / `crux_addressed_ratio` are high: debaters engage the actual crux, not adjacent ground.
2. **Correct categorization.** Empirical cruxes route to evidence, Values cruxes to an explicit tradeoff, Definitional cruxes to a definition; genuinely irreducible cruxes are flagged as such rather than argued forever.
3. **Honest resolution.** Convergence and resolution are read un-pooled over decision-point-reached runs (via `computeConvergenceWithCensoring`), so an undecided or censored crux is never laundered as resolved. `crux_resolution_divergence_rate` is low, meaning camps agree on whether the crux resolved.
4. **Neutral phrasing.** `question_form` does not smuggle a camp's framing.
5. **Grounding and dedup.** Linked nodes are present, and a recurring crux is merged into one entry with a recurrence count, not duplicated.

Failure modes, each an active concern:
- **Talking past the crux** (low `crux_addressed_rate`): the debate never touches the real disagreement.
- **Miscategorization**: treating a Values crux as Empirical invites endless "evidence" that can never resolve it.
- **False convergence**: declaring a crux resolved when the run was censored or the verdict was undecided. This is the reason the censoring gate (t/1671) reads convergence un-pooled and keys `censored` off the run-level termination reason, not the per-crux undecided verdict; when `n_unknown` dominates a window, the headline is reported as untrustworthy rather than interpreted.
- **Biased phrasing**: a `question_form` that presupposes one camp's answer.
- **Duplication**: the same crux scattered across many un-merged entries, hiding its true recurrence.

## How Cruxes are generated

- **Extraction from debates.** Cruxes are identified as the load-bearing disagreements during and after a debate, from claim extraction and the argument network. A crux that appears in multiple debates accumulates a source-debate count (`×N`).
- **Neutral question-form enrichment (t/1507).** An LLM rewrites each crux into a neutral question; neutrality is prompt-enforced and sample-reviewed. The `question_form` is presentational and carries no scoring weight, so a phrasing slip cannot bias a metric.
- **Categorization.** Each crux is typed Empirical / Values / Definitional, and its resolution status is tracked Active / Resolved / Irreducible.
- **Registry.** `cruxRegistry.ts` holds cruxes with their linked nodes and source debates.

## How Cruxes are used

- **Debate steering.** Cruxes focus a debate on the real disagreement (the CRUX_FOCUS prompt family), and `crux_addressed_rate` measures whether the debaters actually engaged them.
- **Convergence measurement.** Crux resolution across a debate feeds `convergence_score_at_termination` and `crux_resolution_divergence_rate`, read un-pooled with the censoring gate so termination-driven censoring does not masquerade as agreement.
- **Situation alignment.** `situation_crux_alignment` asks whether injected situations shape the cruxes the debate engages.
- **Taxonomy feedback.** `cruxTaxonomyFeedback.ts` uses cruxes to surface gaps and tensions in the taxonomy, so recurring disagreements drive taxonomy refinement.
- **Evidence attachment.** Empirical cruxes can carry external evidence URLs, moving them toward resolution by evidence rather than rhetoric.
- **Browsing and analysis.** The Cruxes view filters by category and by resolution status, and each crux shows its source debates and linked nodes.

## Success metrics and current gaps

- **Primary engagement metric:** `crux_addressed_rate` / `crux_addressed_ratio`.
- **Resolution honesty:** convergence read un-pooled with the censoring gate (t/1671); the standing caveat is that a window dominated by `n_unknown` is untrustworthy and must be reported as such.
- **Open items:** `question_form` neutrality is sample-reviewed, not human-validated; category assignment and irreducibility flags are stipulated rather than validated against an adjudicated set.
