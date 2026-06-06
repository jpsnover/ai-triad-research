#!/usr/bin/env tsx
/**
 * Extraction Coverage Prompt Validation — t/373
 *
 * Validates the element decomposition prompt by running it on debate
 * transcripts and checking whether extracted claims cover the elements.
 *
 * Phase 1: Decompose statements into information elements
 * Phase 2: Check coverage of each element against my_claims
 *
 * Usage:
 *   cd research/comp-linguist
 *   npx tsx scripts/extraction-coverage-validation.ts
 *   npx tsx scripts/extraction-coverage-validation.ts --debates debate-5cf84d60,debate-ff1310c8
 *   npx tsx scripts/extraction-coverage-validation.ts --max-entries 10
 */

import fs from 'fs';
import path from 'path';

// ── Config ──────────────────────────────────────────────

const __dirname = path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Z]:)/, '$1');
const RESULTS_DIR = path.resolve(__dirname, '../results');
const DATA_DIR = path.resolve(__dirname, '../../../..', 'ai-triad-data/debates');

const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';

// ── Types ───────────────────────────────────────────────

interface InformationElement {
  text: string;
  element_type: 'verifiable' | 'normative';
}

interface DecompositionResult {
  elements: InformationElement[];
}

interface CoverageCheckResult {
  element_text: string;
  element_type: 'verifiable' | 'normative';
  covered: boolean;
  covering_claim: string | null;
}

interface CoverageResult {
  elements: CoverageCheckResult[];
  total_elements: number;
  verifiable_elements: number;
  normative_elements: number;
  covered_verifiable: number;
  covered_normative: number;
  coverage_rate: number;
}

interface EntryValidation {
  debate_file: string;
  entry_id: string;
  speaker: string;
  statement_words: number;
  claims_count: number;
  decomposition: DecompositionResult;
  coverage: CoverageResult;
}

// ── Prompts ─────────────────────────────────────────────

function buildDecompositionPrompt(statement: string): string {
  return `Decompose the following debate statement into its distinct INFORMATION ELEMENTS at CLAIM level — each element should be a complete argumentative point, not a sub-component.

STATEMENT:
"""
${statement}
"""

Instructions:
1. Extract the major claims, positions, and arguments from the statement. Target the level of granularity at which a claim extractor would produce output — one element per ARGUMENTATIVE POINT, not per sentence or sub-assertion.

2. GRANULARITY GUIDE:
   - CORRECT: "Strict liability creates a market-based audit mechanism that scales automatically and replaces bureaucratic gatekeeping" (one argumentative point with supporting details bundled)
   - TOO FINE: Splitting the above into "Strict liability creates a market-based audit mechanism", "This mechanism scales automatically", "This mechanism replaces bureaucratic gatekeeping" (three sub-assertions of one point)
   - A 300-word statement typically contains 5-12 major information elements, not 20-30.

3. Classify each element:
   - "verifiable": Factual claims, empirical assertions, causal arguments, historical references, statistics, mechanistic claims, analytical arguments about how systems work. These can in principle be assessed for accuracy or internal consistency.
   - "normative": Value judgments, prescriptive claims ("should", "must"), expressions of desire or intention, moral evaluations, policy recommendations. These express what the speaker wants rather than what is the case.

4. Write each element as a self-contained sentence preserving specific qualifiers and conditions.

5. Do NOT include:
   - Rhetorical transitions or meta-commentary about the debate
   - Attributions without content ("Skeptic disagrees")
   - Restatements of the same point in different words

Respond in JSON:
{
  "elements": [
    { "text": "...", "element_type": "verifiable" },
    { "text": "...", "element_type": "normative" }
  ]
}`;
}

