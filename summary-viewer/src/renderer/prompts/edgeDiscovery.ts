// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Builds prompts for discovering typed edges between a new taxonomy node
 * and existing nodes. Unlike potentialEdges.ts (which works on unmapped
 * concepts), this targets created nodes and persists to edges.json.
 */

export function buildEdgeDiscoverySystemPrompt(): string {
  return `You are a research analyst for the AI Triad project at the Berkman Klein Center.

Your task is to discover typed, directed edges between a newly created taxonomy node and
existing nodes. These edges form a navigable graph that enables assumption surfacing,
argument mapping, and structural analysis of the AI policy debate.

You will receive:
  1. A SOURCE NODE -- the new node whose edges you are discovering.
  2. A CANDIDATE NODE LIST -- pre-filtered existing nodes across all POVs.

For the source node, propose edges to any candidate nodes where a meaningful
relationship exists. Quality over quantity.

EDGE TYPE VOCABULARY:

  SUPPORTS (directional: source -> target)
    The source directly strengthens or provides evidence for the target.

  CONTRADICTS (bidirectional)
    Incompatible claims. If one is true, the other is weakened or false.
    Must involve genuine logical tension, not mere disagreement in emphasis.

  ASSUMES (directional: source -> target)
    The source depends on the target being true.

  WEAKENS (directional: source -> target)
    Partial challenge -- undermines but doesn't fully contradict.

  RESPONDS_TO (directional: source -> target)
    The source was formulated as a direct response to the target.

  TENSION_WITH (bidirectional)
    Structural tension -- pull in different directions without direct contradiction.
    Common across POV boundaries.

  INTERPRETS (directional: source -> target)
    The source provides a POV-specific reading of the target concept.

EDGE ATTRIBUTES:

  confidence (required, number 0.5-1.0):
    0.9-1.0: Explicit relationship.
    0.7-0.9: Strongly implied.
    0.5-0.7: Plausible but indirect.

  rationale (required, string): 1-2 sentences referencing content of both nodes.

  strength (optional, "strong" | "moderate" | "weak")

RULES:
  - Be precise. Every edge must be justified by actual content of both nodes.
  - No edges based on superficial keyword overlap.
  - Cross-POV edges are especially valuable.
  - For bidirectional types (CONTRADICTS, TENSION_WITH), propose once from source.
  - Aim for 3-10 edges. Fewer is fine if sparse, more if highly connected.
  - Return ONLY valid JSON. No markdown fences, no preamble.`;
}

export function buildEdgeDiscoveryUserPrompt(
  sourceNode: {
    id: string; label: string; description: string;
    pov: string; category?: string;
    graph_attributes?: Record<string, unknown>;
  },
  candidateNodes: Array<{
    id: string; label: string; description: string;
    pov: string; category?: string;
  }>,
): string {
  let sourceBlock = `SOURCE NODE:
  ID: ${sourceNode.id}
  POV: ${sourceNode.pov}
  Category: ${sourceNode.category || 'N/A'}
  Label: ${sourceNode.label}
  Description: ${sourceNode.description}`;

  if (sourceNode.graph_attributes) {
    const attrs = sourceNode.graph_attributes;
    sourceBlock += `
  Epistemic Type: ${attrs.epistemic_type || 'unknown'}
  Assumes: ${Array.isArray(attrs.assumes) ? attrs.assumes.join('; ') : 'N/A'}`;
  }

  const candidateBlock = candidateNodes
    .map(n => `  ${n.id} [${n.pov}/${n.category || 'N/A'}] ${n.label}: ${n.description.slice(0, 200)}`)
    .join('\n');

  return `${sourceBlock}

CANDIDATE NODES:
${candidateBlock}

OUTPUT SCHEMA:
{
  "source_node_id": "${sourceNode.id}",
  "edges": [
    {
      "type": "TENSION_WITH",
      "target": "saf-goals-001",
      "bidirectional": true,
      "confidence": 0.85,
      "rationale": "Explanation referencing both nodes.",
      "strength": "strong"
    }
  ]
}

CONSTRAINTS:
  - "source_node_id" MUST be exactly "${sourceNode.id}".
  - Each "target" MUST be a valid node ID from the candidate list above.
  - "bidirectional" must be true for CONTRADICTS and TENSION_WITH, false otherwise.
  - "confidence" must be between 0.5 and 1.0.
  - Return ONLY the JSON object.`;
}
