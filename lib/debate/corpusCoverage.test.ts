// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { computeCorpusCoverage, saveCoverageMap, loadCoverageMap } from './corpusCoverage.js';

// ── Mock fns (module-level, survive across describes) ─────

const mockExistsSync = vi.fn();
const mockReaddirSync = vi.fn();
const mockReadFileSync = vi.fn();
const mockWriteFileSync = vi.fn();
const mockMkdirSync = vi.fn();

vi.mock('fs', () => ({
  default: {
    existsSync: (...args: unknown[]) => mockExistsSync(...args),
    readdirSync: (...args: unknown[]) => mockReaddirSync(...args),
    readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
    writeFileSync: (...args: unknown[]) => mockWriteFileSync(...args),
    mkdirSync: (...args: unknown[]) => mockMkdirSync(...args),
  },
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  readdirSync: (...args: unknown[]) => mockReaddirSync(...args),
  readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
  writeFileSync: (...args: unknown[]) => mockWriteFileSync(...args),
  mkdirSync: (...args: unknown[]) => mockMkdirSync(...args),
}));

// ── Helpers ───────────────────────────────────────────────

function makeDebate(id: string, transcriptRefs: string[][], anRefs: string[][] = []) {
  return JSON.stringify({
    id,
    transcript: transcriptRefs.map((refs, i) => ({
      id: `e${i}`,
      type: i === 0 ? 'opening' : 'statement',
      speaker: 'accelerationist',
      taxonomy_refs: refs.map(r => ({ node_id: r })),
    })),
    argument_network: {
      nodes: anRefs.map((refs, i) => ({
        id: `AN-${i}`,
        text: `claim ${i}`,
        speaker: 'accelerationist',
        source_entry_id: `e${i}`,
        taxonomy_refs: refs,
        turn_number: 1,
      })),
      edges: [],
    },
  });
}

function makeCruxRegistry(entries: { related_taxonomy_nodes: string[] }[]) {
  return JSON.stringify({
    version: 1,
    entries: entries.map((e, i) => ({
      id: `crux-${i}`,
      description: `Crux ${i}`,
      embedding: [],
      disagreement_type: 'empirical',
      first_seen_debate: 'debate-1',
      first_seen_date: '2026-01-01',
      occurrences: [],
      ...e,
    })),
    last_updated: '2026-01-01',
  });
}

function setupMocks(config: {
  existsSync?: (p: string) => boolean;
  readdirSync?: string[];
  readFileSync?: (p: string) => string;
  writeFileSync?: (p: string, content: string) => void;
}) {
  if (config.existsSync) {
    mockExistsSync.mockImplementation((p: unknown) => config.existsSync!(String(p)));
  }
  if (config.readdirSync) {
    mockReaddirSync.mockReturnValue(config.readdirSync);
  }
  if (config.readFileSync) {
    mockReadFileSync.mockImplementation((p: unknown) => config.readFileSync!(String(p)));
  }
  if (config.writeFileSync) {
    mockWriteFileSync.mockImplementation((p: unknown, content: unknown) =>
      config.writeFileSync!(String(p), String(content)),
    );
    if (!config.existsSync) {
      mockExistsSync.mockReturnValue(true);
    }
    mockMkdirSync.mockReturnValue(undefined);
  }
}

