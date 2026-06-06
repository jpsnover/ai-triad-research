#!/usr/bin/env tsx
/**
 * Source Extraction Gap Analysis — t/377
 *
 * Tests whether source document extraction (Invoke-DocumentSummary pipeline)
 * suffers from qualifier omission, the dominant failure mode found in
 * the FIRE gap analysis on debate statements (10.9% false-accept rate).
 *
 * Phase 1: key_points (verbatim → point entailment)
 *   - Each key_point has a `verbatim` field (exact quote) and a `point` field (paraphrase)
 *   - Run entailment check on each (verbatim, point) pair
 *   - Cross-tabulate by BDI category, POV, extraction_confidence
 *
 * Phase 2: factual_claims (no verbatim anchor — needs source documents)
 *   - Deferred to Phase 1 results; may not be needed if key_points are clean
 *
 * Prerequisites:
 *   - GEMINI_API_KEY or AI_API_KEY env var set
 *   - Source summaries in ../ai-triad-data/summaries/
 *
 * Usage:
 *   cd research/comp-linguist
 *   npx tsx scripts/source-extraction-gap-analysis.ts
 *   npx tsx scripts/source-extraction-gap-analysis.ts --max-points 100
 *   npx tsx scripts/source-extraction-gap-analysis.ts --sample 30
 *   npx tsx scripts/source-extraction-gap-analysis.ts --analyze-only results/source-*.json
 *
 * Output:
 *   results/source-extraction-gap-{timestamp}.json  — raw data
 *   results/source-extraction-gap-{timestamp}.md    — analysis report
 */

import fs from 'fs';
import path from 'path';

// ── Config ──────────────────────────────────────────────

const __dirname = path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Z]:)/, '$1');
const RESULTS_DIR = path.resolve(__dirname, '../results');
const DATA_DIR = path.resolve(__dirname, '../../../..', 'ai-triad-data/summaries');

const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';

const POVS = ['accelerationist', 'safetyist', 'skeptic'] as const;

// ── Types ───────────────────────────────────────────────

interface KeyPoint {
  stance: string;
  taxonomy_node_id: string | null;
  category: string;
  point: string;
  verbatim: string;
  excerpt_context?: string;
  extraction_confidence?: number;
  vocabulary_terms?: string[];
}

interface FactualClaim {
  claim: string;
  claim_label: string;
  doc_position: string;
  extraction_confidence?: number;
  fire_confidence?: number;
  linked_taxonomy_nodes?: string[];
}

interface SourceSummary {
  doc_id: string;
  taxonomy_version?: string;
  generated_at?: string;
  model_info?: { model?: string };
  pov_summaries: Record<string, { key_points: KeyPoint[] }>;
  factual_claims?: FactualClaim[];
}

interface EntailmentResult {
  verdict: 'entailed' | 'partial' | 'not_entailed';
  explanation: string;
  repaired_claim: string | null;
}

interface PointAnalysis {
  doc_id: string;
  pov: string;
  category: string;
  stance: string;
  taxonomy_node_id: string | null;
  verbatim: string;
  point: string;
  extraction_confidence: number | null;
  entailment: EntailmentResult;
}

interface ExperimentConfig {
  sampleSize: number;
  maxPoints: number;
  concurrency: number;
  analyzeOnly?: string[];
}

// ── CLI arg parsing ─────────────────────────────────────

function parseArgs(): ExperimentConfig {
  const args = process.argv.slice(2);
  const config: ExperimentConfig = {
    sampleSize: 30,
    maxPoints: 0,
    concurrency: 5,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--sample':
        config.sampleSize = parseInt(args[++i]) || 30;
        break;
      case '--max-points':
        config.maxPoints = parseInt(args[++i]) || 0;
        break;
      case '--concurrency':
        config.concurrency = Math.max(1, parseInt(args[++i]) || 5);
        break;
      case '--analyze-only':
        config.analyzeOnly = args.slice(i + 1);
        i = args.length;
        break;
      case '--help':
        printUsage();
        process.exit(0);
    }
  }

  return config;
}

