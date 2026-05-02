// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Prompts for incremental argument network extraction.
 * Called after each debater's turn to extract claims and relationships.
 */

import { MOVE_EDGE_MAP, SUPPORT_MOVES, wordOverlap, maxOverlapVsExisting, lookupTaxonomyEdgeWeight } from './helpers.js';
import type { ArgumentNetworkNode, ArgumentNetworkEdge } from './types.js';

const SUPPORT_SCHEMES = Object.entries(MOVE_EDGE_MAP)
  .filter(([, v]) => v.edgeType === 'support')
  .map(([k]) => k)
  .join(', ');

const ATTACK_SCHEMES = Object.entries(MOVE_EDGE_MAP)
  .filter(([, v]) => v.edgeType === 'attack')
  .map(([k]) => k)
  .join(', ');

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
- "bdi_category": "belief" (empirical/factual claim), "desire" (normative/value claim), or "intention" (strategic/methodological claim)
- "base_strength": classify the evidential grounding as ONE of:
  "grounded" — cites specific data, named sources, dates, or directly verifiable facts
  "reasoned" — logical argument with internal coherence but no specific evidence
  "asserted" — claim stated without supporting reasoning or evidence
  Do NOT output numeric scores. Use ONLY these three categories.
- "bdi_sub_scores": for each criterion, answer "yes", "partial", or "no":
  For belief claims: {"evidence_quality": "partial", "source_reliability": "partial", "falsifiability": "partial"} (always "partial" — human adjusts later)
  For desire claims: {"values_grounding": "yes/partial/no", "tradeoff_acknowledgment": "yes/partial/no", "precedent_citation": "yes/partial/no"}
  For intention claims: {"mechanism_specificity": "yes/partial/no", "scope_bounding": "yes/partial/no", "failure_mode_addressing": "yes/partial/no"}
- "specificity": "precise" (contains specific numbers, dates, named entities, or directly verifiable facts), "general" (broad empirical claim without specific verifiable details), or "abstract" (theoretical/normative, not empirically testable)
- "steelman_of": null normally. Set to the opponent's name (e.g. "Prometheus") ONLY when this claim deliberately presents the STRONGEST version of an opponent's position before critiquing it. A steelman means restating someone else's argument charitably — not attacking it.

Return ONLY JSON (no markdown):
{
  "claims": [
    {
      "text": "near-verbatim claim from the statement",
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
          "scheme": "move name — e.g. COUNTEREXAMPLE, CONCEDE, CONDITIONAL-AGREE",
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
  belief: {"evidence_quality": "partial", "source_reliability": "partial", "falsifiability": "partial"} (always "partial" — human adjusts)
  desire: {"values_grounding": "yes/partial/no", "tradeoff_acknowledgment": "yes/partial/no", "precedent_citation": "yes/partial/no"}
  intention: {"mechanism_specificity": "yes/partial/no", "scope_bounding": "yes/partial/no", "failure_mode_addressing": "yes/partial/no"}
- "specificity": "precise" (specific numbers, dates, named entities), "general" (broad empirical), or "abstract" (theoretical/normative)
- "steelman_of": null normally. Set to opponent's name ONLY when this claim deliberately presents the strongest version of an opponent's position.

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
          "scheme": "move name — e.g. COUNTEREXAMPLE, CONCEDE, CONDITIONAL-AGREE",
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

import type { UnansweredClaimEntry } from './types.js';

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
 */
export function factCheckToBaseStrength(
  verdict: string,
  confidence?: string,
): number {
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

export interface RawExtractedClaim {
  text: string;
  bdi_category?: string;
  base_strength?: number | string;
  bdi_sub_scores?: Record<string, number | string>;
  specificity?: string;
  steelman_of?: string | null;
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

    const overlapVsAN = maxOverlapVsExisting(claim.text, allNodes);
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
        ? 'ai_rubric'
        : (claim.bdi_category === 'belief' ? 'default_pending' : 'ai_rubric'),
      bdi_sub_scores: claim.bdi_sub_scores && typeof claim.bdi_sub_scores === 'object'
        ? claim.bdi_sub_scores as ArgumentNetworkNode['bdi_sub_scores'] : undefined,
      bdi_confidence: bdiConfidenceMap[claim.bdi_category ?? ''] ?? 0.5,
      bdi_category: claim.bdi_category as ArgumentNetworkNode['bdi_category'],
      specificity: claim.specificity as ArgumentNetworkNode['specificity'],
      steelman_of: claim.steelman_of || undefined,
    };
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
