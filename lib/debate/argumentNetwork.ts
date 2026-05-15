// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Prompts for incremental argument network extraction.
 * Called after each debater's turn to extract claims and relationships.
 */

import { MOVE_EDGE_MAP, SUPPORT_MOVES, wordOverlap, maxOverlapVsExisting, lookupTaxonomyEdgeWeight } from './helpers.js';
import type { ArgumentNetworkNode, ArgumentNetworkEdge } from './types.js';
import { retrieveEvidence } from './evidenceRetriever.js';
import { computeFactCheckStrength } from './qbaf.js';
import type { WebEvidenceItem } from './qbaf.js';
import { detectAmbiguityCollapse, findSourcePassage } from './ambiguityDetector.js';

const SUPPORT_SCHEMES = Object.entries(MOVE_EDGE_MAP)
  .filter(([, v]) => v.edgeType === 'support')
  .map(([k]) => k)
  .join(', ');

const ATTACK_SCHEMES = Object.entries(MOVE_EDGE_MAP)
  .filter(([, v]) => v.edgeType === 'attack')
  .map(([k]) => k)
  .join(', ');

const DOMAIN_VOCABULARY = `
PREFERRED DOMAIN TERMINOLOGY — use these standardized terms when the claim expresses the same concept:
- "AI alignment" — ensuring AI systems pursue intended objectives (not "making AI do what we want")
- "alignment tax" — performance cost imposed by safety constraints (not "safety overhead")
- "instrumental convergence" — tendency of agents to pursue convergent sub-goals (not "AI pursuing sub-goals")
- "capability overhang" — gap between developed and deployed capability (not "latent potential")
- "mesa-optimization" — learned sub-objectives that diverge from training objective (not "inner optimizer")
- "compute governance" — regulatory control over computational resources (not "chip controls")
- "existential risk" — risk of human extinction or permanent civilizational collapse
- "recursive self-improvement" — AI system iteratively improving its own capabilities
- "corrigibility" — property of an AI system that accepts human correction
- "scalable oversight" — maintaining effective human supervision as AI capability scales
- "differential technology development" — prioritizing safety capabilities over dangerous capabilities
- "regulatory capture" — regulated entities controlling their own regulatory framework
- "agentic AI" — AI systems that autonomously pursue goals over extended periods
- "algorithmic accountability" — obligation to explain and justify algorithmic decisions
- "dual-use" — technology with both beneficial and harmful applications
- "red-teaming" — adversarial testing to identify system vulnerabilities
- "deployment guardrails" — constraints on AI system behavior in production
- "formal verification" — mathematical proof that a system meets its specification
- "pre-deployment verification" — testing and validation before releasing an AI system
- "frontier models" — the most capable AI models at the boundary of current technology
- "deceptive alignment" — AI system appearing aligned during training while pursuing different objectives
- "systemic risk" — risk of cascading failures across interconnected systems
- "human-in-the-loop" — requiring human oversight at decision points in automated systems
- "catastrophic failure" — failure mode with severe, potentially irreversible consequences
- "safety-washing" — superficial safety claims used to deflect genuine accountability
- "regulatory sandboxes" — controlled environments for testing innovation under regulatory oversight
- "liability regime" — legal framework assigning responsibility for AI-caused harms
- "strict liability" — legal liability without requiring proof of fault or negligence
- "moat" / "barrier to entry" — competitive advantages that prevent new market participants
- "race to the bottom" — competitive dynamic where safety standards decrease to reduce costs
- "performative compliance" — appearing to meet requirements without genuine implementation
- "lock-in effects" — mechanisms that prevent switching away from a technology or vendor
- "human agency" — the capacity for humans to make autonomous decisions in AI-mediated contexts
- "adversarial robustness" — resilience of AI systems against deliberately crafted malicious inputs
- "capability elicitation" — methods for discovering and measuring what an AI system can do
These are advisory — use the debater's exact phrasing when it's already precise.
`;

export interface PriorClaim {
  id: string;
  text: string;
  speaker: string;
}

export function extractClaimsPrompt(
  statement: string,
  speaker: string,
  priorClaims: PriorClaim[],
): string {
  const priorBlock = priorClaims.length > 0
    ? priorClaims.map(c => `  ${c.id} (${c.speaker}): ${c.text}`).join('\n')
    : '  (none yet — this is the first statement)';

  return `Extract the key claims from this debate statement and map their relationships to prior claims.

STATEMENT by ${speaker}:
"${statement}"

PRIOR CLAIMS IN THIS DEBATE:
${priorBlock}

For each distinct claim in the statement:
1. Extract the claim as a near-verbatim sentence from the statement
2. If it responds to a prior claim, classify the relationship:
   - "supports" with a warrant (WHY it supports — the reasoning pattern).
     Use "supports" for concession moves: when the speaker grants, agrees with, or accepts an opponent's claim. Schemes for support: ${SUPPORT_SCHEMES}.
   - "attacks" with attack_type ("rebut" = contradicts conclusion, "undercut" = denies the inference, "undermine" = attacks premise credibility) and scheme (${ATTACK_SCHEMES})
   NOTE: A CONCEDE-AND-PIVOT move often produces TWO edges — a "supports" edge for the conceded portion and an "attacks" edge for the pivot. Include both in responds_to.
   - "strength": classify the engagement strength as ONE of:
     "decisive" — directly rebuts/supports with specific evidence or logical entailment
     "substantial" — clear engagement with some evidence or reasoning
     "tangential" — loosely related, weak or indirect connection
     Do NOT output numeric weights. Use ONLY these three categories.
   - "argumentation_scheme": classify the reasoning pattern being used. Pick ONE:
     ARGUMENT_FROM_EVIDENCE — supported by specific data or measurements
     ARGUMENT_FROM_EXPERT_OPINION — supported by expert testimony or institutional authority
     ARGUMENT_FROM_PRECEDENT — supported by a historical case or legal precedent
     ARGUMENT_FROM_CONSEQUENCES — based on predicted outcomes of an action
     ARGUMENT_FROM_ANALOGY — draws a parallel to another domain
     PRACTICAL_REASONING — advocates an action as means to a stated goal
     ARGUMENT_FROM_DEFINITION — depends on how a key term is defined
     ARGUMENT_FROM_VALUES — grounded in an explicit value or ethical principle
     ARGUMENT_FROM_FAIRNESS — appeals to equal treatment or proportionality
     ARGUMENT_FROM_IGNORANCE — derives conclusion from absence of evidence
     SLIPPERY_SLOPE — claims a small action leads to extreme outcomes through a chain
     ARGUMENT_FROM_RISK — advocates caution based on magnitude of potential harm
     ARGUMENT_FROM_METAPHOR — uses a metaphor or figurative frame to structure reasoning about the target domain (e.g., "AI development is a race", "regulation is red tape", "alignment is taming a genie")
     OTHER — if none fit (include brief description)
3. If it's a new standalone claim, responds_to should be an empty array

Extract 3-6 claims. Each claim must be traceable to text actually in the statement. Do NOT invent claims. Prefer more rather than fewer — include secondary and supporting claims, not just the headline assertion.

For each claim, also classify:
- "extraction_confidence": how faithfully this claim captures what the speaker actually said (0-1):
  0.9-1.0: near-verbatim sentence from the statement
  0.7-0.89: faithful compression, core meaning preserved
  0.5-0.69: implicit premise or reading between the lines
  Below 0.5: do not include — you are editorializing beyond the statement
- "bdi_category": "belief" (empirical/factual claim), "desire" (normative/value claim), or "intention" (strategic/methodological claim)
- "base_strength": classify the evidential grounding as ONE of:
  "grounded" — cites specific data, named sources, dates, or directly verifiable facts
  "reasoned" — logical argument with internal coherence but no specific evidence
  "asserted" — claim stated without supporting reasoning or evidence
  Do NOT output numeric scores. Use ONLY these three categories.
- "bdi_sub_scores": for each criterion, answer "yes", "partial", or "no":
  For belief claims: OMIT bdi_sub_scores — use "belief_verification" instead (see below)
  For desire claims: {"values_grounding": "yes/partial/no", "tradeoff_acknowledgment": "yes/partial/no", "precedent_citation": "yes/partial/no"}
  For intention claims: {"mechanism_specificity": "yes/partial/no", "scope_bounding": "yes/partial/no", "failure_mode_addressing": "yes/partial/no"}
- "belief_verification": REQUIRED for belief claims ONLY. Answer each sub-step:
  {"evidence_cited": "what specific evidence does this claim cite (1 sentence, or 'none')",
   "source_located": "found" (evidence traceable to the source document) | "not_found" (claim cites evidence not in the source) | "no_source" (claim cites no specific evidence),
   "evidence_supports": "strongly" (evidence directly entails the claim) | "partially" (evidence is relevant but doesn't fully support) | "weakly" (loose connection) | "contradicts" (evidence works against the claim),
   "counter_evidence": "none" (no contradicting info in the source) | "minor" (some tension but not decisive) | "significant" (source contains strong counter-evidence),
   "ambiguity_resolved": "none" (the source makes a clear, unambiguous claim) | "acknowledged" (the source hedges or presents multiple readings, and this extraction preserves that uncertainty) | "collapsed" (the source hedges or presents multiple readings, but this extraction picks one and states it as settled)}
- "specificity": "precise" (contains specific numbers, dates, named entities, or directly verifiable facts), "general" (broad empirical claim without specific verifiable details), or "abstract" (theoretical/normative, not empirically testable)
- "steelman_of": null normally. Set to the opponent's name (e.g. "Prometheus") ONLY when this claim deliberately presents the STRONGEST version of an opponent's position before critiquing it. A steelman means restating someone else's argument charitably — not attacking it.

${DOMAIN_VOCABULARY}
Return ONLY JSON (no markdown):
{
  "claims": [
    {
      "text": "near-verbatim claim from the statement",
      "extraction_confidence": 0.92,
      "bdi_category": "belief or desire or intention",
      "base_strength": "grounded or reasoned or asserted",
      "bdi_sub_scores": {"values_grounding": "yes", "tradeoff_acknowledgment": "partial", "precedent_citation": "no"},
      "specificity": "precise or general or abstract",
      "steelman_of": null,
      "responds_to": [
        {
          "prior_claim_id": "AN-1",
          "relationship": "supports or attacks",
          "attack_type": "rebut or undercut or undermine (only if attacks)",
          "strength": "decisive or substantial or tangential",
          "scheme": "one of: DISTINGUISH, COUNTEREXAMPLE, CONCEDE-AND-PIVOT, REFRAME, EMPIRICAL CHALLENGE, EXTEND, UNDERCUT, SPECIFY, INTEGRATE, BURDEN-SHIFT",
          "argumentation_scheme": "ARGUMENT_FROM_EVIDENCE",
          "warrant": "1 sentence: WHY this claim relates to the prior claim"
        }
      ]
    }
  ]
}`;
}

