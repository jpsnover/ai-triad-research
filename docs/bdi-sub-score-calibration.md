# BDI Sub-Score Calibration Guide

**Audience:** Researchers using the diagnostics window to understand claim strength scores, and anyone editing the belief sub-score sliders to inject domain expertise.  
**Related docs:** `subsystem-debate-engine.md`, `qbaf-explainability-review.md`, `reading-the-argument-network.md`, `utility-function-and-lookahead.md`

---

## What BDI sub-scores are

Every I-node (claim) in the Argument Network carries a **BDI category** — Belief, Desire, or Intention — drawn from the BDI (Belief-Desire-Intention) model of rational agents. The category determines what kind of claim is being made:

- **Belief** — an assertion about how the world is. Factual, empirical, or descriptive. *"Current frontier AI systems require enormous compute to train."*
- **Desire** — an assertion about how the world should be. Normative, value-laden, goal-expressing. *"AI development should be governed by international treaty."*
- **Intention** — an assertion about what will be done. Action-oriented, mechanism-specifying, implementation-committing. *"We will implement mandatory compute audits through the BIS."*

Each category is evaluated on three **sub-scores** specific to that type of claim. The sub-scores combine into the claim's `base_strength`, which is the starting QBAF weight before edge propagation.

---

## The nine sub-scores

### Belief sub-scores

Belief claims are factual assertions. The three sub-scores evaluate how well the claim holds up to epistemic scrutiny.

**`evidence_quality`** — How well-supported is this claim by cited evidence?
- ≥ 0.7: strong evidence cited — specific studies, data, or authoritative sources directly support the claim
- 0.4–0.69: partial or indirect evidence — the claim is plausible but the cited evidence is tangential or not conclusive
- < 0.4: unsupported or speculative — claim is asserted without evidence, or evidence cited doesn't support it

**`source_reliability`** — How credible and authoritative are the sources cited?
- ≥ 0.7: authoritative, peer-reviewed, or official sources
- 0.4–0.69: mixed or secondary sources — credible but not the strongest available
- < 0.4: no sources, or sources with known reliability issues

**`falsifiability`** — Can this claim be tested or disproven with observable evidence?
- ≥ 0.7: clearly testable with specific criteria — the claim has identifiable conditions under which it would be false
- 0.4–0.69: partially testable — some testable component but also unfalsifiable elements
- < 0.4: unfalsifiable or purely theoretical — no conceivable evidence could disprove it

`base_strength` for Belief claims = average of the three sub-scores.

---

### Desire sub-scores

Desire claims are normative assertions about what should happen. The three sub-scores evaluate the normative quality of the claim.

**`values_grounding`** — Is this value claim explicitly grounded in stated values or principles?
- ≥ 0.7: explicitly ties to named values, ethical frameworks, or stated principles — *"because human autonomy requires..."*
- 0.4–0.69: implicitly value-laden but not explicitly grounded — the claim expresses a value without naming it
- < 0.4: value claim without clear normative basis — assertion without ethical warrant

**`tradeoff_acknowledgment`** — Does the claim acknowledge competing tradeoffs or costs?
- ≥ 0.7: explicitly names costs, risks, or competing values — *"while this would slow deployment, it would..."*
- 0.4–0.69: mentions tradeoffs in passing without developing them
- < 0.4: presents the position as cost-free or ignores obvious downsides

**`precedent_citation`** — Does the claim cite relevant precedent, norms, or established practice?
- ≥ 0.7: cites specific precedents, case law, or established international norms
- 0.4–0.69: references general precedent without specifics
- < 0.4: no precedent cited — purely aspirational with no grounding in existing practice

`base_strength` for Desire claims = average of the three sub-scores.

---

### Intention sub-scores

Intention claims specify actions, mechanisms, or implementation paths. The three sub-scores evaluate how actionable and realistic the claim is.

**`mechanism_specificity`** — How specific is the proposed mechanism, action, or implementation path?
- ≥ 0.7: concrete steps, named actors, defined timelines — *"the BIS would require quarterly compute reports from facilities above 10^25 FLOP/s"*
- 0.4–0.69: general approach without implementation detail — *"governments should regulate compute"*
- < 0.4: vague aspiration with no actionable mechanism — *"we need better AI governance"*

**`scope_bounding`** — Are the boundaries, limitations, and applicability conditions defined?
- ≥ 0.7: explicitly defines where the proposal applies and where it doesn't — includes carve-outs, thresholds, jurisdictional scope
- 0.4–0.69: some boundaries mentioned but incomplete
- < 0.4: unbounded claim with no defined limits — applies "everywhere" or "to all AI"

**`failure_mode_addressing`** — Does the claim address what could go wrong or how failures would be handled?
- ≥ 0.7: explicitly names failure scenarios and mitigations — *"if X fails, Y provides a backstop"*
- 0.4–0.69: acknowledges risk without specific mitigation — *"there are risks but they are manageable"*
- < 0.4: no consideration of failure modes — assumes the mechanism works as designed

`base_strength` for Intention claims = average of the three sub-scores.

---

## Why Belief sub-scores default to 0.5

