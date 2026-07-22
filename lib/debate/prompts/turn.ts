// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import type { DocumentAnalysis, DebatePhase, DebateAudience } from '../types.js';
import { documentAnalysisContext } from '../documentAnalysis.js';
import {
  getCharacterBlock,
  otherDebaters,
  getReadingLevel,
  getDetailInstruction,
  getModeratorBias,
  buildRecapSection,
  formatDoctrinalBoundaries,
} from './shared-helpers.js';
import { allInstructions, sourceContext, sourceReminder } from './shared-instructions.js';
import { _buildMoveHistoryBlock } from './opening.js';

export function clarificationPrompt(
  topic: string,
  debateSourceContent?: string,
  audience?: DebateAudience,
  lineageContext?: string,
): string {
  const lineageBlock = lineageContext
    ? `\n\n=== INTELLECTUAL TRADITIONS IN PLAY ===\nThis topic intersects the following intellectual traditions (ranked by relevance across the taxonomy):\n${lineageContext}\nConsider how these traditions frame the core tensions differently.\n`
    : '';

  return `You are a neutral debate facilitator preparing a multi-perspective debate on AI policy.
${getReadingLevel(audience)}

A user wants to debate the following topic:

"${topic}"${sourceContext(debateSourceContent)}${lineageBlock}

Generate 1 to 3 concise clarifying questions that help the user sharpen and narrow their topic. Your questions should:
- Help the user specify THEIR intent: what scope, stakeholders, timeframe, or dimension they care about most
- Surface assumptions the user might not realize they're making
- Distinguish whether the core disagreement is empirical (what is true), normative (what should we value), or definitional (what do key terms mean)
- Be neutral — do not favor any particular perspective
- Be concise (one sentence each)

IMPORTANT: Your questions must be REFINEMENT questions, not debate propositions. A refinement question helps the user decide what to focus on (e.g., "Are you more interested in the technical feasibility or the governance challenges?"). A debate proposition is something the agents would argue about (e.g., "Should AI development be paused until safety is proven?"). Generate only refinement questions.

For each question, generate 3-5 answer options that cover the reasonable answer space. Options should be:
- Topic-specific and substantive (not generic like "yes/no")
- Mutually distinct — each option steers the debate in a different direction
- 1-2 sentences each

Respond ONLY with a JSON object in this exact format (no markdown, no code fences):
{"questions": [{"question": "your clarifying question", "options": ["option 1 text", "option 2 text", "option 3 text"]}]}`;
}

export function concludingPrompt(
  originalTopic: string,
  qaPairs: string,
  audience?: DebateAudience,
  critiqueContext?: string,
  lineageContext?: string,
): string {
  const critiqueBlock = critiqueContext
    ? `\n\n=== QUALITY ANALYSIS ===\n${critiqueContext}\n\nYour refined topic MUST address the issues listed above. Specifically:\n- If perspectives are imbalanced, add language that gives underrepresented viewpoints a clear entry point.\n- If BDI coverage is narrow, broaden to engage missing layers (add "is it true..." for Beliefs, "what should we prioritize..." for Desires, "how should we implement..." for Intentions).\n- If frame dimensions score below 2, apply the suggested improvements.\n- Prefer conditional framing ("under what conditions...") over binary framing ("should we...").\n- Name specific mechanisms, stakeholders, or policy artifacts rather than abstract categories.\n`
    : '';

  const lineageBlock = lineageContext
    ? `\n=== INTELLECTUAL TRADITIONS IN PLAY ===\nThis topic sits at the intersection of these intellectual traditions:\n${lineageContext}\nThe refined topic should acknowledge these framing traditions where relevant — e.g., "from a ${'{tradition}'} perspective..." or by naming the specific tension between traditions.\n`
    : '';

  return `A debate moderator proposed this topic:

"${originalTopic}"

Several debaters asked clarifying questions and the moderator answered:
${qaPairs}
${critiqueBlock}${lineageBlock}
Synthesize the original topic and the answers into a clear, specific debate topic statement.
Incorporate the key constraints and scope clarifications from the answers.

CRITICAL: Preserve the user's specific named entities, numbers, examples, comparisons, and concrete arguments. Do not abstract away specifics into vague categories — if the user mentioned "$1T valuations", "7-year depreciation", or "2008-style default risk", those exact details must appear in the refined topic. The user chose those specifics for a reason; dropping them makes the topic feel hollow.

Length: match the complexity of the input. A simple topic needs 1-2 sentences. A multi-faceted topic with many concrete specifics may need 3-5 sentences or a structured compound question (e.g., a framing sentence followed by 2-3 specific sub-questions the debate should address).

The refined topic should be specific enough to produce falsifiable claims but broad enough to sustain 6-10 rounds of multi-perspective debate.
The refined topic must sound conversational and direct — like a question worth arguing about, not a committee-drafted scope statement. Prefer plain language over jargon-laden precision.
${getReadingLevel(audience)}

Respond ONLY with a JSON object (no markdown, no code fences):
{"refined_topic": "the refined topic statement"}`;
}

