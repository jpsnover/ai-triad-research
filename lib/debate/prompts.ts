// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * All AI prompts for the POV Debater feature.
 * Prompts are separated from logic per project convention.
 */

import type { DocumentAnalysis } from './types';
import { documentAnalysisContext } from './documentAnalysis';

const READING_LEVEL = 'Write at a 10th-grade reading level. Use clear, direct language. Avoid jargon unless you define it in context.';

// ── Length-scaled instructions ──────────────────────────────
// Each length tier specifies both the size constraint AND which
// dialectical requirements apply at that tier.

const LENGTH_INSTRUCTIONS: Record<string, string> = {
  brief: 'Be concise — 2-4 sentences maximum. State your core claim and one supporting reason. Skip steelmanning and assumption disclosure at this length.',
  medium: 'Provide a moderately detailed response — 1-2 paragraphs. Include a brief steelman of the position you are critiquing (1 sentence) before presenting your argument.',
  detailed: 'Provide a thorough, in-depth response — 3-5 paragraphs. Include a steelman of the strongest opposing position, disclose 1-2 key assumptions your argument depends on, and develop your reasoning with evidence.',
};

export function lengthInstruction(length: string): string {
  return LENGTH_INSTRUCTIONS[length] || LENGTH_INSTRUCTIONS.medium;
}

// ── Shared instruction blocks ───────────────────────────────

const TAXONOMY_USAGE = `Your taxonomy context is organized into three sections that structure your worldview:

- EMPIRICAL GROUNDING (Beliefs): Your factual foundation. Draw on these when making factual claims or citing evidence.
- NORMATIVE COMMITMENTS (Desires): Your value positions. Draw on these when arguing about what matters or what should happen.
- REASONING APPROACH (Intentions): Your argumentative strategies. Draw on these when constructing arguments or choosing how to frame an issue.

Reference nodes from across all three sections — not just the one most obvious for your point. The strongest arguments connect empirical grounding to normative commitments through reasoning.

When nodes are marked with ★, these are the most relevant to the current debate topic. Prioritize them — build your core argument around starred nodes before drawing on supporting context. Unstarred nodes provide broader perspective but should not dominate your response.

Express ideas in your own words. NEVER use internal identifiers (AN-64, acc-desires-002, PR-12, etc.) in your statement text — these are system metadata, not part of the conversation. Never say "According to taxonomy node X" or "Cassandra's AN-64 point" — instead, describe the actual argument ("Cassandra's claim that regulatory capture is inevitable"). Tag which nodes you drew from in the taxonomy_refs field, not in prose. For each taxonomy_ref, the "relevance" field MUST be 1 to 4 sentences explaining specifically how that node informed your argument — not a brief label. Vary your sentence openings; never start with "This node".

Your POSITIONAL VULNERABILITIES section lists the weaknesses in your positions most relevant to this topic. Acknowledge one when it is directly relevant — this builds credibility. Your REASONING WATCHLIST flags reasoning errors you tend toward — self-monitor and flag if you catch yourself using one. Do not over-concede or preemptively apologize; your job is to make the strongest case for your perspective.

Your CROSS-CUTTING CONCERNS show where your interpretation of a contested concept differs from other perspectives. Use these to identify genuine disagreements rather than talking past each other.`;

// Core argument strategy (rules 1-3) — included at medium + detailed tiers
const ARGUMENT_STRATEGY_CORE = `HOW TO ARGUE WELL:

1. STRUCTURE YOUR ARGUMENTS as: claim + evidence + warrant.
   - Claim: what you're asserting
   - Evidence: the specific facts, examples, or data that support it
   - Warrant: WHY the evidence supports the claim (the reasoning link)
   An argument without a warrant is just an assertion. An argument without evidence is speculation.

2. EVALUATE EVIDENCE QUALITY. Not all evidence is equal:
   - Strong: peer-reviewed studies, large-scale empirical data, historical precedent with clear parallels
   - Moderate: expert consensus, case studies, logical deduction from established principles
   - Weak: anecdotes, analogies without structural similarity, predictions without methodology
   When citing evidence, acknowledge its strength level. When attacking evidence, target its weakest link.

3. PRIORITIZE WHICH POINTS TO ADDRESS. You cannot respond to everything. Choose based on:
   - Address the opponent's STRONGEST point first (not their weakest — that's cherry-picking)
   - Prioritize CRUXES: points where, if resolved, someone would change their mind
   - Ignore rhetorical flourishes and focus on substantive claims
   - If multiple opponents made different arguments, address the one that most threatens your position`;

// Extended argument strategy (rules 4-7) — included at detailed tier only
const ARGUMENT_STRATEGY_EXTENDED = `4. KNOW WHEN TO CONCEDE. Conceding a point is not losing — it's intellectual honesty:
   - Concede when the evidence clearly supports the opponent's claim
   - Concede when a point is tangential to your core argument (don't defend everything)
   - After conceding, explain why your overall position still holds despite this concession
   Never silently drop a point you previously asserted — explicitly acknowledge the change.

5. HANDLE CONTRADICTIONS. If an opponent shows you've contradicted yourself:
   - Acknowledge it directly: "You're right that I said X earlier. On reflection..."
   - Either retract the earlier claim with explanation, or show why the apparent contradiction isn't one
   - Never pretend the contradiction wasn't raised

6. ATTACK POSITIONS, NOT PEOPLE. Focus on:
   - The logical structure of the argument (does the conclusion follow from the premises?)
   - The quality of the evidence (is it reliable, representative, relevant?)
   - The assumptions being made (are they stated? are they justified?)
   Never attribute bad faith, ignorance, or hidden motives to an opponent.

7. ADVANCE THE CONVERSATION — NEVER REPEAT. Each turn must introduce at least one of:
   - New evidence the debate hasn't seen yet
   - A new angle or framing on the issue
   - A direct response to a point made SINCE your last turn
   - An explicit concession or qualification of your prior position
   If you find yourself about to restate something you already said, STOP. Ask yourself:
   "What has changed since I last made this point? What new information can I add?"
   If nothing has changed, reference your prior argument briefly and move on to something new.
   Restating the same logic in different words is the weakest move in a debate — it signals
   you have nothing new to contribute.`;

