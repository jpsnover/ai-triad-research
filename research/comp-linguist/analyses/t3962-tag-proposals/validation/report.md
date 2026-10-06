# Skeptic tag proposals: blind validation report

**Ticket:** t/3962, step 2. **Date:** 2026-10-06. **Method:** pre-registered in t/3962#8 before any label was compared.
**Proposals:** prompt v1, gemini-3.8-flash, temperature 0, all 372 Skeptic nodes at data `e4095258`, 0 failures.
**Sample:** 60 nodes, stratified by proposed label (critical 18, both 18, institutional 18, untagged 6) and spread over category (B 22, I 20, D 18). The 12 dry-run nodes are excluded.
**Annotators:** CL Main and CL.Investigate1, each blind to the proposals and to each other.

**Verdict: PASS.**

## Agreement per label

Each tag is scored as a yes/no judgment per node. κ is given only where both raters have at least 5 positives (t/3587).

| Label | Pair | Agreement | Positives (A / B) | κ |
|---|---|---|---|---|
| critical | annotator vs annotator | 49/60 = 0.817 | 33 / 38 | 0.62 |
| critical | **consensus vs model** | **48/49 = 0.980** | 30 / 31 | 0.96 |
| institutional | annotator vs annotator | 53/60 = 0.883 | 35 / 40 | 0.75 |
| institutional | **consensus vs model** | **47/53 = 0.887** | 34 / 34 | 0.75 |
| untagged | annotator vs annotator | 56/60 = 0.933 | 8 / 4 | (fewer than 5 positives) |
| untagged | consensus vs model | 55/56 = 0.982 | 4 / 3 | (fewer than 5 positives) |

- **Exact tag-set agreement:** the two annotators agree on 46/60; the model matches both on 39/60.
- **Pass criterion:** model-vs-consensus agreement must be ≥ 0.80 on every label with ≥ 5 consensus positives, and neither annotator may be constant on any label. Critical (0.98) and institutional (0.887) pass. Untagged has 4 consensus positives, so it is reported but not gated. No annotator is constant on any label.

## Error analysis

- **No critical over-assignment.** The dry run raised it as a risk, and the data rules it out: the model tags 36 critical; the annotators tag 33 and 38.
- **Institutional: the 6 misses run both ways (3 and 3).**
  - **The model missed shared ground** on desires-062, desires-066 and intentions-153. It tagged them critical only, while both annotators gave both tags.
  - **The model tagged both where both annotators gave only critical:** desires-075 and intentions-148.
  - **intentions-167** (prompt-worm propagation) is a technical-mechanism node. Both annotators left it untagged; the model tagged it institutional.
- **Technical-mechanism nodes** (an attack method, a benchmarking or probing technique, build tooling) are where raters disagree most about untagged versus tagged. They are also the nodes most likely to be **misplaced in the Skeptic camp**, a data-quality question separate from tagging.

## Caveats

- **Stratified sample.** It over-represents the smaller labels, especially untagged, by design. The agreement rates are per-label estimates, not population-weighted corpus accuracy.
- **Not fully blind on the untagged stratum.** CL Main saw the model's rationales for the 6 untagged nodes before annotating, so CL.Investigate1's labels are the blind ones there.
- **Confidence does not discriminate.** Model confidence ranges only from 0.75 to 0.95, which makes it a weak sort key for the review queue.

## Resulting proposed split (all 372 nodes, before editor review)

critical 145 (39%), critical + institutional 129 (35%), institutional 92 (25%), untagged 6 (2%).
