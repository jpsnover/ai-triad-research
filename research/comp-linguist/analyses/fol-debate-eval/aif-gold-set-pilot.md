# AIF gold set: pilot double-annotation (t/3587 / build item B1)

**Author:** Computational Linguist
**Status:** pilot (1 of 3 sample sessions). t/3587 stays In Progress; this is the first reliability result and the validated-and-revised codebook, not the complete gold set.
**Purpose:** the AIF sample evidence was single-annotator first-pass (`fol-debate-sample-findings.md` §70). This establishes the double-annotation method, a first inter-annotator reliability number, and codebook v2, before any AIF crux metric anchors a threshold (CL metric-provenance discipline).

## Method

- **Unit:** each debate statement (turn). Session `7a75e42f` (New Mexico v. Meta), 10 statements.
- **Labels (binary per statement):** `concession`, `retained_hold`, `defeater`, `attributed_restatement`, `cross_agent_attack` (codebook §Codebook v1 below).
- **Annotators:** A = Computational Linguist; B = an independent agent given ONLY the codebook and the statement texts, blind to A's labels. A's labels were **frozen before B ran** (no post-hoc drift).
- **Caveat (load-bearing):** both annotators are LLM-based, as was the original single-annotator pass. This measures codebook operationalizability and cross-annotator consistency; it is **not** a human-validated gold set. A human adjudication pass (B1.5) is the recommended upgrade before any threshold anchors on these labels.

## Results

| Label | A positives | B positives | Agreement | Cohen's κ |
|---|---|---|---|---|
| **concession** | 2 | 2 | 100% | **1.000** |
| **retained_hold** | 2 | 2 | 100% | **1.000** |
| defeater | 0 | 0 | 100% | undefined (no instances) |
| attributed_restatement | 10 | 7 | 70% | 0.000 |
| cross_agent_attack | 10 | 9 | 90% | 0.000 |

**Overall raw cell agreement: 46/50 = 92.0%.** Four disagreements, all systematic (below).

### What the numbers mean

1. **The dialectical-scaffold moves are reliably identifiable.** `concession` and `retained_hold` reached **κ=1.0**: both annotators independently and exactly picked statements 4 and 7 (the *"Fine, engineers wrote the scroll on purpose… but it's a category error"* grant-then-reassert move). These are the moves AIF exists to capture, and they are the reliable ones. This is the load-bearing positive result.

2. **`defeater` had zero instances.** The explicit *"I would change if <X>"* marker did not appear in any of the 10 turns. The concession/hold pairs carry **no explicit defeater condition**. This corrects an assumption in the scoping design (`aif-scoping-design.md` §2), which modelled the defeater as an extractable `latent CA condition`. **Design consequence:** the latent-defeater signal is likely **inferred, not surface-extractable**, or is rarer than the scaffold framing suggested. Verify against the other two sessions before finalizing the B4 data-model.

3. **`attributed_restatement` and `cross_agent_attack` were too liberally defined (κ=0).** A marked both on all 10 turns; B distinguished pure rebuttals (no re-voicing) and the opening turn (no prior agent to attack). The κ of 0 is a **constant-rater artifact** (A had no variance), not random labeling: raw agreement stayed high (70% / 90%) and every disagreement runs the same direction. The fix is definitional, not procedural (codebook v2).

### The four disagreements and their adjudication

| idx | label | A | B | Adjudicated | Reason |
|---|---|---|---|---|---|
| 1 | cross_agent_attack | 1 | 0 | **0** | Opening turn; it attacks a framing but there is no prior agent's claim to attack. Cross-agent attack requires a target in a prior turn. |
| 2 | attributed_restatement | 1 | 0 | **0** | A rebuttal that does not re-voice the opponent's specific claim. Restatement requires re-voicing, not mere disagreement. |
| 5 | attributed_restatement | 1 | 0 | **0** | Same: fresh assertion rebutting voluntary-restraint, no re-voiced opponent claim. |
| 8 | attributed_restatement | 1 | 0 | **0** | Same: rebuts scale-nullifies-responsibility without re-voicing it. |

Adjudication favors B's stricter reading in all four. That is an honest finding: **annotator A / the codebook as written was too permissive** on the two near-ubiquitous labels. Codebook v2 tightens them.

## Codebook v1 (as run) and v2 (revised)

**v1 labels** (as given to both annotators): concession = explicit grant of an opponent point; retained_hold = grant-then-reassert; defeater = explicit would-change condition; attributed_restatement = restates the opponent's position; cross_agent_attack = direct attack on another agent's claim.

**v2 refinements (from the disagreements):**
- **attributed_restatement:** requires **re-voicing the opponent's specific claim or framing** (paraphrase or quote of what they said). A rebuttal that disagrees without re-voicing is `cross_agent_attack` only.
- **cross_agent_attack:** requires a **target claim in a prior turn** by another agent. An opening turn attacking a framing from the source/priming (no prior agent turn) is **not** cross-agent.
- **defeater:** unchanged, but note it is **empirically rare/absent**; do not assume an extractable surface marker.

## Adjudicated gold labels (session 7a75e42f)

| idx | speaker | conc | hold | def | attr | ca |
|---|---|---|---|---|---|---|
| 1 | acc | 0 | 0 | 0 | 1 | 0 |
| 2 | saf | 0 | 0 | 0 | 0 | 1 |
| 3 | skp | 0 | 0 | 0 | 1 | 1 |
| 4 | acc | 1 | 1 | 0 | 1 | 1 |
| 5 | saf | 0 | 0 | 0 | 0 | 1 |
| 6 | skp | 0 | 0 | 0 | 1 | 1 |
| 7 | acc | 1 | 1 | 0 | 1 | 1 |
| 8 | saf | 0 | 0 | 0 | 0 | 1 |
| 9 | acc | 0 | 0 | 0 | 1 | 1 |
| 10 | saf | 0 | 0 | 0 | 1 | 1 |

The sustained crux is one CA cluster: harm deliberately-engineered (saf/skp) vs stochastic-emergent (acc), returned to at statements 3, 4, 6, 7, 10.

## Remaining B1 work (t/3587 stays In Progress)

1. Apply **codebook v2** to the other two sample sessions (`b45f82f7`, 8 turns; `cb5c96e3`, 9 turns), double-annotated, for the full 27-turn set.
2. Confirm the **defeater-absence** finding across all three sessions (if defeater is genuinely near-zero, the B4 data-model should treat the latent CA condition as inferred, not a required field).
3. **Human adjudication pass (B1.5)** on the merged disagreements before any AIF metric anchors a threshold.
4. Commit the merged gold set + this provenance record as the metric-provenance anchor (per CL discipline), then B1 is done and B2/B5 can rely on it.

## Provenance note

Session observed (real run). Annotation double-blind between two LLM annotators; not human-validated. Method and both raw annotation passes are the provenance record. Do not let any number here anchor a threshold until the human adjudication pass (B1.5) runs.
