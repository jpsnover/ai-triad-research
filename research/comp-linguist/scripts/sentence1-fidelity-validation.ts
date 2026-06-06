#!/usr/bin/env tsx
/**
 * Sentence 1 Fidelity Validation — t/381
 *
 * Tests whether the SENTENCE 1 FIDELITY instruction produces faithful
 * paraphrases of verbatim quotes. Two-phase test:
 *
 * Phase 1: Generate sentence 1 WITH the fidelity instruction
 * Phase 2: Run distortion check on (verbatim, generated sentence 1)
 *
 * Compares against the baseline 94% distortion rate from t/377.
 *
 * Usage:
 *   cd research/comp-linguist
 *   npx tsx scripts/sentence1-fidelity-validation.ts
 *   npx tsx scripts/sentence1-fidelity-validation.ts --sample 30
 */

import fs from 'fs';
import path from 'path';

const __dirname = path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Z]:)/, '$1');
const RESULTS_DIR = path.resolve(__dirname, '../results');
const DATA_DIR = path.resolve(__dirname, '../../../..', 'ai-triad-data/summaries');

const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';

const POVS = ['accelerationist', 'safetyist', 'skeptic'] as const;

// ── Types ───────────────────────────────────────────────

interface KeyPoint {
  category: string;
  point: string;
  verbatim: string;
  extraction_confidence?: number;
}

interface SourceSummary {
  doc_id: string;
  pov_summaries: Record<string, { key_points: KeyPoint[] }>;
}

interface ValidationResult {
  doc_id: string;
  pov: string;
  category: string;
  verbatim: string;
  old_point_sentence1: string;
  new_sentence1: string;
  old_verdict: 'entailed' | 'partial' | 'not_entailed';
  new_verdict: 'entailed' | 'partial' | 'not_entailed';
  old_explanation: string;
  new_explanation: string;
}

// ── Gemini API ──────────────────────────────────────────

function getApiKey(): string {
  const key = process.env.GEMINI_API_KEY ?? process.env.AI_API_KEY;
  if (!key) {
    console.error('Error: Set GEMINI_API_KEY or AI_API_KEY environment variable');
    process.exit(1);
  }
  return key;
}

async function callGemini(prompt: string, apiKey: string): Promise<string> {
  const url = `${GEMINI_BASE}/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.1,
      responseMimeType: 'application/json',
    },
  };

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Gemini API error ${resp.status}: ${text.slice(0, 200)}`);
  }

  const data = await resp.json() as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const raw = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!raw) throw new Error('Empty Gemini response');
  return raw;
}

// ── Prompts ─────────────────────────────────────────────

function buildSentence1Prompt(verbatim: string, pov: string, category: string): string {
  return `You are writing the FIRST SENTENCE of a key_point analysis for a ${pov} perspective on a ${category}-type claim.

VERBATIM QUOTE from the source document:
"""
${verbatim}
"""

SENTENCE 1 FIDELITY RULES (mandatory):
  Sentence 1 must be a faithful paraphrase of the verbatim quote. It may rephrase for clarity but must preserve ALL of the following:
    • Qualifying conditions — "in complex architectures", "when evidence emerges", "for high-risk AI systems" must appear in the paraphrase, not be dropped.
    • Enumerated items — if the verbatim lists three items, sentence 1 must include all three. Do NOT drop items from a list.
    • Hedging language — "could result in" stays "could result in", NOT "leads to". "May be overlooked" stays "may be", NOT "is often". Preserve the original degree of certainty.
    • Scope boundaries — "high-risk AI systems" stays scoped, NOT broadened to "AI systems". "Large-scale AI" does NOT become "training models".

Write ONLY sentence 1 — a faithful paraphrase that a reader could trace back to the verbatim quote without losing any factual content.

Respond in JSON: {"sentence1": "..."}`;
}

function buildDistortionCheckPrompt(verbatim: string, sentence1: string): string {
  return `You are a distortion judge. Given an EXACT QUOTE and a PARAPHRASE, determine whether the paraphrase faithfully preserves the quote's content.

EXACT QUOTE:
"""
${verbatim}
"""

PARAPHRASE:
"""
${sentence1}
"""

Check for:
  - Qualifier omission: Does the paraphrase drop important conditions or limiting phrases?
  - Scope change: Does the paraphrase broaden or narrow the claim?
  - Certainty escalation: Does "could" become "does", "may" become "is"?
  - Content omission: Does the paraphrase skip items from a list or drop key assertions?

Verdicts:
  - "entailed": The factual content is faithfully preserved. Reasonable rewording is fine.
  - "partial": The paraphrase omits a qualifier, changes scope, or drops content.
  - "not_entailed": The paraphrase fundamentally misrepresents the quote.

Respond in JSON: {"verdict": "...", "explanation": "..."}`;
}

