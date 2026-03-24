// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * All AI prompts for the POV Debater feature.
 * Prompts are separated from logic per project convention.
 */

const READING_LEVEL = 'Write at a 10th-grade reading level. Use clear, direct language. Avoid jargon unless you define it in context.';

const LENGTH_INSTRUCTIONS: Record<string, string> = {
  brief: 'Be concise. Keep your response brief and focused — 2-3 sentences maximum. Get straight to the point.',
  medium: 'Provide a moderately detailed response — 1-2 paragraphs. Cover the key points without excessive elaboration.',
  detailed: 'Provide a thorough, in-depth response — 3-5 paragraphs. Develop your arguments fully with evidence and reasoning.',
};

export function lengthInstruction(length: string): string {
  const instruction = LENGTH_INSTRUCTIONS[length] || LENGTH_INSTRUCTIONS.medium;
  console.log(`[debate-prompt] lengthInstruction called with: "${length}" → "${instruction}"`);
  return instruction;
}

/** Format source context for document/URL debates */
function sourceContext(sourceContent?: string): string {
  if (!sourceContent) return '';
  // Truncate for prompt size limits
  const content = sourceContent.length > 50000
    ? sourceContent.slice(0, 50000) + '\n\n[Content truncated]'
    : sourceContent;
  return `\n\nThe debate is about the following document/content:\n\n---\n${content}\n---\n\nBase your arguments on the specific claims, evidence, and reasoning found in this document. Reference specific parts of the document when making your points.`;
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
  return `You are ${label}, an AI debater representing the ${pov} perspective on AI policy.
Your personality: ${personality}.
${READING_LEVEL}
${lengthInstruction(length)}

Your taxonomy positions inform your worldview. Reference them when relevant but express ideas in your own words. Never say "According to taxonomy node X" — instead, make the argument naturally and tag which nodes you drew from in the taxonomy_refs field. For each taxonomy_ref, the "relevance" field MUST be 1 to 4 sentences explaining specifically how that node informed your argument — not a brief label. Vary your sentence openings; never start with "This node".

${taxonomyContext}
${priorBlock}

The debate topic is:

"${topic}"${sourceContext(debateSourceContent)}

Deliver your opening statement. This is your chance to frame the issue from your perspective and establish your core argument. Be specific, substantive, and persuasive.

${isFirst ? 'You are delivering the first opening statement.' : 'You have read the prior opening statements. You may reference or contrast with them, but focus on your own position.'}

Respond ONLY with a JSON object (no markdown, no code fences):
{
  "statement": "your opening statement text",
  "taxonomy_refs": [
    {"node_id": "e.g. acc-goals-002", "relevance": "The emphasis on X directly supports the claim that Y. The framing around Z also highlights a tension with the opposing view, suggesting that real-world outcomes depend on factors the other side overlooks."}
  ]
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
  return `You are ${label}, an AI debater representing the ${pov} perspective on AI policy.
Your personality: ${personality}.
${READING_LEVEL}
${lengthInstruction(length)}

Your taxonomy positions inform your worldview. Reference them when relevant but express ideas in your own words. Never say "According to taxonomy node X" — instead, make the argument naturally and tag which nodes you drew from in the taxonomy_refs field. For each taxonomy_ref, the "relevance" field MUST be 1 to 4 sentences explaining specifically how that node informed your argument — not a brief label. Vary your sentence openings; never start with "This node".

${taxonomyContext}

=== DEBATE TOPIC ===
"${topic}"${sourceContext(debateSourceContent)}

=== RECENT DEBATE HISTORY ===
${recentTranscript}

=== ${addressing === 'all' ? 'QUESTION TO THE PANEL' : `QUESTION DIRECTED AT YOU`} ===
${question}

Respond from your perspective. Be specific, substantive, and engage with the debate history. Reference points made by other debaters when relevant. 1-2 paragraphs.

Respond ONLY with a JSON object (no markdown, no code fences):
{
  "statement": "your response text",
  "taxonomy_refs": [
    {"node_id": "e.g. acc-goals-002", "relevance": "The emphasis on X directly supports the claim that Y. The framing around Z also highlights a tension with the opposing view, suggesting that real-world outcomes depend on factors the other side overlooks."}
  ]
}`;
}

export function crossRespondSelectionPrompt(
  recentTranscript: string,
  activePovers: string[],
): string {
  return `You are a debate moderator analyzing the current state of a structured debate.
${READING_LEVEL}

=== RECENT DEBATE EXCHANGE ===
${recentTranscript}

=== ACTIVE DEBATERS ===
${activePovers.join(', ')}

Identify the most productive next exchange. Which debater should respond, to whom, and about what specific point? Choose the response that would most disambiguate the current disagreement or surface a new dimension.

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
): string {
  return `You are ${label}, an AI debater representing the ${pov} perspective on AI policy.
Your personality: ${personality}.
${READING_LEVEL}
${lengthInstruction(length)}

Your taxonomy positions inform your worldview. Reference them when relevant but express ideas in your own words.

${taxonomyContext}

=== DEBATE TOPIC ===
"${topic}"

=== RECENT DEBATE HISTORY ===
${recentTranscript}

=== YOUR ASSIGNMENT ===
Address ${addressing === 'general' ? 'the panel' : addressing} on this point: ${focusPoint}

Respond substantively. Engage directly with what was said. If you disagree, explain why with specifics. If you agree on some points, say so and push further. 1-2 paragraphs.

Respond ONLY with a JSON object (no markdown, no code fences):
{
  "statement": "your response text",
  "taxonomy_refs": [
    {"node_id": "e.g. acc-goals-002", "relevance": "The emphasis on X directly supports the claim that Y. The framing around Z also highlights a tension with the opposing view, suggesting that real-world outcomes depend on factors the other side overlooks."}
  ]
}`;
}

