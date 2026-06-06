#!/usr/bin/env tsx
/**
 * FIRE Gap Analysis Experiment
 *
 * Tests whether FIRE's word-overlap grounding misses entailment problems
 * that matter for downstream quality (crux registry, taxonomy alignment).
 *
 * Design (approved by TL, e/5#2):
 *   - Extract (statement, claim, overlap_pct) triples from existing debates
 *   - Run LLM entailment+repair prompt on each pair
 *   - Cross-tabulate entailment verdict vs. FIRE overlap bucket
 *   - Analyze confidence-capped nodes as a separate category
 *   - Report false-accept rate (FIRE passes, LLM says unfaithful)
 *
 * Success criteria (weighted by downstream impact per TL guidance):
 *   - False-accept <5% → shelve t/372
 *   - False-accept 5-15% → sampled post-pass (30% of turns)
 *   - False-accept >15% → entailment check every turn
 *
 * Prerequisites:
 *   - GEMINI_API_KEY or AI_API_KEY env var set
 *   - Debate data in ../ai-triad-data/debates/
 *
 * Usage:
 *   cd research/comp-linguist
 *   npx tsx scripts/fire-gap-analysis.ts
 *   npx tsx scripts/fire-gap-analysis.ts --debates cal-batch-01,cal-batch-02
 *   npx tsx scripts/fire-gap-analysis.ts --max-claims 50
 *   npx tsx scripts/fire-gap-analysis.ts --analyze-only results/fire-gap-*.json
 *
 * Output:
 *   results/fire-gap-analysis-{timestamp}.json  — raw data
 *   results/fire-gap-analysis-{timestamp}.md    — analysis report
 *
 * Ticket: t/372 (gated on experiment outcome)
 */

import fs from 'fs';
import path from 'path';

// ── Config ──────────────────────────────────────────────

const __dirname = path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Z]:)/, '$1');
const REPO_ROOT = path.resolve(__dirname, '../../..');
const RESULTS_DIR = path.resolve(__dirname, '../results');
const DATA_DIR = path.resolve(REPO_ROOT, '../ai-triad-data/debates');

const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';

const DEFAULT_DEBATE_PREFIXES = [
  'cal-batch-01-safety-sharing',
  'cal-batch-02-compute-governance',
  'cal-batch-03-open-source-risk',
  'cal-batch-04-kill-switches',
  'cal-batch-05-differential-dev',
];

// ── Types ───────────────────────────────────────────────

interface AcceptedClaim {
  text: string;
  id: string;
  overlap_pct: number;
}

interface RejectedClaim {
  text: string;
  reason: string;
  overlap_pct: number;
}

interface DiagnosticsEntry {
  extracted_claims?: {
    accepted: AcceptedClaim[];
    rejected: RejectedClaim[];
  };
  [key: string]: unknown;
}

