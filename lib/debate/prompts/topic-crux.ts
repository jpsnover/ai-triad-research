// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import type { TopicScope } from '../types.js';

export function topicScopeExtractionPrompt(topic: string, scopeAdditions?: { dimension: string; detail: string }[]): string {
  const additionsBlock = scopeAdditions && scopeAdditions.length > 0
    ? `\n\n=== ADDITIONAL DIMENSIONAL CONTEXT ===\nThe topic critique identified these dimensional details that should inform your scope extraction (they were too detailed to fit in the topic sentence itself):\n${scopeAdditions.map(s => `- ${s.dimension}: ${s.detail}`).join('\n')}\nIncorporate these into the appropriate scope fields (key_tensions, relevant_disciplines, on_scope_evidence, etc.).\n`
    : '';

  return `You are a debate scope analyst. Extract the structured scope of the following debate topic.

=== DEBATE TOPIC ===
"${topic}"
${additionsBlock}
=== TASK ===
Parse this topic into a TopicScope object. Populate ALL fields — no field should be empty or generic.

For the 7 universal fields:
- core_proposition: The specific claim or question being debated. One sentence.
- relevant_disciplines: Academic/professional disciplines from which evidence should be drawn. Be specific — "semiconductor physics, thermodynamics" not "technology."
- on_scope_evidence: Types of facts, data, metrics, or examples that are relevant to this specific topic.
- key_tensions: The 2-4 central disagreements this topic will generate between accelerationist, safetyist, and skeptic perspectives.
- off_scope_topics: Adjacent subjects debaters will predictably drift toward. Be specific.
- drift_signatures: Specific argument patterns that signal a debater has left the topic's scope. These must be actionable — "shifting from physics to ethics without infrastructure connection" not "going off topic."
- example_ceiling: The maximum severity or type of examples that are proportionate to this topic's scope.

For user-constraint fields:
- Does the topic state or imply excluded scenarios? List them in excluded_scenarios.
- What risk level does the topic specify or imply? (low/medium/high/catastrophic/unspecified)
- What domain and product_type (if any) does the topic specify?
- What time_horizon (if any) does the topic specify or imply?
- What verbatim qualifiers did the user include? Preserve exact text in explicit_qualifiers.
- Are these constraints explicit (user stated them) or inferred (you deduced them)? Set constraint_confidence accordingly.

=== EXAMPLES ===

Topic: "Should AI development be regulated by international treaty, similar to nuclear weapons?"
{
  "core_proposition": "Whether AI development warrants international treaty-level regulation analogous to nuclear non-proliferation frameworks",
  "relevant_disciplines": ["international law", "arms control policy", "AI governance", "game theory", "geopolitical strategy"],
  "on_scope_evidence": ["precedents from nuclear/chemical/biological treaties", "AI capability benchmarks", "international coordination mechanisms", "verification and compliance regimes", "sovereign technology policy"],
  "key_tensions": ["national competitiveness vs global coordination", "speed of AI progress vs treaty negotiation timelines", "verification feasibility for software vs hardware", "democratic vs authoritarian governance models"],
  "off_scope_topics": ["specific AI product design", "individual company practices", "technical alignment research methods", "consumer AI applications", "AI consciousness or sentience"],
  "drift_signatures": ["pivoting to specific model architectures instead of governance frameworks", "discussing startup culture or VC funding instead of international coordination", "debating consciousness or AGI timelines instead of treaty mechanisms"],
  "example_ceiling": "Nation-state level policy decisions and international agreements; catastrophic-scale examples are proportionate given the nuclear analogy",
  "risk_level": "unspecified",
  "domain": "international AI governance",
  "product_type": null,
  "time_horizon": null,
  "excluded_scenarios": [],
  "explicit_qualifiers": [],
  "constraint_confidence": "inferred"
}

Topic: "How should a startup build a low-risk AI-powered consumer product for home energy management with no agentic or other AI features?"
{
  "core_proposition": "Design and deployment strategy for a non-agentic AI consumer product in the home energy management space at low risk level",
  "relevant_disciplines": ["product management", "UX design", "energy systems engineering", "consumer electronics regulation", "machine learning for time-series forecasting"],
  "on_scope_evidence": ["smart thermostat market data", "consumer adoption curves", "home energy API standards", "utility rate structures", "UL/FCC compliance requirements", "recommendation system accuracy metrics"],
  "key_tensions": ["feature simplicity vs user value", "data collection vs privacy", "prediction accuracy vs computational cost", "regulatory compliance vs time-to-market"],
  "off_scope_topics": ["autonomous AI agents", "existential AI risk", "military AI applications", "large language models", "AI consciousness", "enterprise or industrial energy systems"],
  "drift_signatures": ["citing catastrophic infrastructure failures or loss-of-life incidents", "discussing autonomous decision-making or agentic behavior", "invoking existential risk or civilizational-scale consequences", "comparing to high-risk domains like aviation or nuclear power"],
  "example_ceiling": "Consumer product failures, minor financial losses, usability issues — nothing involving injury, death, or systemic infrastructure failure",
  "risk_level": "low",
  "domain": "consumer technology, home energy",
  "product_type": "AI-powered home energy management product",
  "time_horizon": null,
  "excluded_scenarios": ["agentic AI features", "autonomous decision-making"],
  "explicit_qualifiers": ["low-risk", "consumer product", "home energy management", "no agentic or other AI features"],
  "constraint_confidence": "explicit"
}

Topic: "Are physical limits on computation — energy, heat, materials — the real bottleneck that will halt AI scaling before we reach transformative capabilities?"
{
  "core_proposition": "Whether physical computational constraints will prevent AI from reaching transformative capability thresholds before algorithmic or economic factors",
  "relevant_disciplines": ["semiconductor physics", "thermodynamics", "materials science", "computational complexity theory", "energy systems engineering", "supply chain economics"],
  "on_scope_evidence": ["transistor density trends and physical limits", "data center energy consumption data", "chip fabrication yield rates", "cooling technology constraints", "rare earth mineral supply data", "compute cost curves"],
  "key_tensions": ["physical limits vs algorithmic efficiency gains", "current scaling trends vs theoretical ceilings", "centralized compute vs distributed approaches", "near-term bottlenecks vs long-term workarounds"],
  "off_scope_topics": ["AI alignment and safety techniques", "AI consciousness or sentience", "labor displacement from AI", "AI regulation and policy", "specific AI model architectures unrelated to compute"],
  "drift_signatures": ["shifting from physics to ethics without infrastructure connection", "discussing AI safety or alignment without linking to physical constraints", "debating what AI should do rather than what physics allows it to do", "invoking labor market impacts without connecting to scaling limits"],
  "example_ceiling": "Industrial and scientific scale — data center operations, chip fabrication economics, energy grid capacity",
  "risk_level": "unspecified",
  "domain": "computational physics, AI infrastructure",
  "product_type": null,
  "time_horizon": null,
  "excluded_scenarios": [],
  "explicit_qualifiers": ["physical limits", "energy, heat, materials"],
  "constraint_confidence": "inferred"
}

=== OUTPUT FORMAT ===
Return a single JSON object matching the TopicScope schema above. No markdown fences. No commentary.`;
}

