// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Descriptions of epistemic types used in taxonomy graph attributes.
// Source: docs/epistemic-types.md

export interface AttributeInfoLink {
  label: string;
  url: string;
}

export interface AttributeInfo {
  label: string;
  summary: string;
  example: string;
  frequency: string;
  links?: AttributeInfoLink[];
}

export const EPISTEMIC_TYPES: Record<string, AttributeInfo> = {
  strategic_recommendation: {
    label: 'Strategic Recommendation',
    summary:
      'Proposing a course of action. The position advocates for a specific policy, institutional response, or behavioral change. It says "we should do X" rather than "X is true." The claim\'s validity depends on both the accuracy of its premises and the feasibility of its prescribed action.',
    example:
      '"Governments should establish regulatory sandboxes for frontier AI systems" or "Labs should adopt mandatory red-teaming before deployment."',
    frequency:
      'Most common type (43 nodes). Distributed across all POVs, with safetyist nodes producing the most (16), followed by accelerationist (13) and skeptic (10).',
  },
  empirical_claim: {
    label: 'Empirical Claim',
    summary:
      'Asserting something observable about the world. The position makes a factual claim that is, in principle, verifiable through evidence, measurement, or experiment. It says "X is the case" and can be evaluated against data.',
    example:
      '"Scaling laws show a predictable relationship between compute and model capability" or "AI-generated code contains security vulnerabilities at a higher rate than human-written code."',
    frequency:
      'Second most common (33 nodes). Evenly distributed across all four POVs, reflecting the universal need to ground arguments in observable facts.',
  },
  interpretive_lens: {
    label: 'Interpretive Lens',
    summary:
      'Providing a framework for understanding. The position offers a conceptual vocabulary, analytical frame, or way of categorizing the AI landscape. Rather than making a testable claim, it shapes how the audience perceives and organizes other claims. It is meta-analytical.',
    example:
      '"The AI debate is best understood as a tension between centralization and democratization" or "Existential risk from AI is fundamentally a governance problem, not a technical one."',
    frequency:
      '17 nodes. Concentrated in cross-cutting (8) and accelerationist (7) POVs, where framing the debate itself is a central activity.',
  },
  predictive: {
    label: 'Predictive',
    summary:
      'Forecasting future states. The position makes a claim about what will happen, when, or under what conditions. Its validity can only be assessed after the predicted timeframe passes. Predictions range from near-term extrapolations to long-term speculation.',
    example:
      '"AGI will arrive within the next decade" or "Automation will displace 30% of current jobs by 2035."',
    frequency:
      '17 nodes. Distributed across accelerationist (6), safetyist (6), and cross-cutting (4). Skeptics rarely make predictions (1 node).',
  },
  normative_prescription: {
    label: 'Normative Prescription',
    summary:
      'Declaring what ought to be. The position makes a moral or ethical claim about values, duties, or rights. Unlike strategic recommendations (which are practical), normative prescriptions are grounded in ethical frameworks. They say "X is right" or "we have a duty to do Y."',
    example:
      '"Every person has a right to understand the AI systems that affect their life" or "The potential to end suffering creates a moral obligation to accelerate AI development."',
    frequency:
      '16 nodes. Spread across accelerationist (6), skeptic (5), and safetyist (4), where each perspective invokes different ethical frameworks.',
  },
  definitional: {
    label: 'Definitional',
    summary:
      'Establishing what terms mean. The position defines, categorizes, or distinguishes key concepts. It shapes the debate by determining what counts as "AI safety," "alignment," "AGI," or other contested terms. Definitional claims are rarely falsifiable but have outsized influence on subsequent arguments.',
    example:
      '"Artificial general intelligence means a system that can perform any intellectual task a human can" or "AI safety encompasses reliability, robustness, and alignment."',
    frequency:
      'Least common (5 nodes). Concentrated in cross-cutting (2) and safetyist (2) contexts, where boundary-drawing is most important.',
  },
};
