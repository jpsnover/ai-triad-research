# Edge-Rationale Quality Harness (A′)

**Tranche:** follow-up to t/2444 (edge-rationale coverage plan) · **Author:** Computational Linguist

An **automated, no-hand-grading** quality screen for the `rationale` field on taxonomy
edges. It answers one question about a batch of rationale text: *is it good, or is it
empty / off-type / label-restatement junk?*

> **Context (t/2444 correction, 2026-08-23):** the ~33k missing rationales were **not**
> "never generated" — the workflow-app pipeline **wiped** original discovery-time
> rationales twice; they are git-restorable intact from `ba3128f5`. The remediation is a
> **git-restore + pipeline fix + regression gate**, not an LLM backfill. This harness is
> therefore primarily a **restore-verifier** (confirm the restored text is the good
> original, not corrupted/empty) and a general screen for any future rationale — it is
> *not* gating a 33k-edge backfill spend (that path is superseded).

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

## Intended use

**Restore-verifier (primary).** After the git-restore lands rationales from `ba3128f5`,
point this harness at the restored `edges.json`. A low flag rate confirms the restore
recovered the good original text; a spike in `empty`/`too_short` flags would mean the
restore missed edges or pulled corrupted rows. This is the cheap automated check that the
restore did what it claims — before trusting 25k reviewer-facing rationales.

**General screen (secondary).** Run it over any batch of rationale text — new discovery-time
output, or a residual LLM backfill of the ~6 edges that never had one — to catch obvious junk.
