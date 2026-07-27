# PREREG for t/1670: Criterion-Disclosure A/B on the Crux Success Criterion

**Ticket:** t/1670 (source: `docs/instrument-effects-review.md` §5 R-3, Bronder effect (ii))
**Author:** Computational Linguist
**Last updated:** 2026-07-27
**Status:** Preregistered protocol. Committed before any run. Results section is empty by design; the run itself is gated on owner authorization of LLM spend.

## What this decides

Whether our crux engagement metric measures engagement or a hidden rubric. The audit (t/1670#1) established that the criterion is undisclosed on both sides of the seam: `neutralEvaluator.ts:192` asks the evaluator to "assess whether the debate has addressed it" with no definition, and the debater prompt tells speakers to find cruxes without ever saying what addressing one means. This experiment tests whether naming the criterion changes behaviour, and in which direction.

## The rubric (the artifact under test)

Genus-differentia definitions, written so each status is decidable from the transcript rather than from impression. The discriminating property is **bilateral engagement on the same proposition**, which a reader can point at.

- **`addressed`.** A speaker engaged the crux proposition with reasoning or evidence bearing on it, **and** an opposing speaker answered on that same proposition. Encompasses evidence offered and contested, a distinction drawn and then accepted or rejected, and an explicit concession. Excludes assertion that draws no response, and a response that substitutes a different proposition.
- **`partially_addressed`.** The crux proposition was engaged with reasoning or evidence by at least one speaker, but **no opposing speaker answered on that same proposition**, or the exchange began and then moved to an adjacent proposition before either side answered. Encompasses one-sided engagement, however substantive.
- **`unaddressed`.** No speaker offered reasoning or evidence bearing on the crux proposition. Encompasses a crux that was named but only asserted about, and a crux that never surfaced.

## The intervention

**Disclosure sentence added to the debater prompt** (one sentence, mirroring Bronder's single added sentence):

> A crux counts as addressed only when you engage the specific proposition in dispute with reasoning or evidence and an opposing speaker answers on that same proposition; restating your position, or answering a nearby question instead, leaves the crux unaddressed.

**The same rubric is given to the evaluator** in the disclosed arm, replacing the bare "assess whether the debate has addressed it." Disclosing to only one side would confound two changes; the point is that both score against one stated rubric.

## Arms

| Arm | Debater prompt | Evaluator prompt |
|---|---|---|
| **A (control)** | current, criterion undisclosed | current, "assess whether the debate has addressed it" |
| **B (disclosed)** | current + the disclosure sentence | current + the three-status rubric above |

Model, topics, rounds, situation injection, and temperature are all held fixed. Arms differ only in prompt text.

## Sample

Golden-set topics, same topic list run in both arms, minimum 10 debates per arm (the replication gate, R-1 / t/1668, applies here too, since a single draw per arm would not be readable). Topic list and run ids recorded in the results section when the run happens.

## Outcome measures

- **Primary: the three-way status distribution per arm** (counts of addressed / partially_addressed / unaddressed over all cruxes). Reported as counts, Bronder's own reporting style.
- **Secondary, diagnostic only: `crux_addressed_ratio` as production computes it.** Reported alongside to show how much movement the production metric hides. This is not the decision variable, because the metric bins `partially_addressed` with `unaddressed` (t/1796) and would report zero change for a real `unaddressed → partially_addressed` shift.
- **Guard measure: bilateral-exchange depth.** For 10 cruxes sampled per arm, CL hand-checks whether an `addressed` verdict rests on substantive mutual engagement or on shallow acknowledgment.

## Decision rules (fixed before the run)

1. **Disclosure changed behaviour** iff the status distribution shifts between arms by ≥ 10 percentage points in any category.
2. **Direction matters more than movement.** A shift toward `addressed`/`partially_addressed` supports the hidden-criterion hypothesis, meaning the undisclosed criterion was suppressing measured engagement. A shift toward `unaddressed` means disclosure made the evaluator *stricter*, which is also informative and must be reported as such rather than as a failure.
3. **Goodhart check, and it can veto a positive result.** If the distribution improves but the guard measure shows the disclosed arm's `addressed` verdicts resting on shallow acknowledgment (speakers performing response to satisfy the stated rule), then disclosure produced gaming, not engagement. That outcome is reported as **disclosure-induced gaming**, and the disclosure sentence is not adopted. A metric that improves because the rule was named is exactly the instrument effect this whole review programme exists to detect.
4. **Null result is a result.** If the distribution does not move, the hidden criterion was not suppressing measured engagement, and F-3 is not supported for our harness. Report it; do not re-run with a different sentence and present that as the original test.

## Provenance

`crux_addressed_ratio` and the evaluator's status definitions are currently **stipulated**. The rubric above is stipulated at introduction. It promotes to **human-validated** only if a human rater scores transcripts against it with acceptable agreement. The A/B alone cannot do that, since it measures whether behaviour changed, not whether the rubric is correct. Register entry accompanies any adoption.

## Results

Not yet run. This section is written before the run and holds no results. The run is gated on owner authorization of LLM spend (10+ debates per arm).
