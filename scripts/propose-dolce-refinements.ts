// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * CLI script to generate DOLCE refinement proposals for taxonomy nodes.
 *
 * Runs the DOLCE genus-differentia compliance prompt against one POV's
 * taxonomy nodes in batches, producing a structured proposals JSON file
 * for human review.
 *
 * Usage:
 *   npx tsx scripts/propose-dolce-refinements.ts --pov safetyist [--batch-size 20] [--model gemini-2.5-flash] [--dry-run]
 *
 * Parameters:
 *   --pov         Required. One of: accelerationist, safetyist, skeptic
 *   --batch-size  Nodes per LLM call (default 20)
 *   --model       LLM model (default gemini-2.5-flash)
 *   --dry-run     Show batch plan without calling LLM
 */

import fs from 'fs';
import path from 'path';
import { resolveRepoRoot, resolveDataRoot } from '../lib/debate/taxonomyLoader.js';
import { createCLIAdapter } from '../lib/debate/aiAdapter.js';
import { stripCodeFences, parseJsonRobust } from '../lib/debate/helpers.js';
import type { PovNode } from '../lib/debate/taxonomyTypes.js';

// ── Types ─────────────────────────────────────────────

interface ProposalIssue {
  field: string;
  severity: 'critical' | 'major' | 'suggestion';
  category: string;
  current: string;
  proposed: string;
  rationale: string;
}

/** Raw format from LLM (flat fields per the prompt template). */
interface RawNodeProposal {
  id: string;
  label: string;
  status: 'compliant' | 'needs_changes';
  issues: ProposalIssue[];
  current_description?: string;
  proposed_description?: string | null;
  current_graph_attributes?: Record<string, unknown>;
  proposed_graph_attributes?: Record<string, unknown> | null;
}

/** Normalized format consumed by the review GUI (nested current/proposed). */
interface NodeProposal {
  id: string;
  label: string;
  status: 'compliant' | 'needs_changes';
  issues: ProposalIssue[];
  current: { description: string; graph_attributes: Record<string, unknown> };
  proposed: { description: string; graph_attributes: Record<string, unknown> };
}

interface ProposalsOutput {
  generated_at: string;
  model: string;
  source_file: string;
  total_nodes: number;
  summary: {
    compliant: number;
    needs_changes: number;
    critical: number;
    major: number;
    suggestion: number;
  };
  proposals: NodeProposal[];
}

// ── POV variable mapping ──────────────────────────────

const POV_MAP: Record<string, { name: string; file: string; prefix: string; exampleId: string }> = {
  accelerationist: { name: 'accelerationist', file: 'accelerationist.json', prefix: 'acc', exampleId: 'acc-beliefs-001' },
  safetyist: { name: 'safetyist', file: 'safetyist.json', prefix: 'saf', exampleId: 'saf-beliefs-001' },
  skeptic: { name: 'skeptic', file: 'skeptic.json', prefix: 'skp', exampleId: 'skp-beliefs-001' },
};

// ── Helpers ───────────────────────────────────────────

function loadJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8').replace(/^\uFEFF/, '')) as T;
}

function getArg(name: string, fallback?: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx >= 0 && process.argv[idx + 1] && !process.argv[idx + 1].startsWith('--')) {
    return process.argv[idx + 1];
  }
  return fallback;
}