// ── Data Loading ────────────────────────────────────────

function loadSamplePoints(sampleDocs: number): { docId: string; pov: string; category: string; verbatim: string; oldSentence1: string }[] {
  const allFiles = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.json'));

  // Deterministic shuffle
  const shuffled = [...allFiles].sort((a, b) => {
    let ha = 0, hb = 0;
    for (let i = 0; i < a.length; i++) ha = ((ha << 5) - ha + a.charCodeAt(i)) | 0;
    for (let i = 0; i < b.length; i++) hb = ((hb << 5) - hb + b.charCodeAt(i)) | 0;
    return ha - hb;
  });

  const selected = shuffled.slice(0, Math.min(sampleDocs, shuffled.length));
  const points: { docId: string; pov: string; category: string; verbatim: string; oldSentence1: string }[] = [];

  for (const file of selected) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf-8')) as SourceSummary;
      if (!data.pov_summaries) continue;

      for (const pov of POVS) {
        const kps = data.pov_summaries[pov]?.key_points;
        if (!kps) continue;
        for (const kp of kps) {
          if (!kp.verbatim || kp.verbatim.length < 20 || !kp.point) continue;
          const firstSentence = kp.point.split(/(?<=[.!?])\s+/)[0] ?? kp.point;
          points.push({
            docId: data.doc_id,
            pov,
            category: kp.category ?? 'unknown',
            verbatim: kp.verbatim,
            oldSentence1: firstSentence,
          });
        }
      }
    } catch { /* skip malformed */ }
  }

  return points;
}

