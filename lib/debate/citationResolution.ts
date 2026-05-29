// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Citation resolution module — prevents LLM citation fabrication in the debate pipeline.
 *
 * Two paths:
 * - Path B (tool-calling): LLM calls `lookup_citation` during draft generation
 * - Path A (prompt injection): Citation bank injected into prompt + post-draft scrub
 *
 * Both paths use a shared citation bank built from the evidence index and source metadata.
 */

import type { ToolDefinition } from '../ai-client/types.js';
import type { SourceEvidenceIndex, DocMetaMap } from './evidenceFromSummaries.js';

// ── Types ─────────────────────────────────────────────────

export interface CitationBankEntry {
  doc_id: string;
  title: string;
  authors: string[];
  year: string;
  url: string | null;
  key_findings: string[];
  source_type: 'academic' | 'legislation' | 'report';
}

export interface CitationWarning {
  citation: string;
  reason: string;
}

export interface ScrubResult {
  cleanedDraft: string;
  removed: string[];
  warnings: string[];
  /** Detailed fabrication records for diagnostics. */
  fabrications: CitationFabrication[];
}

// ── Diagnostics types ──────────────────────────────────────

export interface CitationMatch {
  citation_text: string;
  doc_id: string;
  title: string;
  similarity: number;
  match_type: 'exact' | 'fuzzy_title' | 'url' | 'arxiv_id';
}

export interface CitationFabrication {
  citation_text: string;
  pattern: 'arxiv' | 'url' | 'title' | 'legislation';
  action: 'removed' | 'hedged';
  replacement?: string;
}

export interface CitationResolutionDiagnostics {
  // Common
  path: 'tool-calling' | 'bank-scrub';
  bank_size: number;
  bank_sources: string[];
  citations_extracted: number;
  citations_matched: number;
  citations_fabricated: number;
  resolution_time_ms: number;

  // Matched citations
  matches: CitationMatch[];

  // Fabricated citations (removed or hedged)
  fabrications: CitationFabrication[];

  // Path B: tool calls
  tool_calls?: {
    query: string;
    source_type?: string;
    results_count: number;
    top_result?: { doc_id: string; title: string; relevance: number };
    time_ms: number;
    empty: boolean;
  }[];

  // Path A: scrub diff
  scrub_diff?: {
    lines_removed: number;
    lines_modified: number;
    original_length: number;
    cleaned_length: number;
  };

  // Path A: original text before scrubbing (for Diff Viewer)
  scrub_original?: string;

  // Validation warnings
  warnings: string[];
}

// ── Citation Bank ─────────────────────────────────────────

/**
 * Build a citation bank from the evidence index and source metadata.
 * Extracts verified document references that the LLM may cite.
 */
export function buildCitationBank(
  evidenceIndex: SourceEvidenceIndex,
  docMeta: DocMetaMap,
  policyRegistry?: Array<{ id: string; action: string; source_povs?: string[] }>,
): CitationBankEntry[] {
  const seen = new Set<string>();
  const entries: CitationBankEntry[] = [];

  // Collect doc_ids from the evidence index
  for (const nodeEntry of Object.values(evidenceIndex)) {
    for (const fact of nodeEntry.facts ?? []) {
      if (seen.has(fact.doc_id)) continue;
      seen.add(fact.doc_id);
      const meta = docMeta[fact.doc_id];
      if (!meta) continue;
      entries.push({
        doc_id: fact.doc_id,
        title: meta.title,
        authors: extractAuthors(meta),
        year: extractYear(meta),
        url: meta.resolved_url ?? null,
        key_findings: [],
        source_type: classifySourceType(meta),
      });
    }
    for (const kp of nodeEntry.keyPoints ?? []) {
      if (seen.has(kp.doc_id)) continue;
      seen.add(kp.doc_id);
      const meta = docMeta[kp.doc_id];
      if (!meta) continue;
      entries.push({
        doc_id: kp.doc_id,
        title: meta.title,
        authors: extractAuthors(meta),
        year: extractYear(meta),
        url: meta.resolved_url ?? null,
        key_findings: [],
        source_type: classifySourceType(meta),
      });
    }
  }

  // Add key findings to existing entries
  for (const nodeEntry of Object.values(evidenceIndex)) {
    for (const fact of nodeEntry.facts ?? []) {
      const entry = entries.find(e => e.doc_id === fact.doc_id);
      if (entry && entry.key_findings.length < 3 && !entry.key_findings.includes(fact.claim)) {
        entry.key_findings.push(fact.claim);
      }
    }
  }

  // Add policy registry entries as legislation sources
  if (policyRegistry) {
    for (const pol of policyRegistry) {
      if (seen.has(pol.id)) continue;
      seen.add(pol.id);
      entries.push({
        doc_id: pol.id,
        title: pol.action,
        authors: [],
        year: '',
        url: null,
        key_findings: [],
        source_type: 'legislation',
      });
    }
  }

  return entries;
}

