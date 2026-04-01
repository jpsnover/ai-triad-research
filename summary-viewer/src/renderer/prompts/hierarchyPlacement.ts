// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Builds prompts for placing a single new orphan node into the existing
 * taxonomy hierarchy (finding its parent).
 */

export function buildHierarchyPlacementSystemPrompt(): string {
  return `You are an ontology engineer placing a single new taxonomy node into an existing hierarchy
for the AI Triad project at the Berkman Klein Center.

You will receive:
  1. A NEW NODE that needs placement — it currently has no parent.
  2. A list of EXISTING NODES in the same POV and category, some of which are parents
     (they have children) and some are leaves.

Your task:
  Decide ONE of:

  A) PLACE the new node under an existing parent — if its topic clearly fits within
     that parent's scope. This is the preferred outcome.
  B) LEAVE as top-level — ONLY if the node is genuinely unique with no thematic
     neighbors AND no existing parent could reasonably encompass it.

PLACEMENT RULES:
  - Prefer placing under an existing parent. Most nodes belong somewhere.
  - When placing, specify the relationship type:
    "is_a": the new node is a more specific version of the parent.
    "part_of": the new node is a component or aspect of the parent.
    "specializes": the new node is a concrete implementation of the parent's principle.
  - Provide a 1-2 sentence rationale for the placement.
  - The parent must be MORE GENERAL than the child.
  - Maximum hierarchy depth is 2 (parent + leaf). Do not place under a node that
    already has a parent (no grandchildren).

RULES:
  - Return ONLY valid JSON. No markdown fences, no preamble, no commentary.`;
}

export function buildHierarchyPlacementUserPrompt(
  newNode: { id: string; label: string; description: string; category?: string },
  siblingNodes: Array<{
    id: string; label: string; description: string; category?: string;
    parent_id?: string | null; children?: string[];
  }>,
): string {
  // Identify existing parents (nodes that have children or no parent themselves)
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