The AI scoring for Belief sub-scores has low inter-rater reliability at Q-0 (the first calibration round, before any human adjustment):

| Sub-score | Q-0 calibration *r* |
|---|---|
| `evidence_quality` | −0.12 to 0.20 |
| `source_reliability` | −0.12 to 0.20 |
| `falsifiability` | −0.12 to 0.20 |

These correlation values mean the AI's initial Belief sub-score assignments are barely better than chance compared to expert human ratings. The reasons are structural: evaluating evidence quality requires knowing whether the cited evidence is actually good (which requires domain expertise the model may not have for niche claims), and evaluating falsifiability requires understanding what would count as disconfirmation (which the model often conflates with "is this claim uncertain?").

**The design response:** Belief sub-scores default to 0.5 at extraction. This produces a neutral `base_strength = 0.5` — the claim enters the QBAF with equal initial weight regardless of how evidence-laden it sounds. A human reviewer with domain expertise is expected to adjust the sliders in the INodeRow expanded view to reflect actual evidence quality.

This is intentional: it is better to start neutral and let humans calibrate than to propagate AI-assigned evidence scores that are systematically unreliable.

---

## Why Desire and Intention sub-scores are AI-scored

Desire and Intention sub-scores have meaningfully higher Q-0 calibration:

| Category | Sub-score | Q-0 calibration *r* |
|---|---|---|
| Desire | `values_grounding` | 0.65 |
| Desire | `tradeoff_acknowledgment` | 0.65 |
| Desire | `precedent_citation` | 0.65 |
| Intention | `mechanism_specificity` | 0.71 |
| Intention | `scope_bounding` | 0.71 |
| Intention | `failure_mode_addressing` | 0.71 |

These properties are more reliably detectable from the text itself: whether a claim names values, acknowledges tradeoffs, or specifies concrete mechanisms is largely a matter of what language is present in the claim — the model can score these from surface features with reasonable accuracy. Belief sub-scores require external knowledge; Desire and Intention sub-scores are more self-contained.

As a result, Desire and Intention sub-scores are assigned by the extraction model and not defaulted to 0.5. They still appear in the INodeRow slider view and can be adjusted, but they start from a meaningful AI-assigned value rather than a neutral placeholder.

---

## How base_strength feeds into QBAF

`base_strength` is the initial node weight in the QBAF graph — the claim's strength *before any attacks or supports are applied*. It sets the starting point for strength propagation:

1. A claim with `base_strength = 0.8` starts strong. It takes sustained, weighted attacks to push its `computed_strength` below 0.3 (the "defeated" threshold).
2. A claim with `base_strength = 0.3` starts weak. Even a single moderate attack can push it below the threshold.
3. A claim with `base_strength = 0.5` (the Belief default) is neutral — its fate depends entirely on whether it receives attacks or supports.

This means the Belief-score sliders in the diagnostics window are not cosmetic. Changing a Belief claim's slider values changes its `base_strength`, which propagates through the QBAF computation and changes `computed_strength` for every claim that has an edge relationship with it. The Argument Network tab reflects these changes live.

See `docs/qbaf-explainability-review.md` for the mathematical details of how strength propagation works.

---

## Using the sliders

In the diagnostics window, Belief I-nodes in the expanded INodeRow view show editable sliders for the three Belief sub-scores. The sliders are the mechanism for injecting domain expertise into the debate's formal record.

**When to adjust:**
- You know a cited source is authoritative (or retracted): adjust `source_reliability`
- A claim sounds falsifiable in language but isn't actually testable: lower `falsifiability`
- A claim is well-evidenced from your domain knowledge even if the model didn't detect it: raise `evidence_quality`

**What changes downstream:**
- `base_strength` is recomputed as the average of the adjusted sub-scores
- QBAF propagation reruns with the new base_strength
- `computed_strength` updates for the adjusted node and all nodes with edge relationships to it
- `position_strength` in the Utility tab updates accordingly — adjusting a strong agent claim up makes their utility rise; adjusting a weak claim down makes it fall further

**Desire and Intention sliders** are also editable but start from AI-assigned values rather than 0.5. Adjust these when the model's scoring clearly missed something — a claim that sounds like it specifies a mechanism but doesn't actually name any actors or timelines, or a value claim that sounds grounded but is actually circular.

---

## Relationship to confidence impact

When a debate's argument network is used to update taxonomy node confidence (visible in the Confidence Impact section of the Argument Network tab), the `base_strength` of attacking claims directly influences the magnitude of the confidence change.

A high-`base_strength` attack on a taxonomy node's associated claim produces a larger confidence drop in the node's `confidence_history` than a low-`base_strength` attack. This means Belief sub-score adjustments made in the diagnostics window can propagate all the way to the living taxonomy — a correction you make to a mis-scored evidence_quality slider can change whether the taxonomy considers a node's belief well-supported or contested.

The `robustness` field in the Confidence Impact trace (shown as a "2× confirmed" chip) indicates when a confidence change was driven by multiple independent high-`base_strength` claims, not just one — making it more resistant to reversal in subsequent debates.