/**
 * Hybrid approach: the debater supplies claim sketches (my_claims) with
 * the claims it intended to make and which prior claims they target.
 * This lighter prompt validates those claims and classifies the relationship
 * types (supports/attacks, attack_type, scheme, warrant) — the debater
 * identified WHAT it's arguing, and this analyst classifies HOW.
 */
export function classifyClaimsPrompt(
  statement: string,
  speaker: string,
  debaterClaims: { claim: string; targets: string[] }[],
  priorClaims: PriorClaim[],
): string {
  const priorBlock = priorClaims.length > 0
    ? priorClaims.map(c => `  ${c.id} (${c.speaker}): ${c.text}`).join('\n')
    : '  (none yet)';

  const claimsBlock = debaterClaims
    .map((c, i) => `  [${i + 1}] "${c.claim}"${c.targets.length > 0 ? ` → targets: ${c.targets.join(', ')}` : ' (standalone)'}`)
    .join('\n');

  return `The debater ${speaker} made the following statement and identified their key claims.
Your job is to CLASSIFY the relationship between each claim and its targets. Do NOT invent
new claims — work only with the claims the debater provided.

STATEMENT by ${speaker}:
"${statement}"

CLAIMS IDENTIFIED BY THE DEBATER:
${claimsBlock}

PRIOR CLAIMS IN THIS DEBATE:
${priorBlock}

For each claim:
1. Verify the claim text appears near-verbatim in the statement (if not, flag it)
2. For each target, classify the relationship:
   - "supports" with a warrant (WHY it supports — the reasoning pattern).
     Use "supports" for concession moves: when the speaker grants, agrees with, or accepts
     an opponent's claim. Schemes for support: ${SUPPORT_SCHEMES}.
   - "attacks" with attack_type ("rebut" = contradicts conclusion, "undercut" = denies the
     inference, "undermine" = attacks premise credibility) and scheme (${ATTACK_SCHEMES})
   NOTE: A CONCEDE-AND-PIVOT move often produces TWO edges — a "supports" edge for the
   conceded portion and an "attacks" edge for the pivot. Include both in responds_to.
   - "strength": classify the engagement strength as ONE of:
     "decisive" — directly rebuts/supports with specific evidence or logical entailment
     "substantial" — clear engagement with some evidence or reasoning
     "tangential" — loosely related, weak or indirect connection
     Do NOT output numeric weights. Use ONLY these three categories.
   - "argumentation_scheme": classify the reasoning pattern (ARGUMENT_FROM_EVIDENCE,
     ARGUMENT_FROM_EXPERT_OPINION, ARGUMENT_FROM_PRECEDENT, ARGUMENT_FROM_CONSEQUENCES,
     ARGUMENT_FROM_ANALOGY, PRACTICAL_REASONING, ARGUMENT_FROM_DEFINITION, ARGUMENT_FROM_VALUES,
     ARGUMENT_FROM_FAIRNESS, ARGUMENT_FROM_IGNORANCE, SLIPPERY_SLOPE, ARGUMENT_FROM_RISK, OTHER)
3. If the debater listed no targets but you see an obvious relationship to a prior claim,
   you may add it — but prefer the debater's own assessment.

Also classify each claim:
- "bdi_category": "belief" (empirical/factual), "desire" (normative/value), or "intention" (strategic/methodological)
- "base_strength": classify the evidential grounding as ONE of:
  "grounded" — cites specific data, named sources, dates, or directly verifiable facts
  "reasoned" — logical argument with internal coherence but no specific evidence
  "asserted" — claim stated without supporting reasoning or evidence
  Do NOT output numeric scores. Use ONLY these three categories.
- "bdi_sub_scores": for each criterion, answer "yes", "partial", or "no":
  For belief claims: OMIT bdi_sub_scores — use "belief_verification" instead (see below)
  desire: {"values_grounding": "yes/partial/no", "tradeoff_acknowledgment": "yes/partial/no", "precedent_citation": "yes/partial/no"}
  intention: {"mechanism_specificity": "yes/partial/no", "scope_bounding": "yes/partial/no", "failure_mode_addressing": "yes/partial/no"}
- "belief_verification": REQUIRED for belief claims ONLY. Answer each sub-step:
  {"evidence_cited": "what evidence this claim cites (1 sentence, or 'none')",
   "source_located": "found" | "not_found" | "no_source",
   "evidence_supports": "strongly" | "partially" | "weakly" | "contradicts",
   "counter_evidence": "none" | "minor" | "significant",
   "ambiguity_resolved": "none" | "acknowledged" | "collapsed"}
- "specificity": "precise" (specific numbers, dates, named entities), "general" (broad empirical), or "abstract" (theoretical/normative)
- "steelman_of": null normally. Set to opponent's name ONLY when this claim deliberately presents the strongest version of an opponent's position.

${DOMAIN_VOCABULARY}
Return ONLY JSON (no markdown):
{
  "claims": [
    {
      "text": "the debater's claim text (unchanged)",
      "bdi_category": "belief or desire or intention",
      "base_strength": "grounded or reasoned or asserted",
      "bdi_sub_scores": {"mechanism_specificity": "yes", "scope_bounding": "partial", "failure_mode_addressing": "no"},
      "specificity": "precise or general or abstract",
      "steelman_of": null,
      "responds_to": [
        {
          "prior_claim_id": "AN-1",
          "relationship": "supports or attacks",
          "attack_type": "rebut or undercut or undermine (only if attacks)",
          "strength": "decisive or substantial or tangential",
          "scheme": "one of: DISTINGUISH, COUNTEREXAMPLE, CONCEDE-AND-PIVOT, REFRAME, EMPIRICAL CHALLENGE, EXTEND, UNDERCUT, SPECIFY, INTEGRATE, BURDEN-SHIFT",
          "argumentation_scheme": "ARGUMENT_FROM_EVIDENCE",
          "warrant": "1 sentence: WHY this claim relates to the prior claim"
        }
      ]
    }
  ]
}`;
}

