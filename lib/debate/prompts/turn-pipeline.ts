// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import type { DocumentAnalysis, DebatePhase, DebateAudience, TopicScope } from '../types.js';
import type { TopicStructure } from '../topicStructure.js';
import { documentAnalysisContext } from '../documentAnalysis.js';
import { getTopicScope, hasMeaningfulScope, formatDebateScopeBlock } from './state.js';
import {
  getCharacterBlock,
  otherDebaters,
  getReadingLevel,
  getDetailInstruction,
  getStyleReinforcement,
  getPolicymakerFraming,
  formatDoctrinalBoundaries,
} from './shared-helpers.js';
import {
  sourceReminder,
  MUST_CORE_BEHAVIORS,
  STEELMAN_INSTRUCTION,
  PHASE_INSTRUCTIONS,
} from './shared-instructions.js';
import { _buildMoveHistoryBlock } from './opening.js';

export interface StagePromptInput {
  [key: string]: unknown;
  label: string;
  pov: string;
  personality: string;
  topic: string;
  /** User-supplied supporting context, kept separate from the topic question. */
  background?: string;
  taxonomyContext: string;
  recentTranscript: string;
  focusPoint: string;
  addressing: string;
  phase?: DebatePhase;
  priorMoves?: string[];
  turnsSinceLastConcession?: number;
  priorRefs?: string[];
  availablePovNodeIds?: string[];
  crossPovNodeIds?: string[];
  priorFlaggedHints?: string[];
  sourceContent?: string;
  documentAnalysis?: DocumentAnalysis;
  audience?: DebateAudience;
  pendingIntervention?: {
    move: string;
    family: string;
    targetDebater: string;
    responseField?: string;
    responseSchema?: string;
    directResponsePattern?: string;
    isTargeted: boolean;
    round?: number;
  };
  phaseContext?: {
    rationale: string;
    phase_progress: number;
    approaching_transition: boolean;
  };
  edgeContext?: string;
  strategicHints?: string[];
  /** Strong claims to base the argument on — injected into Plan stage as foundations. */
  strongFoundations?: { text: string; marginal_delta: number; base_strength: number; reason: string }[];
  /** Weak claims to avoid using — injected into Plan stage with reasons. */
  avoidClaims?: { text: string; marginal_delta: number; base_strength: number; reason: string }[];
  /** Concession claims to preserve — injected into Plan stage as claims to keep. */
  preserveConcessions?: { text: string; reason: string }[];
  vocabularyExclusion?: string;
  /** Prior crux context from cross-debate registry — injected into Brief stage. */
  priorCruxContext?: string;
  /** Current debate crux context — active/resolved cruxes from this debate's crux_tracker. */
  currentCruxContext?: string;
  /** Topic scope constraints — injected into Brief stage for pre-draft scope checking. */
  topicScope?: TopicScope;
  /** When true, inserts a salience beacon block in the Draft prompt to reduce scope drift. */
  salienceBeacon?: boolean;
  /** Exploration summary priming — AN sketch + convergence areas injected at Brief prompt top. */
  explorationPriming?: string;
  /** Use restructured BRIEF prompt (YOUR TASK → REFERENCE → CURRENT STATE). Experiment flag (t/1029). */
  useBackgroundPrompt?: boolean;
  /** Decomposed topic structure — when present, BRIEF uses labeled sections for proposition/premises/scope. */
  topicStructure?: TopicStructure;
  /** Formatted Talmudic source card directive to inject into the Draft prompt. */
  talmudicReferenceDirective?: string;
  /** Card id the debater must respond to in talmudic_reference_response. */
  talmudicReferenceCardId?: string;
}

function formatTopicBlock(topic: string, structure?: TopicStructure): string {
  if (!structure || structure.core_proposition === topic) {
    return `=== DEBATE TOPIC ===\n"${topic}"`;
  }
  const parts = [`=== DEBATE TOPIC ===\n"${structure.core_proposition}"`];
  if (structure.structural_premises.length > 0) {
    parts.push(
      `=== TOPIC PREMISES (given — do not recharacterize as claims) ===\n${structure.structural_premises.map(p => `- ${p}`).join('\n')}`,
    );
  }
  if (structure.scope_constraints && structure.scope_constraints.length > 0) {
    parts.push(
      `=== TOPIC SCOPE CONSTRAINTS ===\n${structure.scope_constraints.map(c => `- ${c}`).join('\n')}`,
    );
  }
  return parts.join('\n\n');
}

function topicPremiseFidelityInstruction(structure?: TopicStructure): string {
  if (structure && structure.structural_premises.length > 0) {
    return 'TOPIC PREMISE FIDELITY: The TOPIC PREMISES listed above are given conditions of the debate — treat them as settled background facts. You may question their enforceability, sufficiency, or practical consequences, but do not recharacterize them as "claims" or "assertions." When referencing a premise, use the topic\'s own language or clearly mark your interpretation.';
  }
  return 'TOPIC PREMISE FIDELITY: When the DEBATE TOPIC states an explicit structural feature of the proposal (e.g., conditions, mechanisms, exclusions, exemptions), treat it as a given of the debate. You may question its enforceability, sufficiency, or practical consequences — but do not recharacterize it as a "claim" or "assertion." When referencing a topic feature, use the topic\'s own language or clearly mark your interpretation.';
}

