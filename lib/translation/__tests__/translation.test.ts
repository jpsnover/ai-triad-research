import { describe, it, expect } from 'vitest';
import path from 'path';
import { DictionaryLoader } from '../../dictionary/loader';
import { lintText, lintNodes, lintDictionary } from '../../dictionary/lint';
import { locateOccurrences } from '../locator';
import { resolveWithEnsemble } from '../ensemble';
import { buildFallbackPrompt } from '../llmFallback';
import { translateDocument } from '../pipeline';
import { tokenSortRatio, jaccardSimilarity, levenshteinRatio } from '../phraseMatch';
import type { TranslationPipelineConfig, EnsembleConfig, RoutingConfig } from '../types';
import type { SenseEmbeddingsFile, StandardizedTerm, SenseEmbeddingEntry } from '../../dictionary/types';

const dataRoot = path.resolve(__dirname, '../../../../ai-triad-data');
const dictionaryDir = path.join(dataRoot, 'dictionary');

function makeLoader() {
  return new DictionaryLoader(dictionaryDir);
}

function loadSenseEmbeddings(): SenseEmbeddingsFile {
  const fs = require('fs');
  return JSON.parse(fs.readFileSync(path.join(dictionaryDir, 'sense_embeddings.json'), 'utf-8'));
}

const DEFAULT_ENSEMBLE: EnsembleConfig = {
  w_e: 0.85,
  w_p: 0.15,
  phrase_match_function: 'token_sort_ratio',
  phrase_noise_floor: 0.50,
  phrase_aggregation: 'top_k_sum',
  phrase_top_k: 3,
};

const DEFAULT_ROUTING: RoutingConfig = {
  top_score_threshold: 0.55,
  margin_threshold: 0.10,
  context_window_tokens: 100,
};

const DEFAULT_CONFIG: TranslationPipelineConfig = {
  ensemble: DEFAULT_ENSEMBLE,
  routing: DEFAULT_ROUTING,
  llm_fallback: {
    enabled: false,
    provider: 'anthropic',
    model: 'claude-opus-4-7',
    endpoint: null,
    fallback_context_tokens: 500,
    max_retries: 2,
    timeout_seconds: 30,
    max_candidate_senses: 3,
  },
};

// ── Phrase matching tests ───────────────────────────────

describe('tokenSortRatio', () => {
  it('returns 1.0 for identical strings', () => {
    expect(tokenSortRatio('alignment problem', 'alignment problem')).toBe(1.0);
  });

  it('handles word-order variation', () => {
    const score = tokenSortRatio('alignment problem', 'problem alignment');
    expect(score).toBe(1.0);
  });

  it('handles morphological variation', () => {
    const score = tokenSortRatio('alignment problems', 'alignment problem');
    expect(score).toBeGreaterThan(0.85);
  });

  it('returns low score for unrelated strings', () => {
    const score = tokenSortRatio('alignment problem', 'banana smoothie recipe');
    expect(score).toBeLessThan(0.3);
  });

  it('handles empty strings', () => {
    expect(tokenSortRatio('', '')).toBe(1.0);
    expect(tokenSortRatio('hello', '')).toBe(0.0);
  });
});

describe('jaccardSimilarity', () => {
  it('returns 1.0 for identical token sets', () => {
    expect(jaccardSimilarity('a b c', 'a b c')).toBe(1.0);
  });

  it('returns 0.5 for 50% overlap', () => {
    expect(jaccardSimilarity('a b', 'a c')).toBeCloseTo(1 / 3, 2);
  });
});

describe('levenshteinRatio', () => {
  it('returns 1.0 for identical strings', () => {
    expect(levenshteinRatio('hello', 'hello')).toBe(1.0);
  });

  it('handles single-char differences', () => {
    expect(levenshteinRatio('cat', 'bat')).toBeCloseTo(0.667, 2);
  });
});

// ── Stage 1: Locator tests ─────────────────────────────