/** Format the argument network for injection into moderator prompts */
export function formatArgumentNetworkContext(
  nodes: { id: string; text: string; speaker: string }[],
  edges: { source: string; target: string; type: string; attack_type?: string; scheme?: string; argumentation_scheme?: string; warrant?: string }[],
): string {
  if (nodes.length === 0) return '';

  const lines = ['', '=== ARGUMENT NETWORK (claims made so far) ==='];

  // Build adjacency for display
  const attacksOn = new Map<string, { source: string; type: string; scheme?: string; argumentation_scheme?: string; warrant?: string }[]>();
  for (const e of edges) {
    if (e.type === 'attacks') {
      const list = attacksOn.get(e.target) || [];
      list.push({ source: e.source, type: e.attack_type || 'rebut', scheme: e.scheme, argumentation_scheme: e.argumentation_scheme, warrant: e.warrant });
      attacksOn.set(e.target, list);
    }
  }

  for (const n of nodes) {
    const attacks = attacksOn.get(n.id) || [];
    const attackSuffix = attacks.length > 0
      ? ` [attacked ${attacks.length}x]`
      : ' [unaddressed]';
    lines.push(`${n.id} (${n.speaker}): "${n.text}"${attacks.length > 0 || edges.some(e => e.source === n.id) ? '' : attackSuffix}`);
    for (const a of attacks) {
      const schemeInfo = a.argumentation_scheme ? ` [${a.argumentation_scheme}]` : '';
      lines.push(`  <- ${a.source} ${a.type}${a.scheme ? ` via ${a.scheme}` : ''}${schemeInfo}${a.warrant ? ` — ${a.warrant}` : ''}`);
    }
  }

  // Identify unaddressed claims (no attacks, not supporting anything)
  const responded = new Set(edges.map(e => e.target));
  const responding = new Set(edges.map(e => e.source));
  const unaddressed = nodes.filter(n => !responded.has(n.id) && !responding.has(n.id));
  if (unaddressed.length > 0) {
    lines.push('');
    lines.push(`Unaddressed claims: ${unaddressed.map(n => n.id).join(', ')}`);
  }

  return lines.join('\n');
}

/** Format claims from other debaters, prioritized by response-relevance.
 *  Tier 1: Claims that respond to this agent's prior claims.
 *  Tier 2: Unaddressed claims targeting this agent.
 *  Tier 3: Recency (fallback). */
export function formatEstablishedPoints(
  allNodes: { id: string; text: string; speaker: string }[],
  currentSpeaker: string,
  maxPoints: number = 10,
  edges?: { source: string; target: string; type: 'supports' | 'attacks' }[],
): string {
  if (allNodes.length === 0) return '';

  const otherClaims = allNodes.filter(n => n.speaker !== currentSpeaker);
  if (otherClaims.length === 0) return '';

  // Identify this speaker's claim IDs
  const myClaims = new Set(allNodes.filter(n => n.speaker === currentSpeaker).map(n => n.id));
  const otherIds = new Set(otherClaims.map(n => n.id));

  // Tier 1: Claims that directly respond to my claims (via edges)
  const tier1 = new Set<string>();
  // Tier 2: Claims targeting me that I haven't responded to
  const tier2 = new Set<string>();

  if (edges && edges.length > 0) {
    // Claims from others that target my claims
    for (const e of edges) {
      if (otherIds.has(e.source) && myClaims.has(e.target)) {
        tier1.add(e.source);
      }
    }

    // Claims targeting me that I haven't addressed (no edge from my claims to theirs)
    const myTargets = new Set(edges.filter(e => myClaims.has(e.source)).map(e => e.target));
    for (const id of tier1) {
      // Already in tier 1 — skip
    }
    for (const c of otherClaims) {
      if (!tier1.has(c.id) && !myTargets.has(c.id)) {
        // Check if this claim targets any of my claims
        const targetsMe = edges.some(e => e.source === c.id && myClaims.has(e.target));
        if (targetsMe) tier2.add(c.id);
      }
    }
  }

  // Build prioritized list
  const result: { id: string; text: string; speaker: string; tag: string }[] = [];

  for (const c of otherClaims) {
    if (tier1.has(c.id)) {
      result.push({ ...c, tag: '[RESPONDS TO YOUR CLAIM]' });
    }
  }
  for (const c of otherClaims) {
    if (tier2.has(c.id)) {
      result.push({ ...c, tag: '[UNADDRESSED — TARGETING YOU]' });
    }
  }
  // Tier 3: remaining by recency
  for (const c of otherClaims.slice().reverse()) {
    if (!tier1.has(c.id) && !tier2.has(c.id) && result.length < maxPoints) {
      result.push({ ...c, tag: '' });
    }
  }

  const capped = result.slice(0, maxPoints);

  const lines = [
    '',
    '=== POINTS ALREADY ESTABLISHED BY OTHER DEBATERS ===',
    'These points have already been made. Do NOT restate them in your own words.',
    'If you agree, say so briefly ("as [name] noted") and move to what you can ADD.',
    'If you disagree, attack the specific claim rather than restating it.',
  ];
  for (const c of capped) {
    const tag = c.tag ? ` ${c.tag}` : '';
    lines.push(`- ${c.id} (${c.speaker}):${tag} ${c.text}`);
  }

  return lines.join('\n') + '\n';
}