function extractAuthors(meta: { title: string; provenance_label?: string }): string[] {
  // Provenance label sometimes contains author info
  if (meta.provenance_label && !meta.provenance_label.startsWith('arXiv:') && !meta.provenance_label.startsWith('http')) {
    return [meta.provenance_label];
  }
  return [];
}

function extractYear(meta: { title: string; provenance_label?: string }): string {
  // Try to find a year in the provenance label or title
  const yearMatch = (meta.provenance_label ?? '').match(/\b(20\d{2})\b/) ?? meta.title.match(/\b(20\d{2})\b/);
  return yearMatch?.[1] ?? '';
}

function classifySourceType(meta: { title: string; provenance_label?: string }): 'academic' | 'legislation' | 'report' {
  const lower = (meta.title + ' ' + (meta.provenance_label ?? '')).toLowerCase();
  if (/\b(act|executive order|regulation|statute|directive|bill)\b/.test(lower)) return 'legislation';
  if (/\b(arxiv|paper|journal|conference|proceedings)\b/.test(lower)) return 'academic';
  return 'report';
}

// ── Scoped Citation Bank (Path A — prompt injection) ──────

/**
 * Build a turn-scoped citation bank from the full bank.
 * Filters to sources relevant to *this* turn: evidence-selected docs,
 * prior-cited docs, and a frequency-ranked buffer from target nodes.
 * Saves ~8-9K tokens per turn vs. injecting the full corpus.
 *
 * The full bank is still used for scrub/validation (Path A post-draft)
 * and tool-calling lookup (Path B).
 */
export function buildScopedCitationBank(
  fullBank: CitationBankEntry[],
  options: {
    /** Doc IDs from the evidence stage's selected facts + key points. */
    evidenceDocIds: Set<string>;
    /** Doc IDs from prior turns (carry-forward). */
    priorCitedDocIds?: Set<string>;
    /** Plan's target_nodes — used to find buffer docs. */
    targetNodeIds?: string[];
    /** Evidence index — used to rank buffer docs by fact frequency. */
    evidenceIndex?: SourceEvidenceIndex;
    /** Max entries in the scoped bank. Default 15. */
    maxEntries?: number;
  },
): CitationBankEntry[] {
  const maxEntries = options.maxEntries ?? 15;
  const bankById = new Map(fullBank.map(e => [e.doc_id, e]));

  const result: CitationBankEntry[] = [];
  const included = new Set<string>();

  // Tier 1: evidence-selected docs (always included — these are what the LLM was told to cite)
  for (const docId of options.evidenceDocIds) {
    const entry = bankById.get(docId);
    if (entry && !included.has(docId)) {
      result.push(entry);
      included.add(docId);
    }
  }

  // Tier 2: prior-cited docs (carry-forward — debater may reference earlier sources)
  if (options.priorCitedDocIds) {
    for (const docId of options.priorCitedDocIds) {
      if (result.length >= maxEntries) break;
      const entry = bankById.get(docId);
      if (entry && !included.has(docId)) {
        result.push(entry);
        included.add(docId);
      }
    }
  }

  // Tier 3: buffer from target nodes (ranked by fact count — most-cited docs first)
  if (result.length < maxEntries && options.targetNodeIds && options.evidenceIndex) {
    const docFrequency = new Map<string, number>();
    for (const nodeId of options.targetNodeIds) {
      const nodeEntry = options.evidenceIndex[nodeId];
      if (!nodeEntry) continue;
      for (const fact of nodeEntry.facts ?? []) {
        if (!included.has(fact.doc_id) && bankById.has(fact.doc_id)) {
          docFrequency.set(fact.doc_id, (docFrequency.get(fact.doc_id) ?? 0) + 1);
        }
      }
      for (const kp of nodeEntry.keyPoints ?? []) {
        if (!included.has(kp.doc_id) && bankById.has(kp.doc_id)) {
          docFrequency.set(kp.doc_id, (docFrequency.get(kp.doc_id) ?? 0) + 1);
        }
      }
    }

    const bufferDocs = [...docFrequency.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, maxEntries - result.length);

    for (const [docId] of bufferDocs) {
      const entry = bankById.get(docId);
      if (entry) {
        result.push(entry);
        included.add(docId);
      }
    }
  }

  // Tier 4: legislation/policy entries (always small — include if space remains)
  for (const entry of fullBank) {
    if (result.length >= maxEntries) break;
    if (entry.source_type === 'legislation' && !included.has(entry.doc_id)) {
      result.push(entry);
      included.add(entry.doc_id);
    }
  }

  return result;
}