export function briefStagePrompt(input: StagePromptInput): string {
  const documentBlock = input.documentAnalysis
    ? documentAnalysisContext(input.documentAnalysis)
    : sourceReminder(input.sourceContent);

  return `You are an analytical assistant preparing a situation brief for ${input.label}, who represents the ${input.pov} perspective on AI policy.

Your task is to comprehend the current state of the debate and identify what matters most for ${input.label}'s next response. This is pure analysis — do not write any debate statement or adopt the debater's voice.

${input.explorationPriming ? `${input.explorationPriming}\n` : ''}${input.taxonomyContext}
${input.edgeContext ? `\n=== KNOWN CROSS-POV TENSIONS ===\n${input.edgeContext}\n` : ''}${input.topicScope ? `\n${formatDebateScopeBlock(input.topicScope)}\n` : ''}${input.priorCruxContext ? `\n${input.priorCruxContext}\n` : ''}${input.currentCruxContext ? `\n=== IDENTIFIED CRUXES (THIS DEBATE) ===\n${input.currentCruxContext}\n\n` : ''}${formatTopicBlock(input.topic, input.topicStructure)}${input.background ? `\n\n=== BACKGROUND CONTEXT ===\nThe user provided the following supporting context. Use it to inform your analysis, but keep it separate from the debate question itself.\n${input.background}` : ''}

=== RECENT DEBATE HISTORY ===
${input.recentTranscript}
${documentBlock}
=== ASSIGNMENT FOR NEXT TURN ===
${input.label} must address ${input.addressing === 'general' ? 'the panel' : input.addressing} on: ${input.focusPoint}

${input.phase ? PHASE_INSTRUCTIONS[input.phase] : ''}

ATTRIBUTION FIDELITY: Your analysis of other speakers' positions must be grounded in what they actually said in the RECENT DEBATE HISTORY above. Do not infer, extrapolate, or construct positions that a speaker did not explicitly state. If a speaker did not address a topic, note the absence — do not fill it with assumptions about what they "probably" believe.

${topicPremiseFidelityInstruction(input.topicStructure)}

Analyze the debate state and produce a structured brief. Focus on:
1. What is the current state of the debate? What just happened?
2. What are the most important claims that need addressing? Include the AN-ID if available. For each claim, identify which taxonomy nodes ground your response.
3. What commitments have been made that constrain or enable ${input.label}'s response?
4. What structural tensions exist that ${input.label} could exploit or must navigate?
5. What does the current debate phase demand?
${input.pendingIntervention ? `6. MODERATOR DIRECTIVE: A moderator ${input.pendingIntervention.move} intervention is active${input.pendingIntervention.isTargeted ? ' and directed at YOU' : ` (directed at ${input.pendingIntervention.targetDebater})`}. Your situation_assessment MUST identify this directive and note what compliance requires.` : ''}
${input.currentCruxContext ? `\nCRUX ENGAGEMENT: Your situation_assessment MUST identify which active cruxes (from IDENTIFIED CRUXES above) bear on the key claims. For each relevant crux, note whether this turn could advance, challenge, or resolve it.\n` : ''}
GROUNDING DEPTH: Each claim MUST cite 2-4 grounding nodes from the taxonomy — a primary anchor plus 1-3 supporting or contrasting nodes. Draw from different BDI categories (Beliefs for evidence, Desires for values, Intentions for strategy). A single-node grounding is too shallow — show the full argumentative structure.

GROUNDING WEIGHTS: For Belief grounding nodes, include "confidence" (0.0–1.0) from the taxonomy context. For Desire grounding nodes, include "priority" (1–5). For Intention grounding nodes, include "operationality" (1–5). These help downstream stages calibrate rhetorical strength.

NODE-ID ACCURACY: Copy taxonomy node IDs exactly as they appear in your context above. Do NOT modify, prefix, or "correct" them. "cc-040" stays "cc-040" — do not change it to "sit-cc-040" or any other variant.

Respond ONLY with a JSON object (no markdown, no code fences):
{
  "situation_assessment": "2-4 sentences describing the current debate state and what just happened${input.pendingIntervention ? '. Include the moderator directive and what it requires' : ''}",
  "key_claims_to_address": [
    {"claim": "the claim text or summary", "speaker": "who made it", "an_id": "AN-ID if known", "grounding": [{"node_id": "acc-beliefs-003", "label": "Node Label Here", "confidence": 0.72, "why": "primary — high-confidence anchor"}, {"node_id": "acc-desires-007", "label": "Node Label Here", "priority": 4, "why": "supporting — core value commitment"}, {"node_id": "acc-intentions-012", "label": "Node Label Here", "operationality": 3, "why": "supporting — strategic counter"}]}
  ],
  "relevant_commitments": [
    {"speaker": "who", "commitment": "what was committed", "type": "asserted | conceded | challenged"}
  ],
  "edge_tensions": [
    {"edge": "brief description of the tension", "relevance": "how it could be used"}
  ],
  "phase_considerations": "1-2 sentences on what the current phase demands and how it shapes strategy"
}`;
}