function printUsage(): void {
  console.log(`
Source Extraction Gap Analysis (t/377)

Usage:
  npx tsx scripts/source-extraction-gap-analysis.ts [options]

Options:
  --sample <n>            Number of summary files to sample (default: 30)
  --max-points <n>        Limit total key_points analyzed (0 = all from sampled files)
  --concurrency <n>       Parallel LLM calls (default: 5)
  --analyze-only <files>  Skip LLM calls, re-analyze existing JSON results
  --help                  Show this help
`);
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

async function callGemini(prompt: string, apiKey: string): Promise<EntailmentResult> {
  const url = `${GEMINI_BASE}/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.1,
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: {
          verdict: { type: 'STRING', enum: ['entailed', 'partial', 'not_entailed'] },
          explanation: { type: 'STRING' },
          repaired_claim: { type: 'STRING' },
        },
        required: ['verdict', 'explanation'],
      },
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

  const parsed = JSON.parse(raw) as EntailmentResult;
  if (!parsed.repaired_claim || parsed.verdict === 'entailed') {
    parsed.repaired_claim = null;
  }
  return parsed;
}

function buildEntailmentPrompt(verbatim: string, point: string): string {
  return `You are a distortion judge for a document analysis system. Given an EXACT QUOTE from a source document and a PARAPHRASED POINT that was extracted from it, determine whether the paraphrase DISTORTS the factual content of the quote.

EXACT QUOTE (verbatim from the document):
"""
${verbatim}
"""

PARAPHRASED POINT (extracted by the system):
"""
${point}
"""

IMPORTANT CONTEXT: The paraphrased point is DESIGNED to be 3-6 sentences that:
  1. State what the document claims (paraphrasing the quote)
  2. Explain the evidence/reasoning the document uses
  3. Connect the claim to a political perspective (accelerationist/safetyist/skeptic)
  4. Note caveats

Sentences 2-4 are EXPECTED to add interpretive content, POV framing, and implications that go beyond the verbatim quote. This is BY DESIGN and should NOT be flagged.

YOUR TASK: Judge ONLY whether sentence 1 (the factual paraphrase) faithfully preserves the content of the verbatim quote. Specifically check for:
  - Qualifier omission: Does the paraphrase drop important conditions, exceptions, or limiting phrases from the quote?
  - Scope change: Does the paraphrase broaden or narrow the claim beyond what the quote states?
  - Factual distortion: Does the paraphrase misrepresent what the quote says?
  - Content omission: Does the paraphrase skip a major assertion present in the quote?

DO NOT flag:
  - Added POV framing ("This aligns with the safetyist goal of...")
  - Added implications or interpretive context in later sentences
  - Reasonable paraphrasing that preserves meaning
  - Using different words to express the same idea

Verdicts:
  - "entailed": The factual content of the quote is faithfully preserved in the paraphrase. POV additions are fine.
  - "partial": The paraphrase omits an important qualifier, changes scope, or drops a key assertion from the quote.
  - "not_entailed": The paraphrase fundamentally misrepresents what the quote says.

If "partial" or "not_entailed", provide a MINIMAL repair to the point's first sentence to fix the distortion. Keep the POV framing sentences unchanged.

Respond in JSON: {"verdict": "...", "explanation": "...", "repaired_claim": "..." or null}`;
}

// ── Data Loading ────────────────────────────────────────

function loadSummaryFiles(sampleSize: number): SourceSummary[] {
  if (!fs.existsSync(DATA_DIR)) {
    console.error(`Data directory not found: ${DATA_DIR}`);
    process.exit(1);
  }

  const allFiles = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.json'));
  console.log(`Found ${allFiles.length} summary files in ${DATA_DIR}`);

  // Deterministic shuffle using file name hash for reproducibility
  const shuffled = [...allFiles].sort((a, b) => {
    const ha = simpleHash(a);
    const hb = simpleHash(b);
    return ha - hb;
  });

  const selected = shuffled.slice(0, Math.min(sampleSize, shuffled.length));
  console.log(`Sampled ${selected.length} files`);

  const summaries: SourceSummary[] = [];
  for (const file of selected) {
    try {
      const raw = fs.readFileSync(path.join(DATA_DIR, file), 'utf-8');
      const data = JSON.parse(raw) as SourceSummary;
      if (data.pov_summaries) {
        summaries.push(data);
      }
    } catch {
      console.warn(`  Skipping malformed: ${file}`);
    }
  }

  return summaries;
}

function simpleHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return h;
}

// ── Data Extraction ─────────────────────────────────────

interface PointPair {
  docId: string;
  pov: string;
  category: string;
  stance: string;
  taxonomyNodeId: string | null;
  verbatim: string;
  point: string;
  extractionConfidence: number | null;
}

function extractPointPairs(summaries: SourceSummary[]): PointPair[] {
  const pairs: PointPair[] = [];

  for (const summary of summaries) {
    for (const pov of POVS) {
      const povData = summary.pov_summaries[pov];
      if (!povData?.key_points) continue;

      for (const kp of povData.key_points) {
        if (!kp.verbatim || !kp.point) continue;
        // Skip entries with placeholder or very short verbatim
        if (kp.verbatim.length < 20) continue;

        pairs.push({
          docId: summary.doc_id,
          pov,
          category: kp.category ?? 'unknown',
          stance: kp.stance ?? 'unknown',
          taxonomyNodeId: kp.taxonomy_node_id ?? null,
          verbatim: kp.verbatim,
          point: kp.point,
          extractionConfidence: kp.extraction_confidence ?? null,
        });
      }
    }
  }

  return pairs;
}

// ── Confidence bucket analysis ──────────────────────────

function confidenceBucket(conf: number | null): string {
  if (conf == null) return 'missing';
  if (conf >= 0.95) return '0.95-1.00';
  if (conf >= 0.90) return '0.90-0.94';
  if (conf >= 0.80) return '0.80-0.89';
  if (conf >= 0.70) return '0.70-0.79';
  return '<0.70';
}

// ── Experiment Runner ───────────────────────────────────

async function runExperiment(config: ExperimentConfig): Promise<PointAnalysis[]> {
  const apiKey = getApiKey();

  console.log('\n── Source Extraction Gap Analysis (t/377) ──\n');

  const summaries = loadSummaryFiles(config.sampleSize);
  let allPairs = extractPointPairs(summaries);

  console.log(`Total (verbatim, point) pairs: ${allPairs.length}`);

  // Field audit: extraction_confidence population
  const withConfidence = allPairs.filter(p => p.extractionConfidence != null);
  const withoutConfidence = allPairs.filter(p => p.extractionConfidence == null);
  console.log(`\nextraction_confidence populated: ${withConfidence.length}/${allPairs.length} (${((withConfidence.length / allPairs.length) * 100).toFixed(1)}%)`);
  if (withoutConfidence.length > 0) {
    const missingDocs = [...new Set(withoutConfidence.map(p => p.docId))];
    console.log(`  Missing in ${missingDocs.length} docs`);
  }

  if (config.maxPoints > 0 && allPairs.length > config.maxPoints) {
    console.log(`\nLimiting to ${config.maxPoints} points (from ${allPairs.length})`);
    allPairs = allPairs.slice(0, config.maxPoints);
  }

  console.log(`Concurrency: ${config.concurrency}`);
  console.log('Running entailment checks...\n');

  const results: PointAnalysis[] = [];
  let completed = 0;
  let errors = 0;

  async function processPair(pair: PointPair): Promise<PointAnalysis | null> {
    const prompt = buildEntailmentPrompt(pair.verbatim, pair.point);

    try {
      const entailment = await callGemini(prompt, apiKey);
      completed++;
      if (completed % 20 === 0 || completed === allPairs.length) {
        process.stdout.write(`  [${completed}/${allPairs.length}] ${errors > 0 ? `(${errors} errors) ` : ''}\r`);
      }

      return {
        doc_id: pair.docId,
        pov: pair.pov,
        category: pair.category,
        stance: pair.stance,
        taxonomy_node_id: pair.taxonomyNodeId,
        verbatim: pair.verbatim,
        point: pair.point.slice(0, 800),
        extraction_confidence: pair.extractionConfidence,
        entailment,
      };
    } catch (err) {
      errors++;
      console.error(`  Error on ${pair.docId}/${pair.pov}: ${(err as Error).message.slice(0, 100)}`);
      return null;
    }
  }

  for (let i = 0; i < allPairs.length; i += config.concurrency) {
    const batch = allPairs.slice(i, i + config.concurrency);
    const batchResults = await Promise.all(batch.map(processPair));
    for (const r of batchResults) {
      if (r) results.push(r);
    }
    if (i + config.concurrency < allPairs.length) {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }

  console.log(`\n\nCompleted: ${completed}, Errors: ${errors}\n`);
  return results;
}

// ── Analysis ────────────────────────────────────────────

interface VerdictBucket {
  total: number;
  entailed: number;
  partial: number;
  not_entailed: number;
}

interface AnalysisSummary {
  total_points: number;
  by_verdict: Record<string, number>;
  false_accept_rate: number;
  by_pov: Record<string, VerdictBucket>;
  by_bdi: Record<string, VerdictBucket>;
  by_confidence_bucket: Record<string, VerdictBucket>;
  by_stance: Record<string, VerdictBucket>;
  confidence_field_audit: {
    populated: number;
    missing: number;
    population_rate: number;
  };
  sample_failures: PointAnalysis[];
  recommendation: string;
}

function analyze(results: PointAnalysis[]): AnalysisSummary {
  const byVerdict: Record<string, number> = { entailed: 0, partial: 0, not_entailed: 0 };
  const byPov: Record<string, VerdictBucket> = {};
  const byBdi: Record<string, VerdictBucket> = {};
  const byConfBucket: Record<string, VerdictBucket> = {};
  const byStance: Record<string, VerdictBucket> = {};

  let confPopulated = 0;
  let confMissing = 0;

  for (const r of results) {
    const v = r.entailment.verdict;
    byVerdict[v] = (byVerdict[v] ?? 0) + 1;

    // By POV
    if (!byPov[r.pov]) byPov[r.pov] = { total: 0, entailed: 0, partial: 0, not_entailed: 0 };
    byPov[r.pov].total++;
    byPov[r.pov][v]++;

    // By BDI
    const bdi = r.category?.toLowerCase() ?? 'unknown';
    if (!byBdi[bdi]) byBdi[bdi] = { total: 0, entailed: 0, partial: 0, not_entailed: 0 };
    byBdi[bdi].total++;
    byBdi[bdi][v]++;

    // By confidence bucket
    const cb = confidenceBucket(r.extraction_confidence);
    if (!byConfBucket[cb]) byConfBucket[cb] = { total: 0, entailed: 0, partial: 0, not_entailed: 0 };
    byConfBucket[cb].total++;
    byConfBucket[cb][v]++;

    // By stance
    if (!byStance[r.stance]) byStance[r.stance] = { total: 0, entailed: 0, partial: 0, not_entailed: 0 };
    byStance[r.stance].total++;
    byStance[r.stance][v]++;

    // Confidence audit
    if (r.extraction_confidence != null) confPopulated++;
    else confMissing++;
  }

  const totalFalseAccept = (byVerdict.partial ?? 0) + (byVerdict.not_entailed ?? 0);
  const falseAcceptRate = results.length > 0 ? totalFalseAccept / results.length : 0;

  // Sample failures sorted by extraction_confidence descending (high-confidence failures are most interesting)
  const failures = results
    .filter(r => r.entailment.verdict !== 'entailed')
    .sort((a, b) => (b.extraction_confidence ?? 0) - (a.extraction_confidence ?? 0))
    .slice(0, 10);

  // Recommendation
  let recommendation: string;
  if (falseAcceptRate < 0.05) {
    recommendation = `False-accept rate ${(falseAcceptRate * 100).toFixed(1)}%. Source extraction is faithful. No entailment post-pass needed for the summarization pipeline.`;
  } else if (falseAcceptRate <= 0.15) {
    recommendation = `False-accept rate ${(falseAcceptRate * 100).toFixed(1)}%. Consider sampled entailment verification for source extraction (matching the debate pipeline approach from t/372).`;
  } else {
    recommendation = `False-accept rate ${(falseAcceptRate * 100).toFixed(1)}%. Source extraction has a significant faithfulness problem. Entailment verification should be added to the summarization pipeline.`;
  }

  return {
    total_points: results.length,
    by_verdict: byVerdict,
    false_accept_rate: falseAcceptRate,
    by_pov: byPov,
    by_bdi: byBdi,
    by_confidence_bucket: byConfBucket,
    by_stance: byStance,
    confidence_field_audit: {
      populated: confPopulated,
      missing: confMissing,
      population_rate: results.length > 0 ? confPopulated / results.length : 0,
    },
    sample_failures: failures,
    recommendation,
  };
}

// ── Report Generation ───────────────────────────────────

function generateReport(summary: AnalysisSummary, results: PointAnalysis[], docsSampled: number): string {
  const lines: string[] = [];

  lines.push('# Source Extraction Gap Analysis — Experiment Report');
  lines.push('');
  lines.push(`**Date:** ${new Date().toISOString().split('T')[0]}`);
  lines.push(`**Key points analyzed:** ${summary.total_points}`);
  lines.push(`**Source summaries sampled:** ${docsSampled}`);
  lines.push(`**Model:** ${GEMINI_MODEL}`);
  lines.push(`**Ticket:** t/377`);
  lines.push('');

  // 1. Overall verdict
  lines.push('## 1. Overall Entailment Verdict');
  lines.push('');
  lines.push('| Verdict | Count | Rate |');
  lines.push('|---------|-------|------|');
  for (const v of ['entailed', 'partial', 'not_entailed']) {
    const count = summary.by_verdict[v] ?? 0;
    const rate = summary.total_points > 0 ? ((count / summary.total_points) * 100).toFixed(1) : '0.0';
    lines.push(`| ${v} | ${count} | ${rate}% |`);
  }
  lines.push('');
  lines.push(`**False-accept rate (partial + not_entailed):** ${(summary.false_accept_rate * 100).toFixed(1)}%`);
  lines.push('');

  // 2. By POV
  lines.push('## 2. By POV (Lens)');
  lines.push('');
  lines.push('| POV | Total | Entailed | Partial | Not Entailed | FA Rate |');
  lines.push('|-----|-------|----------|---------|--------------|---------|');
  for (const [pov, b] of Object.entries(summary.by_pov).sort((a, b) => a[0].localeCompare(b[0]))) {
    const faRate = b.total > 0 ? (((b.partial + b.not_entailed) / b.total) * 100).toFixed(1) : '0.0';
    lines.push(`| ${pov.charAt(0).toUpperCase() + pov.slice(1)} | ${b.total} | ${b.entailed} | ${b.partial} | ${b.not_entailed} | ${faRate}% |`);
  }
  lines.push('');

  // 3. By BDI
  lines.push('## 3. By BDI Category');
  lines.push('');
  lines.push('| Category | Total | Entailed | Partial | Not Entailed | FA Rate |');
  lines.push('|----------|-------|----------|---------|--------------|---------|');
  for (const [cat, b] of Object.entries(summary.by_bdi).sort((a, b) => a[0].localeCompare(b[0]))) {
    const faRate = b.total > 0 ? (((b.partial + b.not_entailed) / b.total) * 100).toFixed(1) : '0.0';
    lines.push(`| ${cat} | ${b.total} | ${b.entailed} | ${b.partial} | ${b.not_entailed} | ${faRate}% |`);
  }
  lines.push('');

  // 4. By extraction_confidence bucket
  lines.push('## 4. By extraction_confidence Bucket');
  lines.push('');
  lines.push('| Confidence | Total | Entailed | Partial | Not Entailed | FA Rate |');
  lines.push('|------------|-------|----------|---------|--------------|---------|');
  const bucketOrder = ['0.95-1.00', '0.90-0.94', '0.80-0.89', '0.70-0.79', '<0.70', 'missing'];
  for (const bucket of bucketOrder) {
    const b = summary.by_confidence_bucket[bucket];
    if (!b) continue;
    const faRate = b.total > 0 ? (((b.partial + b.not_entailed) / b.total) * 100).toFixed(1) : '0.0';
    lines.push(`| ${bucket} | ${b.total} | ${b.entailed} | ${b.partial} | ${b.not_entailed} | ${faRate}% |`);
  }
  lines.push('');

  // 5. Confidence field audit
  lines.push('## 5. extraction_confidence Field Audit');
  lines.push('');
  lines.push(`- Populated: ${summary.confidence_field_audit.populated}/${summary.total_points} (${(summary.confidence_field_audit.population_rate * 100).toFixed(1)}%)`);
  lines.push(`- Missing: ${summary.confidence_field_audit.missing}`);
  lines.push('');

  // 6. By stance
  lines.push('## 6. By Stance');
  lines.push('');
  lines.push('| Stance | Total | Entailed | Partial | Not Entailed | FA Rate |');
  lines.push('|--------|-------|----------|---------|--------------|---------|');
  for (const [stance, b] of Object.entries(summary.by_stance).sort((a, b) => b[1].total - a[1].total)) {
    const faRate = b.total > 0 ? (((b.partial + b.not_entailed) / b.total) * 100).toFixed(1) : '0.0';
    lines.push(`| ${stance} | ${b.total} | ${b.entailed} | ${b.partial} | ${b.not_entailed} | ${faRate}% |`);
  }
  lines.push('');

  // 7. Sample failures
  lines.push('## 7. Sample Failures (up to 10, sorted by extraction_confidence descending)');
  lines.push('');
  if (summary.sample_failures.length === 0) {
    lines.push('No failures found.');
  } else {
    for (const f of summary.sample_failures) {
      lines.push(`### ${f.doc_id} (${f.pov}, ${f.category}, conf: ${f.extraction_confidence ?? 'N/A'}, verdict: ${f.entailment.verdict})`);
      lines.push('');
      lines.push(`**Verbatim:** ${f.verbatim}`);
      lines.push('');
      lines.push(`**Point:** ${f.point}`);
      lines.push('');
      lines.push(`**Problem:** ${f.entailment.explanation}`);
      lines.push('');
      if (f.entailment.repaired_claim) {
        lines.push(`**Repaired:** ${f.entailment.repaired_claim}`);
        lines.push('');
      }
      lines.push('---');
      lines.push('');
    }
  }

  // 8. Recommendation
  lines.push('## 8. Recommendation');
  lines.push('');
  lines.push(`**${summary.recommendation}**`);
  lines.push('');
  lines.push('### Decision criteria applied:');
  lines.push('- False-accept rate <5% → source extraction is faithful, no action needed');
  lines.push('- False-accept rate 5-15% → consider sampled entailment verification');
  lines.push('- False-accept rate >15% → entailment verification needed for summarization pipeline');
  lines.push('');

  return lines.join('\n');
}

