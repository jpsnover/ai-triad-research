// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * All AI prompts for the POV Debater feature.
 * Prompts are separated from logic per project convention.
 */

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
  const instruction = LENGTH_INSTRUCTIONS[length] || LENGTH_INSTRUCTIONS.medium;
  console.log(`[debate-prompt] lengthInstruction called with: "${length}" → "${instruction}"`);
  return instruction;
}

// ── Shared instruction blocks ───────────────────────────────

const TAXONOMY_USAGE = `Your taxonomy context is organized into BDI sections — Beliefs, Values, and Reasoning Approach — that structure your worldview:

- BELIEFS (Data/Facts): Your empirical grounding. Draw on these when making factual claims or citing evidence.
- VALUES (Goals/Values): Your normative commitments. Draw on these when arguing about what matters or what should happen.
- REASONING APPROACH (Methods/Arguments): Your argumentative strategies. Draw on these when constructing arguments or choosing how to frame an issue.

Reference nodes from across all three sections — not just the one most obvious for your point. The strongest arguments connect beliefs to values through reasoning.

Express ideas in your own words. Never say "According to taxonomy node X" — instead, make the argument naturally and tag which nodes you drew from in the taxonomy_refs field. For each taxonomy_ref, the "relevance" field MUST be 1 to 4 sentences explaining specifically how that node informed your argument — not a brief label. Vary your sentence openings; never start with "This node".

Your KNOWN VULNERABILITIES section lists weaknesses in your positions and fallacy tendencies to watch for. Acknowledge a vulnerability when it is directly relevant — this builds credibility. But do not over-concede or preemptively apologize; your job is to make the strongest case for your perspective.

Your CROSS-CUTTING CONCERNS show where your interpretation of a contested concept differs from other perspectives. Use these to identify genuine disagreements rather than talking past each other.`;

const STEELMAN_INSTRUCTION = `Before critiquing an opposing position, briefly state the strongest version of that position in a way its advocates would recognize as fair. Only then explain where you think it breaks down. This is called steelmanning — it demonstrates intellectual honesty and ensures you are engaging with the real argument, not a caricature.`;

const DISAGREEMENT_TYPING = `When you disagree with another debater, classify your disagreement:
- EMPIRICAL: You believe different facts are true (e.g., "AGI won't arrive that soon")
- VALUES: You share the facts but prioritize differently (e.g., "Even if AGI is near, speed matters more than caution")
- DEFINITIONAL: You define a key term differently (e.g., "What counts as 'alignment' differs")
Include a "disagreement_type" field in your response when you disagree.`;

const DIALECTICAL_MOVES = `Your response should employ one or more of these dialectical moves:
- CONCEDE: Acknowledge a valid point from the opponent
- DISTINGUISH: Accept the opponent's evidence but show it doesn't apply here
- REFRAME: Shift the framing to reveal what the current frame hides
- COUNTEREXAMPLE: Provide a specific case that challenges the opponent's claim
- REDUCE: Show the opponent's logic leads to an absurd or unacceptable conclusion
- ESCALATE: Raise the stakes by connecting to a broader principle
Include a "move_types" array in your response listing which moves you used.`;

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

Respond ONLY with a JSON object in this exact format (no markdown, no code fences):
{"questions": ["question 1", "question 2"]}`;
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
): string {
  const lengthKey = length || 'medium';
  const includeAssumptions = lengthKey === 'detailed';
  const includeSteelman = lengthKey !== 'brief';

  return `You are ${label}, an AI debater representing the ${pov} perspective on AI policy.
Your personality: ${personality}.
${READING_LEVEL}
${lengthInstruction(lengthKey)}

${TAXONOMY_USAGE}

${taxonomyContext}
${priorBlock}

The debate topic is:

"${topic}"${sourceContext(debateSourceContent)}

Deliver your opening statement. This is your chance to frame the issue from your perspective and establish your core argument. Be specific, substantive, and persuasive.
${debateSourceContent ? `\nSince this debate is grounded in a document, your opening should: (1) identify what you see as the document's central claim or thesis, (2) state which of its claims you accept and which you challenge, and (3) flag any assumptions or framing choices the document makes that your perspective contests.\n` : ''}
${isFirst ? 'You are delivering the first opening statement.' : `You have read the prior opening statements.${includeSteelman ? ' Before critiquing any prior position, briefly acknowledge the strongest version of that position.' : ''} You may reference or contrast with them, but focus on your own position.`}
${includeAssumptions ? `\nState 1-2 key assumptions your position depends on. For each, briefly note how your position would change if that assumption were wrong. This demonstrates intellectual honesty and helps the audience evaluate your argument.\n` : ''}
Respond ONLY with a JSON object (no markdown, no code fences):
{
  "statement": "your opening statement text",
  "taxonomy_refs": [
    {"node_id": "e.g. acc-goals-002", "relevance": "The emphasis on X directly supports the claim that Y. The framing around Z also highlights a tension with the opposing view, suggesting that real-world outcomes depend on factors the other side overlooks."}
  ]${includeAssumptions ? `,
  "key_assumptions": [
    {"assumption": "what you assume to be true", "if_wrong": "how your position would change"}
  ]` : ''}
}`;
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
): string {
  const lengthKey = length || 'medium';
  const includeSteelman = lengthKey !== 'brief';
  const includeDisagreementType = true; // always include — it's a small field

  return `You are ${label}, an AI debater representing the ${pov} perspective on AI policy.