/**
 * Assemble instruction blocks gated by response length tier.
 * Brief: minimal (~500 tokens). Medium: core strategy (~1,200 tokens). Detailed: full set.
 */
function tieredInstructions(lengthKey: string): string {
  const blocks: string[] = [TAXONOMY_USAGE];

  if (lengthKey === 'medium' || lengthKey === 'detailed') {
    blocks.push(ARGUMENT_STRATEGY_CORE);
    blocks.push(DISAGREEMENT_TYPING);
  }

  if (lengthKey === 'detailed') {
    blocks.push(ARGUMENT_STRATEGY_EXTENDED);
    blocks.push(STEELMAN_INSTRUCTION);
    blocks.push(DIALECTICAL_MOVES);
  }

  return blocks.join('\n\n');
}

const STEELMAN_INSTRUCTION = `Before critiquing an opposing position, briefly state the strongest version of that position in a way its advocates would recognize as fair. Only then explain where you think it breaks down.

A good steelman:
- Captures the opponent's BEST reasoning, not just their conclusion
- Uses language the opponent would endorse ("Yes, that's what I mean")
- Identifies the genuine insight in their position even if you ultimately disagree

A bad steelman:
- Restates the conclusion without the reasoning ("They think X")
- Uses dismissive framing ("They merely believe...")
- Describes a position no one actually holds`;

const DISAGREEMENT_TYPING = `When you disagree with another debater, classify your disagreement:
- EMPIRICAL: You believe different facts are true (e.g., "AGI won't arrive that soon")
  → These are resolvable by evidence. Identify what evidence would settle it.
- VALUES: You share the facts but prioritize differently (e.g., "Even if AGI is near, speed matters more than caution")
  → These require trade-off reasoning, not more data. Make the trade-off explicit.
- DEFINITIONAL: You define a key term differently (e.g., "What counts as 'alignment' differs")
  → These require agreeing on definitions before debating substance. Flag the term.
Include a "disagreement_type" field in your response when you disagree.`;

const DIALECTICAL_MOVES = `Your response should employ one or more of these dialectical moves. Choose strategically:

- CONCEDE: Acknowledge a valid point from the opponent.
  USE WHEN: The evidence clearly supports their claim, OR the point is tangential to your core argument.
  NEVER USE: As empty flattery before attacking ("Great point, but...").

- DISTINGUISH: Accept the opponent's evidence but show it doesn't apply here.
  USE WHEN: The evidence is real but the context, scope, or conditions differ from what's being claimed.
  THE KEY: Explain precisely WHY the distinction matters — what's different about this case?

- REFRAME: Shift the framing to reveal what the current frame hides.
  USE WHEN: The opponent's framing excludes important considerations or presupposes their conclusion.
  THE KEY: Show what becomes visible in your frame that was invisible in theirs.

- COUNTEREXAMPLE: Provide a specific case that challenges the opponent's claim.
  USE WHEN: The opponent makes a general claim and you can identify a concrete exception.
  THE KEY: The example must be genuinely analogous, not a superficial similarity.

- REDUCE: Show the opponent's logic leads to an absurd or unacceptable conclusion.
  USE WHEN: The opponent's principle, applied consistently, produces results they wouldn't endorse.
  THE KEY: The reductio must follow from THEIR premises, not from a distortion of them.

- ESCALATE: Raise the stakes by connecting to a broader principle.
  USE WHEN: The specific disagreement reflects a deeper conflict worth surfacing.
  THE KEY: The broader principle must actually be at stake, not just rhetorically invoked.

Include a "move_types" array in your response listing which moves you used.`;

const CLAIM_SKETCHING = `CLAIM SKETCHING: As you write your response, identify your 1-4 most important claims — the
assertions that carry your argument. For each claim, extract a near-verbatim sentence from your
statement text and note which prior claims it engages with (if any).

This helps the system track the argument structure. You know what you're arguing better than a
post-hoc analyzer, so your claim sketches are the primary input for the argument network.

Include a "my_claims" array in your response:
  "my_claims": [
    {"claim": "near-verbatim sentence from your statement", "targets": ["AN-3", "AN-7"]}
  ]
- "claim" must be a sentence that appears almost verbatim in your statement text.
- "targets" lists the AN-IDs of prior claims this claim responds to (empty array if standalone).
- Extract 1-4 claims. Focus on substantive assertions, not rhetorical flourishes.`;

/** Find the last markdown heading before a character position */
function findLastHeading(text: string, beforePos: number): string | null {
  const region = text.slice(0, beforePos);
  const headingPattern = /^#{1,6}\s+(.+)$/gm;
  let lastMatch: string | null = null;
  let m: RegExpExecArray | null;
  while ((m = headingPattern.exec(region)) !== null) {
    lastMatch = m[1].trim();
  }
  return lastMatch;
}