describe('locateOccurrences', () => {
  const loader = makeLoader();
  const colloquials = loader.listColloquial();

  it('finds bare colloquial terms in plain text', () => {
    const text = 'The alignment problem is central to AI safety research.';
    const occs = locateOccurrences(text, colloquials);
    const terms = occs.map(o => o.colloquial_term);
    expect(terms).toContain('alignment');
    expect(terms).toContain('safety');
  });

  it('skips terms inside quotation markers', () => {
    const text = '<q canonical-bypass>alignment is important</q> but safety matters.';
    const occs = locateOccurrences(text, colloquials);
    const terms = occs.map(o => o.colloquial_term);
    expect(terms).not.toContain('alignment');
    expect(terms).toContain('safety');
  });

  it('skips terms inside code blocks', () => {
    const text = '```\nalignment = true\n```\nalignment matters.';
    const occs = locateOccurrences(text, colloquials);
    expect(occs).toHaveLength(1);
    expect(occs[0].colloquial_term).toBe('alignment');
    expect(occs[0].offset).toBeGreaterThan(20);
  });

  it('skips terms inside inline code', () => {
    const text = 'Use `alignment` for the config, but alignment in prose matters.';
    const occs = locateOccurrences(text, colloquials);
    expect(occs).toHaveLength(1);
    expect(occs[0].offset).toBeGreaterThan(14);
  });

  it('captures context before and after', () => {
    const text = 'Before text. alignment is important. After text.';
    const occs = locateOccurrences(text, colloquials, 100);
    const alignmentOcc = occs.find(o => o.colloquial_term === 'alignment');
    expect(alignmentOcc).toBeDefined();
    expect(alignmentOcc!.context_before).toContain('Before');
    expect(alignmentOcc!.context_after).toContain('After');
  });

  it('returns empty for text without colloquial terms', () => {
    const text = 'This is a generic text about nothing in particular.';
    const occs = locateOccurrences(text, colloquials);
    expect(occs).toHaveLength(0);
  });

  it('does not match substrings', () => {
    const text = 'misalignment is different from alignment.';
    const occs = locateOccurrences(text, colloquials);
    expect(occs).toHaveLength(1);
    expect(occs[0].colloquial_term).toBe('alignment');
  });

  it('handles multiple occurrences of same term', () => {
    const text = 'alignment is discussed. Later, alignment is revisited.';
    const occs = locateOccurrences(text, colloquials);
    const alignments = occs.filter(o => o.colloquial_term === 'alignment');
    expect(alignments).toHaveLength(2);
  });
});

// ── Stage 2: Ensemble tests ────────────────────────────

describe('resolveWithEnsemble', () => {
  const loader = makeLoader();
  const embeddings = loadSenseEmbeddings();
  const embMap = new Map(
    Object.entries(embeddings.entries).map(([k, v]) => [k, v as SenseEmbeddingEntry]),
  );

  it('resolves with phrase signal alone when no context embedding', () => {
    const colloquial = loader.getColloquial('alignment')!;
    const candidateSenses = colloquial.resolves_to
      .map(r => loader.getStandardized(r.standardized_term))
      .filter((s): s is StandardizedTerm => s !== null);

    const result = resolveWithEnsemble({
      occurrence: {
        colloquial_term: 'alignment',
        offset: 0,
        length: 9,
        context_before: 'The inner alignment problem and mesa-optimizers are the core challenge of',
        context_after: 'research. Deceptive alignment poses existential risks.',
      },
      candidateSenses,
      senseEmbeddings: embMap,
      contextEmbedding: null,
      config: DEFAULT_ENSEMBLE,
      routing: DEFAULT_ROUTING,
    });

    expect(result.signals).toHaveProperty('safety_alignment');
    expect(result.signals).toHaveProperty('commercial_alignment');
    expect(result.signals).toHaveProperty('alignment_compliance');
  });

  it('returns signals for all candidate senses', () => {
    const colloquial = loader.getColloquial('risk')!;
    const candidateSenses = colloquial.resolves_to
      .map(r => loader.getStandardized(r.standardized_term))
      .filter((s): s is StandardizedTerm => s !== null);

    const result = resolveWithEnsemble({
      occurrence: {
        colloquial_term: 'risk',
        offset: 0,
        length: 4,
        context_before: 'The existential risk from AI systems',
        context_after: 'demands precautionary regulation.',
      },
      candidateSenses,
      senseEmbeddings: embMap,
      contextEmbedding: null,
      config: DEFAULT_ENSEMBLE,
      routing: DEFAULT_ROUTING,
    });

    expect(Object.keys(result.signals)).toHaveLength(candidateSenses.length);
    for (const sig of Object.values(result.signals)) {
      expect(sig.combined_score).toBeGreaterThanOrEqual(0);
      expect(sig.combined_score).toBeLessThanOrEqual(1);
    }
  });

  it('marks as needs_fallback when below thresholds', () => {
    const colloquial = loader.getColloquial('governance')!;
    const candidateSenses = colloquial.resolves_to
      .map(r => loader.getStandardized(r.standardized_term))
      .filter((s): s is StandardizedTerm => s !== null);

    const result = resolveWithEnsemble({
      occurrence: {
        colloquial_term: 'governance',
        offset: 0,
        length: 10,
        context_before: 'We need better',
        context_after: 'of AI systems.',
      },
      candidateSenses,
      senseEmbeddings: embMap,
      contextEmbedding: null,
      config: DEFAULT_ENSEMBLE,
      routing: { ...DEFAULT_ROUTING, top_score_threshold: 0.99 },
    });

    expect(result.needs_fallback).toBe(true);
    expect(result.confidence).toBe('ambiguous');
  });
});

