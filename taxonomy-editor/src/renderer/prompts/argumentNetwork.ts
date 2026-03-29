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

/** Format commitments for injection into debater prompts */
export function formatCommitments(
  commitments: { asserted: string[]; conceded: string[]; challenged: string[] },
): string {
  const lines: string[] = [];

  if (commitments.asserted.length > 0) {
    lines.push('You have asserted:');
    for (const a of commitments.asserted.slice(-5)) lines.push(`- ${a}`);
  }
  if (commitments.conceded.length > 0) {
    lines.push('You have conceded:');
    for (const c of commitments.conceded) lines.push(`- ${c}`);
  }
  if (commitments.challenged.length > 0) {
    lines.push('You have challenged:');
    for (const c of commitments.challenged) lines.push(`- ${c}`);
  }

  if (lines.length === 0) return '';

  return `\n=== YOUR COMMITMENTS SO FAR ===\n${lines.join('\n')}\n\nCONSISTENCY RULE: Do not contradict your prior assertions without explicitly acknowledging the change. If you now believe differently, say "I previously argued X, but on reflection..." — do not silently flip.\n`;
}