/** Format commitments and prior claims for injection into debater prompts */
export function formatCommitments(
  commitments: { asserted: string[]; conceded: string[]; challenged: string[] },
  priorClaims?: { text: string }[],
): string {
  const lines: string[] = [];

  if (commitments.asserted.length > 0 || (priorClaims && priorClaims.length > 0)) {
    lines.push('POINTS YOU HAVE ALREADY MADE (do NOT repeat these — build on them or make NEW arguments):');
    // Use AN claims if available (more precise), fall back to commitment assertions
    const claims = priorClaims && priorClaims.length > 0
      ? priorClaims.map(c => c.text)
      : commitments.asserted;
    for (const a of claims.slice(-8)) lines.push(`- ${a}`);
  }
  if (commitments.conceded.length > 0) {
    lines.push('Points you have CONCEDED (do not contradict these without acknowledging the change):');
    for (const c of commitments.conceded) lines.push(`- ${c}`);
  }
  if (commitments.challenged.length > 0) {
    lines.push('Points you have CHALLENGED:');
    for (const c of commitments.challenged) lines.push(`- ${c}`);
  }

  if (lines.length === 0) return '';

  return `\n=== YOUR PRIOR ARGUMENTS ===\n${lines.join('\n')}\n
REPETITION RULE: Do NOT restate a point you have already made. The audience has heard it.
If an opponent hasn't addressed your point, say "I note that no one has responded to my argument
that [brief reference]" — then move to a NEW argument or develop a DIFFERENT angle.
If you want to reinforce a prior point, add NEW evidence or a NEW example — do not restate
the same logic with different words.

CONSISTENCY RULE: Do not contradict your prior assertions without explicitly acknowledging
the change. If you now believe differently, say "I previously argued X, but on reflection..."
— do not silently flip.\n`;
}

// ── Unanswered Claims Ledger ────────────────────────────

import type { UnansweredClaimEntry, DialecticalScheme } from './types.js';

/**
 * Update the unanswered claims ledger after claim extraction.
 * Tracks claims with base_strength > 0.4 that have no incoming edges (not responded to).
 * Complements the 8-entry compression window (tactical) with a debate-wide view (strategic).
 */
export function updateUnansweredLedger(
  ledger: UnansweredClaimEntry[],
  nodes: ArgumentNetworkNode[],
  edges: ArgumentNetworkEdge[],
  currentRound: number,
): UnansweredClaimEntry[] {
  const updated = [...ledger];
  const targeted = new Set(edges.map(e => e.target));
  const ledgerIds = new Set(updated.map(e => e.claim_id));

  for (const node of nodes) {
    if ((node.base_strength ?? 0) <= 0.4) continue;

    const isAddressed = targeted.has(node.id);
    const existing = updated.find(e => e.claim_id === node.id);

    if (existing) {
      // Already tracked — check if now addressed
      if (isAddressed && !existing.addressed_round) {
        // Find who addressed it
        const addressingEdge = edges.find(e => e.target === node.id);
        const addressingNode = addressingEdge
          ? nodes.find(n => n.id === addressingEdge.source)
          : undefined;
        existing.addressed_round = currentRound;
        existing.addressed_by = addressingNode?.speaker as string | undefined;
      }
    } else if (!isAddressed && !ledgerIds.has(node.id)) {
      // New unanswered claim
      updated.push({
        claim_id: node.id,
        claim_text: node.text,
        speaker: node.speaker as string,
        first_unanswered_round: currentRound,
      });
    }
  }

  return updated;
}

/**
 * Format a moderator hint for the oldest unanswered claim.
 * Returns a hint string every 3 rounds, empty string otherwise.
 */
export function formatUnansweredClaimsHint(
  ledger: UnansweredClaimEntry[],
  currentRound: number,
): string {
  if (currentRound % 3 !== 0) return '';

  const unanswered = ledger
    .filter(e => !e.addressed_round)
    .sort((a, b) => a.first_unanswered_round - b.first_unanswered_round);

  if (unanswered.length === 0) return '';

  const oldest = unanswered[0];
  const age = currentRound - oldest.first_unanswered_round;

  return `\n\nSTRATEGIC NOTE: ${unanswered.length} claim(s) remain unanswered across the debate. ` +
    `The oldest (${age} rounds unanswered, from round ${oldest.first_unanswered_round}) is by ${oldest.speaker}: ` +
    `"${oldest.claim_text}". Consider directing the next responder to address it.`;
}

/**
 * Detect isolated high-strength claims from different speakers with no edges between them.
 * This pattern — strong positions coexisting without engagement — signals debaters talking
 * past each other. The fix is a SPECIFY move: force one side to state what would falsify
 * their position, making the disagreement testable.
 */
export function formatSpecifyHint(
  nodes: { id: string; text: string; speaker: string; base_strength?: number; computed_strength?: number }[],
  edges: { source: string; target: string }[],
): string {
  const strongNodes = nodes.filter(n => (n.computed_strength ?? n.base_strength ?? 0.5) >= 0.6);
  if (strongNodes.length < 2) return '';

  // Build edge adjacency (undirected — any edge between two nodes counts as engagement)
  const connected = new Set<string>();
  for (const e of edges) {
    connected.add(`${e.source}|${e.target}`);
    connected.add(`${e.target}|${e.source}`);
  }

  // Find pairs of strong claims from different speakers with no edge between them
  const isolatedPairs: { a: typeof strongNodes[0]; b: typeof strongNodes[0] }[] = [];
  for (let i = 0; i < strongNodes.length; i++) {
    for (let j = i + 1; j < strongNodes.length; j++) {
      const a = strongNodes[i], b = strongNodes[j];
      if (a.speaker === b.speaker) continue;
      if (!connected.has(`${a.id}|${b.id}`)) {
        isolatedPairs.push({ a, b });
      }
    }
  }

  if (isolatedPairs.length === 0) return '';

  // Pick the pair with the highest combined strength
  isolatedPairs.sort((x, y) => {
    const xStr = (x.a.computed_strength ?? x.a.base_strength ?? 0.5) + (x.b.computed_strength ?? x.b.base_strength ?? 0.5);
    const yStr = (y.a.computed_strength ?? y.a.base_strength ?? 0.5) + (y.b.computed_strength ?? y.b.base_strength ?? 0.5);
    return yStr - xStr;
  });

  const best = isolatedPairs[0];
  const aStr = (best.a.computed_strength ?? best.a.base_strength ?? 0.5).toFixed(2);
  const bStr = (best.b.computed_strength ?? best.b.base_strength ?? 0.5).toFixed(2);

  return `\n\nSPECIFY OPPORTUNITY: ${best.a.id} (${best.a.speaker}, strength ${aStr}) and ` +
    `${best.b.id} (${best.b.speaker}, strength ${bStr}) are both strong claims with NO direct ` +
    `engagement between them — the debaters may be talking past each other. Consider using ` +
    `a SPECIFY move: direct one debater to state what specific evidence or outcome would ` +
    `falsify their position. This forces testable predictions and makes the disagreement resolvable.`;
}

/**
 * QBAF-Grounded Concession Opportunity (QGCO).
 *
 * Surfaces opponent claims whose QBAF computed_strength exceeds `threshold` and
 * that the current speaker has not yet attacked or conceded. The debater can
 * choose to grant these points — counterbalancing the move-type rotation rule
 * that blocks consecutive CONCEDE openings and was causing debaters to never
 * concede anything.
 *
 * Returns '' if no qualifying candidates exist. The caller is responsible for
 * any round-based gating (e.g. fire only when no recent concession).
 */