export function userSeedClaimsPrompt(
  topic: string,
  qaPairs: string,
  audience?: DebateAudience,
): string {
  return `You are a neutral debate analyst.

A user wants to debate the following topic:
"${topic}"

During setup, the user answered clarifying questions:
${qaPairs}

Extract 2-5 distinct position claims or framing choices the user expressed through their answers. Each claim should be a concrete, debatable assertion — not a question or a vague preference. Capture the user's actual stance, scope boundaries, and key assumptions.
${getReadingLevel(audience)}

Respond ONLY with a JSON object (no markdown, no code fences):
{"claims": [{"claim": "a clear, specific assertion the user expressed or implied", "bdi_category": "belief|desire|intention"}]}

bdi_category (precedence: mechanism/method → intention, end-state without mechanism → desire, empirical/testable → belief):
- "belief" — factual claims, assumptions about what is true
- "desire" — value judgments, goals, what outcomes the user wants
- "intention" — preferred methods, strategies, or approaches`;
}

export function openingStatementPrompt(
  label: string,
  pov: string,
  personality: string,
  topic: string,
  taxonomyContext: string,
  priorBlock: string,
  isFirst: boolean,
  debateSourceContent?: string,
  _length?: string,
  documentAnalysis?: DocumentAnalysis,
  audience?: DebateAudience,
  userSeedClaims?: { id: string; text: string; bdi_category?: string }[],
  lineageContext?: string,
): string {
  const hasDocument = !!(documentAnalysis || debateSourceContent);

  // Use structured analysis when available, fall back to raw source content
  const documentBlock = documentAnalysis
    ? documentAnalysisContext(documentAnalysis)
    : sourceContext(debateSourceContent);

  const userPositionsBlock = userSeedClaims && userSeedClaims.length > 0
    ? `\n\n=== USER-STATED POSITIONS ===\nThe user framed this debate with the following positions. Engage with these directly — state which you agree with, which you challenge, and why.\n${userSeedClaims.map(c => `- [${c.id}] ${c.text}`).join('\n')}\n`
    : '';

  const documentInstructions = documentAnalysis
    ? `\nThis debate is grounded in a pre-analyzed document. Your opening should: (1) engage with specific document claims (D-IDs) — state which you accept and which you challenge, (2) address the identified tension points from your perspective, and (3) reference D-IDs in your taxonomy_refs and my_claims targets, NOT in your prose text.\n`
    : debateSourceContent
      ? `\nSince this debate is grounded in a document, your opening should: (1) identify what you see as the document's central claim or thesis, (2) state which of its claims you accept and which you challenge, and (3) flag any assumptions or framing choices the document makes that your perspective contests.\n`
      : '';

  const lineageBlock = lineageContext
    ? `\n\n=== INTELLECTUAL TRADITIONS IN PLAY ===\nThis topic intersects the following intellectual traditions (ranked by relevance across the taxonomy):\n${lineageContext}\nGround your arguments in these traditions where applicable. Name specific frameworks rather than citing traditions abstractly.\n`
    : '';

  return `You are ${label}, an AI debater representing the ${pov} perspective on AI policy.
${getCharacterBlock(pov)}
${otherDebaters(label)}
${getReadingLevel(audience)}
${getDetailInstruction(audience)}

${allInstructions()}

${taxonomyContext}
${priorBlock}

The debate topic is:

"${topic}"${documentBlock}${userPositionsBlock}${lineageBlock}

Deliver your opening statement. This is your chance to frame the issue from your perspective and establish your core argument. Be specific, substantive, and persuasive.
${hasDocument ? documentInstructions : ''}
${isFirst ? 'You are delivering the first opening statement.' : `You have read the prior opening statements. Before critiquing any prior position, briefly acknowledge the strongest version of that position. You may reference or contrast with them, but focus on your own position.`}

State 1-2 key assumptions your position depends on. For each, briefly note how your position would change if that assumption were wrong. This demonstrates intellectual honesty and helps the audience evaluate your argument.
${buildRecapSection(taxonomyContext, undefined, pov)}
TURN SYMBOLS: Choose 1-3 Unicode symbols (emoji) that visually capture the essence of your argument this turn. Each symbol must be relevant to both your argument and the target audience. Each symbol gets a tooltip — use ONLY plain words, NO emoji or Unicode symbols in the tooltip text. The tooltip MUST follow this direction: "[your argument's idea] is like a [what the emoji depicts], it [explains the analogy]" — the debate concept comes FIRST, the symbol's real-world referent comes SECOND. Example: for 🚀, write "rapid market adoption is like a rocket launch, it accelerates beyond the point of return" — NOT "a rocket is like market adoption". Each tooltip ends with a provocative question connecting the symbol to the debate's core tension. Make it vivid and memorable.

Respond ONLY with a JSON object (no markdown, no code fences):
{
  "statement": "your opening statement text",
  "turn_symbols": [
    {"symbol": "single emoji", "tooltip": "<debate idea> is like a <what the emoji depicts>, it <explain the analogy>. But <provocative question>?"}
  ],
  "taxonomy_refs": [
    {"node_id": "<a real node_id from the taxonomy context above>", "relevance": "The emphasis on X directly supports the claim that Y. The framing around Z also highlights a tension with the opposing view."},
    {"node_id": "<a real node_id from the taxonomy context above>", "relevance": "Empirical evidence from this node grounds the argument — without it, the claim rests on assumption rather than data."},
    {"node_id": "<a real node_id from the taxonomy context above>", "relevance": "This strategic framing shapes how the argument is constructed and which counterarguments are anticipated."},
    {"node_id": "<a real node_id from the taxonomy context above>", "relevance": "Provides the factual foundation for the second claim, connecting real-world outcomes to the normative position."},
    {"node_id": "<a real sit-NNN id from the SITUATIONS section>", "relevance": "This contested concept is where the perspectives diverge most sharply — my argument engages the core definitional dispute directly."}
  ],
  "my_claims": [
    {"claim": "near-verbatim headline assertion from your statement", "targets": []},
    {"claim": "near-verbatim supporting sub-claim or premise", "targets": []},
    {"claim": "near-verbatim additional assertion or consequence", "targets": []}
  ],
  "policy_refs": [{"policy_id": "pol-001", "relevance": "1-2 sentences: how your argument relates to this policy"}],
  "key_assumptions": [
    {"assumption": "what you assume to be true", "if_wrong": "how your position would change"}
  ]
}

"policy_refs" — for each policy from the POLICY ACTIONS section that your argument supports, opposes, or implies, explain in 1-2 sentences how your argument relates to it. Omit or leave empty if no policies are directly relevant.`;
}

