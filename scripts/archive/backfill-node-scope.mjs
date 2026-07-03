#!/usr/bin/env node
// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Phase 4.5 — Backfill node_scope on all taxonomy nodes.
 *
 * Classification rules:
 *   Data/Facts → "claim" (empirical assertions)
 *   Methods/Arguments → "scheme" (argumentative strategies)
 *   Goals/Values → AI triage (could be claim, scheme, or bridging)
 *   Cross-cutting → AI triage (no category to guide)
 *
 * Usage: node scripts/backfill-node-scope.mjs [--dry-run]
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_ROOT = path.resolve(__dirname, '..', '..', 'ai-triad-data');
const TAXONOMY_DIR = path.join(DATA_ROOT, 'taxonomy', 'Origin');

const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) { console.error('GEMINI_API_KEY not set'); process.exit(1); }

const MODEL = process.env.AI_MODEL || 'gemini-2.5-flash';
console.log(`[AI] Backend: gemini | Model: ${MODEL}${process.env.AI_MODEL ? ' ($AI_MODEL)' : ' (default)'} | Key source: $GEMINI_API_KEY`);
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const DRY_RUN = process.argv.includes('--dry-run');

// ── Gemini API ────────────────────────────────────────────

let apiCalls = 0;
async function generateText(prompt) {
  apiCalls++;
  const url = `${GEMINI_BASE}/${MODEL}:generateContent?key=${API_KEY}`;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 4096 },
      }),
    });
    if (resp.status === 429 || resp.status === 503) {
      await new Promise(r => setTimeout(r, 2000 * Math.pow(2, attempt)));
      continue;
    }
    if (!resp.ok) throw new Error(`Gemini ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
    const json = await resp.json();
    if (!json.candidates?.length) throw new Error('No candidates');
    return json.candidates[0].content.parts.map(p => p.text).join('');
  }
  throw new Error('Rate limited after 3 retries');
}

// ── Deterministic classification ──────────────────────────

function classifyByCategory(node) {
  if (node.category === 'Data/Facts') return 'claim';
  if (node.category === 'Methods/Arguments') return 'scheme';
  return null; // Goals/Values and CC need AI triage
}

// ── AI batch triage for ambiguous nodes ───────────────────

function buildTriagePrompt(nodes) {
  const nodeBlock = nodes.map(n =>
    `  ${n.id}: "${n.label}" — ${n.description.slice(0, 150)}...`
  ).join('\n');

  return `Classify each taxonomy node's role in argumentation structure.

For each node, assign ONE of:
  "claim" — a specific, testable assertion about the world
    Test: "Does this node assert something that could be true or false?"
  "scheme" — an argumentative strategy, framework, or reasoning pattern
    Test: "Does this node describe HOW to reason about something?"
  "bridging" — connects claims to schemes or values (use sparingly, <15% of nodes)
    Test: "Does this node primarily exist to link other concepts together?"

NODES:
${nodeBlock}

Return ONLY a JSON object mapping node IDs to scope values. No markdown, no commentary.
Example: {"acc-goals-001": "claim", "acc-goals-002": "scheme"}`;
}

// ── Main ──────────────────────────────────────────────────

async function main() {
  console.log(`Phase 4.5 — Backfill node_scope`);
  console.log(`Model: ${MODEL} | Dry run: ${DRY_RUN}`);

  const files = {
    accelerationist: path.join(TAXONOMY_DIR, 'accelerationist.json'),
    safetyist: path.join(TAXONOMY_DIR, 'safetyist.json'),
    skeptic: path.join(TAXONOMY_DIR, 'skeptic.json'),
    'cross-cutting': path.join(TAXONOMY_DIR, 'cross-cutting.json'),
  };

  let totalNodes = 0, deterministic = 0, aiTriaged = 0, failed = 0;
  const scopeCounts = { claim: 0, scheme: 0, bridging: 0 };

  for (const [pov, filePath] of Object.entries(files)) {
    const fileData = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const isCC = pov === 'cross-cutting';

    console.log(`\n  ${pov.toUpperCase()} (${fileData.nodes.length} nodes)`);

    // Phase 1: deterministic classification
    const needsTriage = [];
    for (const node of fileData.nodes) {
      totalNodes++;
      if (!node.graph_attributes) node.graph_attributes = {};

      const scope = isCC ? null : classifyByCategory(node);
      if (scope) {
        node.graph_attributes.node_scope = scope;
        scopeCounts[scope]++;
        deterministic++;
      } else {
        needsTriage.push(node);
      }
    }

    console.log(`    Deterministic: ${fileData.nodes.length - needsTriage.length} | Needs AI: ${needsTriage.length}`);

    // Phase 2: AI triage in batches of 25
    for (let i = 0; i < needsTriage.length; i += 25) {
      const batch = needsTriage.slice(i, i + 25);
      try {
        const prompt = buildTriagePrompt(batch);
        const raw = await generateText(prompt);
        const cleaned = raw.replace(/```json\s*/g, '').replace(/```/g, '').trim();
        const results = JSON.parse(cleaned);

        for (const node of batch) {
          const scope = results[node.id];
          if (scope && ['claim', 'scheme', 'bridging'].includes(scope)) {
            node.graph_attributes.node_scope = scope;
            scopeCounts[scope]++;
            aiTriaged++;
          } else {
            // Fallback: Goals/Values → claim, CC → claim
            node.graph_attributes.node_scope = 'claim';
            scopeCounts.claim++;
            aiTriaged++;
          }
        }
        process.stdout.write('✓');
      } catch (err) {
        // Fallback for failed batches
        for (const node of batch) {
          node.graph_attributes.node_scope = isCC ? 'claim' : 'claim';
          scopeCounts.claim++;
          failed++;
        }
        process.stdout.write('✗');
      }
      await new Promise(r => setTimeout(r, 300));
    }

    // Save
    if (!DRY_RUN) {
      const tmp = filePath + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(fileData, null, 2) + '\n', 'utf-8');
      fs.renameSync(tmp, filePath);
      console.log(`\n    ✓ Saved`);
    }
  }

  console.log(`\n${'═'.repeat(50)}`);
  console.log(`  SUMMARY`);
  console.log(`  Total: ${totalNodes} | Deterministic: ${deterministic} | AI: ${aiTriaged} | Failed: ${failed}`);
  console.log(`  Scopes: claim=${scopeCounts.claim} scheme=${scopeCounts.scheme} bridging=${scopeCounts.bridging}`);
  console.log(`  Bridging rate: ${(scopeCounts.bridging / totalNodes * 100).toFixed(1)}%`);
  console.log(`  API calls: ${apiCalls}`);
  if (DRY_RUN) console.log(`  ⚠ DRY RUN — no files modified`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
