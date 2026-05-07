// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { retrieveEvidence, clearSourceIndex } from './evidenceRetriever.js';

// ── Mock filesystem ──────────────────────────────────────

const MOCK_SOURCES_DIR = '/mock/sources';

function mockSource(id: string, title: string, oneLiner: string, tags: string[], snapshot: string) {
  return { id, title, oneLiner, tags, snapshot };
}

const MOCK_SOURCES = [
  mockSource(
    'ai-regulation-2026',
    'AI Regulation Framework 2026',
    'Comprehensive overview of global AI regulation including safety requirements and compliance standards',
    ['regulation', 'governance', 'safety'],
    'The EU AI Act establishes comprehensive requirements for high-risk AI systems.\n\nCompanies must implement risk management frameworks and conduct conformity assessments before deploying AI in critical sectors.\n\nThe regulation requires transparency and human oversight for automated decision-making systems.',
  ),
  mockSource(
    'compute-governance-overview',
    'Compute Governance and AI Development',
    'Analysis of computational resource governance as a lever for AI safety policy',
    ['compute', 'governance', 'safety', 'policy'],
    'Compute governance represents a promising approach to AI regulation.\n\nBy controlling access to large-scale computational resources, governments can influence the pace and direction of AI development.\n\nCritics argue that compute governance may stifle innovation and disproportionately affect smaller organizations.',
  ),
  mockSource(
    'alignment-tax-study',
    'The Alignment Tax: Performance Costs of Safety Constraints',
    'Empirical study measuring the performance overhead of safety alignment techniques on large language models',
    ['alignment', 'safety', 'performance', 'benchmarks'],
    'Safety alignment techniques impose measurable performance costs on language models.\n\nRLHF reduces benchmark accuracy by 3-7% across standard tasks while improving harmlessness scores.\n\nConstitutional AI methods show smaller alignment tax (1-3%) but require more compute during training.',
  ),
];

function setupMockFs() {
  const originalReaddir = fs.readdirSync;
  const originalReadFile = fs.readFileSync;
  const originalExists = fs.existsSync;
  const originalStat = fs.statSync;

  vi.spyOn(fs, 'readdirSync').mockImplementation(((dir: string, opts?: unknown) => {
    if (dir === MOCK_SOURCES_DIR) {
      return MOCK_SOURCES.map(s => ({
        name: s.id,
        isDirectory: () => true,
        isFile: () => false,
      }));
    }
    return originalReaddir(dir, opts as fs.ObjectEncodingOptions & { withFileTypes: boolean; recursive?: boolean });
  }) as typeof fs.readdirSync);

  vi.spyOn(fs, 'readFileSync').mockImplementation(((filePath: string, encoding?: unknown) => {
    const p = filePath as string;
    for (const src of MOCK_SOURCES) {
      if (p === path.join(MOCK_SOURCES_DIR, src.id, 'metadata.json')) {
        return JSON.stringify({
          id: src.id,
          title: src.title,
          one_liner: src.oneLiner,
          topic_tags: src.tags,
        });
      }
      if (p === path.join(MOCK_SOURCES_DIR, src.id, 'snapshot.md')) {
        return src.snapshot;
      }
    }
    return originalReadFile(filePath, encoding as BufferEncoding);
  }) as typeof fs.readFileSync);

  vi.spyOn(fs, 'existsSync').mockImplementation(((filePath: string) => {
    const p = filePath as string;
    if (p === MOCK_SOURCES_DIR) return true;
    for (const src of MOCK_SOURCES) {
      if (p === path.join(MOCK_SOURCES_DIR, src.id, 'metadata.json')) return true;
      if (p === path.join(MOCK_SOURCES_DIR, src.id, 'snapshot.md')) return true;
    }
    return originalExists(p);
  }) as typeof fs.existsSync);

  vi.spyOn(fs, 'statSync').mockImplementation(((filePath: string) => {
    const p = filePath as string;
    for (const src of MOCK_SOURCES) {
      if (p === path.join(MOCK_SOURCES_DIR, src.id, 'snapshot.md')) {
        return { isDirectory: () => false, isFile: () => true } as fs.Stats;
      }
    }
    return originalStat(p);
  }) as typeof fs.statSync);
}

// ── Tests ─────────────────────────────────────────────────

describe('evidenceRetriever', () => {
  beforeEach(() => {
    clearSourceIndex();
    setupMockFs();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    clearSourceIndex();
  });

  it('retrieves relevant evidence for a matching claim', () => {
    const items = retrieveEvidence(
      'AI regulation requires risk management frameworks for high-risk systems',
      MOCK_SOURCES_DIR,
    );
    expect(items.length).toBeGreaterThan(0);
    expect(items[0].source_doc_id).toBe('ai-regulation-2026');
    expect(items[0].similarity_score).toBeGreaterThan(0);
  });

  it('returns empty array for unrelated claim', () => {
    const items = retrieveEvidence(
      'quantum computing superconductor materials breakthrough',
      MOCK_SOURCES_DIR,
    );
    expect(items).toEqual([]);
  });

  it('respects topK limit', () => {
    const items = retrieveEvidence(
      'AI safety governance regulation compute alignment',
      MOCK_SOURCES_DIR,
      { topK: 2 },
    );
    expect(items.length).toBeLessThanOrEqual(2);
  });

  it('includes source_doc_id and text in evidence items', () => {
    const items = retrieveEvidence(
      'compute governance AI development regulation',
      MOCK_SOURCES_DIR,
    );
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item.id).toMatch(/^ev-\d+$/);
      expect(item.source_doc_id).toBeTruthy();
      expect(item.text).toBeTruthy();
      expect(typeof item.similarity_score).toBe('number');
    }
  });

  it('scores alignment-related sources higher for alignment claims', () => {
    const items = retrieveEvidence(
      'alignment tax performance costs safety constraints language models',
      MOCK_SOURCES_DIR,
    );
    expect(items.length).toBeGreaterThan(0);
    // The alignment-tax source should be ranked first
    const alignmentItems = items.filter(i => i.source_doc_id === 'alignment-tax-study');
    expect(alignmentItems.length).toBeGreaterThan(0);
  });

  it('filters by minSimilarity threshold', () => {
    // A very high threshold should exclude even partial matches
    const items = retrieveEvidence(
      'obscure niche topic about unrelated field of study',
      MOCK_SOURCES_DIR,
      { minSimilarity: 0.5 },
    );
    expect(items).toEqual([]);
  });

  it('caches source index across calls', () => {
    retrieveEvidence('test claim one', MOCK_SOURCES_DIR);
    const readDirSpy = vi.mocked(fs.readdirSync);
    const callCountAfterFirst = readDirSpy.mock.calls.length;
    retrieveEvidence('test claim two', MOCK_SOURCES_DIR);
    // readdirSync for the sources dir should not be called again
    const newCalls = readDirSpy.mock.calls.slice(callCountAfterFirst);
    const sourcesDirCalls = newCalls.filter(c => c[0] === MOCK_SOURCES_DIR);
    expect(sourcesDirCalls.length).toBe(0);
  });
});