// ── Stage 3: LLM fallback prompt tests ─────────────────

describe('buildFallbackPrompt', () => {
  const loader = makeLoader();

  it('builds a well-formed prompt with candidate senses', () => {
    const colloquial = loader.getColloquial('alignment')!;
    const candidateSenses = colloquial.resolves_to
      .map(r => loader.getStandardized(r.standardized_term))
      .filter((s): s is StandardizedTerm => s !== null);

    const signals: Record<string, any> = {};
    for (const s of candidateSenses) {
      signals[s.canonical_form] = {
        embedding_similarity: 0.5,
        phrase_signal: 0.3,
        phrase_matches: [],
        combined_score: 0.47,
      };
    }

    const prompt = buildFallbackPrompt({
      occurrence: {
        colloquial_term: 'alignment',
        offset: 50,
        length: 9,
        context_before: 'inner',
        context_after: 'problem',
      },
      signals,
      candidateSenses,
      config: DEFAULT_CONFIG.llm_fallback,
      largerContext: 'The inner alignment problem is a key challenge in AI safety research.',
    });

    expect(prompt).toContain('alignment');
    expect(prompt).toContain('safety_alignment');
    expect(prompt).toContain('resolved_to');
    expect(prompt).toContain('JSON');
  });

  it('limits candidates to max_candidate_senses', () => {
    const colloquial = loader.getColloquial('alignment')!;
    const candidateSenses = colloquial.resolves_to
      .map(r => loader.getStandardized(r.standardized_term))
      .filter((s): s is StandardizedTerm => s !== null);

    const signals: Record<string, any> = {};
    for (const [i, s] of candidateSenses.entries()) {
      signals[s.canonical_form] = {
        embedding_similarity: 0.5,
        phrase_signal: 0,
        phrase_matches: [],
        combined_score: 0.5 - i * 0.1,
      };
    }

    const prompt = buildFallbackPrompt({
      occurrence: {
        colloquial_term: 'alignment',
        offset: 0,
        length: 9,
        context_before: '',
        context_after: '',
      },
      signals,
      candidateSenses,
      config: { ...DEFAULT_CONFIG.llm_fallback, max_candidate_senses: 2 },
      largerContext: 'alignment context',
    });

    const senseHeaderCount = (prompt.match(/^### /gm) || []).length;
    expect(senseHeaderCount).toBeLessThanOrEqual(2);
  });
});

// ── Pipeline integration tests ─────────────────────────

describe('translateDocument', () => {
  it('runs full pipeline in LLM-disabled mode', async () => {
    const loader = makeLoader();
    const senseEmbeddings = loadSenseEmbeddings();

    const text = `
AI alignment is one of the most debated topics. Proponents argue that safety
research must be prioritized to manage risk. The governance framework should
balance transparency requirements with capabilities development.
    `.trim();

    const result = await translateDocument(text, {
      config: DEFAULT_CONFIG,
      loader,
      senseEmbeddings,
    });

    expect(result.records.length).toBeGreaterThan(0);
    expect(result.summary.total_occurrences).toBeGreaterThan(0);
    expect(result.dictionary_version).toBe('1.0.0');
    expect(result.pipeline_config.llm_fallback_enabled).toBe(false);

    for (const record of result.records) {
      expect(record.colloquial_term).toBeTruthy();
      expect(record.method).toBe('local_ensemble');
      expect(record.weights.w_e).toBe(0.85);
      expect(record.weights.w_p).toBe(0.15);
    }
  });

  it('returns empty records for text without colloquial terms', async () => {
    const loader = makeLoader();
    const senseEmbeddings = loadSenseEmbeddings();

    const result = await translateDocument(
      'This is a generic text about cooking recipes.',
      { config: DEFAULT_CONFIG, loader, senseEmbeddings },
    );

    expect(result.records).toHaveLength(0);
    expect(result.summary.total_occurrences).toBe(0);
  });

  it('respects quotation bypass in full pipeline', async () => {
    const loader = makeLoader();
    const senseEmbeddings = loadSenseEmbeddings();

    const text = '<q canonical-bypass>alignment matters</q> but safety is key.';
    const result = await translateDocument(text, {
      config: DEFAULT_CONFIG,
      loader,
      senseEmbeddings,
    });

    const terms = result.records.map(r => r.colloquial_term);
    expect(terms).not.toContain('alignment');
    expect(terms).toContain('safety');
  });

  it('marks unresolved as ambiguous when LLM disabled', async () => {
    const loader = makeLoader();
    const senseEmbeddings = loadSenseEmbeddings();

    const text = 'governance is important.';
    const result = await translateDocument(text, {
      config: {
        ...DEFAULT_CONFIG,
        routing: { ...DEFAULT_ROUTING, top_score_threshold: 0.99, margin_threshold: 0.99 },
      },
      loader,
      senseEmbeddings,
    });

    const govRecords = result.records.filter(r => r.colloquial_term === 'governance');
    expect(govRecords.length).toBeGreaterThan(0);
    for (const r of govRecords) {
      expect(r.confidence).toBe('ambiguous');
      expect(r.resolved_to).toBeNull();
    }
  });
});

// ── Lint constraint 4 tests ────────────────────────────

describe('lintText constraint 4', () => {
  it('detects bare colloquial terms in plain text', () => {
    const loader = makeLoader();
    const violations = lintText('The alignment problem is critical.', loader, { constraints: [4] });
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0].constraint_id).toBe(4);
    expect(violations[0].violation_text).toBe('alignment');
  });

  it('does not flag terms inside quotation markers', () => {
    const loader = makeLoader();
    const violations = lintText(
      '<q canonical-bypass>alignment</q> is discussed.',
      loader,
      { constraints: [4] },
    );
    const alignmentViolations = violations.filter(
      (v) => v.violation_text === 'alignment',
    );
    expect(alignmentViolations).toHaveLength(0);
  });

  it('does not flag terms inside code blocks', () => {
    const loader = makeLoader();
    const violations = lintText('```\nalignment\n```', loader, { constraints: [4] });
    expect(violations).toHaveLength(0);
  });

  it('does not flag terms inside inline code', () => {
    const loader = makeLoader();
    const violations = lintText('Use `alignment` here.', loader, { constraints: [4] });
    expect(violations).toHaveLength(0);
  });

  it('includes suggested fix with standardized alternatives', () => {
    const loader = makeLoader();
    const violations = lintText('alignment matters', loader, { constraints: [4] });
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0].suggested_fix).toContain('safety_alignment');
  });

  it('lintNodes checks label, description, and characteristic_language', () => {
    const loader = makeLoader();
    const nodes = [{
      id: 'test-001',
      label: 'alignment research',
      description: 'Study of alignment and safety',
      graph_attributes: {
        characteristic_language: ['governance framework'],
      },
    }];
    const violations = lintNodes(nodes, loader, { constraints: [4] });
    const terms = violations.map((v) => v.violation_text);
    expect(terms).toContain('alignment');
    expect(terms).toContain('safety');
    expect(terms).toContain('governance');
  });
});

