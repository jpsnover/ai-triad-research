// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import type { PromptEnvelope } from './cacheTypes.js';
import type { StagePromptInput } from './prompts.js';
import type { SpeakerId } from './types.js';
import { documentAnalysisContext } from './documentAnalysis.js';
import {
  _MUST_CORE_BEHAVIORS,
  _MUST_EXTENDED,
  _STEELMAN_INSTRUCTION,
  _PHASE_INSTRUCTIONS,
  _otherDebaters,
  _getReadingLevel,
  _getDetailInstruction,
  _sourceReminder,
  _buildMoveHistoryBlock,
} from './prompts.js';

// ── Layer 1 constants (immutable per prompt family) ──────

const DRAFT_LAYER1 = Object.freeze(
  [_MUST_CORE_BEHAVIORS, _MUST_EXTENDED, _STEELMAN_INSTRUCTION].join('\n\n')
);

function simpleHash(str: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
}

const DRAFT_LAYER1_HASH = simpleHash(DRAFT_LAYER1);

export const RECENCY_ANCHOR = Object.freeze(
  'Reminder: Your response must strictly follow all MUST_CORE_BEHAVIORS ' +
  'and STEELMAN_INSTRUCTION rules defined earlier in this conversation.'
);

// ── Envelope builders ────────────────────────────────────

export function briefStageEnvelope(input: StagePromptInput): PromptEnvelope {
  const documentBlock = input.documentAnalysis
    ? documentAnalysisContext(input.documentAnalysis)
    : _sourceReminder(input.sourceContent);

  return {
    layer1_static: '',

    layer2_persona: `You are an analytical assistant preparing a situation brief for ${input.label}, who represents the ${input.pov} perspective on AI policy.\n\nYour task is to comprehend the current state of the debate and identify what matters most for ${input.label}'s next response. This is pure analysis — do not write any debate statement or adopt the debater's voice.`,

    layer3_turn: [
      input.taxonomyContext,
      `=== DEBATE TOPIC ===\n"${input.topic}"${documentBlock}`,
      input.phase ? _PHASE_INSTRUCTIONS[input.phase] : '',
    ].filter(s => s.length > 0).join('\n\n'),

    layer4_variable: [
      `=== RECENT DEBATE HISTORY ===\n${input.recentTranscript}`,
      `=== ASSIGNMENT FOR NEXT TURN ===\n${input.label} must address ${input.addressing === 'general' ? 'the panel' : input.addressing} on: ${input.focusPoint}`,
      `Analyze the debate state and produce a structured brief. Focus on:
1. What is the current state of the debate? What just happened?
2. What are the most important claims that need addressing? Include the AN-ID if available.
3. What commitments have been made that constrain or enable ${input.label}'s response?
4. What structural tensions exist that ${input.label} could exploit or must navigate?
5. What does the current debate phase demand?

Respond ONLY with a JSON object (no markdown, no code fences):
{
  "situation_assessment": "2-4 sentences describing the current debate state and what just happened",
  "key_claims_to_address": [
    {"claim": "the claim text or summary", "speaker": "who made it", "an_id": "AN-ID if known", "grounding": [{"node_id": "acc-beliefs-003", "why": "anchors the response to this claim"}]}
  ],
  "relevant_commitments": [
    {"speaker": "who", "commitment": "what was committed", "type": "asserted | conceded | challenged"}
  ],
  "edge_tensions": [
    {"edge": "brief description of the tension", "relevance": "how it could be used"}
  ],
  "phase_considerations": "1-2 sentences on what the current phase demands and how it shapes strategy"
}`,
    ].join('\n\n'),

    meta: {
      promptType: 'brief',
      persona: input.label.toLowerCase() as SpeakerId,
      audience: input.audience,
      phase: input.phase,
    },
  };
}

