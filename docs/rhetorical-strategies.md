# Rhetorical Strategies

The `rhetorical_strategy` field in a taxonomy node's `GraphAttributes` identifies
the persuasive technique or argumentative approach the position employs. A single
node may use more than one strategy (stored as a comma-separated string).

These strategies were assigned by an LLM during attribute extraction
(`Invoke-AttributeExtraction`) and can be viewed with:

```powershell
(Get-Tax -Id 'acc-desires-001').GraphAttributes.rhetorical_strategy
```

---

## Analogical Reasoning

**Arguing by comparison.** The position draws a parallel between AI and some other
domain, technology, historical event, or natural phenomenon to make its case more
intuitive. The analogy transfers credibility or alarm from the familiar domain to
the AI context.

*Example pattern:* "AI alignment is like trying to steer a rocket mid-flight" or
"Large models are the new electricity."

**Frequency:** Most common strategy (74 nodes). Appears across all four POVs, with
safetyist and accelerationist nodes using it most heavily.

---

## Appeal to Authority

**Invoking credible sources.** The position leans on the reputation, expertise, or
institutional standing of named individuals, organizations, or research programs to
support its claims. The persuasive force comes from *who* says it rather than the
underlying evidence alone.

*Example pattern:* "Leading researchers at DeepMind warn that..." or "As the OECD
framework recommends..."

**Frequency:** Rare (2 nodes). Appears in safetyist and cross-cutting contexts.

---

## Appeal to Evidence

**Letting data lead.** The position foregrounds empirical results, benchmark scores,
experimental findings, or statistical trends as its primary warrant. The rhetorical
move is to present the argument as following directly from observable facts rather
than values or speculation.

*Example pattern:* "Scaling-law experiments show a power-law relationship between
compute and capability" or "Survey data indicate that 60% of researchers expect..."

**Frequency:** 19 nodes. Distributed across all POVs, with accelerationist and
skeptic nodes using it most.

---

## Cost-Benefit Analysis

**Weighing trade-offs explicitly.** The position frames the question as a balance
sheet: what is gained vs. what is risked, what is spent vs. what is returned. It
invites the audience to evaluate the position through an economic or utilitarian
lens rather than an absolute moral one.

*Example pattern:* "The cost of pausing AI research exceeds the expected harm from
continued development" or "Regulation imposes compliance costs that may outweigh
the safety gains."

**Frequency:** 18 nodes. Evenly spread across all four POVs, reflecting its use as
a framing device by both proponents and critics of AI acceleration.

---

## Dismissive Framing

**Minimizing the opposing view.** The position characterizes alternative
perspectives as naive, overwrought, uninformed, or unworthy of serious engagement.
Rather than rebutting arguments on their merits, it questions whether they deserve
attention at all.

*Example pattern:* "These doomsday scenarios belong in science fiction, not policy
discussions" or "Critics who haven't built systems shouldn't lecture those who have."

**Note:** `dismissive_framing` and `dismissive` are treated as the same strategy.
Both signal a rhetorical posture that deflects rather than engages.

**Frequency:** 2 nodes. Appears in accelerationist and cross-cutting contexts.

---

## Inevitability Framing

**Treating the outcome as predetermined.** The position presents a particular
trajectory (usually rapid AI progress) as unstoppable, removing choice from the
equation. The rhetorical effect is to shift the debate from *whether* to *how* and
to make opposition seem futile.

*Example pattern:* "AI will transform every industry within a decade — the only
question is whether we lead or follow" or "Superintelligence is coming regardless
of what any single government does."

**Frequency:** 11 nodes. Overwhelmingly accelerationist (10 of 11), making this
the most POV-concentrated strategy in the taxonomy.

---

## Interpretive Lens

**Offering a framework for reading the landscape.** Rather than making a direct
empirical or normative claim, the position provides a conceptual vocabulary or
analytical frame that shapes how the audience understands other claims. It is
meta-argumentative — it tells you *how to think about* the debate, not what
conclusion to reach.

*Example pattern:* "We should view AI capabilities as a spectrum of tool-use
proficiency" or "The real axis of disagreement is not safety vs. speed but
centralization vs. distribution."

**Frequency:** 1 node (accelerationist context). Rare because most nodes make
direct claims rather than framing moves.

---

## Moral Imperative

**Invoking duty or ethical obligation.** The position argues that a particular
course of action is not merely advisable but morally required. Inaction, delay, or
the opposing position is cast as an ethical failure.

