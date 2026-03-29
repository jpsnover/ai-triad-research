// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Prompts for incremental argument network extraction.
 * Called after each debater's turn to extract claims and relationships.
 */

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
   - "supports" with a warrant (WHY it supports — the reasoning pattern)
   - "attacks" with attack_type ("rebut" = contradicts conclusion, "undercut" = denies the inference, "undermine" = attacks premise credibility) and scheme (COUNTEREXAMPLE, DISTINGUISH, REDUCE, REFRAME, CONCEDE, ESCALATE)
3. If it's a new standalone claim, responds_to should be an empty array

Extract 1-4 claims. Each claim must be traceable to text actually in the statement. Do NOT invent claims.

Return ONLY JSON (no markdown):
{
  "claims": [
    {
      "text": "near-verbatim claim from the statement",
      "responds_to": [
        {
          "prior_claim_id": "AN-1",
          "relationship": "supports or attacks",
          "attack_type": "rebut or undercut or undermine (only if attacks)",
          "scheme": "COUNTEREXAMPLE etc (only if attacks)",
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
   - "supports" with a warrant (WHY it supports — the reasoning pattern)
   - "attacks" with attack_type ("rebut" = contradicts conclusion, "undercut" = denies the
     inference, "undermine" = attacks premise credibility) and scheme (COUNTEREXAMPLE,
     DISTINGUISH, REDUCE, REFRAME, CONCEDE, ESCALATE)
3. If the debater listed no targets but you see an obvious relationship to a prior claim,
   you may add it — but prefer the debater's own assessment.

Return ONLY JSON (no markdown):
{
  "claims": [
    {
      "text": "the debater's claim text (unchanged)",
      "responds_to": [
        {
          "prior_claim_id": "AN-1",
          "relationship": "supports or attacks",
          "attack_type": "rebut or undercut or undermine (only if attacks)",
          "scheme": "COUNTEREXAMPLE etc (only if attacks)",
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
  edges: { source: string; target: string; type: string; attack_type?: string; scheme?: string; warrant?: string }[],
): string {
  if (nodes.length === 0) return '';

  const lines = ['', '=== ARGUMENT NETWORK (claims made so far) ==='];

  // Build adjacency for display
  const attacksOn = new Map<string, { source: string; type: string; scheme?: string; warrant?: string }[]>();
  for (const e of edges) {
    if (e.type === 'attacks') {
      const list = attacksOn.get(e.target) || [];
      list.push({ source: e.source, type: e.attack_type || 'rebut', scheme: e.scheme, warrant: e.warrant });
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
      lines.push(`  <- ${a.source} ${a.type}${a.scheme ? ` via ${a.scheme}` : ''}${a.warrant ? ` — ${a.warrant}` : ''}`);
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
