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
Consider the BDI Category of each element. A Belief grounds empirical claims — it can be verified or falsified. A Desire frames normative commitments — what should happen or what matters. An Intention describes argumentative strategies — how to reason about a topic. Two elements in different BDI categories are almost certainly distinct even if they address the same topic.

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

export interface NodeCritiqueContext {
  edgesJson: string;
  /** @deprecated Renamed from crossCuttingJson — still accepted for backward compat */
  crossCuttingJson: string;
  povJson: string;
  nodeJson: string;
  povName: string;
  policyRegistryJson: string;
}

export function nodeCritiquePrompt(ctx: NodeCritiqueContext): string {
  return `### SYSTEM ROLE
You are a Senior Ontologist and AI Researcher. You are critiquing a node within a multi-perspective AI Knowledge Graph.

### KNOWLEDGE GRAPH SCHEMA & GLOBAL CONTEXT
1. RELATIONSHIP GRAMMAR:
${ctx.edgesJson}

2. UNIVERSAL CONCEPTS (Situations):
${ctx.crossCuttingJson}

3. LOCAL HIERARCHY (The ${ctx.povName} POV this node belongs to):
${ctx.povJson}

4. POLICY ACTION REGISTRY (canonical policies with IDs):
${ctx.policyRegistryJson}

### TARGET NODE FOR CRITIQUE
${ctx.nodeJson}

### CRITIQUE DIRECTIVE
Critique this node with a focus on **Systemic Integration**:
1. **Redundancy Check:** Does this node duplicate a concept already defined in the "Universal Concepts"? If so, recommend a MERGE or an INTERPRETS edge.
2. **Relational Integrity:** Does the \`assumes\` list align with the "Relationship Grammar"?
3. **Taxonomic Placement:** Is the \`parent_id\` logically sound given the other nodes in the Local Hierarchy?
4. **Epistemic Drift:** Does the POV-specific description lean too far into rhetoric, losing its connection to the underlying universal concept?
5. **Policy Action Alignment:** Do the node's \`policy_actions\` reference appropriate registry entries (pol-NNN IDs)? Should any be replaced with a better-matching existing policy? Are any missing policies that this node clearly implies? Every policy_action MUST have a valid \`policy_id\` — reuse existing registry entries when possible.
6. **Description Format (Genus-Differentia):** The description MUST follow this multi-line format (Encompasses and Excludes each start on a NEW line):
   "A Belief / A Desire / An Intention within [POV] discourse that [differentia].
   Encompasses: ...
   Excludes: ..."
   For situation nodes: "A situation that [differentia].\\nEncompasses: ...\\nExcludes: ..."
   If the description has Encompasses/Excludes inline (not on new lines), propose a rewrite with them on separate lines.
7. **BDI Category Alignment:** Does the \`category\` (Beliefs/Desires/Intentions) match the node's content? Beliefs = empirical/verifiable. Desires = normative/priorities. Intentions = reasoning strategies. Flag mismatches.
8. **Node Scope:** If \`node_scope\` is present, verify: \`claim\` = specific testable assertion, \`scheme\` = argumentative pattern, \`bridging\` = connects claims to schemes. If absent and the node clearly fits one, suggest adding it.

### OUTPUT FORMAT
Respond in Markdown with the following sections in order:

#### Critique Summary
A brief overall assessment of this node's systemic integration quality.

#### Structural Rationalization
For **each** proposed change, write a separate subsection:

##### [Field Name] Change
- **What:** Describe the specific change
- **Why:** Reference the relevant critique directive (Redundancy, Relational Integrity, Taxonomic Placement, Epistemic Drift, or Policy Action Alignment)
- **Impact:** How this change improves the knowledge graph's consistency

If no change is needed for a field, do not include a subsection for it.

#### Refined Node JSON
Finally, provide the complete refined node as a fenced JSON code block (\`\`\`json ... \`\`\`) so it can be copied and pasted directly into the taxonomy editor. Include ALL fields, not just the changed ones.`;
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