export function briefStagePromptV2(input: StagePromptInput): string {
  const documentBlock = input.documentAnalysis
    ? documentAnalysisContext(input.documentAnalysis)
    : sourceReminder(input.sourceContent);

  // ── Section 1: YOUR TASK (primacy position) ──
  const taskSection = `## YOUR TASK

You are an analytical assistant preparing a situation brief for ${input.label}, who represents the ${input.pov} perspective on AI policy.

Your task is to comprehend the current state of the debate and identify what matters most for ${input.label}'s next response. This is pure analysis — do not write any debate statement or adopt the debater's voice.

${input.phase ? PHASE_INSTRUCTIONS[input.phase] : ''}

ATTRIBUTION FIDELITY: Your analysis of other speakers' positions must be grounded in what they actually said in the RECENT DEBATE HISTORY below. Do not infer, extrapolate, or construct positions that a speaker did not explicitly state. If a speaker did not address a topic, note the absence — do not fill it with assumptions about what they "probably" believe.

${topicPremiseFidelityInstruction(input.topicStructure)}

Analyze the debate state and produce a structured brief. Focus on:
1. What is the current state of the debate? What just happened?
2. What are the most important claims that need addressing? Include the AN-ID if available. For each claim, identify which taxonomy nodes ground your response.
3. What commitments have been made that constrain or enable ${input.label}'s response?
4. What structural tensions exist that ${input.label} could exploit or must navigate?
5. What does the current debate phase demand?
${input.pendingIntervention ? `6. MODERATOR DIRECTIVE: A moderator ${input.pendingIntervention.move} intervention is active${input.pendingIntervention.isTargeted ? ' and directed at YOU' : ` (directed at ${input.pendingIntervention.targetDebater})`}. Your situation_assessment MUST identify this directive and note what compliance requires.` : ''}
${input.currentCruxContext ? `\nCRUX ENGAGEMENT: Your situation_assessment MUST identify which active cruxes (from IDENTIFIED CRUXES in REFERENCE MATERIAL) bear on the key claims. For each relevant crux, note whether this turn could advance, challenge, or resolve it.\n` : ''}
GROUNDING DEPTH: Each claim MUST cite 2-4 grounding nodes from the taxonomy — a primary anchor plus 1-3 supporting or contrasting nodes. Draw from different BDI categories (Beliefs for evidence, Desires for values, Intentions for strategy). A single-node grounding is too shallow — show the full argumentative structure.

GROUNDING WEIGHTS: For Belief grounding nodes, include "confidence" (0.0–1.0) from the taxonomy context. For Desire grounding nodes, include "priority" (1–5). For Intention grounding nodes, include "operationality" (1–5). These help downstream stages calibrate rhetorical strength.

NODE-ID ACCURACY: Copy taxonomy node IDs exactly as they appear in REFERENCE MATERIAL. Do NOT modify, prefix, or "correct" them. "cc-040" stays "cc-040" — do not change it to "sit-cc-040" or any other variant.

Respond ONLY with a JSON object (no markdown, no code fences):
{
  "situation_assessment": "2-4 sentences describing the current debate state and what just happened${input.pendingIntervention ? '. Include the moderator directive and what it requires' : ''}",
  "key_claims_to_address": [
    {"claim": "the claim text or summary", "speaker": "who made it", "an_id": "AN-ID if known", "grounding": [{"node_id": "acc-beliefs-003", "label": "Node Label Here", "confidence": 0.72, "why": "primary — high-confidence anchor"}, {"node_id": "acc-desires-007", "label": "Node Label Here", "priority": 4, "why": "supporting — core value commitment"}, {"node_id": "acc-intentions-012", "label": "Node Label Here", "operationality": 3, "why": "supporting — strategic counter"}]}
  ],
  "relevant_commitments": [
    {"speaker": "who", "commitment": "what was committed", "type": "asserted | conceded | challenged"}
  ],
  "edge_tensions": [
    {"edge": "brief description of the tension", "relevance": "how it could be used"}
  ],
  "phase_considerations": "1-2 sentences on what the current phase demands and how it shapes strategy"
}`;

  // ── Section 2: REFERENCE MATERIAL (middle position) ──
  const refParts: string[] = [];

  if (input.explorationPriming) refParts.push(input.explorationPriming);
  refParts.push(input.taxonomyContext);
  if (input.edgeContext) refParts.push(`=== KNOWN CROSS-POV TENSIONS ===\n${input.edgeContext}`);
  if (input.topicScope) refParts.push(formatDebateScopeBlock(input.topicScope));
  if (input.priorCruxContext) refParts.push(input.priorCruxContext);
  if (input.currentCruxContext) refParts.push(`=== IDENTIFIED CRUXES (THIS DEBATE) ===\n${input.currentCruxContext}`);
  if (documentBlock) refParts.push(documentBlock);
  if (input.background) refParts.push(`=== BACKGROUND CONTEXT ===\nThe user provided the following supporting context. Use it to inform your analysis, but keep it separate from the debate question itself.\n${input.background}`);

  const referenceSection = `## REFERENCE MATERIAL\n\n${refParts.join('\n\n')}`;

  // ── Section 3: CURRENT STATE (recency position) ──
  const stateSection = `## CURRENT STATE

${formatTopicBlock(input.topic, input.topicStructure)}

=== RECENT DEBATE HISTORY ===
${input.recentTranscript}

=== ASSIGNMENT FOR NEXT TURN ===
${input.label} must address ${input.addressing === 'general' ? 'the panel' : input.addressing} on: ${input.focusPoint}`;

  return `${taskSection}\n\n${referenceSection}\n\n${stateSection}`;
}

