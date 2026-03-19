// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * AI prompts for taxonomy analysis features.
 * Prompts are separated from logic per project convention.
 */

export function distinctionAnalysisPrompt(
  elementA: { category: string; label: string; description: string },
  elementB: { category: string; label: string; description: string },
): string {
  return `Role: Act as a Logical Analyst and Semantic Auditor.

Task: Compare two provided elements (Label + Description) to determine if they are functionally identical, semantically redundant, or if a meaningful distinction exists between them.

Evaluation Framework:

Semantic Mapping: Do the descriptions cover the same conceptual territory using different syntax?

Functional Utility: If one element were deleted, would any unique information, constraint, or application be lost?

The "So What?" Test: Does the difference in phrasing lead to a different real-world outcome or technical requirement?
Consider the Category of the element and how this relates to the analysis. For example, a Method might be used to implement a Goal/Value .  A Fact/Data might backup or verify a claim.  A Concept might be a component of a Method or a Goal.  A Risk might be mitigated by a Method or be a consequence of not following a Method.

Input Data:

Element A:
Category: ${elementA.category}
Label: ${elementA.label}
Description: ${elementA.description}

Element B:
Category: ${elementB.category}
Label: ${elementB.label}
Description: ${elementB.description}

Required Output Format:

The Verdict: [Identical | Redundant | Distinct]

The Delta: Identify the exact words or phrases that create a perceived difference. Analyze if these are "cosmetic" (synonyms) or "structural" (changing the scope).

Logical Gap: If you claim they are different, define the specific scenario where Element A applies but Element B does not. If they are the same, provide a single, "Steel-manned" version that consolidates both perfectly.

Blind Spot Check: Is one a subset of the other (Taxonomic overlap)?`;
}

export function clusterLabelPrompt(
  clusters: { nodeIds: string[]; labels: string[] }[],
): string {
  const lines = clusters.map((c, i) =>
    `Cluster ${i + 1}:\n${c.labels.map(l => `  - ${l}`).join('\n')}`
  ).join('\n\n');

  return `You are labeling thematic clusters of AI policy taxonomy nodes.
For each cluster below, generate a short (3-7 word) thematic label that captures what unites these items.
Return ONLY a JSON array of strings, one label per cluster, in order. No markdown fencing.

${lines}`;
}
