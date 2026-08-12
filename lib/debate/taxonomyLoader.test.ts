import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'path';

const mockExistsSync = vi.fn();
const mockReadFileSync = vi.fn();
const mockFetchUrlForPrompt = vi.fn();

vi.mock('../url-fetch/fetchUrlForPrompt.js', () => ({
  fetchUrlForPrompt: (...args: unknown[]) => mockFetchUrlForPrompt(...args),
}));

vi.mock('fs', () => ({
  default: {
    existsSync: (...args: unknown[]) => mockExistsSync(...args),
    readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
    readdirSync: vi.fn(() => []),
    statSync: vi.fn(),
  },
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
  readdirSync: vi.fn(() => []),
  statSync: vi.fn(),
}));

vi.mock('../npy.js', () => ({
  parseNpy: vi.fn(),
  extractNodeVectors: vi.fn(() => ({})),
}));

import { loadConflicts, fetchUrlContent } from './taxonomyLoader.js';

const FAKE_DATA_ROOT = path.resolve('/fake/data');
const FAKE_ROOT = '/fake/repo';
const FAKE_CONFIG = {
  data_root: '../ai-triad-data',
  taxonomy_dir: 'taxonomy',
  conflicts_dir: 'conflicts',
  debates_dir: 'debates',
};

function setupFsMocks(conflictsFileContent: unknown | null) {
  mockExistsSync.mockImplementation((p: string) => {
    if (p === FAKE_DATA_ROOT) return true;
    if (p.endsWith('.aitriad.json')) return true;
    if (p.endsWith('conflicts.json')) return conflictsFileContent !== null;
    return false;
  });

  mockReadFileSync.mockImplementation((p: string) => {
    if (p.endsWith('.aitriad.json')) return JSON.stringify(FAKE_CONFIG);
    if (p.endsWith('conflicts.json') && conflictsFileContent !== null) {
      return JSON.stringify(conflictsFileContent);
    }
    throw new Error(`ENOENT: ${p}`);
  });
}

describe('loadConflicts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AI_TRIAD_DATA_ROOT = FAKE_DATA_ROOT;
  });

  afterEach(() => {
    delete process.env.AI_TRIAD_DATA_ROOT;
  });

  it('returns conflicts array from conflicts.json wrapper', () => {
    const conflicts = [
      { claim_id: 'c1', claim_label: 'Test', description: 'Desc', status: 'open', linked_taxonomy_nodes: [], instances: [] },
      { claim_id: 'c2', claim_label: 'Test2', description: 'Desc2', status: 'resolved', linked_taxonomy_nodes: ['acc-B-001'], instances: [] },
    ];
    setupFsMocks({ _schema_version: '2.0', conflict_count: 2, conflicts });

    const result = loadConflicts(FAKE_ROOT);
    expect(result).toEqual(conflicts);
    expect(result).toHaveLength(2);
  });

  it('returns empty array when conflicts.json does not exist', () => {
    setupFsMocks(null);
    const result = loadConflicts(FAKE_ROOT);
    expect(result).toEqual([]);
  });

  it('returns empty array when conflicts key is missing', () => {
    setupFsMocks({ _schema_version: '2.0', something_else: [] });
    const result = loadConflicts(FAKE_ROOT);
    expect(result).toEqual([]);
  });

  it('returns empty array when conflicts key is not an array', () => {
    setupFsMocks({ _schema_version: '2.0', conflicts: 'not-an-array' });
    const result = loadConflicts(FAKE_ROOT);
    expect(result).toEqual([]);
  });

  it('returns empty array when file is malformed JSON', () => {
    mockExistsSync.mockImplementation((p: string) => {
      if (p === FAKE_DATA_ROOT) return true;
      if (p.endsWith('.aitriad.json')) return true;
      if (p.endsWith('conflicts.json')) return true;
      return false;
    });
    mockReadFileSync.mockImplementation((p: string) => {
      if (p.endsWith('.aitriad.json')) return JSON.stringify(FAKE_CONFIG);
      if (p.endsWith('conflicts.json')) return '{not valid json';
      throw new Error(`ENOENT: ${p}`);
    });

    const result = loadConflicts(FAKE_ROOT);
    expect(result).toEqual([]);
  });

  it('reads from the correct path (conflicts_dir/conflicts.json)', () => {
    setupFsMocks({ _schema_version: '2.0', conflicts: [] });
    loadConflicts(FAKE_ROOT);

    const existsCalls = mockExistsSync.mock.calls.map((c: unknown[]) => c[0] as string);
    const conflictsCall = existsCalls.find((p: string) => p.includes('conflicts.json'));
    expect(conflictsCall).toMatch(/conflicts[/\\]conflicts\.json$/);
  });
});

describe('fetchUrlContent (L10 SSRF regression — t/2528)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns text from fetchUrlForPrompt on success', async () => {
    mockFetchUrlForPrompt.mockResolvedValue({ ok: true, text: 'Hello world', title: undefined, finalUrl: 'https://example.com', truncated: false });
    const result = await fetchUrlContent('https://example.com');
    expect(result).toBe('Hello world');
    expect(mockFetchUrlForPrompt).toHaveBeenCalledWith('https://example.com');
  });

  it('throws ActionableError when fetchUrlForPrompt blocks a private/SSRF URL', async () => {
    mockFetchUrlForPrompt.mockResolvedValue({ ok: false, reason: 'ssrf' });
    await expect(fetchUrlContent('http://169.254.169.254/latest/meta-data/')).rejects.toMatchObject({
      goal: 'Fetch debate source URL',
    });
  });

  it('throws ActionableError on network failure', async () => {
    mockFetchUrlForPrompt.mockResolvedValue({ ok: false, reason: 'network' });
    await expect(fetchUrlContent('https://unreachable.example.com')).rejects.toMatchObject({
      goal: 'Fetch debate source URL',
    });
  });
});
