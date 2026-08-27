// @vitest-environment node

/**
 * t/1998 — the GET /api/greatest-hits reader (loadGreatestHitsNodeIds).
 *
 * Verifies the contract that matters (TE p/74#83, t/1998#3): returns `{ node_ids }`
 * — a plain array, never the Set that loadGreatestHitsFile yields (JSON.stringify of
 * a Set is `{}`) — when the file exists, and null when it's absent or malformed
 * (graceful no-op; the renderer degrades loudly per t/1998#2).
 *
 * t/3095: migrated from fs.readFileSync to readDataFile; test updated to mock
 * readDataFile instead of writing real files.
 */

import { describe, it, expect, vi } from 'vitest';
import { ActionableError } from '../../../../lib/debate/errors.js';

// ── Hoisted fns ───────────────────────────────────────────────────────────────

const { mockReadDataFile } = vi.hoisted(() => {
  const mockReadDataFile = vi.fn<[string, unknown?], Promise<Buffer>>();
  return { mockReadDataFile };
});

vi.mock('../storage/readDataFile.js', () => ({
  readDataFile: mockReadDataFile,
}));

// ── Imports after mocks ───────────────────────────────────────────────────────

import { loadGreatestHitsNodeIds } from '../routes/sources.js';

function buf(content: unknown): Buffer {
  return Buffer.from(typeof content === 'string' ? content : JSON.stringify(content), 'utf-8');
}

function absent(): void {
  mockReadDataFile.mockRejectedValue(new ActionableError({
    goal: 'Read data file: calibration/greatest-hits.json',
    problem: 'File not found',
    location: 'readDataFile',
    nextSteps: ['verify data root'],
  }));
}

describe('loadGreatestHitsNodeIds (t/1998)', () => {
  it('returns null when the file is absent', async () => {
    absent();
    expect(await loadGreatestHitsNodeIds()).toBeNull();
  });

  it('returns { node_ids } — a plain array, not a Set — when present', async () => {
    mockReadDataFile.mockResolvedValue(buf({ version: 1, node_ids: ['acc-bel-001', 'saf-des-002'] }));
    const result = await loadGreatestHitsNodeIds();
    expect(result).toEqual({ node_ids: ['acc-bel-001', 'saf-des-002'] });
    // Guards the exact bug the contract warns about: it JSON-round-trips as an array,
    // never `{}` (which is what json(res, new Set()) would serialize to).
    expect(JSON.parse(JSON.stringify(result))).toEqual({ node_ids: ['acc-bel-001', 'saf-des-002'] });
  });

  it('t/2003: reads the v2 shape (nodes[].node_id) into { node_ids }', async () => {
    mockReadDataFile.mockResolvedValue(buf({
      version: 2,
      nodes: [
        { node_id: 'acc-beliefs-085', pov: 'accelerationist', bdi_category: 'beliefs', debate_count: 107, crux_link_count: 2 },
        { node_id: 'acc-beliefs-032', pov: 'accelerationist', bdi_category: 'beliefs', debate_count: 85, crux_link_count: 21 },
      ],
    }));
    expect(await loadGreatestHitsNodeIds()).toEqual({ node_ids: ['acc-beliefs-085', 'acc-beliefs-032'] });
  });

  it('t/2003: v1 node_ids take precedence when both shapes are present', async () => {
    mockReadDataFile.mockResolvedValue(buf({ version: 2, node_ids: ['v1-id'], nodes: [{ node_id: 'v2-id' }] }));
    expect(await loadGreatestHitsNodeIds()).toEqual({ node_ids: ['v1-id'] });
  });

  it('t/2003: v2 filters entries with a non-string or missing node_id', async () => {
    mockReadDataFile.mockResolvedValue(buf({ version: 2, nodes: [{ node_id: 'ok' }, { node_id: 42 }, {}] }));
    expect(await loadGreatestHitsNodeIds()).toEqual({ node_ids: ['ok'] });
  });

  it('returns null on malformed JSON (graceful no-op)', async () => {
    mockReadDataFile.mockResolvedValue(buf('{ not valid json'));
    expect(await loadGreatestHitsNodeIds()).toBeNull();
  });

  it('coerces a missing / non-array node_ids to an empty list', async () => {
    mockReadDataFile.mockResolvedValue(buf({ version: 1 }));
    expect(await loadGreatestHitsNodeIds()).toEqual({ node_ids: [] });
    mockReadDataFile.mockResolvedValue(buf({ node_ids: 'oops' }));
    expect(await loadGreatestHitsNodeIds()).toEqual({ node_ids: [] });
  });

  it('filters out non-string entries', async () => {
    mockReadDataFile.mockResolvedValue(buf({ node_ids: ['ok', 42, null, 'also-ok'] }));
    expect(await loadGreatestHitsNodeIds()).toEqual({ node_ids: ['ok', 'also-ok'] });
  });
});