function buildCoverageCheckPrompt(
  elements: InformationElement[],
  claims: string[],
): string {
  const elementList = elements.map((e, i) => `  ${i + 1}. [${e.element_type}] ${e.text}`).join('\n');
  const claimList = claims.map((c, i) => `  ${i + 1}. ${c}`).join('\n');

  return `Given a list of INFORMATION ELEMENTS from a debate statement and a list of EXTRACTED CLAIMS, determine which elements are covered by the claims.

INFORMATION ELEMENTS:
${elementList}

EXTRACTED CLAIMS:
${claimList}

Instructions:
1. For each information element, check if ANY extracted claim captures its core content (explicitly or by implication).
2. A claim "covers" an element if reading the claim would tell you the same factual or normative content as the element, even if worded differently.
3. Partial coverage counts as covered — if the claim captures the main idea but drops minor qualifiers, mark it as covered.
4. An element is "not covered" only if NO claim addresses its content at all.

Respond in JSON:
{
  "coverage": [
    { "element_index": 1, "covered": true, "covering_claim_index": 2 },
    { "element_index": 2, "covered": false, "covering_claim_index": null }
  ]
}`;
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

async function callGeminiRaw(prompt: string, apiKey: string): Promise<string> {
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

// ── Data Loading ────────────────────────────────────────

interface TranscriptEntry {
  id: string;
  speaker: string;
  content: string;
  type: string;
  metadata?: {
    my_claims?: { claim: string; targets?: string[] }[];
    [key: string]: unknown;
  };
}

function findDebateFiles(prefixes?: string[]): string[] {
  const allFiles = fs.readdirSync(DATA_DIR).filter(f => f.startsWith('debate-') && f.endsWith('.json') && !f.includes('diagnostics'));

  if (prefixes && prefixes.length > 0) {
    return allFiles.filter(f => prefixes.some(p => f.includes(p)));
  }

  // Default: pick 3 diverse debates
  const shuffled = [...allFiles].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, 3);
}

function extractStatementEntries(debateFile: string, maxEntries: number): { file: string; entries: TranscriptEntry[] } {
  const filePath = path.join(DATA_DIR, debateFile);
  const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  const transcript: TranscriptEntry[] = data.transcript ?? [];

  const statements = transcript.filter(e =>
    e.type === 'statement' &&
    e.content &&
    e.content.split(/\s+/).length >= 150 &&
    e.metadata?.my_claims &&
    e.metadata.my_claims.length > 0,
  );

  // Take up to maxEntries, preferring diverse speakers
  const seen = new Set<string>();
  const selected: TranscriptEntry[] = [];
  for (const entry of statements) {
    if (selected.length >= maxEntries) break;
    if (!seen.has(entry.speaker)) {
      selected.push(entry);
      seen.add(entry.speaker);
    }
  }
  // Fill remaining slots
  for (const entry of statements) {
    if (selected.length >= maxEntries) break;
    if (!selected.includes(entry)) {
      selected.push(entry);
    }
  }

  return { file: debateFile, entries: selected };
}

// ── Validation Runner ───────────────────────────────────

async function validateEntry(
  debateFile: string,
  entry: TranscriptEntry,
  apiKey: string,
): Promise<EntryValidation> {
  const claims = (entry.metadata?.my_claims ?? []).map(c => c.claim);
  const wordCount = entry.content.split(/\s+/).length;

  // Phase 1: Decompose
  console.log(`  Decomposing ${entry.id} (${entry.speaker}, ${wordCount} words, ${claims.length} claims)...`);
  const decompRaw = await callGeminiRaw(buildDecompositionPrompt(entry.content), apiKey);
  const decomp = JSON.parse(decompRaw) as DecompositionResult;

  console.log(`    → ${decomp.elements.length} elements (${decomp.elements.filter(e => e.element_type === 'verifiable').length} verifiable, ${decomp.elements.filter(e => e.element_type === 'normative').length} normative)`);

  // Phase 2: Coverage check
  console.log(`  Checking coverage...`);
  const coverageRaw = await callGeminiRaw(buildCoverageCheckPrompt(decomp.elements, claims), apiKey);
  const coverageData = JSON.parse(coverageRaw) as {
    coverage: { element_index: number; covered: boolean; covering_claim_index: number | null }[];
  };

  // Build coverage result
  const coverageResults: CoverageCheckResult[] = decomp.elements.map((elem, i) => {
    const check = coverageData.coverage.find(c => c.element_index === i + 1);
    return {
      element_text: elem.text,
      element_type: elem.element_type,
      covered: check?.covered ?? false,
      covering_claim: check?.covering_claim_index != null && check.covering_claim_index > 0
        ? claims[check.covering_claim_index - 1] ?? null
        : null,
    };
  });

  const verifiable = coverageResults.filter(c => c.element_type === 'verifiable');
  const normative = coverageResults.filter(c => c.element_type === 'normative');
  const coveredVerifiable = verifiable.filter(c => c.covered).length;
  const coveredNormative = normative.filter(c => c.covered).length;
  const coverageRate = verifiable.length > 0 ? coveredVerifiable / verifiable.length : 1.0;

  console.log(`    → Coverage: ${coveredVerifiable}/${verifiable.length} verifiable (${(coverageRate * 100).toFixed(1)}%), ${coveredNormative}/${normative.length} normative`);

  return {
    debate_file: debateFile,
    entry_id: entry.id,
    speaker: entry.speaker,
    statement_words: wordCount,
    claims_count: claims.length,
    decomposition: decomp,
    coverage: {
      elements: coverageResults,
      total_elements: decomp.elements.length,
      verifiable_elements: verifiable.length,
      normative_elements: normative.length,
      covered_verifiable: coveredVerifiable,
      covered_normative: coveredNormative,
      coverage_rate: coverageRate,
    },
  };
}

// ── Report ──────────────────────────────────────────────

function generateReport(validations: EntryValidation[]): string {
  const lines: string[] = [];

  lines.push('# Extraction Coverage Prompt Validation — t/373');
  lines.push('');
  lines.push(`**Date:** ${new Date().toISOString().split('T')[0]}`);
  lines.push(`**Entries validated:** ${validations.length}`);
  lines.push(`**Debates:** ${[...new Set(validations.map(v => v.debate_file))].length}`);
  lines.push(`**Model:** ${GEMINI_MODEL}`);
  lines.push('');

  // Summary table
  lines.push('## Summary');
  lines.push('');
  lines.push('| Entry | Speaker | Words | Claims | Elements | Verifiable | Normative | Covered V. | Coverage |');
  lines.push('|-------|---------|-------|--------|----------|------------|-----------|------------|----------|');

  let totalVerifiable = 0;
  let totalCoveredVerifiable = 0;

  for (const v of validations) {
    const c = v.coverage;
    totalVerifiable += c.verifiable_elements;
    totalCoveredVerifiable += c.covered_verifiable;
    lines.push(`| ${v.entry_id.slice(0, 8)} | ${v.speaker} | ${v.statement_words} | ${v.claims_count} | ${c.total_elements} | ${c.verifiable_elements} | ${c.normative_elements} | ${c.covered_verifiable} | ${(c.coverage_rate * 100).toFixed(1)}% |`);
  }

  const overallRate = totalVerifiable > 0 ? totalCoveredVerifiable / totalVerifiable : 1.0;
  lines.push('');
  lines.push(`**Overall verifiable coverage: ${totalCoveredVerifiable}/${totalVerifiable} (${(overallRate * 100).toFixed(1)}%)**`);
  lines.push('');

  // Uncovered elements
  lines.push('## Uncovered Verifiable Elements');
  lines.push('');

  for (const v of validations) {
    const uncovered = v.coverage.elements.filter(e => !e.covered && e.element_type === 'verifiable');
    if (uncovered.length === 0) continue;

    lines.push(`### ${v.entry_id.slice(0, 8)} (${v.speaker})`);
    lines.push('');
    for (const u of uncovered) {
      lines.push(`- ${u.element_text}`);
    }
    lines.push('');
  }

  // Uncovered normative elements
  lines.push('## Uncovered Normative Elements');
  lines.push('');

  for (const v of validations) {
    const uncovered = v.coverage.elements.filter(e => !e.covered && e.element_type === 'normative');
    if (uncovered.length === 0) continue;

    lines.push(`### ${v.entry_id.slice(0, 8)} (${v.speaker})`);
    lines.push('');
    for (const u of uncovered) {
      lines.push(`- ${u.element_text}`);
    }
    lines.push('');
  }

  // Decomposition quality assessment
  lines.push('## Decomposition Quality Assessment');
  lines.push('');
  const avgElements = validations.reduce((s, v) => s + v.coverage.total_elements, 0) / validations.length;
  const avgVerifiable = validations.reduce((s, v) => s + v.coverage.verifiable_elements, 0) / validations.length;
  const avgNormative = validations.reduce((s, v) => s + v.coverage.normative_elements, 0) / validations.length;
  const avgWords = validations.reduce((s, v) => s + v.statement_words, 0) / validations.length;
  const elementsPerWord = avgElements / avgWords;

  lines.push(`- Mean elements per entry: ${avgElements.toFixed(1)}`);
  lines.push(`- Mean verifiable per entry: ${avgVerifiable.toFixed(1)}`);
  lines.push(`- Mean normative per entry: ${avgNormative.toFixed(1)}`);
  lines.push(`- Elements per 100 words: ${(elementsPerWord * 100).toFixed(1)}`);
  lines.push(`- Verifiable/normative ratio: ${(avgVerifiable / (avgNormative || 1)).toFixed(2)}`);
  lines.push('');

  return lines.join('\n');
}

// ── CLI & Main ──────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let debatePrefixes: string[] | undefined;
  let maxEntriesPerDebate = 3;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--debates') {
      debatePrefixes = args[++i].split(',').map(s => s.trim());
    } else if (args[i] === '--max-entries') {
      maxEntriesPerDebate = parseInt(args[++i]) || 3;
    }
  }

  const apiKey = getApiKey();

  if (!fs.existsSync(RESULTS_DIR)) {
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
  }

  console.log('\n── Extraction Coverage Prompt Validation (t/373) ──\n');

  const debateFiles = findDebateFiles(debatePrefixes);
  console.log(`Debate files: ${debateFiles.length}`);

  const allValidations: EntryValidation[] = [];

  for (const debateFile of debateFiles) {
    console.log(`\n${debateFile}:`);
    const { entries } = extractStatementEntries(debateFile, maxEntriesPerDebate);
    if (entries.length === 0) {
      console.log('  No qualifying statement entries found');
      continue;
    }

    for (const entry of entries) {
      try {
        const validation = await validateEntry(debateFile, entry, apiKey);
        allValidations.push(validation);
      } catch (err) {
        console.error(`  Error: ${(err as Error).message.slice(0, 200)}`);
      }
      await new Promise(resolve => setTimeout(resolve, 300));
    }
  }

  if (allValidations.length === 0) {
    console.error('\nNo entries validated. Check debate files.');
    process.exit(1);
  }

  // Save results
  const timestamp = Date.now();
  const jsonPath = path.join(RESULTS_DIR, `extraction-coverage-validation-${timestamp}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify({ validations: allValidations, timestamp }, null, 2));
  console.log(`\nRaw results: ${jsonPath}`);

  const report = generateReport(allValidations);
  const mdPath = path.join(RESULTS_DIR, `extraction-coverage-validation-${timestamp}.md`);
  fs.writeFileSync(mdPath, report);
  console.log(`Report: ${mdPath}`);

  // Console summary
  const totalV = allValidations.reduce((s, v) => s + v.coverage.verifiable_elements, 0);
  const coveredV = allValidations.reduce((s, v) => s + v.coverage.covered_verifiable, 0);
  console.log(`\n── Summary ──`);
  console.log(`Entries validated: ${allValidations.length}`);
  console.log(`Overall coverage: ${coveredV}/${totalV} verifiable elements (${totalV > 0 ? ((coveredV / totalV) * 100).toFixed(1) : 'N/A'}%)`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