// ── Topic Structure Extraction (t/1050) ──────────────────────────
export function extractTopicStructurePrompt(topic: string): string {
  return `You are a topic analyst. Extract the structure of this debate topic into three fields.

DEFINITIONS:
- core_proposition: The central claim or question being debated. Rephrase for clarity if the original is convoluted, but preserve the full scope.
- structural_premises: Factual conditions the topic STATES AS GIVEN — background facts the debaters must accept, not argue about. Most topics have NONE.
- scope_constraints: Explicit limits on what is in or out of scope. Only include if the topic explicitly bounds the debate.

CRITICAL RULE — structural premises vs. debatable claims:
A structural premise is a condition the topic presents as settled background, not something to argue about.
Test: "Could a reasonable debater disagree with this statement?" If yes → it is NOT a structural premise. Classify it as part of core_proposition.

When in doubt, leave structural_premises EMPTY. An overly generous list is worse than an empty one — it tells debaters to treat debatable content as settled fact.

EXAMPLE 1 (has premises):
Topic: "For an established consumer software team shipping a non-AI MVP within 90 days, under what conditions does AI-generated code help versus hurt the company?"
→ structural_premises: ["The team is an established consumer software company", "The product being shipped is non-AI", "The timeline is 90 days"]
These are GIVEN conditions that frame the question — no debater would argue the team isn't established or the timeline isn't 90 days.

EXAMPLE 2 (no premises):
Topic: "Congress should mandate that AI developers utilize siloed datasets to prevent cross-referencing of external user data, prioritizing privacy over agent utility."
→ structural_premises: []
The entire topic is one policy claim. "Prioritizing privacy over agent utility" is a framing preference, not a given fact.

EXAMPLE 3 (looks like it has premises, but doesn't):
Topic: "AI platforms should block non-mainstream information until users complete government-mandated training. This policy prioritizes public safety over open internet access, much like requiring a license to operate heavy machinery."
→ structural_premises: []
"Prioritizes public safety over open access" is a framing claim, not a given condition. The machinery analogy is an argumentative device. A reasonable debater could dispute both.

TOPIC:
"${topic}"

Respond ONLY with JSON (no markdown, no code fences):
{
  "core_proposition": "The central claim or question",
  "structural_premises": [],
  "scope_constraints": []
}`;
}