export function planStageEnvelope(input: StagePromptInput, brief: string): PromptEnvelope {
  const moveHistoryBlock = _buildMoveHistoryBlock(input.priorMoves, input.turnsSinceLastConcession);

  const flaggedBlock = input.priorFlaggedHints && input.priorFlaggedHints.length > 0
    ? `\n=== PRIOR TURN FEEDBACK ===\nYour last response was accepted but flagged with these issues:\n${input.priorFlaggedHints.map(h => '- ' + h).join('\n')}\nAddress at least one of these weaknesses in your plan.\n`
    : '';

  const constructiveMoveList = input.phase && input.phase !== 'confrontation'
    ? '\nConstructive moves also available: INTEGRATE, CONDITIONAL-AGREE, NARROW, STEEL-BUILD'
    : '';

  // Build intervention block for plan stage
  let interventionBlock = '';
  const pi = input.pendingIntervention;
  if (pi) {
    if (pi.isTargeted) {
      interventionBlock = `=== MODERATOR DIRECTIVE — DIRECTED AT YOU ===\nThe moderator issued a ${pi.move} intervention directed at you.${pi.directResponsePattern ? `\nDirective: ${pi.directResponsePattern}` : ''}\nYou MUST plan how to respond to this directive. Your plan must include a directive_response_plan that describes how your first paragraph will directly address the moderator's request.\n`;
    } else {
      interventionBlock = `=== MODERATOR DIRECTIVE — DIRECTED AT ${pi.targetDebater.toUpperCase()} ===\nThe moderator issued a ${pi.move} intervention directed at ${pi.targetDebater} (not you).\nConsider how the moderator's point relates to your own position and plan a brief acknowledgment in your opening.\n`;
    }
  }

  const directiveField = pi
    ? `,\n  "directive_response_plan": "${pi.isTargeted ? '1-3 sentences: how you will directly respond to the moderator directive in your opening paragraph' : '1 sentence: brief acknowledgment of the moderator directive as it relates to your position'}"`
    : '';

  return {
    layer1_static: '',

    layer2_persona: `You are ${input.label}, planning your argumentative strategy for your next debate turn.\nYour personality: ${input.personality}.\nYour perspective: ${input.pov}.`,

    layer3_turn: input.taxonomyContext,

    layer4_variable: [
      `=== SITUATION BRIEF ===\n${brief}`,
      moveHistoryBlock,
      flaggedBlock,
      interventionBlock,
      `=== AVAILABLE DIALECTICAL MOVES ===\nCore moves: DISTINGUISH, COUNTEREXAMPLE, CONCEDE-AND-PIVOT, REFRAME, EMPIRICAL CHALLENGE, EXTEND, UNDERCUT, SPECIFY, GROUND-CHECK, CONDITIONAL-AGREE, IDENTIFY-CRUX, INTEGRATE, STEEL-BUILD, EXPOSE-ASSUMPTION, BURDEN-SHIFT${constructiveMoveList}\n\nEach move should be an object: {"move": "MOVE_NAME", "target": "AN-ID (optional)", "detail": "what you will do"}`,
      `Plan your argumentative strategy. Consider:
1. What is your strategic goal for this turn? What should it accomplish?
2. Which 1-3 dialectical moves will you use, and in what order?
3. Which prior claims (by AN-ID) will you engage with?
4. What is the structure of your argument — how will you open, develop, and close?
5. How might opponents respond, and how does your plan account for that?
6. What taxonomy nodes or policy evidence do you need to cite?${pi ? '\n7. How will you respond to the moderator directive?' : ''}

Respond ONLY with a JSON object (no markdown, no code fences):
{
  "strategic_goal": "1-2 sentences: what this turn should accomplish",
  "planned_moves": [
    {"move": "DISTINGUISH", "target": "AN-3", "detail": "Separate regulatory capture from legitimate oversight"},
    {"move": "EXTEND", "detail": "Build on the innovation metrics argument with new evidence"}
  ],
  "target_claims": ["AN-3", "AN-7"],
  "argument_sketch": "2-4 sentences outlining the argument structure: opening move, main thrust, closing",
  "anticipated_responses": ["Sentinel will likely counter with precautionary principle", "Cassandra may challenge the evidence base"],
  "evidence_needed": ["acc-beliefs-003 for empirical grounding", "pol-012 for policy connection"]${directiveField}
}`,
    ].filter(s => s.length > 0).join('\n\n'),

    meta: {
      promptType: 'plan',
      persona: input.label.toLowerCase() as SpeakerId,
      audience: input.audience,
      phase: input.phase,
    },
  };
}