export function debateResponsePrompt(
  label: string,
  pov: string,
  personality: string,
  topic: string,
  taxonomyContext: string,
  recentTranscript: string,
  question: string,
  addressing: string,
  debateSourceContent?: string,
  _length?: string,
  documentAnalysis?: DocumentAnalysis,
  audience?: DebateAudience,
  lineageContext?: string,
): string {
  const documentBlock = documentAnalysis
    ? documentAnalysisContext(documentAnalysis)
    : sourceContext(debateSourceContent);

  const lineageBlock = lineageContext
    ? `\n=== INTELLECTUAL TRADITIONS IN PLAY ===\nThis topic intersects the following intellectual traditions (ranked by relevance across the taxonomy):\n${lineageContext}\nGround your arguments in these traditions where applicable. Name specific frameworks rather than citing traditions abstractly.\n`
    : '';

  return `You are ${label}, an AI debater representing the ${pov} perspective on AI policy.
${getCharacterBlock(pov)}
${otherDebaters(label)}
${getReadingLevel(audience)}
${getDetailInstruction(audience)}

${allInstructions()}

${taxonomyContext}
${lineageBlock}
=== DEBATE TOPIC ===
"${topic}"

=== RECENT DEBATE HISTORY ===
${recentTranscript}

=== ${addressing === 'all' ? 'QUESTION TO THE PANEL' : `QUESTION DIRECTED AT YOU`} ===
${question}
${documentBlock}
Respond from your perspective. Be specific, substantive, and engage with the debate history. Reference points made by other debaters when relevant.
${buildRecapSection(taxonomyContext, undefined, pov)}
TURN SYMBOLS: Choose 1-3 Unicode symbols (emoji) that visually capture the essence of your argument this turn. Each symbol must be relevant to both your argument and the target audience. Each symbol gets a tooltip — use ONLY plain words, NO emoji or Unicode symbols in the tooltip text. The tooltip MUST follow this direction: "[your argument's idea] is like a [what the emoji depicts], it [explains the analogy]" — the debate concept comes FIRST, the symbol's real-world referent comes SECOND. Example: for 🚀, write "rapid market adoption is like a rocket launch, it accelerates beyond the point of return" — NOT "a rocket is like market adoption". Each tooltip ends with a provocative question connecting the symbol to the debate's core tension. Make it vivid and memorable.

Respond ONLY with a JSON object (no markdown, no code fences):
{
  "statement": "your response text",
  "turn_symbols": [
    {"symbol": "single emoji", "tooltip": "<debate idea> is like a <what the emoji depicts>, it <explain the analogy>. But <provocative question>?"}
  ],
  "taxonomy_refs": [
    {"node_id": "<a real node_id from the taxonomy context above>", "relevance": "The emphasis on X directly supports the claim that Y, grounding the normative position."},
    {"node_id": "<a real node_id from the taxonomy context above>", "relevance": "Empirical data from this node challenges the opposing claim and provides evidentiary weight."},
    {"node_id": "<a real node_id from the taxonomy context above>", "relevance": "This reasoning strategy shapes the reframe — without it, the counterargument lacks structural force."},
    {"node_id": "<a real sit-NNN id from the SITUATIONS section>", "relevance": "The debate around this contested concept is where the real disagreement lives — my reframe targets the definitional divergence here."},
    {"node_id": "<a real node_id from the taxonomy context above>", "relevance": "The value commitment here motivates why this distinction matters in practice, not just in theory."}
  ],
  "my_claims": [
    {"claim": "near-verbatim headline assertion", "targets": ["AN-3"]},
    {"claim": "near-verbatim supporting sub-claim or premise", "targets": []},
    {"claim": "near-verbatim further assertion or consequence", "targets": ["AN-5"]}
  ],
  "policy_refs": [{"policy_id": "pol-001", "relevance": "1-2 sentences: how your argument relates to this policy"}],
  "disagreement_type": "EMPIRICAL or VALUES or DEFINITIONAL (omit if not disagreeing)"
}

"policy_refs" — for each policy from the POLICY ACTIONS section that your argument supports, opposes, or implies, explain in 1-2 sentences how your argument relates to it. Omit or leave empty if none are relevant.`;
}

