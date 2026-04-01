// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

export interface DebateTopic {
  id: number;
  theme: string;
  type: 'Assertion' | 'Question' | 'Issue';
  proposition: string;
}

export const DEBATE_TOPICS: DebateTopic[] = [
  { id: 1, theme: "The Physics Constraint", type: "Assertion", proposition: "The physical limits of power grids, cooling capacity, and silicon yields will halt AI scaling long before algorithmic breakthroughs yield AGI." },
  { id: 2, theme: "The Regulatory Moat", type: "Question", proposition: "Is AI safety regulation a necessary guardrail against existential catastrophe, or a legally codified monopoly designed to crush open-source competition?" },
  { id: 3, theme: "The Epistemology of Scaling", type: "Issue", proposition: "The gap between curve-fitting and cognition. Are highly scaled LLMs developing emergent, alien world-models, or are they brittle stochastic parrots hitting the ceiling of next-token prediction?" },
  { id: 4, theme: "The Agentic Threat", type: "Assertion", proposition: "Deploying autonomous AI agents into real-world infrastructure is an uncontrollable systemic risk masquerading as a post-scarcity economic engine." },
  { id: 5, theme: "The Democratization Paradox", type: "Question", proposition: "Does open-sourcing frontier model weights distribute power and defend against centralized tyranny, or does it permanently proliferate the blueprints for digital weapons of mass destruction?" },
  { id: 6, theme: "The Geopolitical Bluff", type: "Issue", proposition: "The validity of the AI arms race. Is out-computing foreign adversaries a genuine national security imperative, or a manufactured panic designed to extract government subsidies?" },
  { id: 7, theme: "The Alignment Smokescreen", type: "Assertion", proposition: "\"Alignment\" is not a solvable mathematical problem; it is a philosophical smokescreen used to enforce the specific political and cultural biases of tech executives onto global infrastructure." },
  { id: 8, theme: "The Automation of Agency", type: "Question", proposition: "Will delegating cognitive labor to machines elevate humanity to a higher evolutionary tier, or permanently atrophy our agency, intellect, and economic utility?" },
  { id: 9, theme: "The Definition of Ruin", type: "Issue", proposition: "Identifying the actual worst-case scenario. Are we hurtling toward literal human extinction, or merely the devastating financial collapse of a massively overcapitalized tech bubble?" },
  { id: 10, theme: "The Burden of Proof", type: "Assertion", proposition: "The burden of proof rests entirely on those claiming current architectures will scale to AGI, not on those demanding proof of safety or those predicting an imminent plateau." },
  { id: 11, theme: "The Value Alignment Impossibility", type: "Assertion", proposition: "Universal human values do not exist, making mathematical alignment a fool's errand that is either doomed to enforce tyranny or guaranteed to fail entirely." },
  { id: 12, theme: "The Interpretability Delusion", type: "Issue", proposition: "Mechanistic interpretability. Is it a realistic path to guaranteeing model safety, a temporary band-aid, or fundamentally impossible to achieve for trillion-parameter black boxes?" },
  { id: 13, theme: "The Data Wall Exhaustion", type: "Question", proposition: "Will synthetic data generation unlock infinite scaling, inevitably degrade models through algorithmic collapse, or merely hit a hard ceiling once high-quality human data is depleted?" },
  { id: 14, theme: "The Labor Market Threshold", type: "Assertion", proposition: "AGI is not required to break the labor market; narrow, cheap, specialized models are already sufficient to cause structural unemployment that governments are entirely unprepared for." },
  { id: 15, theme: "The Sentience Distraction", type: "Issue", proposition: "Sentience in silicon. Is the debate over machine consciousness a vital ethical precursor to AGI rights, a philosophical trap distracting from immediate safety risks, or entirely absurd anthropomorphism?" },
  { id: 16, theme: "The Decentralization Fallacy", type: "Question", proposition: "Can cryptographic incentives and decentralized compute networks actually democratize AI, or do the sheer capital requirements of frontier models mandate an oligopoly regardless of the underlying architecture?" },
  { id: 17, theme: "The Intellectual Property Collapse", type: "Assertion", proposition: "Generative AI is not a paradigm shift in human creativity; it is the largest automated intellectual property theft in history, destined to collapse under its own legal liabilities." },
  { id: 18, theme: "The Cyber-Warfare Asymmetry", type: "Issue", proposition: "Asymmetric threat vectors. Will AI democratize offense faster than defense, necessitate an autonomous AI defense grid, or prove too unreliable for actual state-level military deployment?" },
  { id: 19, theme: "The Intelligence Explosion Myth", type: "Question", proposition: "Is recursive self-improvement a mathematical certainty once a threshold is crossed, a dangerous myth ignoring real-world friction, or physically impossible due to diminishing returns in algorithmic efficiency?" },
  { id: 20, theme: "The Anthropocentric Benchmark", type: "Assertion", proposition: "Evaluating AI through human benchmarks fundamentally misunderstands the technology; we are either missing an emerging alien intelligence, failing to see the existential threat, or over-indexing on statistical mimicry." },
];
