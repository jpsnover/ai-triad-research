#!/usr/bin/env node
// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Phase 6c — Migrate steelman_vulnerability from string to per-POV object.
 * For each node, generates POV-specific steelman attacks.
 *
 * Usage: node scripts/migrate-steelmans.mjs [--dry-run] [--pov accelerationist]
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_ROOT = path.resolve(__dirname, '..', '..', 'ai-triad-data');
const TAXONOMY_DIR = path.join(DATA_ROOT, 'taxonomy', 'Origin');
const MANIFEST_DIR = path.join(DATA_ROOT, 'migrations');

const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) { console.error('GEMINI_API_KEY not set'); process.exit(1); }
const MODEL = process.env.AI_MODEL || 'gemini-2.5-flash';
console.log(`[AI] Backend: gemini | Model: ${MODEL}${process.env.AI_MODEL ? ' ($AI_MODEL)' : ' (default)'} | Key source: $GEMINI_API_KEY`);
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const DRY_RUN = process.argv.includes('--dry-run');
const ONLY_POV = (() => { const i = process.argv.indexOf('--pov'); return i >= 0 ? process.argv[i+1] : null; })();

let apiCalls = 0;
async function generateText(prompt) {
  apiCalls++;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const resp = await fetch(`${GEMINI_BASE}/${MODEL}:generateContent?key=${API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 4096 },
      }),
    });
    if (resp.status === 429 || resp.status === 503) {
      await new Promise(r => setTimeout(r, 2000 * Math.pow(2, attempt)));
      continue;
    }
    if (!resp.ok) throw new Error(`Gemini ${resp.status}`);
    const json = await resp.json();
    if (!json.candidates?.length) throw new Error('No candidates');
    return json.candidates[0].content.parts.map(p => p.text).join('');
  }
  throw new Error('Rate limited');
}

function buildPrompt(nodes, pov) {
  // For POV nodes: generate attacks from the OTHER two POVs
  // For CC nodes: generate attacks from all three POVs
  const nodeBlock = nodes.map(n => {
    const existing = typeof n.graph_attributes?.steelman_vulnerability === 'string'
      ? n.graph_attributes.steelman_vulnerability : '';
    return `  ${n.id} [${pov}]: "${n.label}" — ${n.description.slice(0, 120)}...
    Existing steelman: ${existing || '(none)'}`;
  }).join('\n');

  const isCC = pov === 'cross-cutting';
  const attackPovs = isCC
    ? 'from_accelerationist, from_safetyist, from_skeptic'
    : (() => {
        const others = ['accelerationist', 'safetyist', 'skeptic'].filter(p => p !== pov);
        return others.map(p => `from_${p}`).join(', ');
      })();

  return `Generate per-POV steelman vulnerabilities for these taxonomy nodes.

A steelman vulnerability is the STRONGEST counterargument from a specific POV against this node's claim.
Each attack must be grounded in THAT POV's specific beliefs and values, not a generic counterargument.

POV vocabulary to use:
  from_accelerationist: reference progress, innovation, speed, scaling, open-source, abundance, competition
  from_safetyist: reference risk, alignment, control, oversight, catastrophe, irreversibility, caution
  from_skeptic: reference bias, displacement, accountability, present harms, evidence gaps, power concentration

NODES:
${nodeBlock}

For each node, return attacks from: ${attackPovs}
Each attack: 1-2 sentences, 50-200 characters, specific to THIS node.

Return ONLY JSON mapping node IDs to objects. No markdown.
Example: {"acc-goals-001": {"from_safetyist": "...", "from_skeptic": "..."}}`;
}

async function main() {
  console.log('Phase 6c — Perspectival Steelman Migration');
  console.log(`Model: ${MODEL} | Dry run: ${DRY_RUN}`);

  const files = {
    accelerationist: path.join(TAXONOMY_DIR, 'accelerationist.json'),
    safetyist: path.join(TAXONOMY_DIR, 'safetyist.json'),
    skeptic: path.join(TAXONOMY_DIR, 'skeptic.json'),
    'cross-cutting': path.join(TAXONOMY_DIR, 'cross-cutting.json'),
  };

  const povs = ONLY_POV ? [ONLY_POV] : Object.keys(files);
  let total = 0, migrated = 0, failed = 0, skipped = 0;

  for (const pov of povs) {
    const fileData = JSON.parse(fs.readFileSync(files[pov], 'utf-8'));
    const nodes = fileData.nodes.filter(n => n.graph_attributes);
    console.log(`\n  ${pov.toUpperCase()} — ${nodes.length} nodes with graph_attributes`);

    // Process in batches of 5 (smaller = more reliable JSON)
    for (let i = 0; i < nodes.length; i += 5) {
      const batch = nodes.slice(i, i + 5);
      total += batch.length;

      try {
        const prompt = buildPrompt(batch, pov);
        let results;
        for (let retry = 0; retry < 2; retry++) {
          const raw = await generateText(prompt);
          let cleaned = raw.replace(/```json\s*/g, '').replace(/```/g, '').trim();
          const firstBrace = cleaned.indexOf('{');
          const lastBrace = cleaned.lastIndexOf('}');
          if (firstBrace >= 0 && lastBrace > firstBrace) {
            cleaned = cleaned.slice(firstBrace, lastBrace + 1);
          }
          // Fix common JSON issues: trailing commas, unescaped newlines
          cleaned = cleaned.replace(/,\s*([}\]])/g, '$1');
          try {
            results = JSON.parse(cleaned);
            break;
          } catch {
            if (retry === 0) continue; // retry once
            throw new Error('JSON parse failed after retry');
          }
        }

        for (const node of batch) {
          const perPov = results[node.id];
          if (perPov && typeof perPov === 'object') {
            if (!DRY_RUN) node.graph_attributes.steelman_vulnerability = perPov;
            migrated++;
          } else {
            skipped++;
          }
        }
        process.stdout.write('✓');
      } catch (err) {
        failed += batch.length;
        process.stdout.write('✗');
        if (failed <= 15) console.error(`\n    Error: ${err.message?.slice(0, 200)}`);
      }
      await new Promise(r => setTimeout(r, 300));
    }

    if (!DRY_RUN) {
      const tmp = files[pov] + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(fileData, null, 2) + '\n', 'utf-8');
      fs.renameSync(tmp, files[pov]);
      console.log(`\n    ✓ Saved`);
    }
  }

  // Manifest
  if (!DRY_RUN) {
    fs.mkdirSync(MANIFEST_DIR, { recursive: true });
    const manifest = {
      phase: '6c',
      description: 'Perspectival steelman migration — string to per-POV object',
      model: MODEL,
      completed_at: new Date().toISOString(),
      items_total: total,
      items_migrated: migrated,
      items_failed: failed,
      items_skipped: skipped,
      api_calls: apiCalls,
    };
    fs.writeFileSync(path.join(MANIFEST_DIR, 'phase-6c-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  }

  console.log(`\n${'═'.repeat(50)}`);
  console.log(`  Total: ${total} | Migrated: ${migrated} | Failed: ${failed} | Skipped: ${skipped}`);
  console.log(`  API calls: ${apiCalls}`);
  if (DRY_RUN) console.log('  ⚠ DRY RUN');
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
