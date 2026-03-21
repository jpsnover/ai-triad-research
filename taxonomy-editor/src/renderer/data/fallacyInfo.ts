// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Fallacy catalog for the Graph Attributes panel.
// Each entry maps a fallacy key (as returned by Find-PossibleFallacy)
// to its display name, Wikipedia URL, and brief description.

export interface FallacyEntry {
  label: string;
  description: string;
  category: 'informal' | 'formal' | 'cognitive_bias';
  wikiUrl: string;
}

export const FALLACY_CATALOG: Record<string, FallacyEntry> = {
  ad_hominem: {
    label: 'Ad Hominem',
    description: 'Attacking the person making the argument rather than the argument itself.',
    category: 'informal',
    wikiUrl: 'https://en.wikipedia.org/wiki/Ad_hominem',
  },
  appeal_to_authority: {
    label: 'Appeal to Authority',
    description: 'Using an authority figure\'s opinion as evidence, especially when the authority is not an expert in the relevant field.',
    category: 'informal',
    wikiUrl: 'https://en.wikipedia.org/wiki/Argument_from_authority',
  },
  appeal_to_consequences: {
    label: 'Appeal to Consequences',
    description: 'Arguing that something must be true (or false) because of its desirable (or undesirable) consequences.',
    category: 'informal',
    wikiUrl: 'https://en.wikipedia.org/wiki/Appeal_to_consequences',
  },
  appeal_to_emotion: {
    label: 'Appeal to Emotion',
    description: 'Manipulating emotions rather than using valid reasoning to win an argument.',
    category: 'informal',
    wikiUrl: 'https://en.wikipedia.org/wiki/Appeal_to_emotion',
  },
  appeal_to_fear: {
    label: 'Appeal to Fear',
    description: 'Using fear to influence acceptance of a conclusion rather than providing evidence.',
    category: 'informal',
    wikiUrl: 'https://en.wikipedia.org/wiki/Appeal_to_fear',
  },
  appeal_to_nature: {
    label: 'Appeal to Nature',
    description: 'Arguing that something is good because it is natural, or bad because it is unnatural.',
    category: 'informal',
    wikiUrl: 'https://en.wikipedia.org/wiki/Appeal_to_nature',
  },
  appeal_to_novelty: {
    label: 'Appeal to Novelty',
    description: 'Arguing that something is better simply because it is new or modern.',
    category: 'informal',
    wikiUrl: 'https://en.wikipedia.org/wiki/Appeal_to_novelty',
  },
  appeal_to_popularity: {
    label: 'Appeal to Popularity',
    description: 'Arguing that something is true or good because many people believe it or do it.',
    category: 'informal',
    wikiUrl: 'https://en.wikipedia.org/wiki/Argumentum_ad_populum',
  },
  appeal_to_tradition: {
    label: 'Appeal to Tradition',
    description: 'Arguing that something is right because it has always been done that way.',
    category: 'informal',
    wikiUrl: 'https://en.wikipedia.org/wiki/Appeal_to_tradition',
  },
  argument_from_analogy: {
    label: 'Argument from Analogy (Weak)',
    description: 'Drawing a conclusion based on an analogy that is too weak or dissimilar to support it.',
    category: 'informal',
    wikiUrl: 'https://en.wikipedia.org/wiki/Argument_from_analogy',
  },
  argument_from_ignorance: {
    label: 'Argument from Ignorance',
    description: 'Claiming something is true because it hasn\'t been proven false, or vice versa.',
    category: 'informal',
    wikiUrl: 'https://en.wikipedia.org/wiki/Argument_from_ignorance',
  },
  argument_from_incredulity: {
    label: 'Argument from Incredulity',
    description: 'Dismissing something because it is hard to imagine or understand.',
    category: 'informal',
    wikiUrl: 'https://en.wikipedia.org/wiki/Argument_from_incredulity',
  },
  argument_from_silence: {
    label: 'Argument from Silence',
    description: 'Drawing a conclusion based on the absence of evidence or statements.',
    category: 'informal',
    wikiUrl: 'https://en.wikipedia.org/wiki/Argument_from_silence',
  },
  bandwagon_fallacy: {
    label: 'Bandwagon Fallacy',
    description: 'Assuming something is true or right because everyone else is doing it.',
    category: 'informal',
    wikiUrl: 'https://en.wikipedia.org/wiki/Argumentum_ad_populum',
  },
  begging_the_question: {
    label: 'Begging the Question',
    description: 'Using a conclusion as a premise in the argument that supports that same conclusion.',
    category: 'informal',
    wikiUrl: 'https://en.wikipedia.org/wiki/Begging_the_question',
  },
  burden_of_proof: {
    label: 'Burden of Proof (shifting)',
    description: 'Placing the burden of proof on the wrong side of the argument.',
    category: 'informal',
    wikiUrl: 'https://en.wikipedia.org/wiki/Burden_of_proof_(philosophy)',
  },
  cherry_picking: {
    label: 'Cherry Picking',
    description: 'Selecting only evidence that supports a position while ignoring contradictory evidence.',
    category: 'informal',
    wikiUrl: 'https://en.wikipedia.org/wiki/Cherry_picking',
  },
  circular_reasoning: {
    label: 'Circular Reasoning',
    description: 'Using a conclusion as one of the premises supporting that conclusion.',
    category: 'informal',
    wikiUrl: 'https://en.wikipedia.org/wiki/Circular_reasoning',
  },
  composition_division: {
    label: 'Composition/Division',
    description: 'Assuming what is true of the parts must be true of the whole, or vice versa.',
    category: 'informal',
    wikiUrl: 'https://en.wikipedia.org/wiki/Fallacy_of_composition',
  },
  continuum_fallacy: {
    label: 'Continuum Fallacy',
    description: 'Rejecting a distinction because there is no sharp boundary between categories.',
    category: 'informal',
    wikiUrl: 'https://en.wikipedia.org/wiki/Continuum_fallacy',
  },
  correlation_causation: {
    label: 'Correlation Does Not Imply Causation',
    description: 'Assuming that because two things correlate, one must cause the other.',
    category: 'informal',
    wikiUrl: 'https://en.wikipedia.org/wiki/Correlation_does_not_imply_causation',
  },
  equivocation: {
    label: 'Equivocation',
    description: 'Using a word with multiple meanings in different parts of the argument as if it means the same thing throughout.',
    category: 'informal',
    wikiUrl: 'https://en.wikipedia.org/wiki/Equivocation',
  },
  false_cause: {
    label: 'False Cause',
    description: 'Incorrectly identifying something as the cause of an event.',
    category: 'informal',
    wikiUrl: 'https://en.wikipedia.org/wiki/Questionable_cause',
  },
  false_dilemma: {
    label: 'False Dilemma',
    description: 'Presenting only two options when more exist.',
    category: 'informal',
    wikiUrl: 'https://en.wikipedia.org/wiki/False_dilemma',
  },
  false_equivalence: {
    label: 'False Equivalence',
    description: 'Treating two things as equivalent when they differ in important ways.',
    category: 'informal',
    wikiUrl: 'https://en.wikipedia.org/wiki/False_equivalence',
  },
  gambler_fallacy: {
    label: "Gambler's Fallacy",
    description: 'Believing that past random events affect the probability of future random events.',
    category: 'informal',
    wikiUrl: 'https://en.wikipedia.org/wiki/Gambler%27s_fallacy',
  },
  genetic_fallacy: {
    label: 'Genetic Fallacy',
    description: 'Judging something based on its origin rather than its current meaning or context.',
    category: 'informal',
    wikiUrl: 'https://en.wikipedia.org/wiki/Genetic_fallacy',
  },
  guilt_by_association: {
    label: 'Guilt by Association',
    description: 'Discrediting an argument because of its association with an undesirable person or group.',
    category: 'informal',
    wikiUrl: 'https://en.wikipedia.org/wiki/Association_fallacy',
  },
  hasty_generalization: {
    label: 'Hasty Generalization',
    description: 'Drawing a broad conclusion from a small or unrepresentative sample.',
    category: 'informal',
    wikiUrl: 'https://en.wikipedia.org/wiki/Hasty_generalization',
  },
  is_ought_problem: {
    label: 'Is\u2013Ought Problem',
    description: 'Deriving normative conclusions (what ought to be) from purely descriptive premises (what is).',
    category: 'informal',
    wikiUrl: 'https://en.wikipedia.org/wiki/Is%E2%80%93ought_problem',
  },
  loaded_question: {
    label: 'Loaded Question',
    description: 'Asking a question that contains an unwarranted assumption.',
    category: 'informal',
    wikiUrl: 'https://en.wikipedia.org/wiki/Loaded_question',
  },
  middle_ground: {
    label: 'Middle Ground (False Compromise)',
    description: 'Assuming the truth must lie between two extreme positions.',
    category: 'informal',
    wikiUrl: 'https://en.wikipedia.org/wiki/Argument_to_moderation',
  },
  moralistic_fallacy: {
    label: 'Moralistic Fallacy',
    description: 'Inferring factual conclusions from moral judgments — what ought to be determines what is.',
    category: 'informal',
    wikiUrl: 'https://en.wikipedia.org/wiki/Moralistic_fallacy',
  },
  moving_the_goalposts: {
    label: 'Moving the Goalposts',
    description: 'Changing the criteria for proof or acceptance after they have been met.',
    category: 'informal',
    wikiUrl: 'https://en.wikipedia.org/wiki/Moving_the_goalposts',
  },
  naturalistic_fallacy: {
    label: 'Naturalistic Fallacy',
    description: 'Equating "natural" with "good" or deriving ethical conclusions from natural facts.',
    category: 'informal',
    wikiUrl: 'https://en.wikipedia.org/wiki/Naturalistic_fallacy',
  },
  nirvana_fallacy: {
    label: 'Nirvana Fallacy',
    description: 'Rejecting a practical solution because it is not perfect.',
    category: 'informal',
    wikiUrl: 'https://en.wikipedia.org/wiki/Nirvana_fallacy',
  },
  no_true_scotsman: {
    label: 'No True Scotsman',
    description: 'Protecting a generalization by redefining the group to exclude counterexamples.',
    category: 'informal',
    wikiUrl: 'https://en.wikipedia.org/wiki/No_true_Scotsman',
  },
  red_herring: {
    label: 'Red Herring',
    description: 'Introducing an irrelevant topic to divert attention from the original issue.',
    category: 'informal',
    wikiUrl: 'https://en.wikipedia.org/wiki/Red_herring',
  },
  reification: {
    label: 'Reification',
    description: 'Treating an abstract concept as if it were a concrete, real thing.',
    category: 'informal',
    wikiUrl: 'https://en.wikipedia.org/wiki/Reification_(fallacy)',
  },
  slippery_slope: {
    label: 'Slippery Slope',
    description: 'Arguing that one event will inevitably lead to a chain of negative consequences without evidence for each step.',
    category: 'informal',
    wikiUrl: 'https://en.wikipedia.org/wiki/Slippery_slope',
  },
  special_pleading: {
    label: 'Special Pleading',
    description: 'Applying standards or rules to others while exempting oneself without adequate justification.',
    category: 'informal',
    wikiUrl: 'https://en.wikipedia.org/wiki/Special_pleading',
  },
  straw_man: {
    label: 'Straw Man',
    description: 'Misrepresenting someone\'s argument to make it easier to attack.',
    category: 'informal',
    wikiUrl: 'https://en.wikipedia.org/wiki/Straw_man',
  },
  sunk_cost: {
    label: 'Sunk Cost Fallacy',
    description: 'Continuing a course of action because of previously invested resources rather than future value.',
    category: 'informal',
    wikiUrl: 'https://en.wikipedia.org/wiki/Sunk_cost',
  },
  texas_sharpshooter: {
    label: 'Texas Sharpshooter Fallacy',
    description: 'Cherry-picking data clusters to suit an argument after the fact.',
    category: 'informal',
    wikiUrl: 'https://en.wikipedia.org/wiki/Texas_sharpshooter_fallacy',
  },
  tu_quoque: {
    label: 'Tu Quoque',
    description: 'Dismissing criticism by pointing out that the critic does the same thing.',
    category: 'informal',
    wikiUrl: 'https://en.wikipedia.org/wiki/Tu_quoque',
  },
  unfalsifiability: {
    label: 'Unfalsifiability',
    description: 'Making a claim that cannot be tested or disproven, rendering it scientifically meaningless.',
    category: 'informal',
    wikiUrl: 'https://en.wikipedia.org/wiki/Falsifiability',
  },
  affirming_the_consequent: {
    label: 'Affirming the Consequent',
    description: 'Assuming that if P implies Q, and Q is true, then P must be true.',
    category: 'formal',
    wikiUrl: 'https://en.wikipedia.org/wiki/Affirming_the_consequent',
  },
  denying_the_antecedent: {
    label: 'Denying the Antecedent',
    description: 'Assuming that if P implies Q, and P is false, then Q must be false.',
    category: 'formal',
    wikiUrl: 'https://en.wikipedia.org/wiki/Denying_the_antecedent',
  },
  affirming_a_disjunct: {
    label: 'Affirming a Disjunct',
    description: 'Concluding that because one disjunct is true, the other must be false (in a non-exclusive or).',
    category: 'formal',
    wikiUrl: 'https://en.wikipedia.org/wiki/Affirming_a_disjunct',
  },
  undistributed_middle: {
    label: 'Undistributed Middle',
    description: 'A syllogistic error where the middle term is not distributed in either premise.',
    category: 'formal',
    wikiUrl: 'https://en.wikipedia.org/wiki/Fallacy_of_the_undistributed_middle',
  },
  base_rate_neglect: {
    label: 'Base Rate Neglect',
    description: 'Ignoring general prevalence information in favor of specific case details.',
    category: 'cognitive_bias',
    wikiUrl: 'https://en.wikipedia.org/wiki/Base_rate_fallacy',
  },
  anchoring_bias: {
    label: 'Anchoring Bias',
    description: 'Over-relying on the first piece of information encountered when making decisions.',
    category: 'cognitive_bias',
    wikiUrl: 'https://en.wikipedia.org/wiki/Anchoring_(cognitive_bias)',
  },
  availability_heuristic: {
    label: 'Availability Heuristic',
    description: 'Judging likelihood based on how easily examples come to mind rather than actual frequency.',
    category: 'cognitive_bias',
    wikiUrl: 'https://en.wikipedia.org/wiki/Availability_heuristic',
  },
  confirmation_bias: {
    label: 'Confirmation Bias',
    description: 'Favoring information that confirms pre-existing beliefs while dismissing contradictory evidence.',
    category: 'cognitive_bias',
    wikiUrl: 'https://en.wikipedia.org/wiki/Confirmation_bias',
  },
  dunning_kruger: {
    label: 'Dunning-Kruger Effect',
    description: 'Overestimating one\'s competence in areas where one has limited expertise.',
    category: 'cognitive_bias',
    wikiUrl: 'https://en.wikipedia.org/wiki/Dunning%E2%80%93Kruger_effect',
  },
  hindsight_bias: {
    label: 'Hindsight Bias',
    description: 'Believing, after an event has occurred, that one would have predicted or expected it.',
    category: 'cognitive_bias',
    wikiUrl: 'https://en.wikipedia.org/wiki/Hindsight_bias',
  },
  optimism_bias: {
    label: 'Optimism Bias',
    description: 'Overestimating the likelihood of positive outcomes and underestimating negative ones.',
    category: 'cognitive_bias',
    wikiUrl: 'https://en.wikipedia.org/wiki/Optimism_bias',
  },
  status_quo_bias: {
    label: 'Status Quo Bias',
    description: 'Preferring the current state of affairs over change, regardless of merit.',
    category: 'cognitive_bias',
    wikiUrl: 'https://en.wikipedia.org/wiki/Status_quo_bias',
  },
  survivorship_bias: {
    label: 'Survivorship Bias',
    description: 'Drawing conclusions from successes while ignoring failures that are no longer visible.',
    category: 'cognitive_bias',
    wikiUrl: 'https://en.wikipedia.org/wiki/Survivorship_bias',
  },
};
