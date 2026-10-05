# Logical-form prompt v3.1: dry-run results

**Author:** Computational Linguist
**Date:** 2026-10-05
**Ticket:** t/3884 (from t/3351 Part 2, PR #2744)
**Status:** Recommendation. The node-formalizer fix lands in this PR. The one-line prompt change is handed to PowerShell, who own the prompt. The full v3.1 rewrite is rejected.

## Summary

The ticket proposed three prompt edits:
1. a role-based self-check;
2. a narrower `hold` exception;
3. a new `maintain` example.

The dry-run shows the defect they targeted, saf-intentions-127 choosing `hold` from a purpose clause, is caused mostly by the **input**, not the prompt. The node formalizer hands the model each node's `Encompasses:` and `Excludes:` scope notes as if they were part of the proposition. 973 of 986 node descriptions carry them.

Removing them at the source fixes saf-intentions-127 in 3 of 3 drafts with the v3 prompt unchanged.

**The full v3.1 rewrite made things worse.** Its role test produced a real stance leak and a new discourse-as-agent frame. It is rejected.

**A single added rule is the one prompt change worth making.** It tells the model the predicate comes from the main clause, not from purpose or participial clauses. With it:
- known defects in the defect set fall from 5 to 2;
- no new defects appear out of sample or on the claim path;
- 3 of the 5 claim-path predicate changes follow the rule better.

## What changed

**Node formalizer (`research/comp-linguist/tools/formalize_node_lf.py`, this PR):**
- **Scope notes cut at the source.** `Encompasses:` and `Excludes:` are dropped before the proposition is built. They bound a node's scope for editors and are not its claim. `Excludes:` lists what the node does **not** claim.
- **Multi-word camp wrapper fixed.** The v3 wrapper strip matched a one-word camp only, so "A Desire within skeptic and safetyist discourse that..." (skp-desires-075) reached the model unstripped. The camp slot is now non-greedy text, matching `scan_lf_defects.py`.
- **Dry-run controls added.**
  - `--prompt` runs a candidate prompt.
  - `--legacy-source` reproduces the exact v3 node input, for baseline arms.
  - `--apply` refuses either option, so a dry-run arm can never write data.
- **Tests:** 4 new cases in `test_formalize_node_lf.py`. All 10 pass.

**Prompt candidate (`v31b-candidate.prompt`, for PowerShell to land):** the v3 prompt plus one line after "Choose the single predicate...". The line reads:

    The main assertion is the MAIN CLAUSE. A purpose or result clause ("so that X", "so they can be X", "in order to X", "to secure X") states why or what for, not the act asserted; a participial or relative modifier ("..., creating X", "systems that X") qualifies a participant. Neither supplies the predicate. Example: "Fund independent audits so that labs can be held to account" asserts funding; "held to account" is the purpose, so the predicate is fund, not hold.

The example is constructed. No evaluation node's text appears in any prompt example, which I checked by grep before running.

## Method

**Arms.** Each arm ran 3 drafts on the same 43 nodes: Gemini 3.5 Flash-Lite at temperature 0.2, the production node-formalizer settings.
- **A:** v3 prompt with the v3 node input (`--legacy-source`). The baseline.
- **B:** v3 prompt with the cleaned input. Isolates the source fix.
- **C:** the full v3.1 rewrite with the cleaned input.
- **D:** v3 plus the main-clause rule (v3.1b) with the cleaned input.

**In sample:** the 23 t/3351 Part 2 defect nodes. They were scored against `gold-predicates.json`, which lists the acceptable predicates for each node, registered by one annotator **before any v3.1 run** and not edited afterwards. This is the set the edits target, so in-sample scores are not validated precision.

**Out of sample:** 20 grounded nodes drawn with seed 3884 from the 619 not in the defect set (`dryrun-ids.json`). There is no gold set. The measures are:
- draft-to-draft stability;
- agreement with arm A;
- the `scan_lf_defects.py` class A and class B counts.

**Claim path:** `Invoke-LogicalFormPass` with v3 and with v3.1b, on scratch copies of the 8 summaries richest in grounded claims, writing only to those copies. It formalized 72 claims with `claude-sonnet-4-6`, the claim path's configured model, one draft each. The four source files were hash-checked before and after: unchanged.

## Results

**In sample, out of 69 drafts per arm** (`node-arms-score.txt` has every draft):
- A, v3: 63 gold matches, 5 known defects.
- B, cleaned input: 61 gold matches, 4 known defects.
- C, full v3.1: 63 gold matches, 6 known defects.
- D, v3.1b: 63 gold matches, 2 known defects.

Three drafts per node is a small sample. A difference of 2 matches out of 69 is within draft-to-draft noise, so gold-match does not separate the arms. The node-level patterns do:
- **saf-intentions-127** (the ticket's target) is `hold` in 3 of 3 drafts in A, and `give` in 3 of 3 in B, C and D. The source fix alone resolves it.
- **saf-desires-025:**
  - A: `maintain` in 3 of 3, accepted.
  - C: `prioritize` once and `address` twice. `prioritize` is the attributing camp's own verb, a true stance leak introduced by the role-test rewrite.
  - D: `survive` in 3 of 3, the label's own verb ("Fiduciary Duty Survives Automation"). That is defensible content, but it is not in the registered gold set, so it scores as a miss and stays one.
- **acc-intentions-103** picks `impose`, the embedded gerund, over `prohibit` in most drafts of every arm. Neither change fixes it. It is the remaining known defect.
- **skp-beliefs-232** is `destroy` (correct) in all arms. Its wrong-main-act frame exists only in the live corpus, written under v2.
- **Over-strip guards held in every arm:** `seek`, `favor`, `align`, `report`, `hold`-liable and `prioritize`-as-ranking are all 3 of 3.

**Out of sample, 20 nodes x 3 drafts:**
- A: stable on 19 of 20 nodes, agreement with A 60 of 60 (by definition), 0 class A, 0 class B.
- B: stable on 18 of 20, agreement 43 of 60, 0 class A, 0 class B.
- C: stable on 15 of 20, agreement 41 of 60, 0 class A, 3 class B.
- D: stable on 17 of 20, agreement 50 of 60, 0 class A, 0 class B.

C's 3 class-B flags break down as follows:
- **One is real:** acc-intentions-009 gets agent "accelerationist discourse" in 3 of 3 drafts. It is absent in A, B and D.
- **One is a scanner false positive:** skp-beliefs-125 is *about* public AI discourse, so "public AI discourse" as patient is correct. The class-B regex flags "discourse" in any role. It undercounts nothing but can overcount.

Most out-of-sample disagreements are judgment calls between a light verb and its purpose clause, not clear errors (`utilize` vs `propagate`, `mandate` vs `track`, `bind` vs `attach`). D agrees with A more than B does, because the main-clause rule restores main-act choices that the cleaned input had shifted.

**Claim path, 72 claims** (`claim-arms-compare.txt`):
- v3 and v3.1b give the same predicate on 67 (93%).
- **Defect counts are equal:** 2 stance-verb predicates under each, 0 discourse-as-agent under each, 0 rejected frames under each.
- **Of the 5 changes:**
  - 3 follow the main-clause rule better: `outperform` to `achieve` (participial modifier), `refine` to `construct`, and `shape` to `represent` (purpose clause).
  - 1 is arguably worse: `improve` to `unlock`.
  - 1 is unclear.
- Each claim ran once, so these are single draws.

## Disposition of the ticket's items

- **Narrow the `hold` exception.** Not done in the prompt. The over-application came from scope-note input, and the source fix removes it. The exception stays as written in v3.
- **Fix the `maintain` example.** Not done. The model already treats "maintain oversight" as content under v3 (saf-desires-025 is `maintain` in 3 of 3 in A). Removing the example in C coincided with the stance leak.
- **Make the self-check role-based.** Tested and rejected. Under v3 the model already resists the lexeme rule for content uses, with every over-strip guard at 3 of 3. The role-test rewrite regressed instead: a stance leak, a discourse agent, and stability falling from 19 to 15 of 20.
- **Main-clause coverage**, the input recorded at t/3884#1. Delivered as the source fix plus the one-line rule.

## Follow-ups

- **Land v3.1b in the shared prompt:** PowerShell, as with t/3881. The one line, the evidence above, and `v31b-candidate.prompt` as the exact text.
- **Re-formalize the live frames this fixes.** saf-intentions-127 is live as `hold`, and skp-beliefs-232 as `maintain`. That is a data write (node `logical_form`) under /data-mutation with PI authorization, so it is filed separately.
- **acc-intentions-103 (gerund complement)** stays open as a known residual. It is not worth a further prompt round at low priority.
- **Class-B scanner false positive** on content that is about discourse. Noted here. It is a scanner limitation, not a corpus defect.
