// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Descriptions of rhetorical strategies used in taxonomy graph attributes.
// Source: docs/rhetorical-strategies.md

export interface StrategyInfo {
  label: string;
  summary: string;
  example: string;
  frequency: string;
}

export const RHETORICAL_STRATEGIES: Record<string, StrategyInfo> = {
  analogical_reasoning: {
    label: 'Analogical Reasoning',
    summary:
      'Arguing by comparison. The position draws a parallel between AI and some other domain, technology, historical event, or natural phenomenon to make its case more intuitive. The analogy transfers credibility or alarm from the familiar domain to the AI context.',
    example:
      '"AI alignment is like trying to steer a rocket mid-flight" or "Large models are the new electricity."',
    frequency:
      'Most common strategy (74 nodes). Appears across all four POVs, with safetyist and accelerationist nodes using it most heavily.',
  },
  appeal_to_authority: {
    label: 'Appeal to Authority',
    summary:
      'Invoking credible sources. The position leans on the reputation, expertise, or institutional standing of named individuals, organizations, or research programs to support its claims. The persuasive force comes from who says it rather than the underlying evidence alone.',
    example:
      '"Leading researchers at DeepMind warn that..." or "As the OECD framework recommends..."',
    frequency:
      'Rare (2 nodes). Appears in safetyist and cross-cutting contexts.',
  },
  appeal_to_evidence: {
    label: 'Appeal to Evidence',
    summary:
      'Letting data lead. The position foregrounds empirical results, benchmark scores, experimental findings, or statistical trends as its primary warrant. The rhetorical move is to present the argument as following directly from observable facts rather than values or speculation.',
    example:
      '"Scaling-law experiments show a power-law relationship between compute and capability" or "Survey data indicate that 60% of researchers expect..."',
    frequency:
      '19 nodes. Distributed across all POVs, with accelerationist and skeptic nodes using it most.',
  },
  cost_benefit_analysis: {
    label: 'Cost-Benefit Analysis',
    summary:
      'Weighing trade-offs explicitly. The position frames the question as a balance sheet: what is gained vs. what is risked, what is spent vs. what is returned. It invites the audience to evaluate the position through an economic or utilitarian lens rather than an absolute moral one.',
    example:
      '"The cost of pausing AI research exceeds the expected harm from continued development" or "Regulation imposes compliance costs that may outweigh the safety gains."',
    frequency:
      '18 nodes. Evenly spread across all four POVs, reflecting its use as a framing device by both proponents and critics of AI acceleration.',
  },
  dismissive_framing: {
    label: 'Dismissive Framing',
    summary:
      'Minimizing the opposing view. The position characterizes alternative perspectives as naive, overwrought, uninformed, or unworthy of serious engagement. Rather than rebutting arguments on their merits, it questions whether they deserve attention at all.',
    example:
      '"These doomsday scenarios belong in science fiction, not policy discussions" or "Critics who haven\'t built systems shouldn\'t lecture those who have."',
    frequency:
      '2 nodes. Appears in accelerationist and cross-cutting contexts.',
  },
  dismissive: {
    label: 'Dismissive Framing',
    summary:
      'Minimizing the opposing view. The position characterizes alternative perspectives as naive, overwrought, uninformed, or unworthy of serious engagement. Rather than rebutting arguments on their merits, it questions whether they deserve attention at all.',
    example:
      '"These doomsday scenarios belong in science fiction, not policy discussions" or "Critics who haven\'t built systems shouldn\'t lecture those who have."',
    frequency:
      '2 nodes. Appears in accelerationist and cross-cutting contexts.',
  },
  inevitability_framing: {
    label: 'Inevitability Framing',
    summary:
      'Treating the outcome as predetermined. The position presents a particular trajectory (usually rapid AI progress) as unstoppable, removing choice from the equation. The rhetorical effect is to shift the debate from whether to how and to make opposition seem futile.',
    example:
      '"AI will transform every industry within a decade \u2014 the only question is whether we lead or follow" or "Superintelligence is coming regardless of what any single government does."',
    frequency:
      '11 nodes. Overwhelmingly accelerationist (10 of 11), making this the most POV-concentrated strategy in the taxonomy.',
  },
  interpretive_lens: {
    label: 'Interpretive Lens',
    summary:
      'Offering a framework for reading the landscape. Rather than making a direct empirical or normative claim, the position provides a conceptual vocabulary or analytical frame that shapes how the audience understands other claims. It is meta-argumentative \u2014 it tells you how to think about the debate, not what conclusion to reach.',
    example:
      '"We should view AI capabilities as a spectrum of tool-use proficiency" or "The real axis of disagreement is not safety vs. speed but centralization vs. distribution."',
    frequency:
      '1 node (accelerationist context). Rare because most nodes make direct claims rather than framing moves.',
  },
  moral_imperative: {
    label: 'Moral Imperative',
    summary:
      'Invoking duty or ethical obligation. The position argues that a particular course of action is not merely advisable but morally required. Inaction, delay, or the opposing position is cast as an ethical failure.',
    example:
      '"We have a moral obligation to develop AI that can cure diseases and end poverty" or "Deploying systems we cannot explain violates our duty to those affected."',
    frequency:
      '17 nodes. Concentrated in accelerationist and skeptic POVs, where it anchors opposing value claims \u2014 accelerationists invoke the moral duty to build, skeptics invoke the moral duty to question.',
  },
  pragmatic: {
    label: 'Pragmatic',
    summary:
      'Focusing on what works. The position sidesteps theoretical debates in favor of practical problem-solving. It appeals to implementability, real-world constraints, and demonstrated results rather than ideological consistency.',
    example:
      '"Instead of debating AGI timelines, we should fix the bias problems in the systems already deployed" or "Whatever your theory, the bottleneck is compute cost, not alignment research."',
    frequency:
      '1 node (skeptic context). Rare as a standalone label because many pragmatic arguments also register as cost-benefit analysis or appeal to evidence.',
  },
  precautionary_framing: {
    label: 'Precautionary Framing',
    summary:
      'Emphasizing downside risk. The position argues that uncertainty itself is reason for caution \u2014 the potential harms are severe enough that the burden of proof falls on those who want to proceed, not those who want to wait. It inverts the default from "safe until proven dangerous" to "dangerous until proven safe."',
    example:
      '"Given the catastrophic potential, we should not deploy frontier models until we can guarantee alignment" or "The asymmetry of outcomes demands a precautionary stance."',
    frequency:
      'Second most common strategy (54 nodes). Heavily safetyist (32 of 54), making it the signature rhetorical move of the safety perspective.',
  },
  reductio_ad_absurdum: {
    label: 'Reductio ad Absurdum',
    summary:
      'Pushing the opposing view to its logical extreme. The position takes a premise from the opposing side and follows it to a conclusion so implausible or unacceptable that the original premise must be rejected. The rhetorical force comes from showing internal inconsistency rather than providing external evidence.',
    example:
      '"If we truly believed AI could never be dangerous, we wouldn\'t bother testing it at all" or "Taken to its logical conclusion, the \'move fast\' position implies we should also skip clinical trials for AI-designed drugs."',
    frequency:
      '6 nodes. Split evenly between accelerationist and skeptic POVs, where each side uses it to undermine the other\'s core assumptions.',
  },
  structural_critique: {
    label: 'Structural Critique',
    summary:
      'Questioning the system, not the claim. The position argues that the problem lies not in any particular AI capability or risk but in the institutions, incentive structures, power dynamics, or economic systems surrounding AI development. It shifts the frame from technical to political or sociological.',
    example:
      '"The real danger isn\'t superintelligence \u2014 it\'s the concentration of AI power in a handful of corporations" or "Safety research is underfunded not because it\'s unimportant but because the incentive structure rewards capability gains."',
    frequency:
      '22 nodes. Most common in skeptic (10) and accelerationist (7) POVs, where skeptics critique existing power structures and accelerationists critique regulatory structures that slow progress.',
  },
  techno_optimism: {
    label: 'Techno-Optimism',
    summary:
      'Trusting technology to solve its own problems. The position expresses confidence that continued technical progress will address current risks, that innovation reliably outpaces harm, and that the historical trajectory of technology supports an optimistic default. It is a dispositional stance as much as an argument.',
    example:
      '"Every wave of technology has created more prosperity than it destroyed" or "The best path to AI safety is more capable AI, not less."',
    frequency:
      '29 nodes. Overwhelmingly accelerationist (20 of 29), making it, along with inevitability framing, a defining rhetorical signature of that POV.',
  },
};
