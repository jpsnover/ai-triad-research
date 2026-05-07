// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Evidence QBAF Builder — classifies retrieved evidence items as
 * support/contradict/irrelevant, builds a QBAF sub-graph, and computes
 * claim strength via the existing DF-QuAD engine.
 *
 * Zero changes to qbaf.ts — uses computeQbafStrengths() as-is.
 */

import { computeQbafStrengths } from './qbaf.js';
import type { QbafNode, QbafEdge } from './qbaf.js';
import type { EvidenceItem } from './evidenceRetriever.js';
import type { AIAdapter, GenerateOptions } from './aiAdapter.js';
import type { StandardizedTerm } from '../dictionary/types.js';
import { ActionableError } from './errors.js';

// ── Types ─────────────────────────────────────────────────

export interface ClassifiedEvidence {
  id: string;
  source_doc_id: string;
  text: string;
  relation: 'support' | 'contradict';
  similarity: number;
}

export interface EvidenceQbafResult {
  /** Claim's computed strength after evidence propagation (0-1). */
  computed_strength: number;
  /** Number of DF-QuAD iterations until convergence. */
  qbaf_iterations: number;
  /** Classified evidence items (irrelevant items filtered out). */
  evidence_items: ClassifiedEvidence[];
}

export interface EvidenceQbafOptions {
  /** Model to use for classification. Falls back to debate model. */
  model?: string;
  /** Domain vocabulary terms to inject into classification prompt. */
  standardizedTerms?: StandardizedTerm[];
  /** Base strength for the claim node. Default: 0.5. */
  claimBaseStrength?: number;
  /** Base strength for evidence nodes. Default: 0.5. */
  evidenceBaseStrength?: number;
  /** Generate options (temperature, timeout, etc.). */
  generateOptions?: GenerateOptions;
}

// ── Classification prompt ─────────────────────────────────

function buildClassificationPrompt(
  claimText: string,
  evidenceItems: EvidenceItem[],
  standardizedTerms?: StandardizedTerm[],
): string {
  const vocabSection = standardizedTerms && standardizedTerms.length > 0
    ? `\nDomain vocabulary (use these definitions when interpreting terms):\n${
        standardizedTerms.slice(0, 20).map(t => `- ${t.canonical_form}: ${t.definition}`).join('\n')
      }\n`
    : '';

  const evidenceList = evidenceItems
    .map((e, i) => `[${i + 1}] (${e.source_doc_id}): ${e.text}`)
    .join('\n\n');

  return `Classify each evidence item as "support", "contradict", or "irrelevant" relative to the claim below.
${vocabSection}
Claim: "${claimText}"

Evidence items:
${evidenceList}

Return ONLY a JSON array (no markdown, no code fences) with one entry per evidence item:
[
  { "index": 1, "relation": "support" | "contradict" | "irrelevant", "reason": "brief explanation" },
  ...
]`;
}

// ── Classification parser ─────────────────────────────────

interface ClassificationEntry {
  index: number;
  relation: 'support' | 'contradict' | 'irrelevant';
  reason?: string;
}

function parseClassifications(responseText: string, count: number): ClassificationEntry[] {
  // Strip markdown fences if present
  const cleaned = responseText
    .replace(/^```(?:json)?\s*/m, '')
    .replace(/```\s*$/m, '')
    .trim();

  try {
    const parsed = JSON.parse(cleaned) as ClassificationEntry[];
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter(e =>
        typeof e.index === 'number' &&
        e.index >= 1 && e.index <= count &&
        ['support', 'contradict', 'irrelevant'].includes(e.relation),
      )
      .map(e => ({
        index: e.index,
        relation: e.relation as 'support' | 'contradict' | 'irrelevant',
        reason: e.reason,
      }));
  } catch {
    return [];
  }
}

// ── QBAF graph construction ───────────────────────────────