export function formatConcessionCandidatesHint(
  nodes: { id: string; text: string; speaker: string; base_strength?: number; computed_strength?: number }[],
  edges: { source: string; target: string; type: string }[],
  currentSpeaker: string,
  priorConceded: string[] = [],
  threshold: number = 0.45,
  maxCandidates: number = 3,
): string {
  const concededSet = new Set(priorConceded);
  const attackedByMe = new Set(
    edges
      .filter(e => e.type === 'attacks')
      .filter(e => nodes.find(n => n.id === e.source)?.speaker === currentSpeaker)
      .map(e => e.target),
  );

  const candidates = nodes
    .filter(n => n.speaker !== currentSpeaker)
    .filter(n => !attackedByMe.has(n.id))
    .filter(n => !concededSet.has(n.id) && !concededSet.has(n.text))
    .map(n => ({ node: n, strength: n.computed_strength ?? n.base_strength ?? 0 }))
    .filter(c => c.strength >= threshold)
    .sort((a, b) => b.strength - a.strength)
    .slice(0, maxCandidates);

  if (candidates.length === 0) return '';

  const lines = [
    '',
    '=== POTENTIAL CONCESSIONS ===',
    'These opponent claims are well-supported. You SHOULD concede at least one unless you have specific, concrete counter-evidence.',
    'Refusing to concede strong opposing points makes your overall argument weaker, not stronger.',
    'If you grant a point, name it explicitly and pivot to what you still contest.',
    'If you decline ALL candidates, you must explain specifically why each one is wrong — "I disagree" is not sufficient.',
  ];
  candidates.forEach((c, i) => {
    lines.push(
      `${i + 1}. [${c.node.id}] ${c.node.speaker} (strength ${c.strength.toFixed(2)}): "${c.node.text}"`,
    );
  });
  lines.push('If you decline to concede, set "concession_considered": "declined" in your JSON response.');
  return lines.join('\n') + '\n';
}

// ── NLI-style discrete evaluation mapping ───────────────────

export type NodeStrengthCategory = 'grounded' | 'reasoned' | 'asserted';
export type EdgeStrengthCategory = 'decisive' | 'substantial' | 'tangential';
export type BdiTernary = 'yes' | 'partial' | 'no';

const NODE_STRENGTH_MAP: Record<NodeStrengthCategory, number> = {
  grounded: 0.8,
  reasoned: 0.5,
  asserted: 0.2,
};

const EDGE_STRENGTH_MAP: Record<EdgeStrengthCategory, number> = {
  decisive: 1.0,
  substantial: 0.7,
  tangential: 0.3,
};

const BDI_TERNARY_MAP: Record<BdiTernary, number> = {
  yes: 1.0,
  partial: 0.5,
  no: 0.0,
};

/** Belief specificity → base_strength proxy (t/455 Stage 1).
 *  AI reliably judges whether a claim cites specific data vs makes broad assertions. */
const BELIEF_SPECIFICITY_MAP: Record<string, number> = {
  precise: 0.70,  // cites specific data, named sources, dates
  general: 0.50,  // broad empirical claim without specific details
  abstract: 0.35, // theoretical, not empirically testable
};

/** Compute base_strength from a ThinkPRM verification chain (t/455 Stage 3).
 *  Decomposes the unreliable holistic "evidence quality" judgment into 4 tractable
 *  sub-steps, each producing a sub-score in [0,1]. */
export function beliefVerificationToStrength(v: BeliefVerification): number {
  // Sub-step 1: source_located — was the evidence found in the source?
  const locationScore = v.source_located === 'found' ? 1.0
    : v.source_located === 'not_found' ? 0.3  // claim cites evidence not in source
    : 0.1;  // no_source — claim cites nothing specific

  // Sub-step 2: evidence_supports — does the evidence actually support the claim?
  const supportScore = v.evidence_supports === 'strongly' ? 1.0
    : v.evidence_supports === 'partially' ? 0.65
    : v.evidence_supports === 'weakly' ? 0.35
    : 0.1;  // contradicts

  // Sub-step 3: counter_evidence — does the source contain contradicting info?
  const counterPenalty = v.counter_evidence === 'none' ? 0
    : v.counter_evidence === 'minor' ? 0.15
    : 0.30;  // significant

  // Sub-step 4: ambiguity_resolved — did the extraction collapse an open question?
  // "collapsed" caps strength at 0.6 — the claim may be accurate but represents
  // a choice among interpretations the source left open (Gur-Arieh et al., 2026).
  const ambiguityPenalty = v.ambiguity_resolved === 'collapsed' ? 0.20
    : 0;  // "none" or "acknowledged" — no penalty

  // Composite: weighted average with counter-evidence and ambiguity penalties
  const raw = 0.4 * locationScore + 0.6 * supportScore - counterPenalty - ambiguityPenalty;
  return Math.max(0.1, Math.min(0.95, raw));
}

export function discreteNodeStrength(category: string): number {
  const key = category.toLowerCase() as NodeStrengthCategory;
  return NODE_STRENGTH_MAP[key] ?? 0.5;
}

export function discreteEdgeStrength(category: string): number {
  const key = category.toLowerCase() as EdgeStrengthCategory;
  return EDGE_STRENGTH_MAP[key] ?? 0.7;
}

export function discreteBdiScore(value: string): number {
  const key = value.toLowerCase() as BdiTernary;
  return BDI_TERNARY_MAP[key] ?? 0.5;
}

/**
 * Map a fact-check verdict + confidence to a numeric base_strength for Belief claims.
 * Closes the belief-scoring asymmetry (theory-of-success §4.4) by using retrieval-augmented
 * verification as a proxy for empirical claim strength.
 *
 * When `evidenceStrength` is provided (from the evidence QBAF pipeline), it takes
 * precedence over the single-verdict mapping.
 */
export function factCheckToBaseStrength(
  verdict: string,
  confidence?: string,
  evidenceStrength?: number,
): number {
  // Evidence QBAF result takes precedence when available
  if (evidenceStrength !== undefined) {
    return Math.max(0, Math.min(1, evidenceStrength));
  }
  const conf = (confidence ?? 'medium').toLowerCase();
  switch (verdict) {
    case 'verified':
    case 'supported':
      return conf === 'high' ? 0.85 : conf === 'low' ? 0.55 : 0.70;
    case 'disputed':
    case 'false':
      return conf === 'high' ? 0.15 : conf === 'low' ? 0.40 : 0.30;
    case 'unverifiable':
    default:
      return 0.50;
  }
}

function isDiscreteNodeStrength(v: unknown): v is string {
  return typeof v === 'string' && v.toLowerCase() in NODE_STRENGTH_MAP;
}

function isDiscreteEdgeStrength(v: unknown): v is string {
  return typeof v === 'string' && v.toLowerCase() in EDGE_STRENGTH_MAP;
}

function isDiscreteBdi(v: unknown): v is string {
  return typeof v === 'string' && v.toLowerCase() in BDI_TERNARY_MAP;
}

/**
 * Normalize a raw extracted claim from discrete categorical outputs to numeric floats.
 * Accepts both legacy float format (passthrough) and NLI-style discrete categories.
 */