export function entailmentRepairPrompt(statement: string, claim: string): string {
  return `You are an entailment judge for a debate system. Given a debater's STATEMENT and an extracted CLAIM, determine whether the claim is faithfully entailed by the statement.

STATEMENT:
"""
${statement}
"""

CLAIM:
"""
${claim}
"""

Instructions:
1. Judge whether the CLAIM is entailed by the STATEMENT:
   - "entailed": The claim accurately captures information present in the statement. Paraphrasing is fine if meaning is preserved.
   - "partial": The claim captures some information from the statement but adds, omits, or distorts key details (e.g., invents specifics not stated, drops important qualifiers, changes scope).
   - "not_entailed": The claim asserts something not present in or contradicted by the statement.

2. If the verdict is "partial" or "not_entailed", provide a MINIMAL repair — the smallest edit to the claim text that makes it faithfully entailed. Preserve the original wording as much as possible. If the claim is entirely fabricated, write a new claim that captures the closest idea actually present in the statement.

3. Write a one-sentence explanation of what specifically is wrong (for partial/not_entailed) or right (for entailed).

Respond in JSON only (no markdown): {"verdict": "entailed" | "partial" | "not_entailed", "explanation": "...", "repaired_claim": "..." or null}`;
}

export function decontextualizeCruxPrompt(
  claim: string,
  debateTopic: string,
  speakers: string[],
  surroundingTurns: string[],
): string {
  const turnBlock = surroundingTurns.length > 0
    ? `SURROUNDING DEBATE TURNS:\n${surroundingTurns.map((t, i) => `[${i + 1}] ${t}`).join('\n')}\n`
    : '';

  return `You are a claim editor preparing debate claims for a cross-debate registry. Claims in the registry must be self-contained — a reader with no knowledge of this specific debate should understand what the claim asserts.

DEBATE TOPIC: "${debateTopic}"
SPEAKERS: ${speakers.join(', ')}

${turnBlock}
ORIGINAL CLAIM:
"${claim}"

Instructions:
1. Expand all context-dependent references: pronouns ("it", "they", "this"), demonstratives ("this policy", "that approach"), relative dates ("recently", "last year"), and implicit subjects.
2. Use bracketed notation [like this] to mark inferred context that was not explicitly stated in the claim. For example: "It would reduce innovation" → "[The EU AI Act] would reduce innovation"
3. Preserve the original meaning exactly — do not add, soften, or strengthen the claim.
4. If the claim is already self-contained with no context-dependent references, return it unchanged.

Respond in JSON only (no markdown): {"decontextualized": "the self-contained claim text", "changes_made": ["list of specific expansions, or empty if unchanged"]}`;
}

// ── Counterfactual type classification (RATIO 2024) ────────────────

export function classifyCounterfactualTypePrompt(
  cruxes: { id: string; claim_text: string; flipping_argument_text: string }[],
  debateTopic: string,
): string {
  const cruxBlock = cruxes.map(c =>
    `- [${c.id}] Claim: "${c.claim_text}" — Flipping argument: "${c.flipping_argument_text}"`
  ).join('\n');

  return `You are a debate analyst classifying counterfactual cruxes by reasoning type. Each crux represents an argument whose removal would flip a claim's debate outcome.

DEBATE TOPIC: "${debateTopic}"

=== COUNTERFACTUAL CRUXES ===
${cruxBlock}

For each crux, classify its counterfactual reasoning type:
- "interventional" (Pearl do-calculus): The counterfactual asks what would happen if a variable were FORCED to a different value, holding all else fixed. Pattern: "If we imposed/required/banned X, what would happen?" The causal graph runs forward from the intervention point.
- "backtracking" (Lewis): The counterfactual runs causal history BACKWARDS. Pattern: "If X had been different in the past, what chain of prior causes would also have been different?" It revises history, not just future consequences.
- "normative": The counterfactual asks what follows from adopting a value, principle, or rule that is not currently in force. Pattern: "If we accepted principle P / valued X over Y, what policy would follow?" The reasoning is about ought-implications, not causal mechanics.

Key distinction: interventional changes ONE variable and traces forward effects; backtracking changes ONE outcome and traces backward to what else must change; normative changes a value commitment and derives policy implications.

Respond in JSON only (no markdown):
{"classifications": [{"id": "crux-id", "counterfactual_type": "interventional or backtracking or normative", "reasoning": "one sentence explaining why this type"}]}`;
}