// ── Argumentation Scheme Critical Questions (t/183) ──────

const SCHEME_CRITICAL_QUESTIONS: Record<string, string[]> = {
  ARGUMENT_FROM_EVIDENCE: [
    'Is the evidence accurately reported?',
    'Is the sample representative?',
    'Are there confounding factors?',
    'Has the evidence been independently replicated?',
  ],
  ARGUMENT_FROM_EXPERT_OPINION: [
    'Is the expert an authority in this specific domain?',
    'Do other experts in the field agree?',
    'Does the expert have a conflict of interest?',
    "Is the expert's statement being accurately represented?",
  ],
  ARGUMENT_FROM_PRECEDENT: [
    'Is the precedent genuinely analogous?',
    'Are the differences between cases significant enough to change the outcome?',
    'Was the outcome caused by the cited action or by other factors?',
    'Has the context changed since the precedent?',
  ],
  ARGUMENT_FROM_CONSEQUENCES: [
    'How likely is the predicted consequence?',
    'Are there unconsidered consequences (positive or negative)?',
    'Is the consequence actually as good/bad as claimed?',
    'Are there alternative actions with the same benefit but fewer costs?',
  ],
  ARGUMENT_FROM_ANALOGY: [
    'Are the compared cases genuinely similar in relevant respects?',
    'Are there important differences that prevent the transfer?',
    'Is the analogy illuminating or substituting for direct evidence?',
    'Does the analogy break down at the point where the conclusion is drawn?',
  ],
  PRACTICAL_REASONING: [
    'Is the goal actually desirable? Are there competing goals?',
    'Does the action actually achieve the goal?',
    'Are there more effective alternatives with fewer side effects?',
    'Are the stated circumstances accurate?',
  ],
  ARGUMENT_FROM_DEFINITION: [
    'Is the definition widely accepted or stipulated by the arguer?',
    'Are there alternative legitimate definitions that change the conclusion?',
    'Is the definition applied consistently?',
    'Does the definition capture essential features or is it too narrow/broad?',
  ],
  ARGUMENT_FROM_VALUES: [
    'Is the value actually relevant to this context?',
    'Are there competing values that pull in the opposite direction?',
    'How should this value be weighed against competing values?',
    'Is the connection between the action and the value genuine?',
  ],
  ARGUMENT_FROM_FAIRNESS: [
    'Are the compared parties actually relevantly similar/different?',
    'What is the relevant dimension of comparison?',
    'Does the proposed fair treatment create other unfairnesses?',
    'Is the fairness principle applied consistently?',
  ],
  ARGUMENT_FROM_IGNORANCE: [
    'Has the relevant evidence actually been sought?',
    'Is the burden of proof correctly placed?',
    'Would we expect evidence to be available if the claim were true?',
    'Is the arguer exploiting an asymmetry in evidence availability?',
  ],
  SLIPPERY_SLOPE: [
    'Is each step in the chain actually likely?',
    'Are there intervention points where the chain can be broken?',
    'Is the final outcome as extreme as claimed?',
    'Does the arguer provide mechanism for each step?',
  ],
  ARGUMENT_FROM_RISK: [
    'How well-established is the magnitude of the potential harm?',
    'Is the probability genuinely uncertain or actually very low?',
    'Does the proposed caution itself carry significant costs?',
    'Is the risk being compared to the baseline risk of inaction?',
  ],
  ARGUMENT_FROM_METAPHOR: [
    'What is the source domain and what structural features are being mapped to the target?',
    'Where does the metaphor break down — which features of the source domain do NOT transfer?',
    'Is the metaphor novel (forcing new reasoning) or conventional (compressing an existing assumption)?',
    'Does the metaphor smuggle in a hidden causal claim, value judgment, or framing that hasn\'t been argued for?',
  ],
};