export function normalizeExtractedClaim(claim: RawExtractedClaim): RawExtractedClaim {
  const normalized = { ...claim };

  // base_strength: accept discrete category string or legacy float
  if (isDiscreteNodeStrength(claim.base_strength)) {
    normalized.base_strength = discreteNodeStrength(claim.base_strength as unknown as string);
  }

  // bdi_sub_scores: accept discrete ternary strings or legacy floats
  if (claim.bdi_sub_scores && typeof claim.bdi_sub_scores === 'object') {
    const mapped: Record<string, number> = {};
    for (const [key, val] of Object.entries(claim.bdi_sub_scores)) {
      mapped[key] = isDiscreteBdi(val) ? discreteBdiScore(val as unknown as string) : (typeof val === 'number' ? val : 0.5);
    }
    normalized.bdi_sub_scores = mapped;
  }

  // edge weights: accept discrete "strength" field, discrete "weight" string, or legacy float
  if (claim.responds_to) {
    normalized.responds_to = claim.responds_to.map(rel => {
      const raw = rel.strength ?? rel.weight;
      if (isDiscreteEdgeStrength(raw)) {
        return { ...rel, weight: discreteEdgeStrength(raw as string) };
      }
      return rel;
    });
  }

  return normalized;
}

// ── Shared claim processing ──────────────────────────────────

/** ThinkPRM-style 4-step verification chain for Belief claims (t/455 Stage 3).
 *  Each sub-step is a self-contained judgment the model can perform reliably. */
export interface BeliefVerification {
  /** What specific evidence does the claim cite? */
  evidence_cited: string;
  /** Is the cited evidence present in the source document? */
  source_located: 'found' | 'not_found' | 'no_source';
  /** Does the cited evidence actually support the claim? */
  evidence_supports: 'strongly' | 'partially' | 'weakly' | 'contradicts';
  /** Does the source contain information contradicting the claim? */
  counter_evidence: 'none' | 'minor' | 'significant';
  /** Does this extraction resolve an ambiguity the source left open? */
  ambiguity_resolved?: 'none' | 'acknowledged' | 'collapsed';
}

export interface RawExtractedClaim {
  text: string;
  extraction_confidence?: number;
  bdi_category?: string;
  base_strength?: number | string;
  bdi_sub_scores?: Record<string, number | string>;
  specificity?: string;
  steelman_of?: string | null;
  /** ThinkPRM verification chain for Belief claims (t/455 Stage 3). */
  belief_verification?: BeliefVerification;
  responds_to?: {
    prior_claim_id: string;
    relationship: string;
    attack_type?: string;
    /** Legacy float format */
    weight?: number | string;
    /** NLI-style discrete category (decisive/substantial/tangential) */
    strength?: string;
    scheme?: string;
    argumentation_scheme?: string;
    warrant?: string;
  }[];
}

export interface ProcessClaimsOptions {
  groundingOverlapThreshold: number;
  duplicateOverlapThreshold?: number;
  maxClaims?: number;
  isClassifyPath: boolean;
  /** Path to sources directory for evidence retrieval (t/455 Stage 2).
   *  When provided, Belief claims get QBAF-adjusted base_strength from
   *  retrieved evidence. Requires Node.js filesystem access. */
  sourcesDir?: string;
}

export interface ProcessClaimsInput {
  claims: RawExtractedClaim[];
  statement: string;
  speaker: string;
  entryId: string;
  taxonomyRefIds: string[];
  turnNumber: number;
  existingNodes: ArgumentNetworkNode[];
  existingEdgeCount: number;
  startNodeId: number;
  taxonomyEdges?: { source: string; target: string; weight?: number }[];
}

export interface ProcessClaimsResult {
  newNodes: ArgumentNetworkNode[];
  newEdges: ArgumentNetworkEdge[];
  accepted: { text: string; id: string; overlap_pct: number }[];
  rejected: { text: string; reason: string; overlap_pct: number }[];
  commitments: { asserted: string[]; conceded: string[]; challenged: string[] };
  rejectionReasons: Record<string, number>;
  rejectedOverlapPcts: number[];
  maxOverlapVsExisting: number;
}

const VALID_ATTACK_TYPES = new Set(['rebut', 'undercut', 'undermine']);