// ── Post-cascade crux refresh ──────────────────────────────────────

export function cruxRefreshPrompt(
  activeCruxes: { id: string; description: string; polarity: number; disagreement_type?: string }[],
  recentConcessions: { speaker: string; conceded_text: string }[],
  recentTranscript: string,
  topic: string,
): string {
  const cruxBlock = activeCruxes.map(c =>
    `- [${c.id}] "${c.description}" (polarity: ${c.polarity.toFixed(2)}${c.disagreement_type ? `, type: ${c.disagreement_type}` : ''})`
  ).join('\n');

  const concessionBlock = recentConcessions.map(c =>
    `- ${c.speaker}: "${c.conceded_text}"`
  ).join('\n');

  return `You are a debate analyst evaluating whether active cruxes remain valid after a concession cascade.

=== DEBATE TOPIC ===
"${topic}"

=== ACTIVE CRUXES ===
${cruxBlock}

=== RECENT CONCESSIONS ===
${concessionBlock}

=== RECENT TRANSCRIPT ===
${recentTranscript}

After these concessions, some cruxes may no longer represent the actual locus of disagreement. For each active crux, determine:
1. Is this crux RESOLVED by the concessions (a speaker's concession makes the crux moot)?
2. Is this crux SUPERSEDED (the debate has moved to a deeper or different disagreement)?
3. Is this crux STILL ACTIVE (the concessions did not affect this disagreement)?

For cruxes that are resolved or superseded, identify what NEW disagreement (if any) has emerged in its place.

Respond in JSON only (no markdown, no code fences):
{
  "crux_verdicts": [
    {"id": "crux-id", "verdict": "resolved" | "superseded" | "active", "reason": "one sentence explaining why"}
  ],
  "emerging_cruxes": [
    {"description": "the new fundamental disagreement", "speakers_involved": ["speaker1", "speaker2"], "disagreement_type": "empirical" | "values" | "definitional", "reason": "what concession created this new frontier"}
  ]
}

emerging_cruxes should only contain genuinely NEW disagreements that emerged FROM the concession cascade — not restatements of existing active cruxes. If no new cruxes emerged, return an empty array.`;
}

// ── Off-scope drift classification (t/394) ────────────────────────

export type OffScopeDriftType = 'evidence' | 'severity' | 'domain';

const SEVERITY_PATTERNS = /\b(catastroph|existential|extinction|civiliz|apocalyp|doomsday|breakdown.*soci|soci.*breakdown|collapse.*soci|soci.*collapse|end.of.humanity|human.extinction|superintelligen|x-risk|existen.*risk)/i;
const DOMAIN_PATTERNS = /\b(different.*(domain|field|sector|industry)|wrong.*(area|domain|field)|unrelated.*(domain|topic)|adjacent.*domain|outside.*scope)/i;

export function classifyOffScopeDrift(
  weaknesses: string[],
  scope: TopicScope,
): OffScopeDriftType {
  const joined = weaknesses.join(' ');

  if (DOMAIN_PATTERNS.test(joined) || scope.off_scope_topics.some(t => joined.toLowerCase().includes(t.toLowerCase()))) {
    return 'domain';
  }

  if (SEVERITY_PATTERNS.test(joined) ||
      (scope.risk_level !== 'catastrophic' && scope.risk_level !== 'unspecified' &&
       /\b(severity|magnitude|scale|disproportionate|escalat|overstat)\b/i.test(joined))) {
    return 'severity';
  }

  return 'evidence';
}