function buildPrompt(
  povInfo: { name: string; file: string; prefix: string; exampleId: string },
  nodeCount: number,
  nodesJson: string,
): string {
  return `You are an expert Ontologist and Knowledge Engineer reviewing taxonomy nodes from the AI Rosetta Stone project. The taxonomy uses DOLCE-aligned BDI (Beliefs, Desires, Intentions) categories with genus-differentia descriptions.

You are reviewing the **${povInfo.name}** perspective (${povInfo.file}).

=== DATA SOURCE ===

The nodes are loaded from:
  ../ai-triad-data/taxonomy/Origin/${povInfo.file}

File structure:
\`\`\`
{
  "_schema_version": "...",
  "pov": "${povInfo.name}",
  "nodes": [ ... array of node objects ... ]
}
\`\`\`

Each node has these fields:
- id: string (format: ${povInfo.prefix}-{category}-{NNN}, e.g., ${povInfo.exampleId})
- category: "Beliefs" | "Desires" | "Intentions"
- label: string (3-8 word title)
- description: string (genus-differentia format, see below)
- parent_id: string | null
- parent_relationship: "is_a" | "part_of" | "specializes" | null
- children: string[] (child node IDs)
- graph_attributes:
    - epistemic_type: string
    - rhetorical_strategy: string | string[]
    - assumes: string[] (underlying premises)
    - falsifiability: "high" | "medium" | "low"
    - audience: string
    - emotional_register: string
    - policy_actions: string[]
    - intellectual_lineage: { name: string, description: string, url: string, category: string }[]
    - steelman_vulnerability: string
    - possible_fallacies: string[]
    - node_scope: string

You are reviewing ALL ${nodeCount} nodes in this batch. Process every node.

=== GENUS-DIFFERENTIA DESCRIPTION FORMAT (MANDATORY) ===

Every description MUST follow this exact structure:

  "A [Belief|Desire|Intention] within ${povInfo.name} discourse that [differentia -- what makes this node distinct from its neighbors]. Encompasses: [scope items, comma-separated]. Excludes: [boundary items with clarifying context]."

The description is 2-5 sentences. The first sentence is the genus-differentia definition. Subsequent sentences elaborate scope and boundaries.

=== BDI CATEGORY CONSTRAINTS ===

**Beliefs** make empirical or interpretive claims about how the world IS.
- Valid verbs: asserts, holds, claims, observes, posits, contends
- INVALID: mandates, seeks, prioritizes, advocates (these imply agency/desire)
- epistemic_type must be one of: empirical_claim, predictive, interpretive_lens, definitional
- falsifiability: typically high or medium

**Desires** express normative commitments about what SHOULD happen.
- Valid verbs: prioritizes, seeks, values, commits to, upholds
- INVALID: asserts, observes, implements, deploys (these imply belief or action)
- epistemic_type must be: normative_prescription
- falsifiability: typically low

**Intentions** propose strategic actions about HOW to achieve goals.
- Valid verbs: advocates, proposes, recommends, implements, promotes
- INVALID: believes, holds, values, prioritizes (these imply belief or desire)
- epistemic_type must be: strategic_recommendation
- falsifiability: typically medium

=== REVIEW CHECKLIST (apply to EVERY node) ===

1. **Genus-differentia format**: Does the description start with "A [Belief|Desire|Intention] within ${povInfo.name} discourse that..."? If not, rewrite to conform.

2. **Category-verb alignment**: Does the main verb match the BDI category? Flag and fix mismatches.

3. **Encompasses/Excludes clarity**:
   - Are Encompasses items specific and parallel in grammatical structure?
   - Are Excludes items clear about WHY they are excluded? Each exclusion should specify: (a) belongs to a different node, (b) out of scope for this POV, or (c) common misconception about this node's coverage.

4. **Semantic redundancy**: Remove low-information adjectives ("various", "important", "significant") that do not distinguish this node from siblings. Every word in the differentia should help distinguish THIS node from its neighbors.

5. **Assumes coherence**: Do the assumes[] entries logically support the description? Flag assumes that contradict the description or belong to a different BDI category.

6. **epistemic_type consistency**: Does the epistemic_type match the category? Flag: Beliefs with normative_prescription, Desires with empirical_claim, Intentions with interpretive_lens.

7. **Falsifiability alignment**: Is the falsifiability rating consistent with the claim type? Flag: empirical_claims rated "low", normative_prescriptions rated "high".

8. **Cross-category parent-child**: If this node's parent_id points to a node in a DIFFERENT BDI category (e.g., a Belief parented under an Intention), flag it. The node displays in the parent's category section in the UI, causing misplacement.

=== OUTPUT FORMAT ===

Return a JSON array. For each node that needs changes:

\`\`\`json
{
  "id": "${povInfo.exampleId}",
  "label": "node label for display",
  "status": "needs_changes",
  "issues": [
    {
      "field": "description | graph_attributes.epistemic_type | assumes | parent_id",
      "severity": "critical | major | suggestion",
      "category": "genus-format | verb-mismatch | encompasses-clarity | excludes-clarity | redundancy | assumes-coherence | type-mismatch | falsifiability-mismatch | cross-category-parent",
      "current": "the current value",
      "proposed": "the proposed replacement",
      "rationale": "one sentence explaining why"
    }
  ],
  "current_description": "full original description verbatim",
  "proposed_description": "full revised description if description changed, null otherwise",
  "current_graph_attributes": { "only fields that would change, with current values" },
  "proposed_graph_attributes": { "only fields that changed, with new values" }
}
\`\`\`

For nodes with NO issues:

\`\`\`json
{
  "id": "${povInfo.exampleId}",
  "label": "node label",
  "status": "compliant",
  "issues": []
}
\`\`\`

=== CONSTRAINTS ===

- Do NOT change node IDs or labels unless the label fundamentally misrepresents the content.
- Do NOT collapse Encompasses/Excludes into running prose -- they MUST remain as labeled clauses within the description.
- Do NOT introduce OWL/RDF formalism -- this project uses ontological VOCABULARY in natural language, not formal triples.
- Do NOT invent new graph_attributes fields -- only validate and fix existing ones.
- Preserve the intellectual voice of the ${povInfo.name} perspective -- the node should sound like a ${povInfo.name} after cleanup, not generic.
- Include EVERY node in the output -- compliant nodes with status "compliant" and zero issues, changed nodes with full before/after.

=== NODES TO REVIEW ===

${nodesJson}`;
}