export function planStagePrompt(input: StagePromptInput, brief: string): string {
  const moveHistoryBlock = _buildMoveHistoryBlock(input.priorMoves, input.turnsSinceLastConcession);

  const flaggedBlock = input.priorFlaggedHints && input.priorFlaggedHints.length > 0
    ? `\n=== PRIOR TURN FEEDBACK ===\nYour last response was accepted but flagged with these issues:\n${input.priorFlaggedHints.map(h => '- ' + h).join('\n')}\nAddress at least one of these weaknesses in your plan.\n`
    : '';

  const constructiveMoveList = input.phase && input.phase !== 'confrontation'
    ? '\nConstructive emphasis: INTEGRATE, SPECIFY, EXTEND, CONCEDE-AND-PIVOT'
    : '';

  const phaseContextBlock = input.phaseContext
    ? `\n=== PHASE STATUS (adaptive) ===\n${input.phaseContext.rationale}\nProgress toward transition: ${(input.phaseContext.phase_progress * 100).toFixed(0)}%${input.phaseContext.approaching_transition ? '\n⚠ Approaching phase transition — prioritize closing open threads and crystallizing positions.' : ''}\n`
    : '';

  // Build intervention block for plan stage
  let interventionBlock = '';
  const pi = input.pendingIntervention;
  if (pi) {
    if (pi.isTargeted) {
      interventionBlock = `
=== MODERATOR DIRECTIVE — DIRECTED AT YOU ===
The moderator issued a ${pi.move} intervention directed at you.
${pi.directResponsePattern ? `\nDirective: ${pi.directResponsePattern}` : ''}
You MUST plan how to respond to this directive. Your plan must include a directive_response_plan that describes how your first paragraph will directly address the moderator's request.
`;
    } else {
      interventionBlock = `
=== MODERATOR DIRECTIVE — DIRECTED AT ${pi.targetDebater.toUpperCase()} ===
The moderator issued a ${pi.move} intervention directed at ${pi.targetDebater} (not you).
Consider how the moderator's point relates to your own position and plan a brief acknowledgment in your opening.
`;
    }
  }

  const directiveField = pi
    ? `,\n  "directive_response": {"directive": "restate the moderator's directive in one sentence", "how_addressed": "${pi.isTargeted ? '1-3 sentences: how you will directly respond to the moderator directive in your opening paragraph' : '1 sentence: brief acknowledgment of the moderator directive as it relates to your position'}"}`
    : '';

  const strategicHintsBlock = input.strategicHints && input.strategicHints.length > 0
    ? `\n=== OPPONENT INTELLIGENCE ===\nThe following tactical observations were computed from the argument network and commitment stores. Use them to inform your strategy — they suggest exploitable weaknesses or shifts in opponent behavior.\n${input.strategicHints.map(h => '- ' + h).join('\n')}\n`
    : '';

  const strongFoundationsBlock = input.strongFoundations && input.strongFoundations.length > 0
    ? `\n=== STRONG FOUNDATIONS ===\nThese arguments are strategically valuable. Base your statement on them.\n\n${input.strongFoundations.map(c => `- "${c.text}" (strength: ${c.base_strength.toFixed(2)}, Δu: ${c.marginal_delta >= 0 ? '+' : ''}${c.marginal_delta.toFixed(3)})\n  Why strong: ${c.reason}`).join('\n')}\n\nGround your statement in these strong positions. You may extend or sharpen them.\n`
    : '';

  const avoidClaimsBlock = input.avoidClaims && input.avoidClaims.length > 0
    ? `\n=== DO NOT USE THESE ARGUMENTS ===\nThese arguments weaken your overall position. Do not use them or make substantially similar arguments.\n\n${input.avoidClaims.map(c => `- "${c.text}" (strength: ${c.base_strength.toFixed(2)}, Δu: ${c.marginal_delta >= 0 ? '+' : ''}${c.marginal_delta.toFixed(3)})\n  Why weak: ${c.reason}`).join('\n')}\n`
    : '';

  const preserveConcessionsBlock = input.preserveConcessions && input.preserveConcessions.length > 0
    ? `\n=== CLAIMS TO PRESERVE ===\nThese concessions are valuable — keep them in your revised response.\n\n${input.preserveConcessions.map(c => `- "${c.text}"\n  ${c.reason}`).join('\n')}\n`
    : '';

  const cruxBlock = input.currentCruxContext
    ? `\n=== ACTIVE CRUXES ===\n${input.currentCruxContext}\nYour plan MUST engage at least one active crux. Identify which planned move addresses which crux.\n`
    : '';

  return `You are ${input.label}, planning your argumentative strategy for your next debate turn.
${getCharacterBlock(input.pov)}
Your perspective: ${input.pov}.
${formatDoctrinalBoundaries(input.pov)}
=== SITUATION BRIEF ===
${brief}
${moveHistoryBlock}${flaggedBlock}${phaseContextBlock}${interventionBlock}${strategicHintsBlock}${strongFoundationsBlock}${avoidClaimsBlock}${preserveConcessionsBlock}${cruxBlock}
=== AVAILABLE DIALECTICAL MOVES ===
The 10 canonical moves: DISTINGUISH, COUNTEREXAMPLE, CONCEDE-AND-PIVOT, REFRAME, EMPIRICAL CHALLENGE, EXTEND, UNDERCUT, SPECIFY, INTEGRATE, BURDEN-SHIFT${constructiveMoveList}

Each move should be an object: {"move": "MOVE_NAME", "target": "AN-ID (optional)", "detail": "what you will do"}

Plan your argumentative strategy. Consider:
1. What is your strategic goal for this turn? What should it accomplish?
2. Which 1-5 dialectical moves will you use, and in what order?
3. Which prior claims (by AN-ID) will you engage with?
4. What is the structure of your argument — how will you open, develop, and close?
5. How might opponents respond, and how does your plan account for that?
6. What taxonomy nodes or policy evidence do you need to cite?${pi ? '\n7. How will you respond to the moderator directive?' : ''}

Match your argument mode to each claim's epistemic type and falsifiability level. Target the opponent's load-bearing assumptions first.

NODE-ID ACCURACY: Copy taxonomy node IDs exactly as they appear in the situation brief. Do NOT modify, prefix, or "correct" them.

Respond ONLY with a JSON object (no markdown, no code fences):
{
  "strategic_goal": "1-2 sentences: what this turn should accomplish${input.currentCruxContext ? ' — reference which active crux(es) you will engage' : ''}",
  "planned_moves": [
    {"move": "DISTINGUISH", "target": "AN-3", "detail": "Separate regulatory capture from legitimate oversight"},
    {"move": "EXTEND", "detail": "Build on the innovation metrics argument with new evidence"}
  ],
  "target_claims": ["AN-3", "AN-7"],
  "argument_sketch": "2-4 sentences outlining the argument structure: opening move, main thrust, closing",
  "anticipated_responses": ["Safetyist will likely counter with precautionary principle", "Skeptic may challenge the evidence base"],
  "target_nodes": ["acc-beliefs-003", "saf-desires-007", "skp-intentions-002"]${directiveField}
}

target_nodes: Select 3-5 taxonomy nodes your strategy will explicitly engage. Choose nodes whose content you will directly reference, build on, or challenge in your argument. These will be threaded to the draft and cite stages for intentional grounding.`;
}

/**
 * Extract target_nodes from a plan JSON string and build an injection block
 * so the draft explicitly engages planned taxonomy nodes.
 */
function buildTargetNodesBlock(planJson: string, taxonomyContext: string): string {
  try {
    const plan = JSON.parse(planJson);
    const nodes: string[] = plan?.target_nodes;
    if (!nodes || nodes.length === 0) return '';
    // Extract node summaries from taxonomy context if available
    const summaries = nodes.map(id => {
      const pattern = new RegExp(`${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[:\\s]+(.{0,80})`, 'i');
      const match = taxonomyContext.match(pattern);
      return match ? `- ${id}: ${match[1].trim()}` : `- ${id}`;
    });
    return `
=== TARGET TAXONOMY NODES ===
Your argument MUST explicitly engage these nodes from your plan:
${summaries.join('\n')}
Write claims that directly reference, build on, or challenge these nodes' content. The cite stage will verify each appears in your taxonomy_refs.
`;
  } catch {
    return '';
  }
}