export function offScopeRepairHint(driftType: OffScopeDriftType, scope: TopicScope): string {
  switch (driftType) {
    case 'severity':
      return `REPAIR: Your argument frames consequences at a severity level exceeding the debate scope. The topic's example ceiling is: ${scope.example_ceiling}. Rewrite your concluding argument to frame consequences proportionate to this scope. You may keep your core thesis but must adjust the magnitude of claimed impacts. Do not invoke civilizational collapse, existential risk, or catastrophic scenarios unless the debate topic explicitly concerns those scales.`;
    case 'domain':
      return `REPAIR: Your argument draws evidence or framing from a domain outside this debate's scope. The debate domain is: ${scope.domain}. Redirect your argument to use evidence, examples, and analogies from within this domain. ${scope.off_scope_topics.length > 0 ? `Specifically excluded topics: ${scope.off_scope_topics.join(', ')}. ` : ''}Keep your core thesis but ground it in on-scope evidence.`;
    case 'evidence':
      return `REPAIR: Your statement uses examples from a different risk/domain category than the debate topic. The topic specifies: ${scope.example_ceiling}. Rewrite using examples at that severity level. Keep your argument structure — just change the evidence.`;
  }
}

export function elementDecompositionPrompt(statement: string): string {
  return `Decompose the following debate statement into its distinct INFORMATION ELEMENTS at CLAIM level — each element should be a complete argumentative point, not a sub-component.

STATEMENT:
"""
${statement}
"""

Instructions:
1. Extract the major claims, positions, and arguments from the statement. Target the level of granularity at which a claim extractor would produce output — one element per ARGUMENTATIVE POINT, not per sentence or sub-assertion.

2. GRANULARITY GUIDE:
   - CORRECT: "Strict liability creates a market-based audit mechanism that scales automatically and replaces bureaucratic gatekeeping" (one argumentative point with supporting details bundled)
   - TOO FINE: Splitting the above into "Strict liability creates a market-based audit mechanism", "This mechanism scales automatically", "This mechanism replaces bureaucratic gatekeeping" (three sub-assertions of one point)
   - A 300-word statement typically contains 5-12 major information elements, not 20-30.

3. Classify each element:
   - "verifiable": Factual claims, empirical assertions, causal arguments, historical references, statistics, mechanistic claims, analytical arguments about how systems work. These can in principle be assessed for accuracy or internal consistency.
   - "normative": Value judgments, prescriptive claims ("should", "must"), expressions of desire or intention, moral evaluations, policy recommendations. These express what the speaker wants rather than what is the case.

4. Write each element as a self-contained sentence preserving specific qualifiers and conditions.

5. Do NOT include:
   - Rhetorical transitions or meta-commentary about the debate
   - Attributions without content ("Skeptic disagrees")
   - Restatements of the same point in different words

Respond in JSON:
{
  "elements": [
    { "text": "...", "element_type": "verifiable" },
    { "text": "...", "element_type": "normative" }
  ]
}`;
}

export function coverageCheckPrompt(
  elements: { text: string; element_type: string }[],
  claims: string[],
): string {
  const elementList = elements.map((e, i) => `  ${i + 1}. [${e.element_type}] ${e.text}`).join('\n');
  const claimList = claims.map((c, i) => `  ${i + 1}. ${c}`).join('\n');

  return `Given a list of INFORMATION ELEMENTS from a debate statement and a list of EXTRACTED CLAIMS, determine which elements are covered by the claims.

INFORMATION ELEMENTS:
${elementList}

EXTRACTED CLAIMS:
${claimList}

Instructions:
1. For each information element, check if ANY extracted claim captures its core content (explicitly or by implication).
2. A claim "covers" an element if reading the claim would tell you the same factual or normative content as the element, even if worded differently.
3. Partial coverage counts as covered — if the claim captures the main idea but drops minor qualifiers, mark it as covered.
4. An element is "not covered" only if NO claim addresses its content at all.

Respond in JSON:
{
  "coverage": [
    { "element_index": 1, "covered": true, "covering_claim_index": 2 },
    { "element_index": 2, "covered": false, "covering_claim_index": null }
  ]
}`;
}

// ── Inline topic improvement (lightweight, pre-creation) ──────────────

export function improveDebateTopicPrompt(topic: string): string {
  return `You are a debate-topic editor. The user has drafted a topic for a structured three-perspective debate on AI policy and safety. Your job is to sharpen it into a single, clear, debatable question that:

1. Is specific enough to produce substantive disagreement across accelerationist, safetyist, and skeptic viewpoints.
2. Avoids yes/no framing — prefer "To what extent…", "How should…", or "What role should…" phrasing.
3. Is self-contained (no jargon that requires outside context).
4. Is concise — one sentence, under 200 characters.

User's draft topic:
"${topic}"

Respond with ONLY the improved topic question — no preamble, no explanation, no quotes. If the draft is already well-formed, return it unchanged.`;
}