/**
 * Extract a JSON array from LLM response text.
 * Uses parseJsonRobust from helpers.ts to handle code fences,
 * trailing commas, bare newlines, and unescaped quotes.
 */
function extractJsonArray(text: string): RawNodeProposal[] {
  // Strip fences and extract the array bracket range
  const cleaned = stripCodeFences(text);
  const start = cleaned.indexOf('[');
  const end = cleaned.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`No JSON array found in LLM response (length=${text.length})`);
  }
  const arrayText = cleaned.slice(start, end + 1);
  return parseJsonRobust(arrayText) as RawNodeProposal[];
}

/**
 * Normalize flat LLM output into the nested format the review GUI expects.
 */
function normalizeProposal(raw: RawNodeProposal): NodeProposal {
  return {
    id: raw.id,
    label: raw.label,
    status: raw.status,
    issues: raw.issues,
    current: {
      description: raw.current_description ?? '',
      graph_attributes: raw.current_graph_attributes ?? {},
    },
    proposed: {
      description: raw.proposed_description ?? raw.current_description ?? '',
      graph_attributes: raw.proposed_graph_attributes ?? {},
    },
  };
}

// ── Main ──────────────────────────────────────────────

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const pov = getArg('pov');
  const batchSize = parseInt(getArg('batch-size', '20')!, 10);
  const model = getArg('model', 'gemini-2.5-flash')!;

  if (!pov || !POV_MAP[pov]) {
    console.error('Usage: npx tsx scripts/propose-dolce-refinements.ts --pov <accelerationist|safetyist|skeptic> [--batch-size 20] [--model gemini-2.5-flash] [--dry-run]');
    process.exit(1);
  }

  const povInfo = POV_MAP[pov]!;
  const repoRoot = resolveRepoRoot(process.cwd());
  const dataRoot = resolveDataRoot(repoRoot);

  const config = JSON.parse(
    fs.readFileSync(path.join(repoRoot, '.aitriad.json'), 'utf-8').replace(/^\uFEFF/, ''),
  ) as { taxonomy_dir: string };
  const taxonomyDir = path.join(dataRoot, config.taxonomy_dir);
  const filePath = path.join(taxonomyDir, povInfo.file);

  console.log(`Repo root:    ${repoRoot}`);
  console.log(`Data root:    ${dataRoot}`);
  console.log(`Taxonomy dir: ${taxonomyDir}`);
  console.log(`POV:          ${povInfo.name}`);
  console.log(`Model:        ${model}`);
  console.log(`Batch size:   ${batchSize}`);
  console.log(`Mode:         ${dryRun ? 'DRY RUN' : 'GENERATE'}`);
  console.log();

  if (!fs.existsSync(filePath)) {
    console.error(`POV file not found: ${filePath}`);
    process.exit(1);
  }

  const data = loadJson<{ nodes: PovNode[] }>(filePath);
  const nodes = data.nodes ?? [];
  console.log(`Loaded ${nodes.length} nodes from ${povInfo.file}`);

  // Build batches
  const batches: PovNode[][] = [];
  for (let i = 0; i < nodes.length; i += batchSize) {
    batches.push(nodes.slice(i, i + batchSize));
  }
  console.log(`Batches: ${batches.length} (${batchSize} nodes each, last batch: ${batches[batches.length - 1]?.length ?? 0})\n`);

  if (dryRun) {
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      const ids = batch.map(n => n.id);
      console.log(`  Batch ${i + 1}/${batches.length}: ${batch.length} nodes (${ids[0]} → ${ids[ids.length - 1]})`);
    }
    console.log('\nDry run complete — no LLM calls made.');
    return;
  }

  // Create AI adapter
  const adapter = createCLIAdapter(repoRoot);
  const allProposals: NodeProposal[] = [];
  let failedBatches = 0;

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const ids = batch.map(n => n.id);
    console.log(`Batch ${i + 1}/${batches.length}: ${batch.length} nodes (${ids[0]} → ${ids[ids.length - 1]})`);

    // Serialize nodes for the prompt — include fields relevant to DOLCE review
    const nodesForPrompt = batch.map(n => ({
      id: n.id,
      category: n.category,
      label: n.label,
      description: n.description,
      parent_id: n.parent_id ?? null,
      parent_relationship: n.parent_relationship ?? null,
      children: n.children ?? [],
      graph_attributes: n.graph_attributes ?? {},
    }));

    const nodesJson = JSON.stringify(nodesForPrompt, null, 2);
    const prompt = buildPrompt(povInfo, batch.length, nodesJson);

    try {
      const response = await adapter.generateText(prompt, model, {
        temperature: 0.2,
        maxTokens: 16384,
        timeoutMs: 120_000,
      });

      const rawProposals = extractJsonArray(response);
      const proposals = rawProposals.map(normalizeProposal);
      console.log(`  → ${proposals.length} proposals (${proposals.filter(p => p.status === 'needs_changes').length} need changes)`);
      allProposals.push(...proposals);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  ✗ Batch ${i + 1} failed: ${msg.slice(0, 200)}`);
      failedBatches++;
    }
  }

  if (allProposals.length === 0) {
    console.error('\nNo proposals generated. All batches failed.');
    process.exit(1);
  }

  // Aggregate summary
  const summary = {
    compliant: allProposals.filter(p => p.status === 'compliant').length,
    needs_changes: allProposals.filter(p => p.status === 'needs_changes').length,
    critical: 0,
    major: 0,
    suggestion: 0,
  };
  for (const p of allProposals) {
    for (const issue of p.issues) {
      if (issue.severity === 'critical') summary.critical++;
      else if (issue.severity === 'major') summary.major++;
      else summary.suggestion++;
    }
  }

  const date = new Date().toISOString().slice(0, 10);
  const output: ProposalsOutput = {
    generated_at: new Date().toISOString(),
    model,
    source_file: povInfo.file,
    total_nodes: nodes.length,
    summary,
    proposals: allProposals,
  };

  const outFileName = `proposals-${pov}-${date}.json`;
  const outPath = path.join(repoRoot, outFileName);
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2) + '\n', 'utf-8');

  // Report
  console.log('\n' + '─'.repeat(50));
  console.log(`Results: ${outFileName}`);
  console.log(`  Total nodes:   ${nodes.length}`);
  console.log(`  Proposals:     ${allProposals.length}`);
  console.log(`  Compliant:     ${summary.compliant}`);
  console.log(`  Needs changes: ${summary.needs_changes}`);
  console.log(`    Critical:    ${summary.critical}`);
  console.log(`    Major:       ${summary.major}`);
  console.log(`    Suggestion:  ${summary.suggestion}`);
  if (failedBatches > 0) {
    console.log(`  Failed batches: ${failedBatches}`);
  }
  console.log(`\nWritten: ${outPath}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
