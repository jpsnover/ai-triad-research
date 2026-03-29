#!/usr/bin/env node
// Retry steelman migration for nodes that still have string format.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_ROOT = path.resolve(__dirname, '..', '..', 'ai-triad-data');
const TAXONOMY_DIR = path.join(DATA_ROOT, 'taxonomy', 'Origin');
const API_KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.AI_MODEL || 'gemini-2.5-flash';
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

async function generateText(prompt) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const resp = await fetch(`${GEMINI_BASE}/${MODEL}:generateContent?key=${API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 2048 },
      }),
    });
    if (resp.status === 429 || resp.status === 503) { await new Promise(r => setTimeout(r, 3000 * attempt)); continue; }
    if (!resp.ok) throw new Error(`Gemini ${resp.status}`);
    const json = await resp.json();
    return json.candidates[0].content.parts.map(p => p.text).join('');
  }
  throw new Error('Rate limited');
}

async function main() {
  const files = { skeptic: 'skeptic.json', 'cross-cutting': 'cross-cutting.json' };
  let fixed = 0, failed = 0;

  for (const [pov, filename] of Object.entries(files)) {
    const filePath = path.join(TAXONOMY_DIR, filename);
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const isCC = pov === 'cross-cutting';
    const needsFix = data.nodes.filter(n => n.graph_attributes?.steelman_vulnerability && typeof n.graph_attributes.steelman_vulnerability === 'string');
    if (needsFix.length === 0) continue;

    console.log(`${pov}: ${needsFix.length} nodes to fix`);

    for (const node of needsFix) {
      const existing = node.graph_attributes.steelman_vulnerability;
      const attackPovs = isCC ? 'from_accelerationist, from_safetyist, from_skeptic' :
        ['accelerationist','safetyist','skeptic'].filter(p => p !== pov).map(p => `from_${p}`).join(', ');

      const prompt = `Generate per-POV steelman vulnerabilities for this taxonomy node.

NODE: ${node.id} "${node.label}" — ${node.description.slice(0, 150)}
Existing steelman: ${existing}
POV: ${pov}

Generate attacks from: ${attackPovs}
Each attack: 1-2 sentences, specific to THIS node, grounded in that POV's worldview.

Return ONLY a JSON object like: {"from_safetyist": "...", "from_skeptic": "..."}
No markdown, no code fences.`;

      try {
        const raw = await generateText(prompt);
        let cleaned = raw.replace(/```json\s*/g, '').replace(/```/g, '').trim();
        const fb = cleaned.indexOf('{'), lb = cleaned.lastIndexOf('}');
        if (fb >= 0 && lb > fb) cleaned = cleaned.slice(fb, lb + 1);
        cleaned = cleaned.replace(/,\s*([}\]])/g, '$1');
        const result = JSON.parse(cleaned);
        node.graph_attributes.steelman_vulnerability = result;
        fixed++;
        process.stdout.write('✓');
      } catch (err) {
        failed++;
        process.stdout.write('✗');
      }
      await new Promise(r => setTimeout(r, 500));
    }

    const tmp = filePath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf-8');
    fs.renameSync(tmp, filePath);
    console.log(`\n  Saved`);
  }
  console.log(`\nFixed: ${fixed}, Failed: ${failed}`);
}
main().catch(err => { console.error(err); process.exit(1); });