describe('computeCorpusCoverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('counts node appearances across debates and flags retreads', () => {
    const debatesDir = '/data/debates';
    const dataRoot = '/data';
    const debate1 = makeDebate('d1', [['acc-beliefs-001', 'saf-desires-002']]);
    const debate2 = makeDebate('d2', [['acc-beliefs-001']]);

    setupMocks({
      existsSync: (p) => {
        if (p.includes('debates')) return !p.includes('cli-runs');
        if (p.includes('crux-registry')) return true;
        return false;
      },
      readdirSync: ['debate-d1.json', 'debate-d2.json'],
      readFileSync: (p) => {
        if (p.includes('debate-d1')) return debate1;
        if (p.includes('debate-d2')) return debate2;
        if (p.includes('crux-registry')) return makeCruxRegistry([]);
        return '';
      },
    });

    const result = computeCorpusCoverage(debatesDir, dataRoot, 2);

    expect(result.debates_scanned).toBe(2);
    expect(result.unique_nodes).toBe(2);
    expect(result.coverageMap.node_stats['acc-beliefs-001'].debate_count).toBe(2);
    expect(result.coverageMap.node_stats['acc-beliefs-001'].retread_flag).toBe(true);
    expect(result.coverageMap.node_stats['saf-desires-002'].debate_count).toBe(1);
    expect(result.coverageMap.node_stats['saf-desires-002'].retread_flag).toBe(false);
  });

  it('protects fault-line nodes from retread flag', () => {
    const debatesDir = '/data/debates';
    const dataRoot = '/data';

    setupMocks({
      existsSync: (p) => {
        if (p.includes('debates')) return !p.includes('cli-runs');
        if (p.includes('crux-registry')) return true;
        return false;
      },
      readdirSync: ['debate-d1.json', 'debate-d2.json'],
      readFileSync: (p) => {
        if (p.includes('debate-')) return makeDebate('d', [['acc-beliefs-001']]);
        if (p.includes('crux-registry')) return makeCruxRegistry([
          { related_taxonomy_nodes: ['acc-beliefs-001'] },
          { related_taxonomy_nodes: ['acc-beliefs-001'] },
        ]);
        return '';
      },
    });

    const result = computeCorpusCoverage(debatesDir, dataRoot, 2);

    expect(result.coverageMap.node_stats['acc-beliefs-001'].crux_link_count).toBe(2);
    expect(result.coverageMap.node_stats['acc-beliefs-001'].retread_flag).toBe(false);
    expect(result.fault_line_count).toBe(1);
    expect(result.retread_count).toBe(0);
  });

  it('handles AN taxonomy_refs as string arrays', () => {
    const debatesDir = '/data/debates';
    const dataRoot = '/data';
    const debate = makeDebate('d1', [], [['skp-intentions-003']]);

    setupMocks({
      existsSync: (p) => {
        if (p.includes('debates')) return !p.includes('cli-runs');
        if (p.includes('crux-registry')) return true;
        return false;
      },
      readdirSync: ['debate-d1.json'],
      readFileSync: (p) => {
        if (p.includes('debate-')) return debate;
        if (p.includes('crux-registry')) return makeCruxRegistry([]);
        return '';
      },
    });

    const result = computeCorpusCoverage(debatesDir, dataRoot);

    expect(result.coverageMap.node_stats['skp-intentions-003'].debate_count).toBe(1);
  });

  it('returns empty stats when debates dir does not exist', () => {
    setupMocks({
      existsSync: () => false,
      readFileSync: () => '',
    });

    const result = computeCorpusCoverage('/nonexistent', '/data');

    expect(result.debates_scanned).toBe(0);
    expect(result.unique_nodes).toBe(0);
  });
});

describe('saveCoverageMap / loadCoverageMap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('round-trips a coverage map', () => {
    const map = {
      version: 1 as const,
      last_updated: '2026-07-01T00:00:00Z',
      debate_count_threshold: 20,
      node_stats: {
        'acc-beliefs-001': { debate_count: 25, crux_link_count: 0, retread_flag: true },
      },
    };

    let written = '';
    setupMocks({
      existsSync: () => true,
      writeFileSync: (_p, content) => { written = content; },
      readFileSync: () => written,
    });

    saveCoverageMap(map, '/data');
    const loaded = loadCoverageMap('/data');

    expect(loaded).not.toBeNull();
    expect(loaded!.node_stats['acc-beliefs-001'].retread_flag).toBe(true);
  });

  it('returns null for missing file', () => {
    setupMocks({
      existsSync: () => false,
    });

    expect(loadCoverageMap('/data')).toBeNull();
  });
});