export function draftStagePrompt(input: StagePromptInput, brief: string, plan: string): string {
  const phaseDirective = input.phase === 'concluding'
    ? `Open with your direct answer to the original debate question${input.topic ? ` ("${input.topic}")` : ''} — what is your verdict, in one sentence? Then name what you agree on, narrow remaining disagreements, and propose conditional agreements.`
    : input.phase === 'argumentation'
    ? 'Probe deeper. Find cruxes, test edge cases, and name areas of agreement explicitly.'
    : 'Engage directly with what was said. If you disagree, explain why with specifics and classify your disagreement type. Challenge the strongest point first, not the weakest.';

  const positionUpdateField = input.phase === 'concluding'
    ? `,\n  "position_update": "1-3 sentences: how has your position evolved during this debate?"` : '';

  const talmudicDirectiveSection = input.talmudicReferenceDirective
    ? `\n=== TALMUDIC SOURCE REFERENCE ===\n${input.talmudicReferenceDirective}\n`
    : '';
  const talmudicResponseField = input.talmudicReferenceCardId
    ? `,\n  "talmudic_reference_response": {\n    "card_id": "${input.talmudicReferenceCardId}",\n    "stance": "accepts|rejects|distinguishes|limits",\n    "relevant_similarity": "one shared principle or pattern",\n    "limiting_difference": "one key difference that limits the analogy"\n  }`
    : '';

  // Build intervention response block for the Draft prompt
  let interventionBlock = '';
  const pi = input.pendingIntervention;
  if (pi) {
    if (pi.isTargeted && pi.directResponsePattern) {
      interventionBlock = `
=== MODERATOR DIRECTIVE — YOU MUST RESPOND DIRECTLY ===
The moderator issued a ${pi.move} intervention directed at you.

${pi.directResponsePattern}

Paragraph 1: respond directly to the moderator's challenge. State your position and one reason. Then proceed with your argument.
`;
    } else if (!pi.isTargeted) {
      interventionBlock = `
=== MODERATOR DIRECTIVE — DIRECTED AT ${pi.targetDebater.toUpperCase()} ===
The moderator issued a ${pi.move} intervention directed at ${pi.targetDebater} (not you).
Your first sentence should briefly acknowledge the moderator's point as it relates to your own position (e.g., "The moderator's question to ${pi.targetDebater} about [topic] also bears on my argument because..."). Keep it to 1-2 sentences, then proceed with your substantive argument.
`;
    }
  }

  return `You are ${input.label}, an AI debater representing the ${input.pov} perspective on AI policy.
${getCharacterBlock(input.pov)}
${otherDebaters(input.label)}
${getReadingLevel(input.audience)}
${getDetailInstruction(input.audience)}
${getPolicymakerFraming(input.audience)}
${MUST_CORE_BEHAVIORS}

${STEELMAN_INSTRUCTION}
${formatDoctrinalBoundaries(input.pov)}
=== SITUATION BRIEF ===
${brief}

=== YOUR ARGUMENT PLAN ===
${plan}
${interventionBlock}${talmudicDirectiveSection}${buildTargetNodesBlock(plan, input.taxonomyContext)}${input.vocabularyExclusion ?? ''}${input.currentCruxContext ? `\n=== ACTIVE CRUXES ===\n${input.currentCruxContext}\n` : ''}${input.salienceBeacon && input.topicScope ? `
=== SALIENCE BEACON ===
ATTENTION: Monitor your argument's structural fidelity to the debate scope.
- Domain: ${input.topicScope.domain}
- Boundary: ${input.topicScope.example_ceiling}
Your argument must resolve through THIS domain's institutions, mechanisms, and consequences — not adjacent domains.
If your reasoning drifts beyond this boundary, redirect through a concrete mechanism within the stated domain.
` : ''}
=== YOUR ASSIGNMENT ===
Address ${input.addressing === 'general' ? 'the panel' : input.addressing} on this point: ${input.focusPoint}

${phaseDirective}

Execute the argument plan above. Write your debate statement following the plan's structure and moves. Stay in character as ${input.label}.

PARAGRAPH STRUCTURE:
${pi?.isTargeted
  ? `- Paragraph 1 (exactly 2-3 sentences): Your direct response to the moderator's challenge. Address what was asked before pivoting.
- Paragraphs 2-4 (normal depth): Your substantive argument. Each paragraph develops one distinct idea.
- Total: 3-5 paragraphs separated by \\n\\n.`
  : `- 3-5 paragraphs separated by \\n\\n. Each paragraph develops one distinct idea.
- A single unbroken block will be rejected — structure your argument into clear, quotable sections.`}

OUTPUT CONSTRAINTS:
- ATTRIBUTION FIDELITY: You may only attribute positions to other debaters that they have explicitly stated in the debate history. Do not infer, extrapolate, or fabricate positions. Phrases like "your solution is X" or "you're arguing for Y" must correspond to something actually said — not an implication you've constructed. Misrepresenting another debater's position undermines the debate's integrity and will be flagged.
- TOPIC PREMISE FIDELITY: Structural features stated in the debate topic are givens, not claims. Critique their consequences, not their existence.
- NODE-ID PROHIBITION: Never surface AN-IDs or taxonomy node IDs in your statement text. Use plain language.
- CLAIM SPECIFICITY: At least one claim per paragraph must include a concrete number, named entity, date, or threshold. If source evidence is provided above, use it — cite the specific statistic, year, or finding rather than paraphrasing vaguely. Abstract claims without any specifics weaken your argument.
- CLAIM SKETCHING: For each paragraph, identify 1-3 distinct claims it makes — the paragraph's main point plus any sub-claim substantial enough to stand as its own argument. A dense paragraph with several specific claims (statistics, named precedents, conditional arguments) should yield more sketches than a paragraph with one simple point. For each, extract a near-verbatim sentence and note which prior claims it engages with.${input.currentCruxContext ? `\n- CRUX ENGAGEMENT: At least one claim_sketch MUST directly address an active crux. Engage the core disagreement head-on rather than circling around it.` : ''}${!input.pendingIntervention?.isTargeted ? `\n- TURN SYMBOLS: Choose 1-3 Unicode symbols (emoji) that capture your argument's essence. Tooltip: 1-sentence analogy connecting the symbol to your argument.` : ''}

${getStyleReinforcement(input.audience)}
${pi?.isTargeted && pi.responseField ? `\n⚠ ACTIVE INTERVENTION: Your response JSON MUST include a "${pi.responseField}" field. Omitting it will trigger a retry.\n` : ''}
Respond ONLY with a JSON object matching this exact schema (no markdown, no code fences):
{
  "statement": "your full debate response (3-5 paragraphs separated by \\n\\n)",${!pi?.isTargeted ? `
  "turn_symbols": [
    {"symbol": "emoji", "tooltip": "1-sentence analogy"}
  ],` : ''}
  "claim_sketches": [
    {"claim": "near-verbatim sentence from your statement", "targets": ["AN-3"]},
    {"claim": "near-verbatim supporting sub-claim", "targets": []}
  ]${_buildInterventionResponseField(pi)}${positionUpdateField}${talmudicResponseField}
}`;
}

export interface RewriteFromClaimsInput {
  label: string;
  pov: string;
  topic: string;
  recentTranscript: string;
  selectedClaims: {
    text: string;
    classification: 'STRONG' | 'PRESERVE';
    dominant_component: string;
    reason: string;
  }[];
  avoidClaims: { text: string; reason: string }[];
  audience?: DebateAudience;
  currentCruxContext?: string;
  topicScope?: TopicScope;
}

/**
 * Rewrite prompt for the over-generate/select/rewrite stage (t/1290).
 * Called after greedy claim selection; selected claims are the argument backbone.
 * Not a draft-from-scratch: the model synthesizes, not discovers.
 */
export function draftFromSelectedClaimsPrompt(input: RewriteFromClaimsInput): string {
  const selectedBlock = input.selectedClaims
    .map((c, i) => `${i + 1}. [${c.classification}] ${c.text}\n   Dominant signal: ${c.dominant_component}. ${c.reason}`)
    .join('\n\n');

  const avoidBlock = input.avoidClaims.length > 0
    ? input.avoidClaims.map((c, i) => `${i + 1}. ${c.text}\n   Reason to avoid: ${c.reason}`).join('\n\n')
    : 'None identified.';

  return `You are ${input.label}, an AI debater representing the ${input.pov} perspective on AI policy.
${getCharacterBlock(input.pov)}
${otherDebaters(input.label)}
${getReadingLevel(input.audience)}
${getDetailInstruction(input.audience)}
${getPolicymakerFraming(input.audience)}
${MUST_CORE_BEHAVIORS}

${STEELMAN_INSTRUCTION}
${formatDoctrinalBoundaries(input.pov)}
=== DEBATE TOPIC ===
${input.topic}

=== RECENT DEBATE CONTEXT ===
${input.recentTranscript}
${input.currentCruxContext ? `\n=== ACTIVE CRUXES ===\n${input.currentCruxContext}\n` : ''}
=== SELECTED CLAIMS (argument backbone) ===
Each claim below was scored for position-building value. Claims marked [STRONG] and [PRESERVE] are your backbone. Every one of them must appear in your response.

${selectedBlock}

=== CLAIMS TO AVOID ===
These scored below utility threshold. Do not introduce them as a paragraph's primary point. Using them as rhetorical context or transitions is permitted, as long as they are not the point.

${avoidBlock}

=== YOUR ASSIGNMENT ===
Build a speaker-voiced argument using the selected claims above as its backbone. Every selected claim must appear. Their order and framing are yours. Do not introduce additional primary claims beyond the selected set. Do not restate the selected claims as a bullet list — synthesize them into flowing argument paragraphs.

PARAGRAPH STRUCTURE:
- 3-5 paragraphs separated by \\n\\n. Each paragraph develops one distinct idea.
- A single unbroken block will be rejected.

OUTPUT CONSTRAINTS:
- ATTRIBUTION FIDELITY: Attribute positions to other debaters only from what they have explicitly stated. Do not infer or fabricate positions.
- TOPIC PREMISE FIDELITY: Structural features stated in the debate topic are givens. Critique their consequences, not their existence.
- NODE-ID PROHIBITION: Never surface AN-IDs or taxonomy node IDs in your statement text.
- CLAIM SPECIFICITY: At least one claim per paragraph must include a concrete number, named entity, date, or threshold.
- CLAIM SKETCHING: For each paragraph, identify 1-3 distinct claims it makes. For each, extract a near-verbatim sentence and note which prior claims it engages with.${input.currentCruxContext ? `\n- CRUX ENGAGEMENT: At least one claim_sketch MUST directly address an active crux.` : ''}
- TURN SYMBOLS: Choose 1-3 Unicode symbols (emoji) that capture your argument's essence. Tooltip: 1-sentence analogy connecting the symbol to your argument.

${getStyleReinforcement(input.audience)}
Respond ONLY with a JSON object matching this exact schema (no markdown, no code fences):
{
  "statement": "your full debate response (3-5 paragraphs separated by \\n\\n)",
  "turn_symbols": [
    {"symbol": "emoji", "tooltip": "1-sentence analogy"}
  ],
  "claim_sketches": [
    {"claim": "near-verbatim sentence from your statement", "targets": ["AN-3"]},
    {"claim": "near-verbatim supporting sub-claim", "targets": []}
  ]
}`;
}

/**
 * Lightweight post-Draft extraction: identify key assumptions from a debate statement.
 * ~100 tokens. Deferred from Draft to reduce cognitive load during generation.
 */
export function assumptionsExtractionPrompt(statement: string): string {
  return `Given this debate statement, identify 1-2 key assumptions the argument depends on and what changes if each assumption fails.

=== STATEMENT ===
${statement}

Respond ONLY with a JSON object (no markdown, no code fences):
{
  "key_assumptions": [
    {"assumption": "the assumption", "if_wrong": "what changes if this assumption fails"}
  ]
}`;
}

/** Build the JSON field for the specific intervention response required by the pending moderator move. */
export function _buildInterventionResponseField(pi?: StagePromptInput['pendingIntervention']): string {
  if (!pi?.isTargeted) return '';
  const RESPONSE_FIELDS: Record<string, string> = {
    PIN:            ',\n  "pin_response": {"position": "agree | disagree | conditional", "condition": "... (if conditional)", "brief_reason": "1-2 sentences"}',
    PROBE:          ',\n  "probe_response": {"evidence_type": "empirical | precedent | theoretical | conceded_gap", "evidence": "cite specific data or source", "critical_question_addressed": "which question this answers"}',
    CHALLENGE:      ',\n  "challenge_response": {"type": "evolved | consistent | conceded", "explanation": "1-2 sentences on how your position has or hasn\'t changed"}',
    CLARIFY:        ',\n  "clarification": {"term": "the term being clarified", "definition": "your precise definition", "example": "a concrete example"}',
    CHECK:          ',\n  "check_response": {"understood_correctly": true, "actual_target": "what you actually meant", "revised_response": "corrected statement if misunderstood"}',
    REVOICE:        ',\n  "revoice_response": {"accurate": true, "correction": "what was misrepresented (if inaccurate)", "nuance": "what the revoicing missed"}',
    'META-REFLECT': ',\n  "reflection": {"reasoning_pattern": "the pattern you identified in your own reasoning", "assessment": "whether this pattern strengthens or weakens your argument", "adjustment": "how you will adjust going forward"}',
    COMPRESS:       ',\n  "compressed_thesis": "your core position in 1-2 sentences — no hedging, no qualifiers, just the claim"',
    COMMIT:         ',\n  "commitment": {"position": "the specific position you are committing to", "conditions": "under what conditions this commitment holds", "falsifiable": "what evidence would make you abandon this position"}',
    CRUX_FOCUS:       ',\n  "crux_focus_response": {"type": "empirical | values | definitional", "evidence_or_tradeoff": "the specific evidence you cite (empirical), tradeoff you name (values), or definition you propose (definitional)", "conditional_agreement": "I would accept [X] if [Y] (optional)", "contested_term_definition": "your precise definition of the contested term (definitional only, optional)"}',
    POLICY_CHALLENGE: ',\n  "policy_challenge_response": {"mechanism": "the specific enforcement/regulatory mechanism you propose", "actor": "who would implement and enforce it", "feasibility": "assessment of political feasibility — what coalition supports this", "obstacle": "primary implementation obstacle"}',
  };
  return RESPONSE_FIELDS[pi.move] ?? '';
}

/**
 * Extract target_nodes from a plan JSON string and build a block for the cite stage
 * so it verifies intentional connections.
 */
function buildPlannedNodesBlock(planJson: string): string {
  try {
    const plan = JSON.parse(planJson);
    const nodes: string[] = plan?.target_nodes;
    if (!nodes || nodes.length === 0) return '';
    return `
=== PLANNED NODES ===
The argument was written to engage these nodes: ${nodes.join(', ')}.
Verify each appears in taxonomy_refs with a substantive relevance explanation. You may add additional discovered connections beyond these.
`;
  } catch {
    return '';
  }
}

/** Extract a compact moves-only summary from the full plan JSON.
 *  Returns just planned_moves + target_nodes — no strategic rationale. */
export function extractCitePlanContext(planJson: string): string {
  try {
    const plan = JSON.parse(planJson);
    const parts: string[] = [];
    if (plan?.planned_moves?.length) {
      const moves = plan.planned_moves.map((m: { move?: string; target?: string }) =>
        m.target ? `${m.move} → ${m.target}` : m.move,
      );
      parts.push(`Planned moves: ${moves.join(', ')}`);
    }
    if (plan?.target_nodes?.length) {
      parts.push(`Target nodes: ${plan.target_nodes.join(', ')}`);
    }
    return parts.length > 0 ? parts.join('\n') : '';
  } catch {
    return '';
  }
}

export function citeStagePrompt(
  input: StagePromptInput,
  plan: string,
  draft: string,
): string {
  let refsHistoryBlock = '';
  if (input.priorRefs && input.priorRefs.length > 0) {
    const recent = Array.from(new Set(input.priorRefs));
    refsHistoryBlock = `\n=== RECENT CITATIONS ===
For context, these nodes were cited in recent turns: ${recent.join(', ')}.
This does NOT mean you should avoid them — cite whatever the statement actually drew from.\n`;
  }

  const planContext = extractCitePlanContext(plan);
  const planBlock = planContext ? `\n=== PLANNED MOVES ===\n${planContext}\n` : '';

  return `You are a grounding analyst. Your task is to annotate a debate statement with precise taxonomy references, policy connections, and dialectical move annotations.

=== DRAFT STATEMENT ===
${draft}

=== TAXONOMY CONTEXT ===
${input.taxonomyContext}
${refsHistoryBlock}${buildPlannedNodesBlock(plan)}${planBlock}
Ground the draft statement in the taxonomy. For each connection:
1. TAXONOMY REFS: Tag 3-5 taxonomy nodes that the statement draws from. Cover at least two BDI sections. For each, explain in 1-4 sentences how the node informed the argument. Every node_id MUST appear verbatim in the TAXONOMY CONTEXT above — do not invent IDs.
2. POLICY REFS: Identify any policy actions the argument supports, opposes, or implies. For each, explain in 1-2 sentences how the argument connects to the policy — what it supports, what it challenges, or what it implies for implementation. Do not just list IDs.
3. GROUNDING CONFIDENCE: Rate 0-1 how well the statement is grounded in the taxonomy (1.0 = every claim traceable to a node, 0.5 = loosely connected, 0.0 = no taxonomy basis).

Do NOT include move_annotations — dialectical moves are tracked from the argument plan.

Respond ONLY with a JSON object (no markdown, no code fences):
{
  "taxonomy_refs": [
    {"node_id": "<a real node_id from TAXONOMY CONTEXT>", "relevance": "1-4 sentences: how this node informed the argument"},
    {"node_id": "<a real node_id from TAXONOMY CONTEXT>", "relevance": "1-4 sentences explaining connection"},
    {"node_id": "<a real node_id from TAXONOMY CONTEXT>", "relevance": "1-4 sentences explaining connection"}
  ],
  "policy_refs": [
    {"policy_id": "pol-001", "relevance": "1-2 sentences: how the argument relates to this policy"},
    {"policy_id": "pol-012", "relevance": "1-2 sentences: how the argument relates to this policy"}
  ],
  "grounding_confidence": 0.85
}`;
}

/**
 * Re-call the cite stage for refs flagged as filler.
 * Asks the model to either strengthen the relevance with a specific mechanism or drop the ref.
 */
export function citeRetryPrompt(
  weakRefs: { node_id: string; relevance: string }[],
  draft: string,
  taxonomyContext: string,
): string {
  const refsList = weakRefs.map(r =>
    `- ${r.node_id}: "${r.relevance}"`
  ).join('\n');

  return `You are a grounding analyst. The following taxonomy_refs were flagged as having filler or too-generic relevance explanations. For each ref, either:
(A) STRENGTHEN — rewrite the relevance with a specific mechanism: what claim in the statement does this node support or complicate, and how? (≥40 chars, mention a concrete concept from the node)
(B) DROP — if the connection is too tenuous to explain with a specific mechanism, omit it from your output.

=== FLAGGED REFS ===
${refsList}

=== DRAFT STATEMENT ===
${draft}

=== TAXONOMY CONTEXT ===
${taxonomyContext}

Respond ONLY with a JSON object (no markdown, no code fences):
{
  "taxonomy_refs": [
    {"node_id": "...", "relevance": "Strengthened relevance explaining the specific mechanism..."}
  ]
}

Only include refs you can genuinely strengthen. Drop any ref where the connection is too vague to explain concretely.`;
}

// ── Draft quality pre-check prompt ──────────────────────

export function draftQualityCheckPrompt(
  statement: string,
  lastOpponentStatement: string | undefined,
  speaker: string,
  pov: string,
  phase: DebatePhase,
  round: number,
  plannedMoves?: { move: string; target?: string; detail: string }[],
  beliefConfidences?: { nodeId: string; label: string; confidence: number }[],
): string {
  const plannedMovesBlock = plannedMoves && plannedMoves.length > 0
    ? `
PLANNED MOVES (from the debater's strategic plan — these are AUTHORIZED):
${plannedMoves.map(pm => `- ${pm.move}${pm.target ? ` (targeting: ${pm.target})` : ''}: ${pm.detail}`).join('\n')}

IMPORTANT: Do NOT flag the draft for executing these planned moves. If the draft uses REFRAME, DISTINGUISH, CONCEDE-AND-PIVOT, or any other move listed above, that is correct execution of the plan. Only flag weaknesses in HOW a move is executed (e.g., vague claims, missing evidence), never flag WHETHER a planned move should be used.
`
    : '';

  const confidenceBlock = beliefConfidences && beliefConfidences.length > 0
    ? `
BELIEF CONFIDENCE LEVELS (for rhetoric calibration):
${beliefConfidences.map(b => `- ${b.nodeId} (${b.confidence.toFixed(2)}): ${b.label}`).join('\n')}

Assess whether the debater's rhetoric matches the evidential basis:
- Citing a high-confidence (≥0.70) Belief as "established fact" → appropriate
- Citing a low-confidence (<0.50) Belief as "established fact" → weakness
- Citing a low-confidence Belief with appropriate hedging → appropriate
- Building an entire argument on a single low-confidence Belief → structural weakness
`
    : '';

  const hasConfidence = beliefConfidences && beliefConfidences.length > 0;
  const scope = getTopicScope();
  const hasScope = hasMeaningfulScope(scope);

  const hasOpponent = !!lastOpponentStatement;
  let qNum = 2;
  const engagesQuestion = hasOpponent
    ? `\n${++qNum}. ENGAGES — Does the draft's first paragraph respond to the opponent's most recent core argument, rather than introducing an unrelated point?`
    : '';
  const engagesField = hasOpponent ? `,\n  "engages": true` : '';

  const confidenceQuestion = hasConfidence
    ? `\n${++qNum}. CALIBRATED — Does the draft's rhetoric match the evidential strength of the Beliefs it cites? (Treating speculative claims as settled fact = no; hedging uncertain claims = yes)`
    : '';
  const confidenceField = hasConfidence ? `,\n  "calibrated": true` : '';

  const topicAlignedQuestion = hasScope
    ? `\n${++qNum}. TOPIC_ALIGNED — Is the draft's core thesis about the debate topic? Pass if the argument's conclusion addresses the stated scope, even when it draws cross-domain analogies or precedents as supporting evidence. Analogical reasoning from other domains is legitimate argumentation — only fail if the argument's thesis itself concerns a different domain, or if the draft develops an off-scope argument across multiple paragraphs without connecting back to the debate question. Do NOT fail for lacking domain-specific evidence (that is a GROUNDED issue, not alignment).
  Scope: ${scope!.example_ceiling}${scope!.excluded_scenarios.length > 0 ? `\n  Excluded: ${scope!.excluded_scenarios.join(', ')}` : ''}${scope!.explicit_qualifiers.length > 0 ? `\n  User qualifiers: ${scope!.explicit_qualifiers.join(', ')}` : ''}`
    : '';
  const topicAlignedField = hasScope ? `,\n  "topic_aligned": true` : '';

  const scopeContextBlock = hasScope
    ? `\nDebate scope: ${scope!.core_proposition}\nExample ceiling: ${scope!.example_ceiling}\n`
    : '';

  const opponentBlock = hasOpponent
    ? `Prior turn (last opponent):\n${lastOpponentStatement!.slice(0, 600)}`
    : 'This is the opening turn — no prior opponent statement.';

  return `You are a debate-draft quality gate. Answer ${qNum} yes/no questions about this draft statement. Do NOT judge overall quality — only flag structural defects that the debater should fix before grounding citations.

Phase: ${phase}
Speaker: ${speaker} (${pov})
Round: ${round}
${plannedMovesBlock}${confidenceBlock}${scopeContextBlock}
${opponentBlock}

Draft statement:
${statement}

Questions:
1. GROUNDED — Does the draft make at least one claim backed by a specific fact, number, named entity, or data point? (Not: "AI could be dangerous" — Yes: "GPT-4 scores 86th percentile on the bar exam")
2. FALSIFIABLE — Does the draft contain at least one prediction or claim that could be proven wrong with evidence? (Not: "AI might cause problems someday" — Yes: "By 2028, ≥3 major democracies will have mandatory AI audit requirements")${engagesQuestion}${confidenceQuestion}${topicAlignedQuestion}

Return ONLY JSON, no prose:
{
  "grounded": true,
  "falsifiable": true${engagesField}${confidenceField}${topicAlignedField},
  "weaknesses": ["≤15 words each, only for failed questions, max ${qNum}"]
}`;
}