// ── Lint constraints 7-10 tests ────────────────────────

describe('lintDictionary constraints 7-8', () => {
  it('constraint 7: accepted terms all have coinage_log_ref', () => {
    const loader = makeLoader();
    const violations = lintDictionary(loader, undefined, { constraints: [7] });
    expect(violations).toEqual([]);
  });

  it('constraint 8: all entries match current schema version', () => {
    const loader = makeLoader();
    const violations = lintDictionary(loader, undefined, { constraints: [8] });
    expect(violations).toEqual([]);
  });
});

describe('lintText constraint 10', () => {
  it('detects unmatched closing tag', () => {
    const loader = makeLoader();
    const violations = lintText('text </q> more', loader, { constraints: [10] });
    expect(violations).toHaveLength(1);
    expect(violations[0].constraint_id).toBe(10);
  });

  it('detects unmatched opening tag', () => {
    const loader = makeLoader();
    const violations = lintText('<q canonical-bypass>unclosed', loader, { constraints: [10] });
    expect(violations).toHaveLength(1);
    expect(violations[0].constraint_id).toBe(10);
  });

  it('passes well-formed quotation', () => {
    const loader = makeLoader();
    const violations = lintText('<q canonical-bypass>text</q>', loader, { constraints: [10] });
    expect(violations).toHaveLength(0);
  });
});
