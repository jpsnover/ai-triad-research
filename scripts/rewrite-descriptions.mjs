#!/usr/bin/env node
// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Phase 2 — Batch rewrite taxonomy node descriptions to genus-differentia format.
 *
 * For each node:
 *   1. Builds context: the node, its siblings (same category+parent), its parent
 *   2. Calls AI to rewrite the description
 *   3. Validates: genus-differentia pattern, sibling references, no orphan node IDs
 *   4. Writes back to taxonomy files
 *   5. Tracks in migration manifest
 *
 * Usage:
 *   node scripts/rewrite-descriptions.mjs [--dry-run] [--pov accelerationist] [--batch-size 25] [--skip-existing]
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const DATA_ROOT = path.resolve(REPO_ROOT, '..', 'ai-triad-data');
const TAXONOMY_DIR = path.join(DATA_ROOT, 'taxonomy', 'Origin');
const MANIFEST_DIR = path.join(DATA_ROOT, 'migrations');

// ── Config ────────────────────────────────────────────────

const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) { console.error('GEMINI_API_KEY not set'); process.exit(1); }

const MODEL = process.env.AI_MODEL || 'gemini-2.5-flash';
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

const args = process.argv.slice(2);
function hasFlag(name) { return args.includes(`--${name}`); }
function getArg(name, defaultVal) {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : defaultVal;
}

const DRY_RUN = hasFlag('dry-run');
const SKIP_EXISTING = hasFlag('skip-existing');
const BATCH_SIZE = parseInt(getArg('batch-size', '25'), 10);
const ONLY_POV = getArg('pov', null); // null = all
const LIMIT = parseInt(getArg('limit', '0'), 10); // 0 = no limit

// ── Genus-differentia pattern detection ───────────────────

const GD_PATTERN_POV = /^A\s+(Goals\/Values|Data\/Facts|Methods\/Arguments)\s+within\s+(accelerationist|safetyist|skeptic)\s+discourse\s+that\s+/i;
const GD_PATTERN_CC = /^A\s+cross-cutting\s+concept\s+that\s+/i;

function hasGenusDifferentia(description, isCC) {
  if (!description) return false;
  return isCC ? GD_PATTERN_CC.test(description) : GD_PATTERN_POV.test(description);
}

// ── Load taxonomy ─────────────────────────────────────────

const FILES = {
  accelerationist: path.join(TAXONOMY_DIR, 'accelerationist.json'),
  safetyist: path.join(TAXONOMY_DIR, 'safetyist.json'),
  skeptic: path.join(TAXONOMY_DIR, 'skeptic.json'),
  'cross-cutting': path.join(TAXONOMY_DIR, 'cross-cutting.json'),
};

function loadJson(p) { return JSON.parse(fs.readFileSync(p, 'utf-8')); }
function saveJsonAtomic(p, data) {
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  fs.renameSync(tmp, p);
}

// Build a global index of all node IDs for orphan reference checking
function buildNodeIndex(allFiles) {
  const index = new Set();
  for (const [, fileData] of Object.entries(allFiles)) {
    for (const node of fileData.nodes) index.add(node.id);
  }
  return index;
}

// ── Gemini API ────────────────────────────────────────────

let apiCalls = 0;
let rateLimitWaits = 0;

async function generateText(prompt, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    apiCalls++;
    const url = `${GEMINI_BASE}/${MODEL}:generateContent?key=${API_KEY}`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 2048 },
      }),
    });
    if (resp.status === 429 || resp.status === 503) {
      rateLimitWaits++;
      const wait = Math.min(60000, 2000 * Math.pow(2, attempt));
      console.log(`    ⏳ Rate limited (${resp.status}), waiting ${(wait / 1000).toFixed(0)}s...`);
      await new Promise(r => setTimeout(r, wait));
      continue;
    }
    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`Gemini ${resp.status}: ${body.slice(0, 300)}`);
    }
    const json = await resp.json();
    if (!json.candidates?.length) throw new Error('No candidates from Gemini');
    return json.candidates[0].content.parts.map(p => p.text).join('');
  }
  throw new Error(`Failed after ${retries} retries (rate limiting)`);
}