// ── Formatting (Path A prompt injection) ──────────────────

/**
 * Format the citation bank as a prompt block for Path A injection.
 */
export function formatCitationBank(bank: CitationBankEntry[]): string {
  if (bank.length === 0) return '';

  const lines: string[] = [
    'CITATION RULES:',
    'You may cite sources from the VERIFIED SOURCES list below. Use the exact title',
    'and attribution provided. Do NOT invent paper titles, arXiv IDs, legislation',
    'names, or URLs from memory — if a claim needs a source not in the list,',
    'state it as your analytical position rather than an empirical finding.',
    '',
    'VERIFIED SOURCES:',
  ];

  for (let i = 0; i < bank.length; i++) {
    const e = bank[i];
    const authorStr = e.authors.length > 0 ? ` (${e.authors.join(', ')}${e.year ? ', ' + e.year : ''})` : e.year ? ` (${e.year})` : '';
    const findingStr = e.key_findings.length > 0 ? ` — ${e.key_findings[0]}` : '';
    lines.push(`${i + 1}. "${e.title}"${authorStr}${findingStr}`);
  }

  return lines.join('\n');
}

// ── Tool Definition (Path B) ──────────────────────────────

/**
 * Tool definition for the `lookup_citation` function call.
 */
export const citationToolDefinition: ToolDefinition = {
  name: 'lookup_citation',
  description: 'Search for real academic papers, legislation, or reports that support a claim. Returns verified citations with titles, authors, dates, and URLs. Use this instead of citing sources from memory.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Natural language description of the evidence needed, e.g. "evidence that alignment training reduces covert actions"',
      },
      source_type: {
        type: 'string',
        enum: ['academic', 'legislation', 'report', 'any'],
        description: 'Filter by source type. Default: any.',
      },
    },
    required: ['query'],
  },
};

/**
 * Execute a citation lookup against the bank.
 * Uses simple keyword matching (no embedding infrastructure needed).
 */
export function executeCitationLookup(
  query: string,
  sourceType: string | undefined,
  bank: CitationBankEntry[],
  maxResults: number = 5,
): string {
  const queryTerms = query.toLowerCase().split(/\s+/).filter(t => t.length > 2);

  const scored = bank
    .filter(e => !sourceType || sourceType === 'any' || e.source_type === sourceType)
    .map(entry => {
      const searchText = [
        entry.title,
        ...entry.key_findings,
        ...entry.authors,
      ].join(' ').toLowerCase();

      let score = 0;
      for (const term of queryTerms) {
        if (searchText.includes(term)) score++;
      }
      // Boost for key findings that contain query terms
      for (const finding of entry.key_findings) {
        const fl = finding.toLowerCase();
        for (const term of queryTerms) {
          if (fl.includes(term)) score += 0.5;
        }
      }
      return { entry, score };
    })
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults);

  if (scored.length === 0) {
    return JSON.stringify({
      results: [],
      message: 'No verified sources found for this claim. State the claim without citation or qualify it as a position rather than an empirical finding.',
    });
  }

  return JSON.stringify({
    results: scored.map(s => ({
      title: s.entry.title,
      authors: s.entry.authors,
      year: s.entry.year,
      url: s.entry.url,
      key_finding: s.entry.key_findings[0] ?? null,
      doc_id: s.entry.doc_id,
      relevance_score: Math.round(s.score * 100) / 100,
    })),
  });
}

// ── Post-Draft Scrub (Path A) ─────────────────────────────