export function draftStageEnvelope(
  input: StagePromptInput, brief: string, plan: string,
): PromptEnvelope {
  const phaseDirective = input.phase === 'concluding'
    ? 'Focus on convergence. Name what you agree on, narrow remaining disagreements, and propose conditional agreements.'
    : input.phase === 'argumentation'
    ? 'Probe deeper. Find cruxes, test edge cases, and name areas of agreement explicitly.'
    : 'Engage directly with what was said. If you disagree, explain why with specifics and classify your disagreement type. Challenge the strongest point first, not the weakest.';

  const positionUpdateField = input.phase === 'concluding'
    ? `,\n  "position_update": "1-3 sentences: how has your position evolved during this debate?"` : '';

  // Build intervention response block
  let interventionBlock = '';
  const pi = input.pendingIntervention;
  if (pi) {
    if (pi.isTargeted && pi.directResponsePattern) {
      interventionBlock = `\n=== MODERATOR DIRECTIVE — YOU MUST RESPOND DIRECTLY ===
The moderator issued a ${pi.move} intervention directed at you.

${pi.directResponsePattern}

CRITICAL: Your first paragraph IS your response to the moderator. It must be unambiguous — a reader should know your answer from those 2-3 sentences alone, without reading further. Do not bury your answer in qualifications. Do not hedge across multiple paragraphs. State your position, give one reason, stop. Your substantive argument goes in paragraphs 2-4.\n`;
    } else if (!pi.isTargeted) {
      interventionBlock = `\n=== MODERATOR DIRECTIVE — DIRECTED AT ${pi.targetDebater.toUpperCase()} ===
The moderator issued a ${pi.move} intervention directed at ${pi.targetDebater} (not you).
Your first sentence should briefly acknowledge the moderator's point as it relates to your own position (e.g., "The moderator's question to ${pi.targetDebater} about [topic] also bears on my argument because..."). Keep it to 1-2 sentences, then proceed with your substantive argument.\n`;
    }
  }

  const paragraphNote = pi?.isTargeted
    ? ' The first paragraph is your direct response to the moderator (short — 2-3 sentences max). Paragraphs 2-4 are your substantive argument.'
    : '';

  return {
    layer1_static: DRAFT_LAYER1,

    layer2_persona: [
      `You are ${input.label}, an AI debater representing the ${input.pov} perspective on AI policy.`,
      `Your personality: ${input.personality}.`,
      _otherDebaters(input.label),
    ].join('\n'),

    layer3_turn: [
      _getReadingLevel(input.audience),
      _getDetailInstruction(input.audience),
      input.taxonomyContext,
    ].join('\n\n'),

    layer4_variable: [
      `=== SITUATION BRIEF ===\n${brief}`,
      `=== YOUR ARGUMENT PLAN ===\n${plan}`,
      interventionBlock,
      `=== YOUR ASSIGNMENT ===\nAddress ${input.addressing === 'general' ? 'the panel' : input.addressing} on this point: ${input.focusPoint}`,
      phaseDirective,
      `Execute the argument plan above. Write your debate statement following the plan's structure and moves. Stay in character as ${input.label}.

PARAGRAPH STRUCTURE: Your "statement" MUST contain 3–5 paragraphs separated by \\n\\n. Each paragraph develops one distinct idea.${paragraphNote}

NODE-ID PROHIBITION: Never surface AN-IDs or taxonomy node IDs in your statement text. Use plain language.

CLAIM SKETCHING: Identify 3-6 claims from your statement — the headline assertion AND supporting sub-claims. For each, extract a near-verbatim sentence and note which prior claims it engages with.

TURN SYMBOLS: Choose 1-3 Unicode symbols (emoji) that visually capture the essence of your argument this turn. Each symbol must be relevant to both your argument and the target audience. For example, a policymaker audience might see a scales-of-justice symbol for a regulatory argument, while a general public audience might see a shield symbol for a safety argument. Each symbol gets a tooltip — use ONLY plain words, NO emoji or Unicode symbols in the tooltip text. Format: "<core concept> is like a <plain-word description of symbol>, it <explain the analogy>" — make it vivid and memorable.

Respond ONLY with a JSON object (no markdown, no code fences):
{
  "statement": "your full debate response (3-5 paragraphs)",
  "turn_symbols": [
    {"symbol": "single emoji", "tooltip": "<core concept> is like a <word describing the symbol>, it <explain the analogy in one sentence>"}
  ],
  "claim_sketches": [
    {"claim": "near-verbatim sentence from your statement", "targets": ["AN-3"]},
    {"claim": "near-verbatim supporting sub-claim", "targets": []}
  ],
  "key_assumptions": [
    {"assumption": "a key assumption your argument depends on", "if_wrong": "what changes if this assumption fails"}
  ],
  "disagreement_type": "EMPIRICAL or VALUES or DEFINITIONAL (omit if not disagreeing)"${positionUpdateField}
}`,
      RECENCY_ANCHOR,
    ].join('\n\n'),

    meta: {
      promptType: 'draft',
      persona: input.label.toLowerCase() as SpeakerId,
      audience: input.audience,
      phase: input.phase,
      layer1Hash: DRAFT_LAYER1_HASH,
    },
  };
}