function stripFences(text) {
  return text.replace(/```json\s*/g, '').replace(/```/g, '').trim();
}

// ── Build rewrite prompt ──────────────────────────────────

function buildPovPrompt(node, siblings, parent, pov) {
  const siblingBlock = siblings.length > 0
    ? siblings.map(s => `  [${s.id}] ${s.label}: ${s.description}`).join('\n')
    : '  (no siblings in this group)';

  const parentBlock = parent
    ? `Parent node: [${parent.id}] ${parent.label}: ${parent.description}`
    : 'This is a top-level node (no parent).';

  return `Rewrite the description of this taxonomy node using genus-differentia format.

NODE TO REWRITE:
  ID: ${node.id}
  Label: ${node.label}
  Category: ${node.category}
  POV: ${pov}
  Current description: ${node.description}

${parentBlock}

SIBLING NODES (same category ${node.parent_id ? 'and parent' : 'at top level'}):
${siblingBlock}

GENUS-DIFFERENTIA FORMAT:
  First sentence: "A ${node.category} within ${pov} discourse that [what makes this node distinct from its siblings]."
  Then 1-3 more sentences covering:
    - Encompasses: what concrete sub-themes or examples this node covers
    - Excludes: what neighboring nodes (name them by label) cover instead
  Total: 2-4 sentences. Grade-10 reading level. Plain language, no jargon.

RULES:
  - The FIRST sentence must follow the pattern exactly: "A ${node.category} within ${pov} discourse that ..."
  - Name at least one sibling node BY LABEL (not ID) in the Excludes clause.
  - Do NOT change the node's meaning — preserve its intellectual content while reformatting.
  - Do NOT reference node IDs in the description text.
  - Keep it concise. The Excludes clause does the boundary-setting work.

Return ONLY the new description text. No JSON, no markdown, no preamble.`;
}

function buildCCPrompt(node, siblings) {
  const siblingBlock = siblings.length > 0
    ? siblings.map(s => `  [${s.id}] ${s.label}: ${s.description}`).join('\n')
    : '  (no siblings)';

  return `Rewrite the description of this cross-cutting taxonomy node using genus-differentia format.

NODE TO REWRITE:
  ID: ${node.id}
  Label: ${node.label}
  Current description: ${node.description}
  Interpretations:
    Accelerationist: ${node.interpretations?.accelerationist || '(none)'}
    Safetyist: ${node.interpretations?.safetyist || '(none)'}
    Skeptic: ${node.interpretations?.skeptic || '(none)'}

NEIGHBORING CROSS-CUTTING NODES:
${siblingBlock}

GENUS-DIFFERENTIA FORMAT:
  First sentence: "A cross-cutting concept that [what makes this concept distinct]."
  Then 1-3 more sentences covering:
    - Encompasses: what this concept covers across the three perspectives
    - Excludes: what neighboring nodes (name them by label) cover instead
  Total: 2-4 sentences. Grade-10 reading level. Plain language.

RULES:
  - The FIRST sentence must start with "A cross-cutting concept that ..."
  - Name at least one neighboring node BY LABEL in the Excludes clause.
  - Do NOT include POV-specific interpretations in the description — those belong in the interpretations object.
  - Preserve the concept's meaning. Reformat, don't reinvent.
  - Keep it concise.

Return ONLY the new description text. No JSON, no markdown, no preamble.`;
}

// ── Validation ────────────────────────────────────────────

