// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Document pre-analysis for debates grounded in a document or URL.
 * Extracts i-nodes (information nodes), maps them to taxonomy/policy items,
 * identifies cross-POV tension points, and produces a claims summary.
 */

import type { DocumentAnalysis } from './types';
import type { PovNode, CrossCuttingNode } from './taxonomyTypes';
import type { PolicyRef } from './taxonomyContext';

// ── Taxonomy sample builder ─────────────────────────────

interface TaxonomySampleInput {
  accelerationist: { nodes: PovNode[] };
  safetyist: { nodes: PovNode[] };
  skeptic: { nodes: PovNode[] };
  crossCutting: { nodes: CrossCuttingNode[] };
  /** New name for crossCutting — Phase 1 shim. */
  situations?: { nodes: CrossCuttingNode[] };
  policyRegistry: PolicyRef[];
}

/**
 * Build a brief taxonomy sample for the analysis prompt.
 * Includes node IDs + labels so the AI can map document claims to real taxonomy items.
 */
export function buildTaxonomySample(taxonomy: TaxonomySampleInput): string {
  const lines: string[] = [];

  for (const pov of ['accelerationist', 'safetyist', 'skeptic'] as const) {
    const nodes = taxonomy[pov].nodes;
    if (nodes.length === 0) continue;
    lines.push(`${pov.toUpperCase()} NODES:`);
    for (const n of nodes) {
      lines.push(`  ${n.id}: ${n.label}`);
    }
    lines.push('');
  }

  const ccNodes = (taxonomy.situations ?? taxonomy.crossCutting).nodes;
  if (ccNodes.length > 0) {
    lines.push('CROSS-CUTTING NODES:');
    for (const n of ccNodes) {
      lines.push(`  ${n.id}: ${n.label}`);
    }
    lines.push('');
  }

  const policies = taxonomy.policyRegistry;
  if (policies.length > 0) {
    lines.push('POLICY ITEMS:');
    for (const p of policies) {
      lines.push(`  ${p.id}: ${p.action}`);
    }
  }

  return lines.join('\n');
}

// ── Truncation (shared with sourceContext in prompts.ts) ─

function findLastHeading(text: string, limit: number): string | null {
  const slice = text.slice(0, limit);
  const re = /^#{1,4}\s+(.+)$/gm;
  let lastMatch: string | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(slice)) !== null) {
    lastMatch = m[1].trim();
  }
  return lastMatch;
}

function truncateDocument(text: string, limit: number = 50000): string {
  if (text.length <= limit) return text;
  const lastHeading = findLastHeading(text, limit);
  const notice = lastHeading
    ? `\n\n[Document truncated at ~${Math.round(limit / 1000)}K characters. Content after '${lastHeading}' is not available.]`
    : `\n\n[Document truncated at ~${Math.round(limit / 1000)}K characters.]`;
  return text.slice(0, limit) + notice;
}

// ── Analysis prompt ─────────────────────────────────────

export function documentAnalysisPrompt(
  sourceContent: string,
  refinedTopic: string,
  activePovers: string[],
  taxonomySample: string,
): string {
  const content = truncateDocument(sourceContent);

  return `You are a neutral analyst preparing a structured breakdown of a document for a multi-perspective debate.

The debate topic is:
"${refinedTopic}"

The debate will involve these perspectives: ${activePovers.join(', ')}.

=== SOURCE DOCUMENT ===
${content}
=== END SOURCE DOCUMENT ===

=== AVAILABLE TAXONOMY NODES ===
${taxonomySample}
=== END TAXONOMY NODES ===

Analyze this document and extract its key claims as information nodes (i-nodes). For each i-node:
1. Extract the claim as a near-verbatim sentence or close paraphrase from the document
2. Classify its type: empirical (testable fact), normative (value judgment), definitional (how a term is defined or scoped), assumption (unstated premise), or evidence (data/example supporting a claim)
3. Map it to relevant taxonomy node IDs from the list above — only include IDs that actually appear in the taxonomy
4. Map it to relevant policy item IDs if applicable

Also identify tension points — places where the document's claims would provoke sharp disagreement between the debate perspectives.

Finally, write a claims summary paragraph: a readable prose summary (3-6 sentences) of what the document argues, suitable for display to users.

Rules:
- Extract ALL key claims. Do not limit the number of i-nodes.
- Each i-node ID must follow the pattern D-1, D-2, D-3, etc.
- taxonomy_refs and policy_refs arrays may be empty if no match exists
- Tension points should reference i-node IDs from the extracted claims
- The claims_summary should be neutral and descriptive, not argumentative

Return ONLY JSON (no markdown, no code fences):
{
  "claims_summary": "Prose paragraph summarizing the document's argument...",
  "i_nodes": [
    {
      "id": "D-1",
      "text": "near-verbatim claim from the document",
      "type": "empirical",
      "taxonomy_refs": ["acc-goals-002"],
      "policy_refs": []
    }
  ],
  "tension_points": [
    {
      "description": "Brief description of the cross-POV friction",
      "i_node_ids": ["D-1", "D-3"],
      "pov_tensions": [
        { "pov": "accelerationist", "stance": "brief stance on this tension" },
        { "pov": "safetyist", "stance": "brief stance on this tension" }
      ]
    }
  ]
}`;
}

// ── Analysis context formatter (replaces sourceContext in debater prompts) ──

export function documentAnalysisContext(analysis: DocumentAnalysis): string {
  const lines: string[] = [
    '',
    '=== DOCUMENT ANALYSIS ===',
    `SUMMARY: ${analysis.claims_summary}`,
    '',
    'KEY CLAIMS (reference by D-ID in taxonomy_refs and my_claims targets, NOT in your prose text):',
  ];

  for (const node of analysis.i_nodes) {
    const refs = [
      ...node.taxonomy_refs,
      ...node.policy_refs,
    ].join(', ');
    const refStr = refs ? ` → ${refs}` : '';
    lines.push(`${node.id}: "${node.text}" [${node.type}]${refStr}`);
  }

  if (analysis.tension_points.length > 0) {
    lines.push('');
    lines.push('TENSION POINTS:');
    for (const tp of analysis.tension_points) {
      const nodeIds = tp.i_node_ids.join(' vs ');
      const stances = tp.pov_tensions.map(pt => `${pt.pov}: ${pt.stance}`).join('. ');
      lines.push(`- ${nodeIds}: ${tp.description}. ${stances}`);
    }
  }

  lines.push('=== END DOCUMENT ANALYSIS ===');

  return lines.join('\n');
}