export function processExtractedClaims(
  input: ProcessClaimsInput,
  options: ProcessClaimsOptions,
): ProcessClaimsResult {
  const {
    claims, statement, speaker, entryId, taxonomyRefIds,
    turnNumber, existingNodes, existingEdgeCount, startNodeId, taxonomyEdges,
  } = input;
  const maxClaims = options.maxClaims ?? 6;
  const dupThreshold = options.duplicateOverlapThreshold ?? 0.30;
  const groundingThreshold = options.groundingOverlapThreshold;

  const newNodes: ArgumentNetworkNode[] = [];
  const newEdges: ArgumentNetworkEdge[] = [];
  const accepted: ProcessClaimsResult['accepted'] = [];
  const rejected: ProcessClaimsResult['rejected'] = [];
  const commitments = { asserted: [] as string[], conceded: [] as string[], challenged: [] as string[] };
  const rejectionReasons: Record<string, number> = {};
  const rejectedOverlapPcts: number[] = [];
  let maxOverlap = 0;

  const allNodes = [...existingNodes];
  const priorIds = new Set(existingNodes.map(n => n.id));
  let nextNodeId = startNodeId;
  let nextEdgeId = existingEdgeCount + 1;

  const bdiConfidenceMap: Record<string, number> = { belief: 0.3, desire: 0.65, intention: 0.71 };

  for (const rawClaim of claims.slice(0, maxClaims)) {
    const claim = normalizeExtractedClaim(rawClaim);
    if (!claim.text || claim.text.length < 10) {
      if (claim.text) {
        rejectionReasons['too_short'] = (rejectionReasons['too_short'] ?? 0) + 1;
      }
      continue;
    }

    const debaterNodes = allNodes.filter(n => n.speaker !== 'document');
    const overlapVsAN = maxOverlapVsExisting(claim.text, debaterNodes);
    if (overlapVsAN > maxOverlap) maxOverlap = overlapVsAN;

    if (overlapVsAN >= dupThreshold) {
      const pct = Math.round(overlapVsAN * 100);
      rejected.push({ text: claim.text, reason: 'duplicate_claim', overlap_pct: pct });
      rejectionReasons['duplicate_claim'] = (rejectionReasons['duplicate_claim'] ?? 0) + 1;
      rejectedOverlapPcts.push(pct);
      continue;
    }

    const overlap = wordOverlap(claim.text, statement);
    if (overlap < groundingThreshold) {
      const pct = Math.round(overlap * 100);
      rejected.push({ text: claim.text, reason: 'low_overlap', overlap_pct: pct });
      rejectionReasons['low_overlap'] = (rejectionReasons['low_overlap'] ?? 0) + 1;
      rejectedOverlapPcts.push(pct);
      continue;
    }

    const nodeId = `AN-${nextNodeId++}`;
    const node: ArgumentNetworkNode = {
      id: nodeId,
      text: claim.text,
      speaker,
      source_entry_id: entryId,
      taxonomy_refs: taxonomyRefIds,
      turn_number: turnNumber,
      base_strength: typeof claim.base_strength === 'number' ? claim.base_strength : 0.5,
      scoring_method: typeof claim.base_strength === 'number'
        ? 'bdi_criteria'
        : (claim.bdi_category === 'belief' ? 'unscored' : 'bdi_criteria'),
      bdi_sub_scores: claim.bdi_sub_scores && typeof claim.bdi_sub_scores === 'object'
        ? claim.bdi_sub_scores as ArgumentNetworkNode['bdi_sub_scores'] : undefined,
      bdi_confidence: bdiConfidenceMap[claim.bdi_category ?? ''] ?? 0.5,
      bdi_category: claim.bdi_category as ArgumentNetworkNode['bdi_category'],
      specificity: claim.specificity as ArgumentNetworkNode['specificity'],
      steelman_of: claim.steelman_of || undefined,
      extraction_confidence: typeof claim.extraction_confidence === 'number'
        ? claim.extraction_confidence : undefined,
    };

    // FIRE cross-check: cap self-reported extraction_confidence at overlap-derived maximum.
    // The LLM may overestimate how faithfully it extracted a claim. Word overlap with
    // the source statement provides a structural sanity check.
    if (node.extraction_confidence != null) {
      const overlapCap = overlap >= 0.7 ? 1.0
        : overlap >= 0.5 ? 0.8
        : overlap >= 0.3 ? 0.6
        : 0.5;
      if (node.extraction_confidence > overlapCap) {
        node.extraction_confidence = overlapCap;
      }
    }

    // BDI composite scoring: for Desires and Intentions with sub-scores,
    // use the mean of the 3 calibrated criteria as base_strength (Q-0: r=0.65/0.71).
    if (node.bdi_category === 'desire' && node.bdi_sub_scores) {
      const { values_grounding, tradeoff_acknowledgment, precedent_citation } = node.bdi_sub_scores;
      if (values_grounding != null || tradeoff_acknowledgment != null || precedent_citation != null) {
        const vg = Number.isFinite(values_grounding) ? values_grounding! : 0.5;
        const ta = Number.isFinite(tradeoff_acknowledgment) ? tradeoff_acknowledgment! : 0.5;
        const pc = Number.isFinite(precedent_citation) ? precedent_citation! : 0.5;
        node.base_strength = (vg + ta + pc) / 3;
        node.scoring_method = 'bdi_composite';
      }
    } else if (node.bdi_category === 'intention' && node.bdi_sub_scores) {
      const { mechanism_specificity, scope_bounding, failure_mode_addressing } = node.bdi_sub_scores;
      if (mechanism_specificity != null || scope_bounding != null || failure_mode_addressing != null) {
        const ms = Number.isFinite(mechanism_specificity) ? mechanism_specificity! : 0.5;
        const sb = Number.isFinite(scope_bounding) ? scope_bounding! : 0.5;
        const fm = Number.isFinite(failure_mode_addressing) ? failure_mode_addressing! : 0.5;
        node.base_strength = (ms + sb + fm) / 3;
        node.scoring_method = 'bdi_composite';
      }
    } else if (node.bdi_category === 'belief') {
      // ── Belief scoring pipeline (t/455) ──
      // Priority: ThinkPRM verification (Stage 3) > evidence QBAF (Stage 2)
      //         > specificity proxy (Stage 1) > generic
      let beliefScored = false;

      // Stage 3: ThinkPRM 4-step verification chain
      // The extraction prompt decomposes "evidence quality" into 4 tractable sub-steps.
      // Each sub-step is self-contained — the model doesn't need external access.
      if (claim.belief_verification
        && claim.belief_verification.source_located
        && claim.belief_verification.evidence_supports) {
        // Override LLM self-reported ambiguity_resolved with structural detector.
        // The model that collapsed an ambiguity can't reliably detect its own collapse.
        const sourcePassage = findSourcePassage(statement, claim.text);
        const ambiguityResult = detectAmbiguityCollapse(sourcePassage, claim.text);
        claim.belief_verification.ambiguity_resolved = ambiguityResult.resolution;

        node.base_strength = beliefVerificationToStrength(claim.belief_verification);
        node.scoring_method = 'belief_verification';
        beliefScored = true;
      }

      // Stage 2: Evidence-retrieval-augmented scoring via QBAF
      // Converts the unreliable "rate evidence quality" judgment into a tractable
      // comparison task: "does this passage support or contradict this claim?"
      // Only runs if Stage 3 (ThinkPRM) didn't already score the claim.
      if (!beliefScored && options.sourcesDir) {
        try {
          const evidence = retrieveEvidence(node.text, options.sourcesDir, { topK: 5 });
          if (evidence.length > 0) {
            // Map EvidenceItem → WebEvidenceItem for the QBAF pipeline.
            // Evidence items with high similarity likely support; low similarity
            // items are neutral. We classify as supporting since retrieveEvidence
            // already filters by relevance — truly contradicting evidence would
            // require NLI classification which is Stage 3 territory.
            const webEvidence: WebEvidenceItem[] = evidence.map(e => ({
              id: e.id,
              text: e.text,
              relation: 'supports' as const,
              source_reliability: Math.min(1, e.similarity_score + 0.2),
              relevance: e.similarity_score,
            }));

            const specStrength = BELIEF_SPECIFICITY_MAP[node.specificity ?? ''] ?? 0.50;
            const result = computeFactCheckStrength(specStrength, webEvidence);
            node.base_strength = result.adjusted_strength;
            node.scoring_method = 'evidence_qbaf';
            beliefScored = true;
          }
        } catch {
          // Evidence retrieval failed (filesystem unavailable, etc.) — fall through
        }
      }

      // Stage 1: Specificity proxy fallback
      if (!beliefScored) {
        const specStrength = BELIEF_SPECIFICITY_MAP[node.specificity ?? ''];
        if (specStrength != null) {
          node.base_strength = specStrength;
          node.scoring_method = 'belief_specificity';
        }
      }
    }

    newNodes.push(node);
    allNodes.push(node);
    priorIds.add(nodeId);

    commitments.asserted.push(claim.text);
    accepted.push({ text: claim.text, id: nodeId, overlap_pct: Math.round(overlap * 100) });

    for (const rel of claim.responds_to ?? []) {
      if (!rel.prior_claim_id || !priorIds.has(rel.prior_claim_id)) continue;

      let edgeWeight: number | undefined = typeof rel.weight === 'number'
        ? Math.max(0, Math.min(1, rel.weight)) : undefined;
      if (edgeWeight === undefined) {
        const targetNode = allNodes.find(n => n.id === rel.prior_claim_id);
        edgeWeight = lookupTaxonomyEdgeWeight(taxonomyRefIds, targetNode?.taxonomy_refs ?? [], taxonomyEdges);
      }

      const raw = (rel.attack_type ?? '').toLowerCase();
      const edge: ArgumentNetworkEdge = {
        id: `AE-${nextEdgeId++}`,
        source: nodeId,
        target: rel.prior_claim_id,
        type: rel.relationship === 'attacks' ? 'attacks' : 'supports',
        attack_type: rel.relationship === 'attacks'
          ? (VALID_ATTACK_TYPES.has(raw) ? raw as 'rebut' | 'undercut' | 'undermine' : 'rebut')
          : undefined,
        weight: edgeWeight,
        scheme: rel.scheme as ArgumentNetworkEdge['scheme'],
        warrant: rel.warrant,
        argumentation_scheme: rel.argumentation_scheme as ArgumentNetworkEdge['argumentation_scheme'],
      };
      newEdges.push(edge);

      if (rel.scheme) {
        const normalized = rel.scheme.toUpperCase().replace(/[_]/g, '-').trim();
        if (SUPPORT_MOVES.has(normalized) || SUPPORT_MOVES.has(normalized.replace(/-/g, ' '))) {
          const targetNode = allNodes.find(n => n.id === rel.prior_claim_id);
          if (targetNode && !commitments.conceded.includes(targetNode.text)) commitments.conceded.push(targetNode.text);
        }
      }
      if (rel.relationship === 'attacks') {
        const targetNode = allNodes.find(n => n.id === rel.prior_claim_id);
        if (targetNode && !commitments.challenged.includes(targetNode.text)) commitments.challenged.push(targetNode.text);
      }
    }
  }

  return {
    newNodes, newEdges, accepted, rejected, commitments,
    rejectionReasons, rejectedOverlapPcts, maxOverlapVsExisting: maxOverlap,
  };
}