function validateDescription(newDesc, node, isCC, nodeIndex, siblingLabels) {
  const errors = [];

  // Pattern check
  if (isCC) {
    if (!GD_PATTERN_CC.test(newDesc)) errors.push('Missing genus-differentia pattern for CC node');
  } else {
    if (!GD_PATTERN_POV.test(newDesc)) errors.push('Missing genus-differentia pattern for POV node');
  }

  // Length check
  const sentences = newDesc.split(/[.!?]+/).filter(s => s.trim().length > 0);
  if (sentences.length > 6) errors.push(`Too long: ${sentences.length} sentences (max 6)`);
  if (newDesc.length > 600) errors.push(`Too long: ${newDesc.length} chars (max 600)`);
  if (newDesc.length < 40) errors.push(`Too short: ${newDesc.length} chars (min 40)`);

  // Check for orphan node ID references
  const idRefs = newDesc.match(/[a-z]{2,3}-(?:goals|data|methods)-\d{3}|cc-\d{3}/g) || [];
  for (const ref of idRefs) {
    if (!nodeIndex.has(ref)) errors.push(`Orphan node ID reference: ${ref}`);
  }

  // Warn (not error) if no sibling label found
  const hasSiblingRef = siblingLabels.some(label =>
    newDesc.toLowerCase().includes(label.toLowerCase()) ||
    newDesc.toLowerCase().includes(label.toLowerCase().replace(/['']/g, "'"))
  );
  if (!hasSiblingRef && siblingLabels.length > 0) {
    errors.push(`No sibling label referenced in Excludes (siblings: ${siblingLabels.slice(0, 3).join(', ')})`);
  }

  return errors;
}

// ── Main ──────────────────────────────────────────────────

