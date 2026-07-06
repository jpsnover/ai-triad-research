import { interpretationText, Interpretation } from '@lib/debate';

export function buildAttributeExtractionUserPrompt(
  node: {
    id: string; label: string; description: string;
    pov: string; category?: string;
    interpretations?: { accelerationist: Interpretation; safetyist: Interpretation; skeptic: Interpretation };
  },
): string {
  let nodeBlock = `NODE TO ANALYZE:
  ID: ${node.id}
  POV: ${node.pov}
  Category: ${node.category || 'N/A'}
  Label: ${node.label}
  Description: ${node.description}`;

  if (node.interpretations) {
    nodeBlock += `
  Accelerationist Interpretation: ${interpretationText(node.interpretations.accelerationist)}
  Safetyist Interpretation: ${interpretationText(node.interpretations.safetyist)}
  Skeptic Interpretation: ${interpretationText(node.interpretations.skeptic)}`;
  }

  return `${nodeBlock}

OUTPUT SCHEMA:
{
  "${node.id}": {
    "epistemic_type": "...",
    "rhetorical_strategy": "...",
    "assumes": ["..."],
    "falsifiability": "high|medium|low",
    "audience": "...",
    "emotional_register": "...",
    "policy_actions": [],
    "intellectual_lineage": ["..."],
    "steelman_vulnerability": "...",
    "possible_fallacies": [],
    "node_scope": "claim|scheme|bridging"
  }
}

CONSTRAINTS:
  - The top-level key MUST be exactly "${node.id}".
  - All eleven attribute fields are REQUIRED.
  - Return ONLY the JSON object.`;
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
      "target": "saf-desires-001",
      "bidirectional": true,
      "confidence": 0.85,
      "weight": 0.9,
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

export function buildHierarchyPlacementUserPrompt(
  newNode: { id: string; label: string; description: string; category?: string },
  siblingNodes: Array<{
    id: string; label: string; description: string; category?: string;
    parent_id?: string | null; children?: string[];
  }>,
): string {
  const parentNodes = siblingNodes.filter(
    n => n.id !== newNode.id && (!n.parent_id || (n.children && n.children.length > 0)),
  );

  const newNodeBlock = `NEW NODE TO PLACE:
  ID: ${newNode.id}
  Label: ${newNode.label}
  Description: ${newNode.description}
  Category: ${newNode.category || 'N/A'}`;

  const existingBlock = parentNodes
    .map(n => {
      const childList = n.children && n.children.length > 0
        ? ` [children: ${n.children.join(', ')}]`
        : '';
      const parentInfo = n.parent_id ? ` [parent: ${n.parent_id}]` : ' [top-level]';
      return `  ${n.id}${parentInfo}${childList} ${n.label}: ${n.description.slice(0, 200)}`;
    })
    .join('\n');

  return `${newNodeBlock}

EXISTING NODES IN THIS BUCKET:
${existingBlock}

OUTPUT SCHEMA — return exactly ONE of these:

Option A (placement under existing parent):
{
  "action": "place",
  "parent_id": "existing-node-id",
  "relationship": "is_a",
  "rationale": "1-2 sentence explanation."
}

Option B (leave as top-level):
{
  "action": "top_level",
  "reason": "1-2 sentence explanation of why no parent fits."
}

CONSTRAINTS:
  - "parent_id" MUST be a valid node ID from the existing nodes list above.
  - Do NOT place under a node that already has a parent_id (no grandchildren).
  - "relationship" must be one of: "is_a", "part_of", "specializes".
  - Return ONLY the JSON object.`;
}