// Citation-like patterns to extract from draft text
const ARXIV_PATTERN = /arXiv:\d{4}\.\d{4,5}(v\d+)?/gi;
const URL_PATTERN = /https?:\/\/[^\s),]+/gi;
const QUOTED_TITLE_PATTERN = /"([^"]{10,120})"/g;
const LEGISLATION_PATTERN = /\b[A-Z][a-z]+ (?:Act|Bill|Order|Directive|Regulation)\b/g;
const EXEC_ORDER_PATTERN = /\bExecutive Order \d+\b/gi;

/**
 * Scrub fabricated citations from a draft statement.
 * Extracts citation-like patterns and fuzzy-matches against the bank.
 * Unmatched citations are replaced with hedged phrasing.
 */
export function scrubCitations(
  draft: string,
  bank: CitationBankEntry[],
): ScrubResult {
  const removed: string[] = [];
  const warnings: string[] = [];
  const fabrications: CitationFabrication[] = [];
  let result = draft;

  // Build lookup sets for fast matching
  const bankTitles = bank.map(e => e.title.toLowerCase());
  const bankUrls = new Set(bank.filter(e => e.url).map(e => e.url!.toLowerCase()));

  // 1. Check arXiv IDs — none should appear (we don't inject them)
  for (const match of draft.matchAll(ARXIV_PATTERN)) {
    removed.push(match[0]);
    fabrications.push({ citation_text: match[0], pattern: 'arxiv', action: 'removed' });
    result = result.replace(match[0], '');
  }

  // 2. Check URLs — must be in the bank
  for (const match of draft.matchAll(URL_PATTERN)) {
    const url = match[0].toLowerCase().replace(/[.,;)]+$/, '');
    if (!bankUrls.has(url)) {
      removed.push(match[0]);
      fabrications.push({ citation_text: match[0], pattern: 'url', action: 'removed' });
      result = result.replace(match[0], '');
    }
  }

  // 3. Check Executive Orders — must fuzzy-match bank
  for (const match of draft.matchAll(EXEC_ORDER_PATTERN)) {
    if (!fuzzyMatchBank(match[0], bankTitles)) {
      removed.push(match[0]);
      fabrications.push({ citation_text: match[0], pattern: 'legislation', action: 'hedged', replacement: 'relevant policy directives' });
      result = result.replace(match[0], 'relevant policy directives');
    }
  }

  // 4. Check legislation patterns
  for (const match of draft.matchAll(LEGISLATION_PATTERN)) {
    if (!fuzzyMatchBank(match[0], bankTitles)) {
      removed.push(match[0]);
      fabrications.push({ citation_text: match[0], pattern: 'legislation', action: 'hedged', replacement: 'proposed regulatory frameworks' });
      // Keep but hedge
      result = result.replace(match[0], 'proposed regulatory frameworks');
    }
  }

  // Clean up artifacts from removals (double spaces, empty parens)
  result = result
    .replace(/\(\s*\)/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([.,;])/g, '$1');

  if (removed.length > 0) {
    warnings.push(`Removed ${removed.length} unverified citation(s): ${removed.join(', ')}`);
  }

  return { cleanedDraft: result, removed, warnings, fabrications };
}

/**
 * Fuzzy-match a citation string against bank titles.
 * Returns true if any bank title contains significant overlap.
 */
function fuzzyMatchBank(citation: string, bankTitles: string[]): boolean {
  const lower = citation.toLowerCase();
  // Exact substring match
  if (bankTitles.some(t => t.includes(lower) || lower.includes(t))) return true;
  // Word overlap: at least 60% of citation words appear in a bank title.
  // Numeric tokens (IDs, order numbers) must match exactly — they distinguish citations.
  const words = lower.split(/\s+/).filter(w => w.length > 2);
  if (words.length === 0) return false;
  const numericWords = words.filter(w => /^\d+$/.test(w));
  for (const title of bankTitles) {
    // All numeric tokens must appear in the bank title
    if (numericWords.length > 0 && !numericWords.every(n => title.includes(n))) continue;
    const matchCount = words.filter(w => title.includes(w)).length;
    if (matchCount / words.length >= 0.6) return true;
  }
  return false;
}

// ── Post-Draft Validation (Both Paths) ────────────────────

/**
 * Validate all citation-like strings in the draft against the bank.
 * Returns specific warnings for citations not found in the bank.
 */
