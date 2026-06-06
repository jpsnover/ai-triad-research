// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

export const DIMENSION_LABELS: Record<string, string> = {
  crux_density: 'Crux Density',
  evidence_coverage: 'Evidence',
  bdi_heterogeneity: 'BDI Balance',
  abstraction_level: 'Abstraction',
  situation_activation: 'Situations',
  conditionality: 'Conditionality',
  mechanism: 'Mechanism',
  stakeholder: 'Stakeholders',
  tension: 'Tension',
  scope: 'Scope',
  actor_specificity: 'Actors',
  decision_proximity: 'Decision Prox.',
  constituency_impact: 'Constituency',
};

export const DIMENSION_TOOLTIPS: Record<string, string> = {
  crux_density: 'POV balance — do all three perspectives (accelerationist, safetyist, skeptic) have nodes activated by this topic?\n\nGood: "Should AI development require mandatory safety audits before deployment?" activates nodes across all three POVs evenly.',
  evidence_coverage: 'Evidence richness — do the activated taxonomy nodes have supporting evidence entries (citations, data)?\n\nGood: "What does the empirical record show about algorithmic bias in hiring?" maps to well-evidenced nodes with real studies.',
  bdi_heterogeneity: 'BDI category spread — does the topic engage Beliefs, Desires, and Intentions, not just one category?\n\nGood: "How should regulators balance innovation incentives with safety mandates?" touches beliefs about risk, desires for growth, and concrete policy intentions.',
  abstraction_level: 'Goldilocks granularity — is the topic neither too broad (activating hundreds of nodes) nor too narrow (activating only a handful)?\n\nGood: "Should foundation model developers be liable for downstream harms?" — specific enough to focus debate, broad enough to sustain multiple rounds.',
  situation_activation: 'Situational grounding — does the topic activate shared cross-cutting or situation nodes that anchor the debate in concrete contexts?\n\nGood: "In the wake of deepfake election interference, what guardrails should platforms adopt?" activates situation nodes about elections and misinformation.',
  conditionality: 'Conditional framing — does the topic specify conditions under which different answers apply, rather than asking a binary yes/no question?\n\nGood: "Under what conditions should open-source AI models require licensing?" vs. bad: "Should AI be regulated?"',
  mechanism: 'Mechanism focus — does the topic ask about causal pathways and processes rather than just outcomes?\n\nGood: "Through what institutional mechanisms can international AI governance achieve compliance?" vs. bad: "Will AI governance work?"',
  stakeholder: 'Stakeholder breadth — does the topic name multiple actors with distinct roles and distributed responsibility?\n\nGood: "How should developers, regulators, and civil society actors share responsibility for AI safety?" vs. bad: "Should tech companies self-regulate?"',
  tension: 'Tension acknowledgment — does the topic explicitly name a trade-off or invite meta-level disagreement?\n\nGood: "How should policymakers navigate the tension between AI innovation speed and precautionary safety requirements?" surfaces a genuine dilemma.',
  scope: 'Scope boundedness — does the topic specify concrete artifacts, timeframes, or domains rather than remaining open-ended?\n\nGood: "Should the EU AI Act\'s risk classification framework be adopted as a global standard by 2030?" vs. bad: "What should AI policy look like?"',
  actor_specificity: 'Actor specificity (policymaker) — does the topic name specific actors, agencies, or institutions rather than abstract entities?\n\n0 = abstract ("stakeholders"), 1 = general types ("regulators"), 2 = named actors ("the FTC")',
  decision_proximity: 'Decision proximity (policymaker) — how close is the topic to a pending policy decision or action?\n\n0 = theoretical, 1 = general governance, 2 = pending action (named bill, rulemaking)',
  constituency_impact: 'Constituency impact (policymaker) — does the topic identify specific affected groups?\n\n0 = no groups named, 1 = general population, 2 = specific constituencies',
};

export const RATING_COLORS: Record<string, string> = {
  strong: '#16a34a',
  fair: '#d97706',
  weak: '#dc2626',
};