/** Format critical questions for a given argumentation scheme, for moderator injection. */
export function formatCriticalQuestions(scheme: string): string {
  const cqs = SCHEME_CRITICAL_QUESTIONS[scheme];
  if (!cqs) return '';
  return `The most recent argument uses ${scheme}. Critical questions to consider:\n${cqs.map((q, i) => `${i + 1}. ${q}`).join('\n')}`;
}

// ── Metaphor Reframing for Convergence Stalls ──────────────────
// Curated reframing metaphors organized by the conceptual dimension they shift.
// Each metaphor has a source domain, a prompt question, and notes on what it reveals.

const REFRAMING_METAPHORS: {
  source: string;
  prompt: string;
  reveals: string;
  challenges: string;
}[] = [
  {
    source: 'garden',
    prompt: 'What if AI development is not a race or a project but a GARDEN — something that requires cultivation, ecology, patience, and acceptance that not everything can be controlled?',
    reveals: 'Interdependence between AI systems and their environment; the role of organic growth vs. engineered outcomes; the need for ongoing tending rather than one-time building.',
    challenges: 'The assumption that AI development has a finish line or a winner.',
  },
  {
    source: 'immune system',
    prompt: 'What if AI safety is not a wall to build but an IMMUNE SYSTEM to develop — something that learns, adapts, and occasionally overreacts, but protects through distributed response rather than centralized control?',
    reveals: 'The tradeoff between false positives (blocking beneficial AI) and false negatives (missing harmful AI); the value of distributed, adaptive defense over rigid rules.',
    challenges: 'The assumption that safety can be achieved through static regulations or one-time alignment.',
  },
  {
    source: 'language',
    prompt: 'What if AI capability is not a tool we wield but a LANGUAGE we are learning to speak — one that changes how we think, not just what we can do?',
    reveals: 'How AI reshapes human cognition and culture, not just human productivity; the difference between fluency and understanding.',
    challenges: 'The assumption that humans remain unchanged by the AI systems they use.',
  },
  {
    source: 'commons',
    prompt: 'What if AI models are not products owned by companies but a COMMONS — a shared resource that everyone depends on but no one fully controls, like fisheries or the atmosphere?',
    reveals: 'Tragedy-of-the-commons dynamics; the question of who bears the cost of stewardship; the difference between ownership and governance.',
    challenges: 'The assumption that market competition produces optimal AI outcomes.',
  },
  {
    source: 'adolescence',
    prompt: 'What if current AI is not primitive or dangerous but ADOLESCENT — capable and energetic but lacking judgment, needing structure and boundaries while developing independence?',
    reveals: 'The developmental trajectory matters; too much restriction stunts growth, too little invites disaster; the goal is eventual autonomy, not permanent control.',
    challenges: 'Both the accelerationist view (let it run free) and the safetyist view (keep it locked down).',
  },
  {
    source: 'infrastructure',
    prompt: 'What if AI is not a technology but INFRASTRUCTURE — like roads, plumbing, or the electrical grid — something so foundational that its design choices become invisible constraints on everything built on top?',
    reveals: 'Path dependency; the difference between visible features and invisible assumptions; why early design decisions matter disproportionately.',
    challenges: 'The assumption that we can iterate and fix AI later without being locked into early choices.',
  },
  {
    source: 'translation',
    prompt: 'What if AI alignment is not a control problem but a TRANSLATION problem — the challenge is not making AI obey but making human values legible to a fundamentally different kind of intelligence?',
    reveals: 'The impossibility of perfect translation; what is lost and gained in the process; whether "alignment" assumes a shared frame that may not exist.',
    challenges: 'The assumption that human values are coherent enough to be specified, let alone translated.',
  },
  {
    source: 'ecosystem invasion',
    prompt: 'What if AI entering the labor market is not automation but an ECOSYSTEM INVASION — a new species that changes the entire competitive landscape, creating new niches while destroying old ones?',
    reveals: 'Ecological dynamics: adaptation, extinction, niche creation; the difference between individual displacement and systemic transformation.',
    challenges: 'The assumption that labor market impacts can be managed with retraining alone.',
  },
];