Your personality: ${personality}.
${READING_LEVEL}
${lengthInstruction(lengthKey)}

${TAXONOMY_USAGE}
${includeSteelman ? `\n${STEELMAN_INSTRUCTION}\n` : ''}
${DISAGREEMENT_TYPING}

${DIALECTICAL_MOVES}

${taxonomyContext}

=== DEBATE TOPIC ===
"${topic}"${sourceContext(debateSourceContent)}

=== RECENT DEBATE HISTORY ===
${recentTranscript}

=== ${addressing === 'all' ? 'QUESTION TO THE PANEL' : `QUESTION DIRECTED AT YOU`} ===
${question}

Respond from your perspective. Be specific, substantive, and engage with the debate history. Reference points made by other debaters when relevant.

Respond ONLY with a JSON object (no markdown, no code fences):
{
  "statement": "your response text",
  "taxonomy_refs": [
    {"node_id": "e.g. acc-goals-002", "relevance": "The emphasis on X directly supports the claim that Y."}
  ],
  "move_types": ["DISTINGUISH", "COUNTEREXAMPLE"]${includeDisagreementType ? `,
  "disagreement_type": "EMPIRICAL or VALUES or DEFINITIONAL (omit if not disagreeing)"` : ''}
}`;
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
): string {
  const lengthKey = length || 'medium';
  const includeSteelman = lengthKey !== 'brief';

  return `You are ${label}, an AI debater representing the ${pov} perspective on AI policy.
Your personality: ${personality}.
${READING_LEVEL}
${lengthInstruction(lengthKey)}

${TAXONOMY_USAGE}
${includeSteelman ? `\n${STEELMAN_INSTRUCTION}\n` : ''}
${DISAGREEMENT_TYPING}

${DIALECTICAL_MOVES}

${taxonomyContext}

=== DEBATE TOPIC ===
"${topic}"${sourceReminder(debateSourceContent)}

=== RECENT DEBATE HISTORY ===
${recentTranscript}

=== YOUR ASSIGNMENT ===
Address ${addressing === 'general' ? 'the panel' : addressing} on this point: ${focusPoint}

Respond substantively. Engage directly with what was said. If you disagree, explain why with specifics and classify your disagreement type. If you agree on some points, say so (CONCEDE) and push further.

Respond ONLY with a JSON object (no markdown, no code fences):
{
  "statement": "your response text",
  "taxonomy_refs": [
    {"node_id": "e.g. acc-goals-002", "relevance": "The emphasis on X directly supports the claim that Y."}
  ],
  "move_types": ["CONCEDE", "DISTINGUISH"],
  "disagreement_type": "EMPIRICAL or VALUES or DEFINITIONAL (omit if not disagreeing)"
}`;
}

export function debateSynthesisPrompt(
  topic: string,
  transcript: string,
  hasSourceDocument: boolean = false,
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
      - "value" — they share the facts but prioritize differently (goals, principles, trade-offs)
      - "conceptual" — they define a key term or concept differently (meaning, scope, framing)
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
   - Each claim must be traceable to something actually said in the transcript${documentAnalysis}

Respond ONLY with a JSON object (no markdown, no code fences):
{
  "areas_of_agreement": [{"point": "...", "povers": ["prometheus", "sentinel"]}],
  "areas_of_disagreement": [{"point": "...", "type": "EMPIRICAL or VALUES or DEFINITIONAL", "bdi_layer": "belief or value or conceptual", "resolvability": "resolvable_by_evidence or negotiable_via_tradeoffs or requires_term_clarification", "positions": [{"pover": "prometheus", "stance": "..."}, {"pover": "sentinel", "stance": "..."}]}],
  "cruxes": [
    {"question": "the factual or value question that would change minds", "if_yes": "which position strengthens and why", "if_no": "which position strengthens and why", "type": "EMPIRICAL or VALUES"}
  ],
  "unresolved_questions": ["..."],
  "taxonomy_coverage": [{"node_id": "e.g. acc-goals-002", "how_used": "brief description"}],
  "argument_map": [
    {"claim_id": "C1", "claim": "near-verbatim from transcript", "claimant": "prometheus", "type": "empirical or normative or definitional", "supported_by": ["C3"], "attacked_by": [
      {"claim_id": "C2", "claim": "the attacking claim text", "claimant": "sentinel", "attack_type": "rebut or undercut or undermine", "scheme": "COUNTEREXAMPLE or DISTINGUISH or REDUCE or REFRAME or CONCEDE or ESCALATE"}
    ]}
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
    {"node_id": "e.g. acc-goals-002"},
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

// ── Cross-Cutting Concern Debate ─────────────────────────

interface CrossCuttingDebateInput {
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

/** Build a rich source-content block from a cross-cutting node for prompt injection */
export function formatCrossCuttingDebateContext(cc: CrossCuttingDebateInput): string {
  const lines: string[] = [
    `=== CROSS-CUTTING CONCERN: ${cc.id} ===`,
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

Respond ONLY with a JSON object in this exact format (no markdown, no code fences):
{"questions": ["question 1", "question 2"]}`;
}

/** Clarification prompt specialized for cross-cutting concern debates */
export function crossCuttingClarificationPrompt(
  topic: string,
  ccContext: string,
): string {
  return `You are a neutral debate facilitator preparing a structured debate grounded in a cross-cutting concern from an AI policy taxonomy.
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

Respond ONLY with a JSON object in this exact format (no markdown, no code fences):
{"questions": ["question 1", "question 2"]}`;
}