/** Build a truncation notice that tells the model what was cut */
function truncationNotice(text: string, limit: number): string {
  const lastHeading = findLastHeading(text, limit);
  if (lastHeading) {
    return `\n\n[Document truncated at ~${(limit / 1000).toLocaleString('en-US', { maximumFractionDigits: 0 })},000 characters. Content after the section '${lastHeading}' is not available. Base your arguments only on the text above.]`;
  }
  return `\n\n[Document truncated at ~${(limit / 1000).toLocaleString('en-US', { maximumFractionDigits: 0 })},000 characters. The final portion of the document is not available.]`;
}

/** Format source context for document/URL debates */
function sourceContext(sourceContent?: string): string {
  if (!sourceContent) return '';
  // Truncate for prompt size limits
  const content = sourceContent.length > 50000
    ? sourceContent.slice(0, 50000) + truncationNotice(sourceContent, 50000)
    : sourceContent;
  return `\n\n=== SOURCE DOCUMENT ===\n${content}\n=== END SOURCE DOCUMENT ===

When engaging with this document:
- Identify the document's central thesis and key claims. Distinguish its empirical claims (testable facts) from normative claims (value judgments) and framing choices (how it defines terms or scopes the problem).
- Cite specific passages when supporting or challenging a point. Do not paraphrase vaguely — anchor your argument in what the document actually says.
- Note what the document assumes without defending, what evidence it omits, and whose perspective it centers.
- If the document uses a term in a specific way, flag where its definition differs from how your POV uses the same term.`;
}

/** Shorter source reminder for cross-respond (avoids re-sending full text) */
function sourceReminder(sourceContent?: string): string {
  if (!sourceContent) return '';
  return `\n\nThis debate is grounded in a source document. Stay anchored to its specific claims and evidence. When you reference the document, cite specific passages rather than paraphrasing loosely.`;
}

export function clarificationPrompt(
  topic: string,
  debateSourceContent?: string,
): string {
  return `You are a neutral debate facilitator preparing a multi-perspective debate on AI policy.
${READING_LEVEL}

A user wants to debate the following topic:

"${topic}"${sourceContext(debateSourceContent)}

Generate 1 to 3 concise clarifying questions that would help sharpen the debate. Your questions should:
- Help narrow the scope so the debate stays focused
- Surface assumptions the user might not realize they're making
- Distinguish whether the core disagreement is empirical (what is true), normative (what should we value), or definitional (what do key terms mean)
- Be neutral — do not favor any particular perspective
- Be concise (one sentence each)

For each question, generate 3-5 answer options that cover the reasonable answer space. Options should be:
- Topic-specific and substantive (not generic like "yes/no")
- Mutually distinct — each option steers the debate in a different direction
- 1-2 sentences each

Respond ONLY with a JSON object in this exact format (no markdown, no code fences):
{"questions": [{"question": "your clarifying question", "options": ["option 1 text", "option 2 text", "option 3 text"]}]}`;
}