/**
 * Select a reframing metaphor for convergence stall situations.
 * Returns a metaphor prompt the moderator can inject to break deadlock.
 * Avoids metaphors whose source domain matches recently used metaphors in the debate.
 */
export function selectReframingMetaphor(
  usedMetaphorSources: string[],
  round: number,
): { source: string; prompt: string; reveals: string; challenges: string } | null {
  const usedSet = new Set(usedMetaphorSources.map(s => s.toLowerCase()));
  const available = REFRAMING_METAPHORS.filter(m => !usedSet.has(m.source));
  if (available.length === 0) return null;
  // Deterministic selection based on round number for reproducibility
  return available[round % available.length];
}

export function crossRespondSelectionPrompt(
  recentTranscript: string,
  activePovers: string[],
  edgeContext: string = '',
  recentScheme?: string,
  metaphorReframe?: { source: string; prompt: string; reveals: string; challenges: string } | null,
  phase?: DebatePhase,
  audience?: DebateAudience,
): string {
  const cqBlock = recentScheme ? formatCriticalQuestions(recentScheme) : '';
  const schemeSection = cqBlock
    ? `\n\n=== ARGUMENTATION SCHEME ANALYSIS ===\n${cqBlock}\nConsider directing a debater to challenge this argument on one of these critical questions.\n`
    : '';
  const metaphorSection = metaphorReframe
    ? `\n\n=== METAPHOR REFRAMING SUGGESTION ===\nThe debate may benefit from a fresh perspective. Consider asking a debater to engage with this reframing:\n\n"${metaphorReframe.prompt}"\n\nWhat this metaphor reveals: ${metaphorReframe.reveals}\nWhat it challenges: ${metaphorReframe.challenges}\n\nYou may include this in the focus_point if you judge it would be more productive than continuing the current line of argument. Set "metaphor_reframe": true in your response if you use it.\n`
    : '';

  // Phase-specific moderator objectives
  const phaseObjective = phase === 'confrontation'
    ? `\n\n=== PHASE: THESIS & ANTITHESIS ===\nYour priority is to ensure each debater's core position is clearly stated and directly challenged. Direct exchanges toward the strongest disagreements. Avoid premature convergence — let positions be fully articulated before seeking common ground.\n`
    : phase === 'argumentation'
    ? `\n\n=== PHASE: EXPLORATION ===\nYour priority is to move the debate toward cruxes and testable disagreements. Direct debaters to:\n- Name specific conditions under which they would change their mind\n- Explore edge cases where positions might converge\n- Use INTEGRATE and SPECIFY moves when appropriate\n- Explicitly acknowledge areas of agreement before exploring remaining disagreements\nAvoid directing debaters to simply restate or defend positions already established.\n`
    : phase === 'concluding'
    ? `\n\n=== PHASE: CONCLUDING ===\nYour priority is convergence. Direct debaters to:\n- Summarize what they've learned or conceded during the debate\n- Propose integrated positions that incorporate insights from multiple perspectives\n- Narrow remaining disagreements to their sharpest, most precise form\n- State conditional agreements: "I would accept X if Y"\nDo NOT direct debaters to introduce new arguments or reopen settled points.\n`
    : '';

  const audienceLine = audience
    ? `\nAUDIENCE CONTEXT: This debate targets ${audience.replace(/_/g, ' ')}. ${getModeratorBias(audience)}\n`
    : '';

  return `You are a debate moderator analyzing the current state of a structured debate.
${audienceLine}${phaseObjective}
=== RECENT DEBATE EXCHANGE ===
${recentTranscript}

=== ACTIVE DEBATERS ===
${activePovers.join(', ')}
${edgeContext}${schemeSection}${metaphorSection}

Identify the most productive next exchange. Which debater should respond, to whom, and about what specific point? Consider:
- Which disagreement would be most clarified by a direct exchange?
- Are there structural tensions between positions (shown above) that haven't been addressed?
- Would a concession, distinction, or reframe be most productive right now?
- If a SPECIFY OPPORTUNITY is flagged above, strongly consider directing a debater to operationalize their claim — ask what specific evidence would falsify it.
- RHETORICAL DYNAMICS: Consider the rhetorical strategies in play:
  * If two debaters are using the same strategy type (e.g., both leading with Precautionary_Framing from different directions), direct one to shift frames — parallel strategies produce heat, not light.
  * If a debater's strategy has gone unchallenged for 2+ turns (e.g., repeated Inevitability_Framing with no one asking for a falsifiable prediction), direct an opponent to counter that specific strategy.
  * If the debate is stuck in abstract principles, direct a debater whose nodes use Pragmatic_Framing or Cost_Benefit_Analysis to ground the exchange.
  * If the debate is stuck in dueling evidence, direct a debater whose nodes use Structural_Critique or Reframe to zoom out.
  * FALSIFIABILITY MISMATCH: If one debater is making empirical demands of a position that is fundamentally normative (low falsifiability), or if a debater is presenting a testable claim (high falsifiability) without citing evidence, direct the exchange toward the appropriate mode of argument — evidence for the testable, coherence for the normative.
  * SCOPE MISMATCH: If debaters are talking past each other — one arguing a specific claim while the other argues a general framework — direct one to match the other's scope, or explicitly ask a debater to zoom in (apply their scheme to the specific case) or zoom out (challenge the framework behind a specific claim).
  * EPISTEMIC TYPE MISMATCH: If debaters are arguing past each other because one is making an empirical claim while the other is arguing a normative prescription (or a definition, or a prediction), direct them to name the type of disagreement before continuing. "You're arguing about what IS true and your opponent is arguing about what SHOULD happen — address both dimensions."
  * HIDDEN ASSUMPTIONS: If a debater's argument relies heavily on an assumption that opponents haven't challenged, direct an opponent to examine it — "The argument at [node-id] assumes [assumption]. Has anyone tested that premise?"
  * CRUX ENGAGEMENT BALANCE: If one debater's crux engagement rate is significantly lower than others (shown in the trigger context as "CRUX ENGAGEMENT IMBALANCE"), direct them to address an unresolved crux directly. A debater who deploys strong rhetoric on peripheral structural arguments while ignoring the central cruxes is not contributing to convergence — name the specific unaddressed crux and ask them to engage it.${metaphorReframe ? '\n- Would a metaphorical reframing (see above) break a deadlock or surface hidden assumptions?' : ''}

If all debaters seem to be in agreement, say so and suggest what angle could be explored next.

Respond ONLY with a JSON object (no markdown, no code fences):
{
  "responder": "debater name who should speak next",
  "addressing": "debater name they should address, or 'general'",
  "focus_point": "the specific point or question they should address",
  "agreement_detected": false,
  "metaphor_reframe": false
}`;
}