async function main() {
  console.log('Phase 2 — Genus-Differentia Description Rewrite');
  console.log(`Model: ${MODEL} | Batch size: ${BATCH_SIZE} | Dry run: ${DRY_RUN} | Skip existing: ${SKIP_EXISTING}`);
  if (ONLY_POV) console.log(`Only processing: ${ONLY_POV}`);

  // Load all files
  const allFiles = {};
  for (const [key, filePath] of Object.entries(FILES)) {
    allFiles[key] = loadJson(filePath);
  }
  const nodeIndex = buildNodeIndex(allFiles);

  // Determine which POVs to process
  const povsToProcess = ONLY_POV ? [ONLY_POV] : Object.keys(FILES);

  // Migration manifest
  const manifest = {
    phase: 2,
    description: 'Genus-differentia description rewrite',
    model: MODEL,
    started_at: new Date().toISOString(),
    completed_at: null,
    items_total: 0,
    items_succeeded: 0,
    items_failed: 0,
    items_skipped: 0,
    items_failed_ids: [],
    failure_reasons: {},
    nodes: [],
  };

  for (const pov of povsToProcess) {
    const fileData = allFiles[pov];
    const isCC = pov === 'cross-cutting';
    const allNodes = fileData.nodes;
    const nodes = LIMIT > 0 ? allNodes.slice(0, LIMIT) : allNodes;

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`  ${pov.toUpperCase()} — ${nodes.length} nodes`);
    console.log(`${'═'.repeat(60)}`);

    // Process in batches
    for (let i = 0; i < nodes.length; i += BATCH_SIZE) {
      const batch = nodes.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(nodes.length / BATCH_SIZE);
      console.log(`\n  Batch ${batchNum}/${totalBatches} (nodes ${i + 1}-${Math.min(i + BATCH_SIZE, nodes.length)})`);

      for (const node of batch) {
        manifest.items_total++;

        // Skip if already has genus-differentia and --skip-existing
        if (SKIP_EXISTING && hasGenusDifferentia(node.description, isCC)) {
          manifest.items_skipped++;
          process.stdout.write('.');
          continue;
        }

        // Build context
        let siblings, parent, prompt;
        if (isCC) {
          // CC nodes: siblings are other CC nodes (no category grouping)
          siblings = allNodes.filter(n => n.id !== node.id).slice(0, 10);
          prompt = buildCCPrompt(node, siblings);
        } else {
          // POV nodes: siblings share same category and parent
          if (node.parent_id) {
            siblings = allNodes.filter(n => n.id !== node.id && n.parent_id === node.parent_id);
            parent = allNodes.find(n => n.id === node.parent_id) || null;
          } else {
            siblings = allNodes.filter(n => n.id !== node.id && !n.parent_id && n.category === node.category);
            parent = null;
          }
          prompt = buildPovPrompt(node, siblings.slice(0, 8), parent, pov);
        }

        const siblingLabels = (isCC ? siblings : siblings).map(s => s.label);
        const oldHash = crypto.createHash('md5').update(node.description || '').digest('hex').slice(0, 8);

        try {
          const newDesc = (await generateText(prompt)).trim();

          // Validate
          const errors = validateDescription(newDesc, node, isCC, nodeIndex, siblingLabels);
          const hasPatternError = errors.some(e => e.startsWith('Missing genus-differentia'));
          const hasSiblingWarning = errors.some(e => e.startsWith('No sibling label'));

          if (hasPatternError) {
            // Hard failure — pattern doesn't match
            manifest.items_failed++;
            manifest.items_failed_ids.push(node.id);
            manifest.failure_reasons[node.id] = errors.join('; ');
            process.stdout.write('✗');
          } else {
            // Success (sibling warning is soft)
            if (!DRY_RUN) {
              node.description = newDesc;
            }
            manifest.items_succeeded++;
            const newHash = crypto.createHash('md5').update(newDesc).digest('hex').slice(0, 8);
            manifest.nodes.push({
              node_id: node.id,
              status: 'migrated',
              batch: batchNum,
              old_description_hash: oldHash,
              new_description_hash: newHash,
              warnings: hasSiblingWarning ? errors.filter(e => e.startsWith('No sibling')) : [],
            });
            process.stdout.write(hasSiblingWarning ? '~' : '✓');
          }
        } catch (err) {
          manifest.items_failed++;
          manifest.items_failed_ids.push(node.id);
          manifest.failure_reasons[node.id] = err.message;
          process.stdout.write('✗');
        }

        // Small delay to avoid rate limiting
        await new Promise(r => setTimeout(r, 300));
      }
    }

    // Save updated file
    if (!DRY_RUN) {
      saveJsonAtomic(FILES[pov], fileData);
      console.log(`\n  ✓ Saved ${FILES[pov]}`);
    }
  }

  // Finalize manifest
  manifest.completed_at = new Date().toISOString();
  manifest.post_actions = {
    embeddings_regenerated: false,
    baseline_captured: null,
  };
  manifest.notes = `${manifest.items_failed} failed nodes left with original descriptions. ${manifest.items_skipped} skipped (already had genus-differentia). API calls: ${apiCalls}. Rate limit waits: ${rateLimitWaits}.`;

  // Save manifest
  if (!DRY_RUN) {
    fs.mkdirSync(MANIFEST_DIR, { recursive: true });
    const manifestPath = path.join(MANIFEST_DIR, 'phase-2-manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
    console.log(`\n✓ Manifest saved to ${manifestPath}`);
  }

  // Summary
  console.log(`\n${'═'.repeat(60)}`);
  console.log('  SUMMARY');
  console.log(`${'═'.repeat(60)}`);
  console.log(`  Total:     ${manifest.items_total}`);
  console.log(`  Succeeded: ${manifest.items_succeeded}`);
  console.log(`  Failed:    ${manifest.items_failed} (${(manifest.items_failed / manifest.items_total * 100).toFixed(1)}%)`);
  console.log(`  Skipped:   ${manifest.items_skipped}`);
  console.log(`  API calls: ${apiCalls}`);
  if (manifest.items_failed > 0) {
    console.log(`  Failed IDs: ${manifest.items_failed_ids.join(', ')}`);
  }
  if (DRY_RUN) console.log('\n  ⚠ DRY RUN — no files were modified');

  // Exit with error if failure rate > 15%
  const failRate = manifest.items_failed / (manifest.items_total - manifest.items_skipped);
  if (failRate > 0.15) {
    console.error(`\n  ✗ Failure rate ${(failRate * 100).toFixed(1)}% exceeds 15% threshold. Investigate before proceeding.`);
    process.exit(1);
  }
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