// ── Dialectical move normalizer ──────────────────────────────

/**
 * Canonical move definitions with aliases that map common LLM hallucinations
 * and legacy/synonym names to the correct canonical move.
 *
 * Each canonical move has:
 * - keywords: tokens that, if present in the hallucinated name, suggest this move
 * - aliases: exact strings (lowercased) that map to this move
 */
const CANONICAL_MOVES: Record<DialecticalScheme, { keywords: string[]; aliases: string[] }> = {
  'DISTINGUISH': {
    keywords: ['distinguish', 'differentiat', 'inapplicab'],
    aliases: ['distinguish', 'differentiate', 'scope-limit', 'limit-scope'],
  },
  'COUNTEREXAMPLE': {
    keywords: ['counter', 'example', 'exception', 'counterpoint'],
    aliases: ['counterexample', 'counter-example', 'counter_example', 'counterpoint', 'provide-counterexample'],
  },
  'CONCEDE-AND-PIVOT': {
    keywords: ['conced', 'pivot', 'acknowledge', 'grant'],
    aliases: ['concede-and-pivot', 'concede_and_pivot', 'concede', 'concede-pivot', 'acknowledge-and-redirect',
              'partial-concession', 'tactical-concession', 'yield-and-redirect'],
  },
  'REFRAME': {
    keywords: ['refram', 'frame', 'perspect', 'assumption', 'expose', 'hidden', 'premise', 'reveal'],
    aliases: ['reframe', 're-frame', 'reframing', 'expose-assumption', 'expose_assumption',
              'expose-assumptions', 'surface-assumption', 'reveal-assumption', 'challenge-frame',
              'shift-frame', 'recontextualize'],
  },
  'EMPIRICAL CHALLENGE': {
    keywords: ['empiric', 'evidence', 'fact', 'data', 'ground', 'verify', 'check'],
    aliases: ['empirical challenge', 'empirical_challenge', 'empirical-challenge',
              'ground-check', 'ground_check', 'fact-check', 'challenge-evidence',
              'dispute-evidence', 'evidence-challenge', 'factual-challenge'],
  },
  'EXTEND': {
    keywords: ['extend', 'build', 'expand', 'steel', 'strengthen', 'amplif'],
    aliases: ['extend', 'build-on', 'build_on', 'steel-build', 'steel_build',
              'steelman-extend', 'amplify', 'elaborate'],
  },
  'UNDERCUT': {
    keywords: ['undercut', 'warrant', 'reasoning', 'logic', 'inference'],
    aliases: ['undercut', 'attack-warrant', 'challenge-reasoning', 'deny-inference',
              'challenge-logic', 'warrant-attack'],
  },
  'SPECIFY': {
    keywords: ['specif', 'falsif', 'operationaliz', 'crux', 'narrow', 'testab', 'predict'],
    aliases: ['specify', 'probe-falsifiability', 'identify-crux', 'identify_crux',
              'narrow', 'narrow-disagreement', 'demand-specification', 'force-prediction',
              'operationalize', 'find-crux', 'name-crux'],
  },
  'INTEGRATE': {
    keywords: ['integrat', 'synthes', 'reconcil', 'conditional', 'hybrid', 'combin'],
    aliases: ['integrate', 'synthesize', 'conditional-agree', 'conditional_agree',
              'conditional-agreement', 'reconcile', 'hybrid-position', 'combine',
              'merge-positions', 'bridge'],
  },
  'BURDEN-SHIFT': {
    keywords: ['burden', 'proof', 'onus', 'responsibility'],
    aliases: ['burden-shift', 'burden_shift', 'shift-burden', 'burden-of-proof',
              'challenge-burden', 'proof-burden'],
  },
};

/** All canonical move names as a set for O(1) lookup. */
const CANONICAL_SET = new Set<string>(Object.keys(CANONICAL_MOVES));

/** Legacy moves that should silently map to their canonical equivalents. */
const LEGACY_MAP: Record<string, DialecticalScheme> = {
  'reduce': 'UNDERCUT',     // "reduces to absurdity" is a form of undercutting the logic
  'escalate': 'REFRAME',    // "escalating" to a deeper principle is reframing the scope
};

export interface NormalizedMove {
  canonical: DialecticalScheme;
  original: string;
  confidence: number; // 0-1
  method: 'exact' | 'alias' | 'keyword' | 'legacy';
}

/**
 * Normalize a single LLM-produced move name to its canonical form.
 * Returns null if no match can be found above the confidence threshold.
 */
export function normalizeMove(raw: string, minConfidence = 0.5): NormalizedMove | null {
  const trimmed = raw.trim();
  const upper = trimmed.toUpperCase();
  const lower = trimmed.toLowerCase();

  // 1. Exact match against canonical names
  if (CANONICAL_SET.has(upper)) {
    return { canonical: upper as DialecticalScheme, original: trimmed, confidence: 1.0, method: 'exact' };
  }

  // 2. Legacy map
  if (LEGACY_MAP[lower]) {
    return { canonical: LEGACY_MAP[lower], original: trimmed, confidence: 0.8, method: 'legacy' };
  }

  // 3. Alias match (exact, case-insensitive)
  for (const [canonical, def] of Object.entries(CANONICAL_MOVES)) {
    if (def.aliases.includes(lower)) {
      return { canonical: canonical as DialecticalScheme, original: trimmed, confidence: 0.95, method: 'alias' };
    }
  }

  // 4. Keyword match — score each canonical move by keyword overlap
  const scores: { canonical: DialecticalScheme; score: number }[] = [];
  for (const [canonical, def] of Object.entries(CANONICAL_MOVES)) {
    let hits = 0;
    for (const kw of def.keywords) {
      if (lower.includes(kw)) hits++;
    }
    if (hits > 0) {
      // Score: proportion of keywords matched, weighted by how specific the match is
      const score = hits / def.keywords.length;
      scores.push({ canonical: canonical as DialecticalScheme, score });
    }
  }

  if (scores.length > 0) {
    scores.sort((a, b) => b.score - a.score);
    const best = scores[0];
    // Require the best to be meaningfully better than second-best to avoid ambiguity
    const confidence = scores.length === 1 || best.score > scores[1].score * 1.3
      ? Math.min(0.85, best.score + 0.3)
      : Math.min(0.6, best.score + 0.1);

    if (confidence >= minConfidence) {
      return { canonical: best.canonical, original: trimmed, confidence, method: 'keyword' };
    }
  }

  return null;
}

/**
 * Normalize an array of LLM-produced move names.
 * Returns only moves that pass the confidence threshold.
 * Deduplicates canonical moves (if two raw moves map to the same canonical, keep highest confidence).
 */
export function normalizeMoves(rawMoves: string[], minConfidence = 0.5): {
  normalized: NormalizedMove[];
  rejected: { original: string; reason: string }[];
} {
  const normalized: NormalizedMove[] = [];
  const rejected: { original: string; reason: string }[] = [];
  const seen = new Map<DialecticalScheme, NormalizedMove>();

  for (const raw of rawMoves) {
    const result = normalizeMove(raw, minConfidence);
    if (!result) {
      rejected.push({ original: raw, reason: `No canonical match (below ${minConfidence} confidence)` });
      continue;
    }

    const existing = seen.get(result.canonical);
    if (!existing || result.confidence > existing.confidence) {
      seen.set(result.canonical, result);
    }
  }

  normalized.push(...seen.values());
  return { normalized, rejected };
}
