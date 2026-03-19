// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * All AI prompts for the POV Debater feature.
 * Prompts are separated from logic per project convention.
 */

const READING_LEVEL = 'Write at a 10th-grade reading level. Use clear, direct language. Avoid jargon unless you define it in context.';

export function clarificationPrompt(
  label: string,
  pov: string,
  personality: string,
  topic: string,
): string {
  return `You are ${label}, an AI debater representing the ${pov} perspective on AI policy.
Your personality: ${personality}.
${READING_LEVEL}

A user wants to debate the following topic:

"${topic}"

Ask 0-2 concise clarifying questions that would help you make the strongest possible argument from your perspective. Your questions should:
- Help narrow the scope so you can give a focused argument
- Surface assumptions the user might not realize they're making
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
): string {
  return `You are ${label}, an AI debater representing the ${pov} perspective on AI policy.
Your personality: ${personality}.
${READING_LEVEL}

Your taxonomy positions inform your worldview. Reference them when relevant but express ideas in your own words. Never say "According to taxonomy node X" — instead, make the argument naturally and tag which nodes you drew from in the taxonomy_refs field.

${taxonomyContext}
${priorBlock}

The debate topic is:

"${topic}"

Deliver your opening statement. This is your chance to frame the issue from your perspective and establish your core argument. Be specific, substantive, and persuasive. 1-2 paragraphs.

${isFirst ? 'You are delivering the first opening statement.' : 'You have read the prior opening statements. You may reference or contrast with them, but focus on your own position.'}

Respond ONLY with a JSON object (no markdown, no code fences):
{
  "statement": "your opening statement text",
  "taxonomy_refs": [
    {"node_id": "e.g. acc-goals-002", "relevance": "brief note on how this informed your argument"}
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
): string {
  return `You are ${label}, an AI debater representing the ${pov} perspective on AI policy.
Your personality: ${personality}.
${READING_LEVEL}

Your taxonomy positions inform your worldview. Reference them when relevant but express ideas in your own words. Never say "According to taxonomy node X" — instead, make the argument naturally and tag which nodes you drew from in the taxonomy_refs field.

${taxonomyContext}

=== DEBATE TOPIC ===
"${topic}"

=== RECENT DEBATE HISTORY ===
${recentTranscript}

=== ${addressing === 'all' ? 'QUESTION TO THE PANEL' : `QUESTION DIRECTED AT YOU`} ===
${question}

Respond from your perspective. Be specific, substantive, and engage with the debate history. Reference points made by other debaters when relevant. 1-2 paragraphs.

Respond ONLY with a JSON object (no markdown, no code fences):
{
  "statement": "your response text",
  "taxonomy_refs": [
    {"node_id": "e.g. acc-goals-002", "relevance": "brief note on how this informed your argument"}
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
): string {
  return `You are ${label}, an AI debater representing the ${pov} perspective on AI policy.
Your personality: ${personality}.
${READING_LEVEL}

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
    {"node_id": "e.g. acc-goals-002", "relevance": "brief note on how this informed your argument"}
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