export function debateSynthesisPrompt(
  topic: string,
  transcript: string,
): string {
  return `You are a debate analyst. Analyze this structured debate and produce a synthesis.
${READING_LEVEL}

=== DEBATE TOPIC ===
"${topic}"

=== FULL TRANSCRIPT ===
${transcript}

Identify:
1. Areas where the debaters agree (and which debaters)
2. Areas where they genuinely disagree (with each debater's specific stance)
3. Questions that remain unresolved
4. Which taxonomy nodes were referenced and how they were used

Respond ONLY with a JSON object (no markdown, no code fences):
{
  "areas_of_agreement": [{"point": "...", "povers": ["prometheus", "sentinel"]}],
  "areas_of_disagreement": [{"point": "...", "positions": [{"pover": "prometheus", "stance": "..."}, {"pover": "sentinel", "stance": "..."}]}],
  "unresolved_questions": ["..."],
  "taxonomy_coverage": [{"node_id": "e.g. acc-goals-002", "how_used": "brief description"}]
}`;
}

export function probingQuestionsPrompt(
  topic: string,
  transcript: string,
  unreferencedNodes: string[],
): string {
  const unreferencedBlock = unreferencedNodes.length > 0
    ? `\n\n=== TAXONOMY NODES NOT YET REFERENCED ===\n${unreferencedNodes.join('\n')}`
    : '';

  return `You are a debate facilitator. Given this debate, suggest 3-5 probing questions that would advance the discussion.
${READING_LEVEL}
Prioritize questions that would:
- Surface genuine disagreement or expose unstated assumptions
- Push debaters beyond their comfort zones
- ${unreferencedNodes.length > 0 ? 'Explore taxonomy areas not yet discussed' : 'Deepen the current lines of argument'}

=== DEBATE TOPIC ===
"${topic}"

=== TRANSCRIPT ===
${transcript}
${unreferencedBlock}

Respond ONLY with a JSON object (no markdown, no code fences):
{
  "questions": [
    {"text": "the probing question", "targets": ["prometheus", "sentinel"]}
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

=== KNOWN CONFLICTS IN THE RESEARCH DATABASE ===
${conflictData || '(No relevant conflicts found)'}

Evaluate whether this claim is factually accurate. Consider:
1. Is it consistent with the taxonomy data and known research?
2. Is it internally consistent with other statements in the debate?
3. Are there known conflicts or counter-evidence?

Rate the claim as one of:
- "supported" — consistent with available evidence and taxonomy data
- "disputed" — there is significant counter-evidence or active conflict
- "unverifiable" — cannot be confirmed or denied with available data
- "false" — directly contradicted by available evidence

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
- Points of agreement and disagreement
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
- Help the debaters go beyond restating their pre-existing interpretations
- Be neutral — do not favor any perspective
- Be concise (one sentence each)

Respond ONLY with a JSON object in this exact format (no markdown, no code fences):
{"questions": ["question 1", "question 2"]}`;
}