// ── Main ────────────────────────────────────────────────

async function main(): Promise<void> {
  const config = parseArgs();

  if (!fs.existsSync(RESULTS_DIR)) {
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
  }

  let results: PointAnalysis[];
  let docsSampled: number;

  if (config.analyzeOnly && config.analyzeOnly.length > 0) {
    console.log('\n── Analyze-only mode ──\n');
    results = [];
    for (const file of config.analyzeOnly) {
      const filePath = path.isAbsolute(file) ? file : path.resolve(process.cwd(), file);
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      if (Array.isArray(data.results)) {
        results.push(...data.results);
      } else if (Array.isArray(data)) {
        results.push(...data);
      }
    }
    docsSampled = new Set(results.map(r => r.doc_id)).size;
    console.log(`Loaded ${results.length} results from ${config.analyzeOnly.length} file(s)`);
  } else {
    const summaries = loadSummaryFiles(config.sampleSize);
    docsSampled = summaries.length;
    const allPairs = extractPointPairs(summaries);

    let pairsToProcess = allPairs;
    if (config.maxPoints > 0 && allPairs.length > config.maxPoints) {
      console.log(`\nLimiting to ${config.maxPoints} points (from ${allPairs.length})`);
      pairsToProcess = allPairs.slice(0, config.maxPoints);
    }

    // Run the experiment directly with the pairs
    const apiKey = getApiKey();
    console.log(`\nTotal (verbatim, point) pairs: ${pairsToProcess.length}`);
    console.log(`Concurrency: ${config.concurrency}`);
    console.log('Running entailment checks...\n');

    results = [];
    let completed = 0;
    let errors = 0;

    async function processPair(pair: PointPair): Promise<PointAnalysis | null> {
      const prompt = buildEntailmentPrompt(pair.verbatim, pair.point);
      try {
        const entailment = await callGemini(prompt, apiKey);
        completed++;
        if (completed % 20 === 0 || completed === pairsToProcess.length) {
          process.stdout.write(`  [${completed}/${pairsToProcess.length}] ${errors > 0 ? `(${errors} errors) ` : ''}\r`);
        }
        return {
          doc_id: pair.docId,
          pov: pair.pov,
          category: pair.category,
          stance: pair.stance,
          taxonomy_node_id: pair.taxonomyNodeId,
          verbatim: pair.verbatim,
          point: pair.point.slice(0, 800),
          extraction_confidence: pair.extractionConfidence,
          entailment,
        };
      } catch (err) {
        errors++;
        console.error(`  Error on ${pair.docId}/${pair.pov}: ${(err as Error).message.slice(0, 100)}`);
        return null;
      }
    }

    for (let i = 0; i < pairsToProcess.length; i += config.concurrency) {
      const batch = pairsToProcess.slice(i, i + config.concurrency);
      const batchResults = await Promise.all(batch.map(processPair));
      for (const r of batchResults) {
        if (r) results.push(r);
      }
      if (i + config.concurrency < pairsToProcess.length) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }

    console.log(`\n\nCompleted: ${completed}, Errors: ${errors}\n`);
  }

  // Save raw results
  const timestamp = Date.now();
  const jsonPath = path.join(RESULTS_DIR, `source-extraction-gap-${timestamp}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify({ config, results, timestamp }, null, 2));
  console.log(`Raw results: ${jsonPath}`);

  // Analyze and report
  const summary = analyze(results);
  const report = generateReport(summary, results, docsSampled);

  const mdPath = path.join(RESULTS_DIR, `source-extraction-gap-${timestamp}.md`);
  fs.writeFileSync(mdPath, report);
  console.log(`Report: ${mdPath}`);

  // Print summary to console
  console.log('\n── Summary ──');
  console.log(`Total points: ${summary.total_points}`);
  console.log(`False-accept rate: ${(summary.false_accept_rate * 100).toFixed(1)}%`);
  console.log(`  entailed: ${summary.by_verdict.entailed ?? 0}`);
  console.log(`  partial: ${summary.by_verdict.partial ?? 0}`);
  console.log(`  not_entailed: ${summary.by_verdict.not_entailed ?? 0}`);
  console.log(`\n${summary.recommendation}`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