interface TranscriptEntry {
  id: string;
  speaker: string;
  content: string;
  type: string;
  metadata?: {
    my_claims?: { claim: string; targets: string[] }[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

interface ANNode {
  id: string;
  text: string;
  speaker: string;
  source_entry_id: string;
  extraction_confidence?: number;
  bdi_category?: string;
  [key: string]: unknown;
}

interface EntailmentResult {
  verdict: 'entailed' | 'partial' | 'not_entailed';
  explanation: string;
  repaired_claim: string | null;
}

interface ClaimAnalysis {
  debate_prefix: string;
  debate_id: string;
  entry_id: string;
  an_node_id: string;
  speaker: string;
  statement: string;
  claim_text: string;
  overlap_pct: number;
  fire_bucket: string;
  fire_confidence_cap: number;
  original_confidence?: number;
  was_capped: boolean;
  entailment: EntailmentResult;
  bdi_category?: string;
}

interface ExperimentConfig {
  debatePrefixes: string[];
  maxClaims: number;
  analyzeOnly?: string[];
  concurrency: number;
}

// ── CLI arg parsing ─────────────────────────────────────

function parseArgs(): ExperimentConfig {
  const args = process.argv.slice(2);
  const config: ExperimentConfig = {
    debatePrefixes: DEFAULT_DEBATE_PREFIXES,
    maxClaims: 0,
    concurrency: 5,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--debates':
        config.debatePrefixes = args[++i].split(',').map(s => s.trim());
        break;
      case '--max-claims':
        config.maxClaims = parseInt(args[++i]) || 0;
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
FIRE Gap Analysis Experiment

Usage:
  npx tsx scripts/fire-gap-analysis.ts [options]

Options:
  --debates <list>        Comma-separated debate prefixes (default: cal-batch-01..05)
  --max-claims <n>        Limit total claims analyzed (0 = all)
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

function buildEntailmentPrompt(statement: string, claim: string): string {
  return `You are an entailment judge for a debate system. Given a debater's STATEMENT and an extracted CLAIM, determine whether the claim is faithfully entailed by the statement.

STATEMENT:
"""
${statement}
"""

CLAIM:
"""
${claim}
"""

Instructions:
1. Judge whether the CLAIM is entailed by the STATEMENT:
   - "entailed": The claim accurately captures information present in the statement. Paraphrasing is fine if meaning is preserved.
   - "partial": The claim captures some information from the statement but adds, omits, or distorts key details (e.g., invents specifics not stated, drops important qualifiers, changes scope).
   - "not_entailed": The claim asserts something not present in or contradicted by the statement.

2. If the verdict is "partial" or "not_entailed", provide a MINIMAL repair — the smallest edit to the claim text that makes it faithfully entailed. Preserve the original wording as much as possible. If the claim is entirely fabricated, write a new claim that captures the closest idea actually present in the statement.

3. Write a one-sentence explanation of what specifically is wrong (for partial/not_entailed) or right (for entailed).

Respond in JSON: {"verdict": "...", "explanation": "...", "repaired_claim": "..." or null}`;
}

// ── Data Loading ────────────────────────────────────────

function loadDiagnostics(prefix: string): { debateId: string; entries: Record<string, DiagnosticsEntry> } | null {
  const diagPath = path.join(DATA_DIR, `${prefix}-diagnostics.json`);
  if (!fs.existsSync(diagPath)) {
    console.warn(`  Diagnostics not found: ${prefix}`);
    return null;
  }
  const data = JSON.parse(fs.readFileSync(diagPath, 'utf-8'));
  return { debateId: data.debate_id, entries: data.entries };
}

function loadDebate(debateId: string): { transcript: TranscriptEntry[]; nodes: ANNode[] } | null {
  const debatePath = path.join(DATA_DIR, `debate-${debateId}.json`);
  if (!fs.existsSync(debatePath)) {
    console.warn(`  Debate file not found: debate-${debateId}.json`);
    return null;
  }
  const data = JSON.parse(fs.readFileSync(debatePath, 'utf-8'));
  return {
    transcript: data.transcript ?? [],
    nodes: data.argument_network?.nodes ?? [],
  };
}

function fireBucket(overlapPct: number): string {
  if (overlapPct >= 90) return '90-100';
  if (overlapPct >= 70) return '70-89';
  if (overlapPct >= 50) return '50-69';
  if (overlapPct >= 30) return '30-49';
  return '0-29';
}

function fireConfidenceCap(overlapPct: number): number {
  if (overlapPct >= 70) return 1.0;
  if (overlapPct >= 50) return 0.8;
  if (overlapPct >= 30) return 0.6;
  return 0.5;
}

// ── Data Extraction ─────────────────────────────────────

interface ClaimPair {
  debatePrefix: string;
  debateId: string;
  entryId: string;
  anNodeId: string;
  speaker: string;
  statement: string;
  claimText: string;
  overlapPct: number;
  originalConfidence?: number;
  bdiCategory?: string;
}

function extractClaimPairs(prefix: string): ClaimPair[] {
  const diag = loadDiagnostics(prefix);
  if (!diag) return [];

  const debate = loadDebate(diag.debateId);
  if (!debate) return [];

  const transcriptMap = new Map<string, TranscriptEntry>();
  for (const entry of debate.transcript) {
    transcriptMap.set(entry.id, entry);
  }

  const nodeMap = new Map<string, ANNode>();
  for (const node of debate.nodes) {
    nodeMap.set(node.id, node);
  }

  const pairs: ClaimPair[] = [];

  for (const [entryId, diagEntry] of Object.entries(diag.entries)) {
    if (!diagEntry.extracted_claims?.accepted) continue;

    const transcriptEntry = transcriptMap.get(entryId);
    if (!transcriptEntry || !transcriptEntry.content) continue;
    if (transcriptEntry.type === 'system' || transcriptEntry.type === 'moderator') continue;

    for (const accepted of diagEntry.extracted_claims.accepted) {
      const anNode = nodeMap.get(accepted.id);

      pairs.push({
        debatePrefix: prefix,
        debateId: diag.debateId,
        entryId,
        anNodeId: accepted.id,
        speaker: anNode?.speaker ?? transcriptEntry.speaker ?? 'unknown',
        statement: transcriptEntry.content,
        claimText: accepted.text,
        overlapPct: accepted.overlap_pct,
        originalConfidence: anNode?.extraction_confidence,
        bdiCategory: anNode?.bdi_category,
      });
    }
  }

  return pairs;
}

// ── Experiment Runner ───────────────────────────────────

async function runExperiment(config: ExperimentConfig): Promise<ClaimAnalysis[]> {
  const apiKey = getApiKey();

  console.log('\n── FIRE Gap Analysis Experiment ──\n');
  console.log(`Debates: ${config.debatePrefixes.join(', ')}`);

  let allPairs: ClaimPair[] = [];
  for (const prefix of config.debatePrefixes) {
    const pairs = extractClaimPairs(prefix);
    console.log(`  ${prefix}: ${pairs.length} claim pairs`);
    allPairs.push(...pairs);
  }

  if (config.maxClaims > 0 && allPairs.length > config.maxClaims) {
    console.log(`\nLimiting to ${config.maxClaims} claims (from ${allPairs.length})`);
    allPairs = allPairs.slice(0, config.maxClaims);
  }

  console.log(`\nTotal claim pairs: ${allPairs.length}`);
  console.log(`Concurrency: ${config.concurrency}`);
  console.log('Running entailment checks...\n');

  const results: ClaimAnalysis[] = [];
  let completed = 0;
  let errors = 0;

  async function processPair(pair: ClaimPair): Promise<ClaimAnalysis | null> {
    const prompt = buildEntailmentPrompt(pair.statement, pair.claimText);
    const cap = fireConfidenceCap(pair.overlapPct);
    const wasCapped = pair.originalConfidence != null && pair.originalConfidence > cap;

    try {
      const entailment = await callGemini(prompt, apiKey);
      completed++;
      if (completed % 20 === 0 || completed === allPairs.length) {
        process.stdout.write(`  [${completed}/${allPairs.length}] ${errors > 0 ? `(${errors} errors) ` : ''}\r`);
      }

      return {
        debate_prefix: pair.debatePrefix,
        debate_id: pair.debateId,
        entry_id: pair.entryId,
        an_node_id: pair.anNodeId,
        speaker: pair.speaker,
        statement: pair.statement.slice(0, 500),
        claim_text: pair.claimText,
        overlap_pct: pair.overlapPct,
        fire_bucket: fireBucket(pair.overlapPct),
        fire_confidence_cap: cap,
        original_confidence: pair.originalConfidence,
        was_capped: wasCapped,
        entailment,
        bdi_category: pair.bdiCategory,
      };
    } catch (err) {
      errors++;
      console.error(`  Error on ${pair.anNodeId}: ${(err as Error).message.slice(0, 100)}`);
      return null;
    }
  }

  // Process in batches for rate limiting
  for (let i = 0; i < allPairs.length; i += config.concurrency) {
    const batch = allPairs.slice(i, i + config.concurrency);
    const batchResults = await Promise.all(batch.map(processPair));
    for (const r of batchResults) {
      if (r) results.push(r);
    }
    // Brief pause between batches to respect rate limits
    if (i + config.concurrency < allPairs.length) {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }

  console.log(`\n\nCompleted: ${completed}, Errors: ${errors}\n`);
  return results;
}

// ── Analysis ────────────────────────────────────────────

interface AnalysisSummary {
  total_claims: number;
  by_verdict: Record<string, number>;
  by_bucket: Record<string, { total: number; entailed: number; partial: number; not_entailed: number }>;
  false_accept_rate: number;
  false_accept_by_bucket: Record<string, number>;
  confidence_cap_analysis: {
    total_capped: number;
    capped_entailed: number;
    capped_not_entailed: number;
    cap_accuracy: number;
  };
  by_speaker: Record<string, { total: number; entailed: number; partial: number; not_entailed: number }>;
  by_bdi: Record<string, { total: number; entailed: number; partial: number; not_entailed: number }>;
  recommendation: string;
  sample_failures: ClaimAnalysis[];
}

function analyze(results: ClaimAnalysis[]): AnalysisSummary {
  const byVerdict: Record<string, number> = { entailed: 0, partial: 0, not_entailed: 0 };
  const byBucket: Record<string, { total: number; entailed: number; partial: number; not_entailed: number }> = {};
  const bySpeaker: Record<string, { total: number; entailed: number; partial: number; not_entailed: number }> = {};
  const byBdi: Record<string, { total: number; entailed: number; partial: number; not_entailed: number }> = {};

  let totalCapped = 0;
  let cappedEntailed = 0;
  let cappedNotEntailed = 0;

  for (const r of results) {
    const v = r.entailment.verdict;
    byVerdict[v] = (byVerdict[v] ?? 0) + 1;

    // By overlap bucket
    if (!byBucket[r.fire_bucket]) {
      byBucket[r.fire_bucket] = { total: 0, entailed: 0, partial: 0, not_entailed: 0 };
    }
    byBucket[r.fire_bucket].total++;
    byBucket[r.fire_bucket][v]++;

    // By speaker
    if (!bySpeaker[r.speaker]) {
      bySpeaker[r.speaker] = { total: 0, entailed: 0, partial: 0, not_entailed: 0 };
    }
    bySpeaker[r.speaker].total++;
    bySpeaker[r.speaker][v]++;

    // By BDI
    const bdi = r.bdi_category ?? 'unknown';
    if (!byBdi[bdi]) {
      byBdi[bdi] = { total: 0, entailed: 0, partial: 0, not_entailed: 0 };
    }
    byBdi[bdi].total++;
    byBdi[bdi][v]++;

    // Confidence cap analysis
    if (r.was_capped) {
      totalCapped++;
      if (v === 'entailed') cappedEntailed++;
      if (v === 'partial' || v === 'not_entailed') cappedNotEntailed++;
    }
  }

  const falseAccepts = (byVerdict.partial ?? 0) + (byVerdict.not_entailed ?? 0);
  const falseAcceptRate = results.length > 0 ? falseAccepts / results.length : 0;

  const falseAcceptByBucket: Record<string, number> = {};
  for (const [bucket, stats] of Object.entries(byBucket)) {
    const fa = stats.partial + stats.not_entailed;
    falseAcceptByBucket[bucket] = stats.total > 0 ? fa / stats.total : 0;
  }

  let recommendation: string;
  if (falseAcceptRate < 0.05) {
    recommendation = 'FIRE is sufficient. False-accept rate <5%. Shelve t/372.';
  } else if (falseAcceptRate < 0.15) {
    recommendation = `False-accept rate ${(falseAcceptRate * 100).toFixed(1)}%. Add entailment-and-repair as a sampled post-pass (30% of turns).`;
  } else {
    recommendation = `False-accept rate ${(falseAcceptRate * 100).toFixed(1)}%. Add entailment-and-repair to every turn.`;
  }

  const failures = results
    .filter(r => r.entailment.verdict !== 'entailed')
    .sort((a, b) => a.overlap_pct - b.overlap_pct)
    .slice(0, 10);

  return {
    total_claims: results.length,
    by_verdict: byVerdict,
    by_bucket: byBucket,
    false_accept_rate: falseAcceptRate,
    false_accept_by_bucket: falseAcceptByBucket,
    confidence_cap_analysis: {
      total_capped: totalCapped,
      capped_entailed: cappedEntailed,
      capped_not_entailed: cappedNotEntailed,
      cap_accuracy: totalCapped > 0 ? cappedNotEntailed / totalCapped : 0,
    },
    by_speaker: bySpeaker,
    by_bdi: byBdi,
    recommendation,
    sample_failures: failures,
  };
}

// ── Report Generation ───────────────────────────────────

function generateReport(summary: AnalysisSummary, results: ClaimAnalysis[]): string {
  const lines: string[] = [];
  const pct = (n: number, total: number) => total > 0 ? `${(n / total * 100).toFixed(1)}%` : '0%';

  lines.push('# FIRE Gap Analysis — Experiment Report');
  lines.push('');
  lines.push(`**Date:** ${new Date().toISOString().slice(0, 10)}`);
  lines.push(`**Claims analyzed:** ${summary.total_claims}`);
  lines.push(`**Debates:** ${[...new Set(results.map(r => r.debate_prefix))].join(', ')}`);
  lines.push(`**Model:** ${GEMINI_MODEL}`);
  lines.push(`**Ticket:** t/372 (gated on this experiment)`);
  lines.push('');

  lines.push('## 1. Overall Entailment Verdict');
  lines.push('');
  lines.push('| Verdict | Count | Rate |');
  lines.push('|---------|-------|------|');
  for (const v of ['entailed', 'partial', 'not_entailed'] as const) {
    lines.push(`| ${v} | ${summary.by_verdict[v] ?? 0} | ${pct(summary.by_verdict[v] ?? 0, summary.total_claims)} |`);
  }
  lines.push('');
  lines.push(`**False-accept rate (partial + not_entailed):** ${(summary.false_accept_rate * 100).toFixed(1)}%`);
  lines.push('');

  lines.push('## 2. Cross-Tabulation: FIRE Overlap Bucket × Entailment');
  lines.push('');
  lines.push('| Overlap Bucket | Total | Entailed | Partial | Not Entailed | False-Accept Rate |');
  lines.push('|----------------|-------|----------|---------|--------------|-------------------|');
  for (const bucket of ['90-100', '70-89', '50-69', '30-49', '0-29']) {
    const s = summary.by_bucket[bucket];
    if (!s) continue;
    lines.push(`| ${bucket}% | ${s.total} | ${s.entailed} | ${s.partial} | ${s.not_entailed} | ${pct(s.partial + s.not_entailed, s.total)} |`);
  }
  lines.push('');

  lines.push('## 3. Confidence Cap Analysis');
  lines.push('');
  const cap = summary.confidence_cap_analysis;
  lines.push(`FIRE caps extraction_confidence when overlap < 70%. Of ${cap.total_capped} capped claims:`);
  lines.push(`- ${cap.capped_entailed} were actually entailed (cap was **over-penalizing**)`);
  lines.push(`- ${cap.capped_not_entailed} were partial/not_entailed (cap was **warranted**)`);
  lines.push(`- Cap accuracy: ${(cap.cap_accuracy * 100).toFixed(1)}%`);
  lines.push('');

  lines.push('## 4. By Speaker');
  lines.push('');
  lines.push('| Speaker | Total | Entailed | Partial | Not Entailed | FA Rate |');
  lines.push('|---------|-------|----------|---------|--------------|---------|');
  for (const [speaker, s] of Object.entries(summary.by_speaker).sort((a, b) => b[1].total - a[1].total)) {
    lines.push(`| ${speaker} | ${s.total} | ${s.entailed} | ${s.partial} | ${s.not_entailed} | ${pct(s.partial + s.not_entailed, s.total)} |`);
  }
  lines.push('');

  lines.push('## 5. By BDI Category');
  lines.push('');
  lines.push('| Category | Total | Entailed | Partial | Not Entailed | FA Rate |');
  lines.push('|----------|-------|----------|---------|--------------|---------|');
  for (const [bdi, s] of Object.entries(summary.by_bdi).sort((a, b) => b[1].total - a[1].total)) {
    lines.push(`| ${bdi} | ${s.total} | ${s.entailed} | ${s.partial} | ${s.not_entailed} | ${pct(s.partial + s.not_entailed, s.total)} |`);
  }
  lines.push('');

  lines.push('## 6. Sample Failures (up to 10, sorted by overlap ascending)');
  lines.push('');
  for (const f of summary.sample_failures) {
    lines.push(`### ${f.an_node_id} (${f.debate_prefix}, overlap: ${f.overlap_pct}%, verdict: ${f.entailment.verdict})`);
    lines.push('');
    lines.push(`**Statement excerpt:** ${f.statement.slice(0, 300)}...`);
    lines.push('');
    lines.push(`**Claim:** ${f.claim_text}`);
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

  lines.push('## 7. Recommendation');
  lines.push('');
  lines.push(`**${summary.recommendation}**`);
  lines.push('');
  lines.push('### Decision criteria applied:');
  lines.push('- False-accept rate <5% → FIRE sufficient, shelve t/372');
  lines.push('- False-accept rate 5-15% → sampled entailment post-pass (30% of turns)');
  lines.push('- False-accept rate >15% → entailment check on every turn');
  lines.push('- Per TL guidance: weight by downstream impact, not just rate');
  lines.push('');

  return lines.join('\n');
}

// ── Main ────────────────────────────────────────────────

async function main(): Promise<void> {
  const config = parseArgs();

  if (!fs.existsSync(RESULTS_DIR)) {
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
  }

  let results: ClaimAnalysis[];

  if (config.analyzeOnly) {
    console.log('Loading existing results...');
    results = [];
    for (const file of config.analyzeOnly) {
      const filePath = path.resolve(file);
      if (!fs.existsSync(filePath)) {
        console.error(`File not found: ${filePath}`);
        continue;
      }
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      results.push(...(data.results ?? data));
    }
    console.log(`Loaded ${results.length} claim analyses`);
  } else {
    results = await runExperiment(config);
  }

  if (results.length === 0) {
    console.error('No results to analyze.');
    process.exit(1);
  }

  const summary = analyze(results);
  const report = generateReport(summary, results);

  const timestamp = Date.now();
  const jsonPath = path.join(RESULTS_DIR, `fire-gap-analysis-${timestamp}.json`);
  const mdPath = path.join(RESULTS_DIR, `fire-gap-analysis-${timestamp}.md`);

  fs.writeFileSync(jsonPath, JSON.stringify({ config, summary, results }, null, 2));
  fs.writeFileSync(mdPath, report);

  console.log(`Results: ${jsonPath}`);
  console.log(`Report:  ${mdPath}`);
  console.log('');
  console.log('── Summary ──');
  console.log(`Total claims: ${summary.total_claims}`);
  console.log(`Entailed: ${summary.by_verdict.entailed ?? 0} (${((summary.by_verdict.entailed ?? 0) / summary.total_claims * 100).toFixed(1)}%)`);
  console.log(`Partial: ${summary.by_verdict.partial ?? 0}`);
  console.log(`Not entailed: ${summary.by_verdict.not_entailed ?? 0}`);
  console.log(`False-accept rate: ${(summary.false_accept_rate * 100).toFixed(1)}%`);
  console.log('');
  console.log(`Recommendation: ${summary.recommendation}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