// ── Main ────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let sampleDocs = 20;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--sample') sampleDocs = parseInt(args[++i]) || 20;
  }

  const apiKey = getApiKey();
  if (!fs.existsSync(RESULTS_DIR)) fs.mkdirSync(RESULTS_DIR, { recursive: true });

  console.log('\n── Sentence 1 Fidelity Validation (t/381) ──\n');

  const points = loadSamplePoints(sampleDocs);
  console.log(`Loaded ${points.length} (verbatim, point) pairs from ${sampleDocs} docs`);

  // Limit to manageable size — take up to 200 points
  const toProcess = points.slice(0, 200);
  console.log(`Processing: ${toProcess.length} pairs`);
  console.log('Phase 1: Generating new sentence 1s with fidelity instruction...\n');

  const results: ValidationResult[] = [];
  let completed = 0;
  let errors = 0;

  for (let i = 0; i < toProcess.length; i += 5) {
    const batch = toProcess.slice(i, i + 5);
    const batchResults = await Promise.all(batch.map(async (p) => {
      try {
        // Phase 1: Generate new sentence 1
        const genRaw = await callGemini(buildSentence1Prompt(p.verbatim, p.pov, p.category), apiKey);
        const gen = JSON.parse(genRaw) as { sentence1: string };

        // Phase 2a: Check OLD sentence 1
        const oldCheckRaw = await callGemini(buildDistortionCheckPrompt(p.verbatim, p.oldSentence1), apiKey);
        const oldCheck = JSON.parse(oldCheckRaw) as { verdict: string; explanation: string };

        // Phase 2b: Check NEW sentence 1
        const newCheckRaw = await callGemini(buildDistortionCheckPrompt(p.verbatim, gen.sentence1), apiKey);
        const newCheck = JSON.parse(newCheckRaw) as { verdict: string; explanation: string };

        completed++;
        if (completed % 20 === 0 || completed === toProcess.length) {
          process.stdout.write(`  [${completed}/${toProcess.length}] ${errors > 0 ? `(${errors} errors) ` : ''}\r`);
        }

        return {
          doc_id: p.docId,
          pov: p.pov,
          category: p.category,
          verbatim: p.verbatim,
          old_point_sentence1: p.oldSentence1,
          new_sentence1: gen.sentence1,
          old_verdict: oldCheck.verdict as 'entailed' | 'partial' | 'not_entailed',
          new_verdict: newCheck.verdict as 'entailed' | 'partial' | 'not_entailed',
          old_explanation: oldCheck.explanation,
          new_explanation: newCheck.explanation,
        } satisfies ValidationResult;
      } catch (err) {
        errors++;
        return null;
      }
    }));

    for (const r of batchResults) {
      if (r) results.push(r);
    }
    if (i + 5 < toProcess.length) {
      await new Promise(resolve => setTimeout(resolve, 300));
    }
  }

  console.log(`\n\nCompleted: ${completed}, Errors: ${errors}\n`);

  // Analysis
  const oldDistortionCount = results.filter(r => r.old_verdict !== 'entailed').length;
  const newDistortionCount = results.filter(r => r.new_verdict !== 'entailed').length;
  const oldRate = results.length > 0 ? (oldDistortionCount / results.length) * 100 : 0;
  const newRate = results.length > 0 ? (newDistortionCount / results.length) * 100 : 0;

  const oldByVerdict = { entailed: 0, partial: 0, not_entailed: 0 };
  const newByVerdict = { entailed: 0, partial: 0, not_entailed: 0 };
  for (const r of results) {
    oldByVerdict[r.old_verdict]++;
    newByVerdict[r.new_verdict]++;
  }

  // Report
  const lines: string[] = [];
  lines.push('# Sentence 1 Fidelity Validation — t/381');
  lines.push('');
  lines.push(`**Date:** ${new Date().toISOString().split('T')[0]}`);
  lines.push(`**Points validated:** ${results.length}`);
  lines.push(`**Documents sampled:** ${sampleDocs}`);
  lines.push(`**Model:** ${GEMINI_MODEL}`);
  lines.push('');
  lines.push('## A/B Comparison: Old vs New Sentence 1');
  lines.push('');
  lines.push('| | Entailed | Partial | Not Entailed | Distortion Rate |');
  lines.push('|---|---|---|---|---|');
  lines.push(`| **Old** (no fidelity instruction) | ${oldByVerdict.entailed} | ${oldByVerdict.partial} | ${oldByVerdict.not_entailed} | ${oldRate.toFixed(1)}% |`);
  lines.push(`| **New** (with fidelity instruction) | ${newByVerdict.entailed} | ${newByVerdict.partial} | ${newByVerdict.not_entailed} | ${newRate.toFixed(1)}% |`);
  lines.push('');
  lines.push(`**Improvement:** ${(oldRate - newRate).toFixed(1)} percentage points`);
  lines.push('');

  // Remaining failures
  const newFailures = results
    .filter(r => r.new_verdict !== 'entailed')
    .slice(0, 10);

  if (newFailures.length > 0) {
    lines.push('## Remaining Failures (new sentence 1, up to 10)');
    lines.push('');
    for (const f of newFailures) {
      lines.push(`### ${f.doc_id} (${f.pov}, ${f.category})`);
      lines.push(`**Verbatim:** ${f.verbatim}`);
      lines.push(`**New sentence 1:** ${f.new_sentence1}`);
      lines.push(`**Problem:** ${f.new_explanation}`);
      lines.push('');
    }
  }

  // Improvements
  const improvements = results.filter(r => r.old_verdict !== 'entailed' && r.new_verdict === 'entailed');
  if (improvements.length > 0) {
    lines.push('## Sample Improvements (old distorted → new faithful, up to 5)');
    lines.push('');
    for (const imp of improvements.slice(0, 5)) {
      lines.push(`### ${imp.doc_id} (${imp.pov})`);
      lines.push(`**Verbatim:** ${imp.verbatim}`);
      lines.push(`**Old sentence 1:** ${imp.old_point_sentence1}`);
      lines.push(`**Old problem:** ${imp.old_explanation}`);
      lines.push(`**New sentence 1:** ${imp.new_sentence1} ✅`);
      lines.push('');
    }
  }

  lines.push('## Verdict');
  lines.push('');
  if (newRate <= 20) {
    lines.push(`**PASS** — New distortion rate ${newRate.toFixed(1)}% meets the <20% target (down from ${oldRate.toFixed(1)}%).`);
  } else {
    lines.push(`**FAIL** — New distortion rate ${newRate.toFixed(1)}% exceeds the <20% target (down from ${oldRate.toFixed(1)}%). Further prompt tuning needed.`);
  }

  const timestamp = Date.now();
  const report = lines.join('\n');
  const mdPath = path.join(RESULTS_DIR, `sentence1-fidelity-validation-${timestamp}.md`);
  const jsonPath = path.join(RESULTS_DIR, `sentence1-fidelity-validation-${timestamp}.json`);

  fs.writeFileSync(mdPath, report);
  fs.writeFileSync(jsonPath, JSON.stringify({ results, timestamp, oldRate, newRate }, null, 2));

  console.log(`Report: ${mdPath}`);
  console.log(`Raw data: ${jsonPath}`);
  console.log(`\n── Results ──`);
  console.log(`Old distortion rate: ${oldRate.toFixed(1)}%`);
  console.log(`New distortion rate: ${newRate.toFixed(1)}%`);
  console.log(`Improvement: ${(oldRate - newRate).toFixed(1)} pp`);
  console.log(newRate <= 20 ? '\nPASS — meets <20% target' : '\nFAIL — exceeds <20% target');
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