export function citeStageEnvelope(
  input: StagePromptInput, brief: string, plan: string, draft: string,
): PromptEnvelope {
  let refsHistoryBlock = '';
  if (input.priorRefs && input.priorRefs.length > 0) {
    const recent = Array.from(new Set(input.priorRefs));
    const uncited = input.availablePovNodeIds
      ? input.availablePovNodeIds.filter(id => !recent.includes(id)).slice(0, 20)
      : [];
    const uncitedLine = uncited.length > 0
      ? `\nNodes from your POV you have NOT yet cited (sample): ${uncited.join(', ')}.`
      : '';
    const crossPovLine = input.crossPovNodeIds && input.crossPovNodeIds.length > 0
      ? `\nYou may also cite nodes from other POVs when engaging directly with their claims. Sample cross-POV nodes: ${input.crossPovNodeIds.slice(0, 8).join(', ')}.`
      : '';
    refsHistoryBlock = `\n=== RECENT CITATIONS ===\nRecently cited: ${recent.join(', ')}.\nREQUIRED: At least 1-2 of this turn's taxonomy_refs must be node_ids NOT in that list.${uncitedLine}${crossPovLine}\n`;
  }

  return {
    layer1_static: '',

    layer2_persona: 'You are a grounding analyst. Your task is to annotate a debate statement with precise taxonomy references, policy connections, and dialectical move annotations.',

    layer3_turn: [
      `=== TAXONOMY CONTEXT ===\n${input.taxonomyContext}`,
      refsHistoryBlock,
    ].filter(s => s.length > 0).join('\n'),

    layer4_variable: [
      `=== SITUATION BRIEF ===\n${brief}`,
      `=== ARGUMENT PLAN ===\n${plan}`,
      `=== DRAFT STATEMENT ===\n${draft}`,
      `Ground the draft statement in the taxonomy. For each connection:
1. TAXONOMY REFS: Tag 4-6 taxonomy nodes that the statement draws from. Cover all three BDI sections (Beliefs, Desires, Intentions). For each, explain in 1-4 sentences how the node informed the argument.
2. POLICY REFS: Identify any policy actions the argument supports, opposes, or implies.
3. MOVE ANNOTATIONS: Finalize the dialectical move annotations. For each move actually executed in the statement (not just planned), provide the move name, optional AN-ID target, and a brief description.
4. GROUNDING CONFIDENCE: Rate 0-1 how well the statement is grounded in the taxonomy (1.0 = every claim traceable to a node, 0.5 = loosely connected, 0.0 = no taxonomy basis).

Respond ONLY with a JSON object (no markdown, no code fences):
{
  "taxonomy_refs": [
    {"node_id": "acc-beliefs-003", "relevance": "1-4 sentences: how this node informed the argument"},
    {"node_id": "acc-desires-002", "relevance": "1-4 sentences explaining connection"},
    {"node_id": "acc-intentions-001", "relevance": "1-4 sentences explaining connection"}
  ],
  "policy_refs": ["pol-001", "pol-012"],
  "move_annotations": [
    {"move": "DISTINGUISH", "target": "AN-3", "detail": "Separated regulatory capture from legitimate oversight"},
    {"move": "EXTEND", "detail": "Built on innovation metrics with new evidence"}
  ],
  "grounding_confidence": 0.85
}`,
    ].join('\n\n'),

    meta: {
      promptType: 'cite',
      persona: input.label.toLowerCase() as SpeakerId,
      audience: input.audience,
      phase: input.phase,
    },
  };
}
