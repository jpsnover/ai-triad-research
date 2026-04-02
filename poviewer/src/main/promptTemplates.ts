// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// === Prompt Templates for Two-Stage Analysis Pipeline ===

export const DEFAULT_STAGE1_PROMPT = `You are an expert policy analyst. Analyze the following document and segment it into distinct claims, assertions, or propositions that express a position on AI governance, safety, or development.

For each claim/assertion found, return its exact text span as it appears in the document, along with the character offsets (0-indexed) marking its start and end position.

Rules:
- Extract substantive claims only (not headings, citations, or filler)
- Each claim should be self-contained and express a clear position
- Overlapping spans are NOT allowed
- Offsets must be exact character positions in the source text
- Return valid JSON only

Document:
{{document}}

Return a JSON array:
[
  {
    "text": "exact text from document",
    "startOffset": 0,
    "endOffset": 100
  }
]`;

export const DEFAULT_STAGE2_PROMPT = `You are an expert policy analyst mapping claims to a taxonomy of AI governance perspectives.

Given a list of claims/assertions extracted from a document and a set of taxonomy definitions organized by perspective camp (accelerationist, safetyist, skeptic, situations), map each claim to the most relevant taxonomy nodes.

For each mapping, specify:
- Which claim (by index) it relates to
- Which taxonomy node it maps to (nodeId and nodeLabel)
- The camp and category of the node
- Whether the claim agrees or contradicts the node's position
- The strength of the alignment (strong/moderate/weak)
- A brief explanation of the mapping rationale

Rules:
- A single claim can map to multiple taxonomy nodes across different camps
- If a claim doesn't map to any taxonomy node, omit it (it will be marked as unmapped)
- Flag claims that map to opposing camps as potential collisions
- Return valid JSON only

Claims:
{{points}}

Taxonomy:
{{taxonomy}}

Return a JSON array:
[
  {
    "pointIndex": 0,
    "nodeId": "acc-goals-001",
    "nodeLabel": "Node label text",
    "category": "Category name",
    "camp": "accelerationist",
    "alignment": "agrees",
    "strength": "strong",
    "explanation": "Brief rationale for this mapping"
  }
]`;

export interface PromptTemplates {
  stage1: string;
  stage2: string;
}

export function getDefaultTemplates(): PromptTemplates {
  return {
    stage1: DEFAULT_STAGE1_PROMPT,
    stage2: DEFAULT_STAGE2_PROMPT,
  };
}

export function buildStage1Prompt(template: string, documentText: string): string {
  return template.replace('{{document}}', documentText);
}

export function buildStage2Prompt(
  template: string,
  pointsJson: string,
  taxonomyJson: string,
): string {
  return template
    .replace('{{points}}', pointsJson)
    .replace('{{taxonomy}}', taxonomyJson);
}