function buildEvidenceGraph(
  claimBaseStrength: number,
  evidenceBaseStrength: number,
  classified: ClassifiedEvidence[],
): { nodes: QbafNode[]; edges: QbafEdge[] } {
  const nodes: QbafNode[] = [
    { id: 'claim', base_strength: claimBaseStrength },
  ];
  const edges: QbafEdge[] = [];

  for (const item of classified) {
    nodes.push({ id: item.id, base_strength: evidenceBaseStrength });
    edges.push({
      source: item.id,
      target: 'claim',
      type: item.relation === 'support' ? 'supports' : 'attacks',
      weight: item.similarity,
    });
  }

  return { nodes, edges };
}

// ── Main pipeline ─────────────────────────────────────────

/**
 * Build and compute an evidence QBAF for a Belief claim.
 *
 * 1. LLM classifies each evidence item as support/contradict/irrelevant
 * 2. Filter irrelevant items
 * 3. Build QBAF: claim as root, evidence as children
 * 4. Run computeQbafStrengths() (zero QBAF engine changes)
 * 5. Return computed strength + evidence graph
 *
 * @param claimText - The Belief claim to evaluate
 * @param evidenceItems - Retrieved evidence items from evidenceRetriever
 * @param adapter - AI adapter for LLM classification call
 * @param model - Model ID for the classification call
 * @param options - Configuration options
 * @returns Evidence QBAF result with computed strength and classified items
 */
export async function buildEvidenceQbaf(
  claimText: string,
  evidenceItems: EvidenceItem[],
  adapter: AIAdapter,
  model: string,
  options?: EvidenceQbafOptions,
): Promise<EvidenceQbafResult> {
  const claimBase = options?.claimBaseStrength ?? 0.5;
  const evidenceBase = options?.evidenceBaseStrength ?? 0.5;

  if (evidenceItems.length === 0) {
    return {
      computed_strength: claimBase,
      qbaf_iterations: 0,
      evidence_items: [],
    };
  }

  // Step 1: LLM classifies evidence items
  const prompt = buildClassificationPrompt(
    claimText,
    evidenceItems,
    options?.standardizedTerms,
  );

  let responseText: string;
  try {
    responseText = await adapter.generateText(prompt, options?.model ?? model, {
      temperature: 0.1,
      maxTokens: 2000,
      ...options?.generateOptions,
    });
  } catch (err) {
    throw new ActionableError({
      goal: 'Classify evidence items for QBAF',
      problem: `LLM classification failed: ${err instanceof Error ? err.message : err}`,
      location: 'evidenceQbaf.buildEvidenceQbaf',
      nextSteps: ['Check API key and model availability', 'Retry the debate'],
      innerError: err,
    });
  }

  // Step 2: Parse classifications and filter irrelevant
  const classifications = parseClassifications(responseText, evidenceItems.length);
  const classified: ClassifiedEvidence[] = [];

  for (const entry of classifications) {
    if (entry.relation === 'irrelevant') continue;
    const evidence = evidenceItems[entry.index - 1];
    if (!evidence) continue;

    classified.push({
      id: evidence.id,
      source_doc_id: evidence.source_doc_id,
      text: evidence.text,
      relation: entry.relation,
      similarity: evidence.similarity_score,
    });
  }

  // If no relevant evidence after classification, return base strength
  if (classified.length === 0) {
    return {
      computed_strength: claimBase,
      qbaf_iterations: 0,
      evidence_items: [],
    };
  }

  // Step 3-4: Build QBAF graph and compute strengths
  const { nodes, edges } = buildEvidenceGraph(claimBase, evidenceBase, classified);
  const qbafResult = computeQbafStrengths(nodes, edges);

  return {
    computed_strength: qbafResult.strengths.get('claim') ?? claimBase,
    qbaf_iterations: qbafResult.iterations,
    evidence_items: classified,
  };
}

// ── Exported for testing ──────────────────────────────────

export { buildClassificationPrompt, parseClassifications, buildEvidenceGraph };