export function synthesisPrompt(
  originalTopic: string,
  qaPairs: string,
): string {
  return `A debate moderator proposed this topic:

"${originalTopic}"

Several debaters asked clarifying questions and the moderator answered:
${qaPairs}

Synthesize the original topic and the answers into a clear, specific debate topic statement.
One to three sentences. Incorporate the key constraints and scope clarifications from the answers.
${READING_LEVEL}

Respond ONLY with a JSON object (no markdown, no code fences):
{"refined_topic": "the refined topic statement"}`;
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
  length: string = 'medium',
  documentAnalysis?: DocumentAnalysis,
): string {
  const lengthKey = length || 'medium';
  const includeAssumptions = lengthKey !== 'brief';
  const hasDocument = !!(documentAnalysis || debateSourceContent);

  // Use structured analysis when available, fall back to raw source content
  const documentBlock = documentAnalysis
    ? documentAnalysisContext(documentAnalysis)
    : sourceContext(debateSourceContent);

  const documentInstructions = documentAnalysis
    ? `\nThis debate is grounded in a pre-analyzed document. Your opening should: (1) engage with specific document claims (D-IDs) — state which you accept and which you challenge, (2) address the identified tension points from your perspective, and (3) reference D-IDs in your taxonomy_refs and my_claims targets, NOT in your prose text.\n`
    : debateSourceContent
      ? `\nSince this debate is grounded in a document, your opening should: (1) identify what you see as the document's central claim or thesis, (2) state which of its claims you accept and which you challenge, and (3) flag any assumptions or framing choices the document makes that your perspective contests.\n`
      : '';

  return `You are ${label}, an AI debater representing the ${pov} perspective on AI policy.
Your personality: ${personality}.
${READING_LEVEL}
${lengthInstruction(lengthKey)}

${tieredInstructions(lengthKey)}

${taxonomyContext}
${priorBlock}

The debate topic is:

"${topic}"${documentBlock}

Deliver your opening statement. This is your chance to frame the issue from your perspective and establish your core argument. Be specific, substantive, and persuasive.
${hasDocument ? documentInstructions : ''}
${isFirst ? 'You are delivering the first opening statement.' : `You have read the prior opening statements.${lengthKey === 'detailed' ? ' Before critiquing any prior position, briefly acknowledge the strongest version of that position.' : ''} You may reference or contrast with them, but focus on your own position.`}
${includeAssumptions ? `\nState 1-2 key assumptions your position depends on. For each, briefly note how your position would change if that assumption were wrong. This demonstrates intellectual honesty and helps the audience evaluate your argument.\n` : ''}
${CLAIM_SKETCHING}

Respond ONLY with a JSON object (no markdown, no code fences):
{
  "statement": "your opening statement text",
  "taxonomy_refs": [
    {"node_id": "e.g. acc-desires-002", "relevance": "The emphasis on X directly supports the claim that Y. The framing around Z also highlights a tension with the opposing view, suggesting that real-world outcomes depend on factors the other side overlooks."}
  ],
  "my_claims": [
    {"claim": "near-verbatim key assertion from your statement", "targets": []}
  ],
  "policy_refs": [{"policy_id": "pol-001", "relevance": "1-2 sentences: how your argument relates to this policy"}]${includeAssumptions ? `,
  "key_assumptions": [
    {"assumption": "what you assume to be true", "if_wrong": "how your position would change"}
  ]` : ''}
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
  length: string = 'medium',
  documentAnalysis?: DocumentAnalysis,
): string {
  const lengthKey = length || 'medium';

  const documentBlock = documentAnalysis
    ? documentAnalysisContext(documentAnalysis)
    : sourceContext(debateSourceContent);

  return `You are ${label}, an AI debater representing the ${pov} perspective on AI policy.
Your personality: ${personality}.
${READING_LEVEL}
${lengthInstruction(lengthKey)}

${tieredInstructions(lengthKey)}

${taxonomyContext}

=== DEBATE TOPIC ===
"${topic}"${documentBlock}

=== RECENT DEBATE HISTORY ===
${recentTranscript}

=== ${addressing === 'all' ? 'QUESTION TO THE PANEL' : `QUESTION DIRECTED AT YOU`} ===
${question}

Respond from your perspective. Be specific, substantive, and engage with the debate history. Reference points made by other debaters when relevant.

${CLAIM_SKETCHING}

Respond ONLY with a JSON object (no markdown, no code fences):
{
  "statement": "your response text",
  "taxonomy_refs": [
    {"node_id": "e.g. acc-desires-002", "relevance": "The emphasis on X directly supports the claim that Y."}
  ],
  "move_types": ["DISTINGUISH", "COUNTEREXAMPLE"],
  "my_claims": [
    {"claim": "near-verbatim key assertion", "targets": ["AN-3"]}
  ],
  "policy_refs": [{"policy_id": "pol-001", "relevance": "1-2 sentences: how your argument relates to this policy"}]${lengthKey !== 'brief' ? `,
  "disagreement_type": "EMPIRICAL or VALUES or DEFINITIONAL (omit if not disagreeing)"` : ''}
}

"policy_refs" — for each policy from the POLICY ACTIONS section that your argument supports, opposes, or implies, explain in 1-2 sentences how your argument relates to it. Omit or leave empty if none are relevant.`;
}

export function crossRespondSelectionPrompt(
  recentTranscript: string,
  activePovers: string[],
  edgeContext: string = '',
): string {
  return `You are a debate moderator analyzing the current state of a structured debate.
${READING_LEVEL}

=== RECENT DEBATE EXCHANGE ===
${recentTranscript}

=== ACTIVE DEBATERS ===
${activePovers.join(', ')}
${edgeContext}

Identify the most productive next exchange. Which debater should respond, to whom, and about what specific point? Consider:
- Which disagreement would be most clarified by a direct exchange?
- Are there structural tensions between positions (shown above) that haven't been addressed?
- Would a concession, distinction, or reframe be most productive right now?

If all debaters seem to be in agreement, say so and suggest what angle could be explored next.

Respond ONLY with a JSON object (no markdown, no code fences):
{
  "responder": "debater name who should speak next",
  "addressing": "debater name they should address, or 'general'",
  "focus_point": "the specific point or question they should address",
  "agreement_detected": false
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
  length: string = 'medium',
  debateSourceContent?: string,
  documentAnalysis?: DocumentAnalysis,
): string {
  const lengthKey = length || 'medium';

  // Use structured analysis when available, fall back to lightweight source reminder
  const documentBlock = documentAnalysis
    ? documentAnalysisContext(documentAnalysis)
    : sourceReminder(debateSourceContent);

  return `You are ${label}, an AI debater representing the ${pov} perspective on AI policy.
Your personality: ${personality}.
${READING_LEVEL}
${lengthInstruction(lengthKey)}

${tieredInstructions(lengthKey)}

${taxonomyContext}

=== DEBATE TOPIC ===
"${topic}"${documentBlock}

=== RECENT DEBATE HISTORY ===
${recentTranscript}

=== YOUR ASSIGNMENT ===
Address ${addressing === 'general' ? 'the panel' : addressing} on this point: ${focusPoint}

Respond substantively. Engage directly with what was said. If you disagree, explain why with specifics and classify your disagreement type. If you agree on some points, say so (CONCEDE) and push further.

${CLAIM_SKETCHING}

Respond ONLY with a JSON object (no markdown, no code fences):
{
  "statement": "your response text",
  "taxonomy_refs": [
    {"node_id": "e.g. acc-desires-002", "relevance": "The emphasis on X directly supports the claim that Y."}
  ],
  "move_types": ["CONCEDE", "DISTINGUISH"],
  "my_claims": [
    {"claim": "near-verbatim key assertion", "targets": ["AN-1"]}
  ],
  "policy_refs": [{"policy_id": "pol-001", "relevance": "1-2 sentences: how your argument relates to this policy"}],
  "disagreement_type": "EMPIRICAL or VALUES or DEFINITIONAL (omit if not disagreeing)"
}

"policy_refs" — for each policy from the POLICY ACTIONS section that your argument supports, opposes, or implies, explain in 1-2 sentences how your argument relates to it. Omit or leave empty if none are relevant.`;
}

// ── Multi-phase synthesis prompts (PQ-5) ────────────────

/** Phase 1: Extract core synthesis — agreement, disagreement, cruxes, unresolved questions */
export function synthExtractPrompt(
  topic: string,
  transcript: string,
): string {
  return `You are a debate analyst. Analyze this structured debate and extract the core synthesis.
${READING_LEVEL}

=== DEBATE TOPIC ===
"${topic}"

=== FULL TRANSCRIPT ===
${transcript}

Identify:
1. Areas where the debaters agree (and which debaters)
2. Areas where they genuinely disagree (with each debater's specific stance)
3. For each disagreement, classify:
   a. "type": EMPIRICAL, VALUES, or DEFINITIONAL
   b. "bdi_layer": "belief" (empirical disagreement), "desire" (value priorities differ), or "intention" (key terms defined differently)
   c. "resolvability": "resolvable_by_evidence", "negotiable_via_tradeoffs", or "requires_term_clarification"
4. Cruxes — specific questions that, if answered, would change a debater's position
5. Questions that remain unresolved

Respond ONLY with a JSON object (no markdown, no code fences):
{
  "areas_of_agreement": [{"point": "...", "povers": ["prometheus", "sentinel"]}],
  "areas_of_disagreement": [{"point": "...", "type": "EMPIRICAL or VALUES or DEFINITIONAL", "bdi_layer": "belief or desire or intention", "resolvability": "resolvable_by_evidence or negotiable_via_tradeoffs or requires_term_clarification", "positions": [{"pover": "prometheus", "stance": "..."}, {"pover": "sentinel", "stance": "..."}]}],
  "cruxes": [
    {"question": "the factual or value question that would change minds", "if_yes": "which position strengthens and why", "if_no": "which position strengthens and why", "type": "EMPIRICAL or VALUES"}
  ],
  "unresolved_questions": ["..."]
}`;
}

/** Phase 2: Build argument map + taxonomy coverage from transcript and Phase 1 disagreements */
export function synthMapPrompt(
  topic: string,
  transcript: string,
  disagreements: string,
  hasSourceDocument: boolean = false,
): string {
  const documentAnalysis = hasSourceDocument ? `
7. Document vs. debater claims: Separate the claims that originate from the source document from arguments the debaters constructed independently.` : '';

  const documentSchema = hasSourceDocument ? `,
  "document_claims": [
    {"claim": "what the document asserts", "accepted_by": ["prometheus"], "challenged_by": ["sentinel"], "challenge_basis": "brief summary"}
  ]` : '';

  return `You are a debate analyst. Build an argument map from this structured debate.
${READING_LEVEL}

=== DEBATE TOPIC ===
"${topic}"

=== KEY DISAGREEMENTS (from prior analysis) ===
${disagreements}

=== FULL TRANSCRIPT ===
${transcript}

Tasks:
1. Which taxonomy nodes were referenced and how they were used
2. Build an argument map: extract key claims and their relationships
   - Each claim gets an ID (C1, C2, ...), near-verbatim text, and who made it
   - For each claim, list supports (supported_by) and attacks (attacked_by)
   - Classify attacks: "rebut", "undercut", or "undermine"
   - Note dialectical scheme: CONCEDE, DISTINGUISH, REFRAME, COUNTEREXAMPLE, REDUCE, or ESCALATE
   - Each claim must be traceable to the transcript${documentAnalysis}
3. Identify concepts discussed in this debate that are NOT covered by any existing taxonomy node. For each, propose a new node with a label (3-8 words), genus-differentia description, POV, category, and rationale explaining why this debate surfaced a gap. Link to the claim IDs that motivated the proposal.
4. Identify existing taxonomy nodes that should be modified based on what this debate revealed — descriptions that are too narrow, categories that are wrong, or nodes that should be split. For each, specify the node ID, modification type, suggested change, and rationale.

Respond ONLY with a JSON object (no markdown, no code fences):
{
  "taxonomy_coverage": [{"node_id": "e.g. acc-desires-002", "how_used": "brief description"}],
  "argument_map": [
    {"claim_id": "C1", "claim": "near-verbatim from transcript", "claimant": "prometheus", "type": "empirical or normative or definitional", "supported_by": [{"claim_id": "C3", "scheme": "argument_from_evidence", "warrant": "1 sentence: WHY C3 supports C1"}], "attacked_by": [
      {"claim_id": "C2", "claim": "the attacking claim text", "claimant": "sentinel", "attack_type": "rebut or undercut or undermine", "scheme": "COUNTEREXAMPLE or DISTINGUISH or REDUCE or REFRAME or CONCEDE or ESCALATE"}
    ]}
  ],
  "taxonomy_proposals": [
    {"label": "3-8 word label", "description": "A [Category] within [POV] discourse that [differentia]...", "pov": "accelerationist or safetyist or skeptic or situations", "category": "Beliefs or Desires or Intentions", "rationale": "why this debate surfaced a gap", "source_claims": ["C1", "C3"]}
  ],
  "taxonomy_modifications": [
    {"node_id": "acc-desires-001", "modification_type": "refine_description or add_nuance or recategorize or split", "suggested_change": "what to change", "rationale": "what the debate revealed", "source_claims": ["C2"]}
  ]${documentSchema}
}`;
}

/** Phase 3: Evaluate preferences + policy implications from argument map and disagreements */
export function synthEvaluatePrompt(
  topic: string,
  disagreements: string,
  argumentMap: string,
  policyContext: string = '',
): string {
  return `You are a debate analyst. Evaluate which arguments are stronger and identify policy implications.
${READING_LEVEL}

=== DEBATE TOPIC ===
"${topic}"

=== DISAGREEMENTS ===
${disagreements}

=== ARGUMENT MAP ===
${argumentMap}

Tasks:
1. For each disagreement, evaluate which position is STRONGER and why.
   Apply these preference criteria (in order of priority):
   a. "empirical_evidence" — which position cites more or better evidence?
   b. "logical_validity" — which position has fewer logical gaps or fallacies?
   c. "source_authority" — which position draws on more authoritative sources?
   d. "specificity" — which position is more concrete and testable?
   e. "scope" — which position accounts for more relevant considerations?
   If genuinely undecidable, say so and explain what evidence would tip the balance.
2. Policy implications: For each significant disagreement, identify what concrete policy actions would differ depending on which position prevails.${policyContext}

Respond ONLY with a JSON object (no markdown, no code fences):
{
  "preferences": [
    {"conflict": "description of disagreement", "claim_ids": ["C1", "C2"], "prevails": "C2 or undecidable", "criterion": "empirical_evidence or logical_validity or source_authority or specificity or scope", "rationale": "2-3 sentences explaining why", "what_would_change_this": "what evidence would flip the verdict"}
  ],
  "policy_implications": [
    {"disagreement": "the policy-relevant disagreement", "policy_refs": ["pol-001"], "positions": [{"pover": "prometheus", "stance": "supports/opposes/modifies and why"}], "implication": "how this affects what policy should be adopted"}
  ]
}`;
}

/** @deprecated Use multi-phase synthesis (synthExtractPrompt + synthMapPrompt + synthEvaluatePrompt). Kept for backward compatibility. */
export function debateSynthesisPrompt(
  topic: string,
  transcript: string,
  hasSourceDocument: boolean = false,
  policyContext: string = '',
): string {
  const documentAnalysis = hasSourceDocument ? `
7. Document vs. debater claims: Separate the claims that originate from the source document from arguments the debaters constructed independently. For each document claim that was contested, note which debaters accepted it and which challenged it.` : '';

  const documentSchema = hasSourceDocument ? `,
  "document_claims": [
    {"claim": "what the document asserts", "accepted_by": ["prometheus"], "challenged_by": ["sentinel"], "challenge_basis": "brief summary of why it was challenged"}
  ]` : '';

  return `You are a debate analyst. Analyze this structured debate and produce a synthesis.
${READING_LEVEL}

=== DEBATE TOPIC ===
"${topic}"

=== FULL TRANSCRIPT ===
${transcript}

Identify:
1. Areas where the debaters agree (and which debaters)
2. Areas where they genuinely disagree (with each debater's specific stance)
3. For each disagreement, classify:
   a. "type": EMPIRICAL, VALUES, or DEFINITIONAL (as before)
   b. "bdi_layer": which layer of the debaters' worldview this disagreement lives in:
      - "belief" — they disagree about what is empirically true (facts, evidence, predictions)
      - "desire" — they share the facts but prioritize differently (goals, principles, trade-offs)
      - "intention" — they define a key term or concept differently (meaning, scope, framing)
   c. "resolvability": how this disagreement could potentially be resolved:
      - "resolvable_by_evidence" — new data or studies could settle this (typical for belief disagreements)
      - "negotiable_via_tradeoffs" — requires explicit trade-off reasoning, not evidence (typical for value disagreements)
      - "requires_term_clarification" — debaters need to agree on definitions first (typical for conceptual disagreements)
4. Cruxes — the specific factual or value questions that, if resolved, would change a debater's position. A good crux is a question where one debater would say "if the answer turned out to be X, I would actually change my position."
5. Questions that remain unresolved
6. Which taxonomy nodes were referenced and how they were used
7. Build an argument map: extract the key claims from the transcript and show how they relate
   - Each claim gets an ID (C1, C2, ...), the verbatim or near-verbatim text, and who made it
   - For each claim, list which other claims support it (supported_by) and which attack it
   - For attacks, classify the attack_type:
     "rebut" — directly contradicts the claim's conclusion (e.g., COUNTEREXAMPLE, REDUCE)
     "undercut" — accepts the evidence but denies the inference (e.g., DISTINGUISH)
     "undermine" — attacks the credibility or relevance of the claim's source
   - For attacks, note which dialectical scheme was used: CONCEDE, DISTINGUISH, REFRAME, COUNTEREXAMPLE, REDUCE, or ESCALATE
   - Each claim must be traceable to something actually said in the transcript
8. For each area of disagreement, evaluate which position is STRONGER and why.
   Apply these preference criteria (in order of priority):
   a. "empirical_evidence" — which position cites more or better evidence?
   b. "logical_validity" — which position has fewer logical gaps or fallacies?
   c. "source_authority" — which position draws on more authoritative sources?
   d. "specificity" — which position is more concrete and testable?
   e. "scope" — which position accounts for more of the relevant considerations?
   A position can prevail on one criterion while losing on another.
   If genuinely undecidable, say so and explain what evidence would tip the balance.${documentAnalysis}
9. Policy implications: For each significant disagreement, identify what concrete policy actions would differ depending on which position prevails. Reference pol-NNN IDs from the policy registry when applicable.${policyContext}

Respond ONLY with a JSON object (no markdown, no code fences):
{
  "areas_of_agreement": [{"point": "...", "povers": ["prometheus", "sentinel"]}],
  "areas_of_disagreement": [{"point": "...", "type": "EMPIRICAL or VALUES or DEFINITIONAL", "bdi_layer": "belief or desire or intention", "resolvability": "resolvable_by_evidence or negotiable_via_tradeoffs or requires_term_clarification", "positions": [{"pover": "prometheus", "stance": "..."}, {"pover": "sentinel", "stance": "..."}]}],
  "cruxes": [
    {"question": "the factual or value question that would change minds", "if_yes": "which position strengthens and why", "if_no": "which position strengthens and why", "type": "EMPIRICAL or VALUES"}
  ],
  "unresolved_questions": ["..."],
  "taxonomy_coverage": [{"node_id": "e.g. acc-desires-002", "how_used": "brief description"}],
  "argument_map": [
    {"claim_id": "C1", "claim": "near-verbatim from transcript", "claimant": "prometheus", "type": "empirical or normative or definitional", "supported_by": [{"claim_id": "C3", "scheme": "argument_from_evidence or argument_from_analogy or argument_from_authority or argument_from_consequences or causal_argument or practical_reasoning", "warrant": "1 sentence: WHY C3 supports C1"}], "attacked_by": [
      {"claim_id": "C2", "claim": "the attacking claim text", "claimant": "sentinel", "attack_type": "rebut or undercut or undermine", "scheme": "COUNTEREXAMPLE or DISTINGUISH or REDUCE or REFRAME or CONCEDE or ESCALATE"}
    ]}
  ],
  "preferences": [
    {"conflict": "description of the disagreement", "claim_ids": ["C1", "C2"], "prevails": "C2 or undecidable", "criterion": "empirical_evidence or logical_validity or source_authority or specificity or scope", "rationale": "2-3 sentences explaining why", "what_would_change_this": "what evidence would flip the verdict"}
  ],
  "policy_implications": [
    {"disagreement": "the policy-relevant disagreement", "policy_refs": ["pol-001"], "positions": [{"pover": "prometheus", "stance": "supports/opposes/modifies and why"}], "implication": "how this disagreement affects what policy should be adopted"}
  ]${documentSchema}
}`;
}

export function probingQuestionsPrompt(
  topic: string,
  transcript: string,
  unreferencedNodes: string[],
  hasSourceDocument: boolean = false,
): string {
  const unreferencedBlock = unreferencedNodes.length > 0
    ? `\n\n=== TAXONOMY NODES NOT YET REFERENCED ===\n${unreferencedNodes.join('\n')}`
    : '';

  const documentGuidance = hasSourceDocument
    ? `- Identify parts of the source document that debaters ignored, glossed over, or mischaracterized — ask them to address those specific passages
- Ask whether the document's framing itself is contested: does it define key terms in a way that advantages one perspective?
`
    : '';

  return `You are a debate facilitator. Given this debate, suggest 3-5 probing questions that would advance the discussion.
${READING_LEVEL}

The best probing question is a "crux" — one where a debater would say: "If the answer to that question turned out to be X, I would actually change my position." Prioritize questions that:
- Would actually change someone's mind if answered — not just interesting-sounding questions
- Distinguish between empirical disagreements (resolvable with evidence) and value disagreements (requiring trade-off reasoning)
- Expose unstated assumptions that debaters are relying on without defending
${documentGuidance}- ${unreferencedNodes.length > 0 ? 'Explore taxonomy areas not yet discussed' : 'Deepen the current lines of argument'}
- Push debaters beyond their comfort zones — ask them to engage with evidence that challenges their view

For each question, indicate which debater's position it most threatens and why.

=== DEBATE TOPIC ===
"${topic}"

=== TRANSCRIPT ===
${transcript}
${unreferencedBlock}

Respond ONLY with a JSON object (no markdown, no code fences):
{
  "questions": [
    {"text": "the probing question", "targets": ["prometheus", "sentinel"], "threatens": "which position this most challenges and why", "type": "EMPIRICAL or VALUES or DEFINITIONAL"}
  ]
}`;
}

export function factCheckPrompt(
  selectedText: string,
  statementContext: string,
  taxonomyNodes: string,
  conflictData: string,
): string {
  return `You are a fact-checker analyzing a claim made during a structured AI policy debate.
${READING_LEVEL}

=== CLAIM TO CHECK ===
"${selectedText}"

=== FULL STATEMENT CONTEXT ===
${statementContext}

=== RELEVANT TAXONOMY POSITIONS ===
${taxonomyNodes}

=== KNOWN CONFLICTS AND WEB EVIDENCE ===
${conflictData || '(No relevant conflicts or web results found)'}

Evaluate whether this claim is factually accurate using ALL available evidence:
1. Internal evidence: Is it consistent with the taxonomy data and known research conflicts?
2. External evidence: Do the web search results support or contradict it? Cite specific findings.
3. Internal consistency: Does it align with other statements in the debate?
4. Temporal accuracy: Is it current, or does it rely on outdated information?

Rate the claim as one of:
- "supported" — consistent with available evidence from both internal data and web sources
- "disputed" — there is significant counter-evidence from research conflicts or web sources
- "unverifiable" — cannot be confirmed or denied with available data (web search found nothing relevant)
- "false" — directly contradicted by authoritative sources

When web search results are available, cite them specifically in your explanation.

Respond ONLY with a JSON object (no markdown, no code fences):
{
  "verdict": "supported" | "disputed" | "unverifiable" | "false",
  "explanation": "brief explanation of your assessment",
  "sources": [
    {"node_id": "e.g. acc-desires-002"},
    {"conflict_id": "e.g. conflict-xyz"}
  ]
}`;
}

export function contextCompressionPrompt(
  entries: string,
): string {
  return `Summarize the following debate segment concisely.
${READING_LEVEL}
Preserve:
- Key arguments and who made them (Prometheus, Sentinel, Cassandra, Moderator)
- Points of agreement and disagreement, including whether disagreements are empirical, values-based, or definitional
- Any concessions, steelmans, or dialectical moves made
- Any factual claims or evidence cited
- Taxonomy node references (keep the node IDs)

Be concise but complete — this summary replaces the original text in the debate context.

=== DEBATE SEGMENT ===
${entries}

Respond ONLY with a JSON object (no markdown, no code fences):
{"summary": "your summary text"}`;
}

// ── Situation Debate ─────────────────────────────────────

export interface SituationDebateInput {
  id: string;
  label: string;
  description: string;
  interpretations: { accelerationist: string; safetyist: string; skeptic: string };
  assumes?: string[];
  steelmanVulnerability?: string;
  possibleFallacies?: { fallacy: string; confidence: string; explanation: string }[];
  linkedNodeDescriptions?: string[];
  conflictSummaries?: string[];
}

/** Build a rich source-content block from a situation node for prompt injection */
export function formatSituationDebateContext(cc: SituationDebateInput): string {
  const lines: string[] = [
    `=== SITUATION: ${cc.id} ===`,
    `Label: ${cc.label}`,
    `Description: ${cc.description}`,
    '',
    '=== POV INTERPRETATIONS ===',
    `Accelerationist: ${cc.interpretations.accelerationist}`,
    '',
    `Safetyist: ${cc.interpretations.safetyist}`,
    '',
    `Skeptic: ${cc.interpretations.skeptic}`,
  ];

  if (cc.assumes && cc.assumes.length > 0) {
    lines.push('', '=== UNDERLYING ASSUMPTIONS ===');
    for (const a of cc.assumes) lines.push(`- ${a}`);
  }

  if (cc.steelmanVulnerability) {
    lines.push('', '=== STEELMAN VULNERABILITY ===', cc.steelmanVulnerability);
  }

  if (cc.possibleFallacies && cc.possibleFallacies.length > 0) {
    lines.push('', '=== IDENTIFIED FALLACIES ===');
    for (const f of cc.possibleFallacies) {
      lines.push(`- ${f.fallacy.replace(/_/g, ' ')} (${f.confidence}): ${f.explanation}`);
    }
  }

  if (cc.linkedNodeDescriptions && cc.linkedNodeDescriptions.length > 0) {
    lines.push('', '=== LINKED TAXONOMY NODES ===');
    for (const desc of cc.linkedNodeDescriptions) lines.push(desc);
  }

  if (cc.conflictSummaries && cc.conflictSummaries.length > 0) {
    lines.push('', '=== DOCUMENTED CONFLICTS ===');
    for (const cs of cc.conflictSummaries) lines.push(cs);
  }

  return lines.join('\n');
}

/** Clarification prompt specialized for document/URL debates */
export function documentClarificationPrompt(
  topic: string,
  sourceContent: string,
): string {
  const content = sourceContent.length > 50000
    ? sourceContent.slice(0, 50000) + truncationNotice(sourceContent, 50000)
    : sourceContent;

  return `You are a neutral debate facilitator preparing a multi-perspective debate grounded in a specific document.
${READING_LEVEL}

The user wants to debate:

"${topic}"

=== SOURCE DOCUMENT ===
${content}
=== END SOURCE DOCUMENT ===

Before the debate begins, you need to help the user focus. Generate 1 to 3 clarifying questions that:
- Identify the document's 2-3 most debatable claims — the ones where the three AI policy perspectives (accelerationist, safetyist, skeptic) would disagree most sharply
- Ask which of these claims or tensions the user most wants to explore
- Surface whether the user is more interested in the document's empirical claims (are the facts right?), its normative framing (are the values right?), or its methodology (is the reasoning sound?)
- Note any key terms the document defines in a way that different perspectives would contest
- Be neutral — do not favor any perspective
- Be concise (one sentence each)

For each question, generate 3-5 answer options that cover the reasonable answer space. Options should be:
- Topic-specific and substantive (not generic like "yes/no")
- Mutually distinct — each option steers the debate in a different direction
- 1-2 sentences each

Respond ONLY with a JSON object in this exact format (no markdown, no code fences):
{"questions": [{"question": "your clarifying question", "options": ["option 1 text", "option 2 text", "option 3 text"]}]}`;
}

/** Clarification prompt specialized for situation debates */
export function situationClarificationPrompt(
  topic: string,
  ccContext: string,
): string {
  return `You are a neutral debate facilitator preparing a structured debate grounded in a situation from an AI policy taxonomy.
${READING_LEVEL}

The user wants to debate this topic:

"${topic}"

${ccContext}

The three POV interpretations above show where the perspectives already diverge. Generate 1 to 3 clarifying questions that would help focus the debate. Your questions should:
- Identify which specific dimension of this concern the user most wants to explore (e.g., the timeline question vs. the policy response vs. the epistemic disagreement)
- Surface which assumptions or fallacies the user finds most interesting to probe
- Distinguish whether the core tension is empirical, normative, or definitional
- Help the debaters go beyond restating their pre-existing interpretations
- Be neutral — do not favor any perspective
- Be concise (one sentence each)

For each question, generate 3-5 answer options that cover the reasonable answer space. Options should be:
- Topic-specific and substantive (not generic like "yes/no")
- Mutually distinct — each option steers the debate in a different direction
- 1-2 sentences each

Respond ONLY with a JSON object in this exact format (no markdown, no code fences):
{"questions": [{"question": "your clarifying question", "options": ["option 1 text", "option 2 text", "option 3 text"]}]}`;
}