*Example pattern:* "We have a moral obligation to develop AI that can cure diseases
and end poverty" or "Deploying systems we cannot explain violates our duty to those
affected."

**Frequency:** 17 nodes. Concentrated in accelerationist and skeptic POVs, where
it anchors opposing value claims — accelerationists invoke the moral duty to build,
skeptics invoke the moral duty to question.

---

## Pragmatic

**Focusing on what works.** The position sidesteps theoretical debates in favor of
practical problem-solving. It appeals to implementability, real-world constraints,
and demonstrated results rather than ideological consistency.

*Example pattern:* "Instead of debating AGI timelines, we should fix the bias
problems in the systems already deployed" or "Whatever your theory, the bottleneck
is compute cost, not alignment research."

**Frequency:** 1 node (skeptic context). Rare as a standalone label because many
pragmatic arguments also register as cost-benefit analysis or appeal to evidence.

---

## Precautionary Framing

**Emphasizing downside risk.** The position argues that uncertainty itself is
reason for caution — the potential harms are severe enough that the burden of proof
falls on those who want to proceed, not those who want to wait. It inverts the
default from "safe until proven dangerous" to "dangerous until proven safe."

*Example pattern:* "Given the catastrophic potential, we should not deploy frontier
models until we can guarantee alignment" or "The asymmetry of outcomes demands a
precautionary stance."

**Frequency:** Second most common strategy (54 nodes). Heavily safetyist (32 of
54), making it the signature rhetorical move of the safety perspective.

---

## Reductio ad Absurdum

**Pushing the opposing view to its logical extreme.** The position takes a premise
from the opposing side and follows it to a conclusion so implausible or
unacceptable that the original premise must be rejected. The rhetorical force comes
from showing internal inconsistency rather than providing external evidence.

*Example pattern:* "If we truly believed AI could never be dangerous, we wouldn't
bother testing it at all" or "Taken to its logical conclusion, the 'move fast'
position implies we should also skip clinical trials for AI-designed drugs."

**Frequency:** 6 nodes. Split evenly between accelerationist and skeptic POVs,
where each side uses it to undermine the other's core assumptions.

---

## Structural Critique

**Questioning the system, not the claim.** The position argues that the problem
lies not in any particular AI capability or risk but in the institutions, incentive
structures, power dynamics, or economic systems surrounding AI development. It
shifts the frame from technical to political or sociological.

*Example pattern:* "The real danger isn't superintelligence — it's the
concentration of AI power in a handful of corporations" or "Safety research is
underfunded not because it's unimportant but because the incentive structure
rewards capability gains."

**Frequency:** 22 nodes. Most common in skeptic (10) and accelerationist (7) POVs,
where skeptics critique existing power structures and accelerationists critique
regulatory structures that slow progress.

---

## Techno-Optimism

**Trusting technology to solve its own problems.** The position expresses
confidence that continued technical progress will address current risks, that
innovation reliably outpaces harm, and that the historical trajectory of technology
supports an optimistic default. It is a dispositional stance as much as an
argument.

*Example pattern:* "Every wave of technology has created more prosperity than it
destroyed" or "The best path to AI safety is more capable AI, not less."

**Frequency:** 29 nodes. Overwhelmingly accelerationist (20 of 29), making it,
along with inevitability framing, a defining rhetorical signature of that POV.

---

## Distribution Summary

| Strategy               | Count | Primary POV(s)                    |
|------------------------|------:|-----------------------------------|
| Analogical Reasoning   |    74 | Safetyist, Accelerationist        |
| Precautionary Framing  |    54 | Safetyist                         |
| Techno-Optimism        |    29 | Accelerationist                   |
| Structural Critique    |    22 | Skeptic, Accelerationist          |
| Appeal to Evidence     |    19 | Accelerationist, Skeptic          |
| Cost-Benefit Analysis  |    18 | All POVs equally                  |
| Moral Imperative       |    17 | Accelerationist, Skeptic          |
| Inevitability Framing  |    11 | Accelerationist                   |
| Reductio ad Absurdum   |     6 | Accelerationist, Skeptic          |
| Appeal to Authority    |     2 | Safetyist, Cross-cutting          |
| Dismissive Framing     |     2 | Accelerationist, Cross-cutting    |
| Interpretive Lens      |     1 | Accelerationist                   |
| Pragmatic              |     1 | Skeptic                           |
