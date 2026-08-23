# Edge-Rationale Quality Harness (A′)

**Tranche:** follow-up to t/2444 (edge-rationale coverage plan) · **Author:** Computational Linguist

An **automated, no-hand-grading** quality screen for the AI-generated `rationale`
field that `Invoke-EdgeRationaleBackfill` writes onto taxonomy edges. It answers one
question before a 25–33k-edge backfill spend commits: *is the output good enough, or
is it spraying label-restatements?*

## Two layers

1. **Mechanical** (`check_rationale_quality.py`, always run, deterministic, **free**)
   flags each rationale as: `empty`, `too_short`, `too_long`, `restatement`,
   `low_novelty`, `both_labels_verbatim`. Pure token heuristics — no model, no cost.
2. **LLM-judge** (`judge-prompt.txt`, **opt-in**, costs tokens). The script does *not*
   call a model. `--emit-judge-prompts` renders one scoring prompt per edge to JSONL;
   score them with any backend; `--judge-results` merges the verdicts back into the
   report. This keeps *building* the harness free and *running* the judge a separate,
   explicit decision.

## Usage

```bash
# mechanical-only report (free)
python check_rationale_quality.py \
  --edges  <data>/taxonomy/Origin/edges.json \
  --taxdir <data>/taxonomy/Origin \
  --out report.json

# also render judge prompts for a later scoring run
python check_rationale_quality.py --edges ... --taxdir ... \
  --emit-judge-prompts judge_prompts.jsonl

# merge scored verdicts back
python check_rationale_quality.py --edges ... --taxdir ... \
  --judge-results judge_results.jsonl --out report.json
```

`test_check_rationale_quality.py` is the two-arm proof: a genuinely good rationale
draws zero flags, and each defect fires exactly its flag. Run
`python test_check_rationale_quality.py` (exit 0 = pass; no pytest needed).

## Provenance (load-bearing)

**Every threshold here is `stipulated`** — asserted by design, not derived from a
labeled study. Registered in `research/comp-linguist/docs/metric-provenance-register.md`.
The judge verdict is a **junk screen** (catches empty / off-type / label-restatement),
**not a proof of rationale quality**. Do not read a judge `pass` as ground truth, and
do not promote these thresholds to `derived` without an evidence pointer (a labeled
sample the thresholds were tuned against).

## Intended use in the tranche sequence

This is the automated bar the **E′ pilot** measures against: run
`Invoke-EdgeRationaleBackfill -Limit 150` on one edge type, point this harness at the
result, and read the flag/verdict distribution. A low flag rate is the evidence PI
needs to approve (or a high rate the reason to fix the prompt first) — before the full
backfill spend.
