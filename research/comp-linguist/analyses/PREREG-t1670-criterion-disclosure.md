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

## Amendment 1 — authorized deviation from the sample floor (2026-07-27, before the run)

The owner authorized the run at **7 debates per arm** on **gemini-3.5-flash-lite**. Both differ from the protocol above, so they are recorded here before any result exists rather than explained afterward.

**Sample: 7 per arm, against a stated floor of 10.** This is below the replication-gate floor (R-1, t/1668) that the Sample section invokes, so the debate-level result is **indicative, not stability-confirmed**. Two consequences follow and both are binding on the report:

- **Per-debate spread must be reported, not just pooled counts.** At n=7 a single atypical debate carries roughly 14% of the arm's weight, so a pooled shift can be manufactured by one outlier. The report shows the per-debate status counts so a reader can see whether the shift is distributed or concentrated.
- **The debate-level and crux-level sample sizes are different, and only one is underpowered.** The primary outcome is a distribution over *cruxes*, and each debate yields several, so the crux-level n may be adequate while the debate-level n is not. Both are reported. Any claim about *debate-to-debate stability* is out of scope at this n; a claim about the crux distribution is admissible with the spread caveat.

**Model: gemini-3.5-flash-lite** (the `Show-TriadDialogue` default). Model is part of the instrument, so these results do not transport to other models, and this is a different instrument from the one Phase 0 validated. Held identical across both arms, which is what the A/B requires.

**What this amendment does not do:** it does not relax any decision rule. Thresholds, the Goodhart veto, and the null-is-a-result rule stand exactly as written. If the result is ambiguous at this n, the honest report is "underpowered, inconclusive" rather than a softened threshold.

## Amendment 2, measured crux density and a second outcome channel (2026-07-27, before any arm-B data exists)

### What I have looked at, and what I have not

Two arm-A debates were already banked when this amendment was written. From them I read **crux counts per checkpoint** and nothing else. The status vocabulary was taken from `lib/debate/neutralEvaluator.ts:37`, which is source, not data. I have not read a single status value, a distribution, or any arm-B artifact, because no arm-B debate has finished. Counts are a power parameter and reading them is what makes this amendment possible; reading outcomes would have made it worthless.

### Amendment 1's hedge does not survive contact with the data

Amendment 1 allowed that "the crux-level n may be adequate while the debate-level n is not." It is not adequate. The final checkpoint carries **2 cruxes per debate** in both banked runs, so seven debates yield roughly **14 cruxes per arm**. One crux is therefore worth about 7.1 percentage points, and Rule 1's 10-point threshold cannot be crossed by fewer than two cruxes changing category. A rule that fires on two of fourteen items is close to a coin-flip detector, and I would rather say so now than discover it while writing up a positive result.

This does not relax Rule 1. It sets the expectation that a Rule 1 "shift" at this n is weak evidence, and that the honest verdict for anything short of a large, distributed, direction-consistent move is "underpowered, inconclusive."

### A third measure, added before results, on the convergence-layer crux states

`crux_tracker[].state` is added as a **preregistered third outcome**, roughly 4 cruxes per debate in the banked runs and so about 28 per arm.

The reason is not only the better count. The two channels have different exposure to the intervention, and that difference is what Rule 3 has been asking for:

- **Labeling channel** (`neutral_evaluations[].status`). The arm-B patch rewrites the evaluator's own rubric, so this channel sees the disclosure directly. Its labels can move without anything about the debate changing.
- **Substance channel** (`crux_tracker[].state`). Computed by the convergence layer, which received no patch. It can only move if the debaters behaved differently, since the debater prompts are the other half of the intervention.

Interpretation is fixed here, before results, so it cannot be fitted to them:

| Labeling channel | Substance channel | Verdict |
|---|---|---|
| moves | moves, same direction | Disclosure changed behaviour. Rule 2 applies to the direction. |
| moves | flat | **Evaluator relabeling.** The rubric renamed the same debates. This is an instrument effect, and the disclosure sentence is not adopted. |
| flat | moves | Debate substance changed but the rubric failed to register it. The rubric under-detects, which is a finding about the rubric. |
| flat | flat | Null, per Rule 4. |

The second row is the Goodhart veto of Rule 3 in measurable form rather than as a hand-check. The hand-check in Rule 3 still runs; it now has a quantitative companion instead of carrying the veto alone.

Both channels report the same way as the primary, showing per-debate spread alongside pooled counts, per Amendment 1.

### Caveat carried forward

The banked arm-A run `t1670-02` logged `an.extraction_coverage_low` at 29% against a 70% threshold. Low extraction coverage is a property of the model and pacing, held identical across arms, so it does not bias the comparison. It does bound what the run can claim. These are thin debates, and a criterion effect measured on thin debates may not appear on richer ones.

## Instrument incident log (recorded and committed before any arm-B data existed)

No decision rule, measure, or interpretation changes here. These are execution facts a reader needs to weigh the run, written down while arm B still had zero artifacts.

1. **Arm-B patch never compiled until tonight.** The patched evaluator rubric quoted the three status words with backticks inside a template literal, which terminated the string, so every arm-B launch died in the TypeScript transform before reaching any model call. The consequence for validity is nil, because zero arm-B debates ran under the broken instrument and nothing was measured with it. The fix (backticks to double quotes in `neutralEvaluator.ts:192`, no wording change) alters quoting, not semantics. Both patched files were then parse-verified with the same transformer the CLI uses. The defect also exposes a gap in my own verification. I had confirmed the patch *text* was present in the worktree but never that it *parsed*, and text-presence checks are not instrument checks.
2. **Worktree data-root resolution.** The arm-B worktree lives outside the repo parent, so the relative `data_root` in `.aitriad.json` resolved to a nonexistent path and arm-B launches failed at taxonomy load. Fixed by pinning `AI_TRIAD_DATA_ROOT` to the same directory arm A resolves implicitly, keeping both arms' data identical. Verified by a 20-second probe run (taxonomy loaded, debate started) that was killed before producing artifacts.
3. **Two-writer race on arm-A slugs (no effect on validity).** A session restart left the original batch runner alive while a recovery filler ran the same queue; for roughly 40 minutes both wrote the same arm-A output slugs. Both writers used byte-identical configs from the same clean tree, so whichever debate survived per slug is a valid arm-A draw selected by timing, not outcome. All six then-banked artifact sets were audited at the object level (harvest/session id match, sub-second write spread, single-run flight recorder): none torn. Fleet lesson filed as pattern #86; the underlying CLI hang that caused every runner to ride its timeout is t/1824.

## Results

Not yet run. This section is written before the run and holds no results.