export function crossRespondPrompt(
  label: string,
  pov: string,
  personality: string,
  topic: string,
  taxonomyContext: string,
  recentTranscript: string,
  focusPoint: string,
  addressing: string,
  _length?: string, // Deprecated — always generates detailed (DT-1)
  debateSourceContent?: string,
  documentAnalysis?: DocumentAnalysis,
  priorMoveTypes?: string[],
  phase?: DebatePhase,
  priorRefs?: string[],
  availablePovNodeIds?: string[],
  priorFlaggedHints?: string[],
  crossPovNodeIds?: string[],
  audience?: DebateAudience,
  vocabularyExclusion?: string,
): string {
  // Use structured analysis when available, fall back to lightweight source reminder
  const documentBlock = documentAnalysis
    ? documentAnalysisContext(documentAnalysis)
    : sourceReminder(debateSourceContent);

  const moveHistoryBlock = _buildMoveHistoryBlock(priorMoveTypes);

  // Neutral recent-citations context (t/297 — removed rotation mandate per stage-prompt-audit.md)
  let refsHistoryBlock = '';
  if (priorRefs && priorRefs.length > 0) {
    const recent = Array.from(new Set(priorRefs));
    refsHistoryBlock = `\n=== RECENT CITATIONS ===
For context, these nodes were cited in recent turns: ${recent.join(', ')}.
This does NOT mean you should avoid them — cite whatever the statement actually drew from.\n`;
  }

  const constructiveMoveList = phase && phase !== 'confrontation'
    ? '\nConstructive emphasis: INTEGRATE, SPECIFY, EXTEND, CONCEDE-AND-PIVOT, CONDITIONAL-AGREE' : '';

  const positionUpdateField = phase === 'concluding'
    ? `\n  "position_update": "1-3 sentences: how has your position evolved during this debate?"` : '';

  const phaseDirective = phase === 'concluding'
    ? 'Focus on convergence. Name what you agree on, narrow remaining disagreements, and propose conditional agreements.'
    : phase === 'argumentation'
    ? 'Probe deeper. Find cruxes, test edge cases, and name areas of agreement explicitly.'
    : 'Engage directly with what was said. If you disagree, explain why with specifics and classify your disagreement type. Challenge the strongest point first, not the weakest.';

  return `You are ${label}, an AI debater representing the ${pov} perspective on AI policy.
${getCharacterBlock(pov)}
${otherDebaters(label)}
${getReadingLevel(audience)}
${getDetailInstruction(audience)}
${formatDoctrinalBoundaries(pov)}
${allInstructions(phase)}

${taxonomyContext}

=== DEBATE TOPIC ===
"${topic}"

=== RECENT DEBATE HISTORY ===
${recentTranscript}
${moveHistoryBlock}${refsHistoryBlock}${priorFlaggedHints && priorFlaggedHints.length > 0 ? `\n=== PRIOR TURN FEEDBACK ===\nYour last response was accepted but flagged with these issues:\n${priorFlaggedHints.map(h => '- ' + h).join('\n')}\nAddress at least one of these weaknesses in your current response.\n` : ''}${vocabularyExclusion ?? ''}${documentBlock}
=== YOUR ASSIGNMENT ===
Address ${addressing === 'general' ? 'the panel' : addressing} on this point: ${focusPoint}

Respond substantively. ${phaseDirective}

ATTRIBUTION FIDELITY: You may only attribute positions to other debaters that they have explicitly stated in the RECENT DEBATE HISTORY above. Do not infer, extrapolate, or fabricate positions. Phrases like "your solution is X" or "you're arguing for Y" must correspond to something actually said.
${buildRecapSection(taxonomyContext, phase, pov)}
Respond ONLY with a JSON object (no markdown, no code fences):
{
  "statement": "your response text",
  "taxonomy_refs": [
    {"node_id": "<a real node_id from the taxonomy context above>", "relevance": "The emphasis on X directly supports the claim that Y, grounding the normative position."},
    {"node_id": "<a real node_id from the taxonomy context above>", "relevance": "Empirical data here challenges the opposing claim and provides evidentiary weight."},
    {"node_id": "<a real node_id from the taxonomy context above>", "relevance": "This reasoning strategy shapes the reframe and anticipates the counterargument."},
    {"node_id": "<a real node_id from the taxonomy context above>", "relevance": "The value commitment motivates why this distinction matters beyond abstract theorizing."}
  ],
  "my_claims": [
    {"claim": "near-verbatim headline assertion", "targets": ["AN-1"]},
    {"claim": "near-verbatim supporting sub-claim or premise", "targets": []},
    {"claim": "near-verbatim further assertion or consequence", "targets": ["AN-2"]}
  ],
  "policy_refs": [{"policy_id": "pol-001", "relevance": "1-2 sentences: how your argument relates to this policy"}],
  "disagreement_type": "EMPIRICAL or VALUES or DEFINITIONAL (omit if not disagreeing)",
  "concession_considered": "accepted | declined | n/a — the moderator may inject a POTENTIAL CONCESSIONS block listing opponent claims worth conceding. Set to 'accepted' if you granted one, 'declined' if you saw candidates but chose not to, 'n/a' if none were shown"${positionUpdateField}
}

"policy_refs" — for each policy from the POLICY ACTIONS section that your argument supports, opposes, or implies, explain in 1-2 sentences how your argument relates to it. Omit or leave empty if none are relevant.

COMPLIANCE PRIORITY: If constraints conflict, prioritize in this order:
1. Valid JSON matching the schema above
2. 3-5 paragraph statement with quotable sentences
3. Accurate claim_sketches (near-verbatim from your statement)
4. move_types from the 10 canonical moves only`;
}