export function validateCitationsAgainstBank(
  draftText: string,
  bank: CitationBankEntry[],
): CitationWarning[] {
  const warnings: CitationWarning[] = [];
  const bankTitles = bank.map(e => e.title.toLowerCase());
  const bankUrls = new Set(bank.filter(e => e.url).map(e => e.url!.toLowerCase()));

  // Check arXiv IDs
  for (const match of draftText.matchAll(ARXIV_PATTERN)) {
    warnings.push({
      citation: match[0],
      reason: 'ArXiv ID not in citation bank — likely fabricated',
    });
  }

  // Check URLs
  for (const match of draftText.matchAll(URL_PATTERN)) {
    const url = match[0].toLowerCase().replace(/[.,;)]+$/, '');
    if (!bankUrls.has(url)) {
      warnings.push({
        citation: match[0],
        reason: 'URL not in citation bank — likely fabricated',
      });
    }
  }

  // Check Executive Orders
  for (const match of draftText.matchAll(EXEC_ORDER_PATTERN)) {
    if (!fuzzyMatchBank(match[0], bankTitles)) {
      warnings.push({
        citation: match[0],
        reason: 'Executive Order not found in citation bank',
      });
    }
  }

  // Check quoted titles that look like paper citations
  for (const match of draftText.matchAll(QUOTED_TITLE_PATTERN)) {
    const title = match[1];
    // Skip short quotes that are likely not citations
    if (title.length < 15) continue;
    // Skip if it looks like a direct speech quote
    if (/^(I |we |they |he |she |it |as |the |this |that )/i.test(title)) continue;
    if (!fuzzyMatchBank(title, bankTitles)) {
      warnings.push({
        citation: `"${title}"`,
        reason: 'Quoted title not found in citation bank — may be fabricated',
      });
    }
  }

  return warnings;
}

// ── Citation Match Extraction (for diagnostics) ───────────

/**
 * Extract matched citations from a draft for diagnostics.
 * Returns an array of matches with similarity and match type.
 */
export function extractCitationMatches(
  draftText: string,
  bank: CitationBankEntry[],
): CitationMatch[] {
  const matches: CitationMatch[] = [];
  const bankTitles = bank.map(e => e.title.toLowerCase());
  const bankUrls = new Map(
    bank.filter(e => e.url).map(e => [e.url!.toLowerCase(), e]),
  );

  // Match URLs
  for (const match of draftText.matchAll(URL_PATTERN)) {
    const url = match[0].toLowerCase().replace(/[.,;)]+$/, '');
    const entry = bankUrls.get(url);
    if (entry) {
      matches.push({
        citation_text: match[0],
        doc_id: entry.doc_id,
        title: entry.title,
        similarity: 1.0,
        match_type: 'url',
      });
    }
  }

  // Match quoted titles
  for (const match of draftText.matchAll(QUOTED_TITLE_PATTERN)) {
    const title = match[1];
    if (title.length < 15) continue;
    if (/^(I |we |they |he |she |it |as |the |this |that )/i.test(title)) continue;
    const titleLower = title.toLowerCase();

    for (let i = 0; i < bank.length; i++) {
      const bankTitle = bankTitles[i];
      if (bankTitle.includes(titleLower) || titleLower.includes(bankTitle)) {
        matches.push({
          citation_text: `"${title}"`,
          doc_id: bank[i].doc_id,
          title: bank[i].title,
          similarity: 1.0,
          match_type: 'exact',
        });
        break;
      }
      // Fuzzy word overlap
      const words = titleLower.split(/\s+/).filter(w => w.length > 2);
      if (words.length === 0) continue;
      const matchCount = words.filter(w => bankTitle.includes(w)).length;
      const sim = matchCount / words.length;
      if (sim >= 0.6) {
        matches.push({
          citation_text: `"${title}"`,
          doc_id: bank[i].doc_id,
          title: bank[i].title,
          similarity: Math.round(sim * 100) / 100,
          match_type: 'fuzzy_title',
        });
        break;
      }
    }
  }

  // Match Executive Orders and legislation by fuzzy title
  for (const match of draftText.matchAll(EXEC_ORDER_PATTERN)) {
    for (let i = 0; i < bank.length; i++) {
      if (fuzzyMatchBank(match[0], [bankTitles[i]])) {
        matches.push({
          citation_text: match[0],
          doc_id: bank[i].doc_id,
          title: bank[i].title,
          similarity: 0.8,
          match_type: 'fuzzy_title',
        });
        break;
      }
    }
  }

  return matches;
}
