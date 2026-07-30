// @vitest-environment node

/**
 * t/1998 — the GET /api/greatest-hits reader (loadGreatestHitsNodeIds).
 *
 * Verifies the contract that matters (TE p/74#83, t/1998#3): returns `{ node_ids }`
 * — a plain array, never the Set that loadGreatestHitsFile yields (JSON.stringify of
 * a Set is `{}`) — when the file exists, and null when it's absent or malformed
 * (graceful no-op; the renderer degrades loudly per t/1998#2).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { loadGreatestHitsNodeIds } from '../routes/sources.js';

let dataRoot: string;

function writeGreatestHits(content: string): void {
  const dir = path.join(dataRoot, 'calibration');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'greatest-hits.json'), content, 'utf-8');
}

describe('loadGreatestHitsNodeIds (t/1998)', () => {
  beforeEach(() => {
    dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ghits-'));
    process.env.AI_TRIAD_DATA_ROOT = dataRoot;
  });
  afterEach(() => {
    delete process.env.AI_TRIAD_DATA_ROOT;
    fs.rmSync(dataRoot, { recursive: true, force: true });
  });

  it('returns null when the file is absent', () => {
    expect(loadGreatestHitsNodeIds()).toBeNull();
  });

  it('returns { node_ids } — a plain array, not a Set — when present', () => {
    writeGreatestHits(JSON.stringify({ version: 1, node_ids: ['acc-bel-001', 'saf-des-002'] }));
    const result = loadGreatestHitsNodeIds();
    expect(result).toEqual({ node_ids: ['acc-bel-001', 'saf-des-002'] });
    // Guards the exact bug the contract warns about: it JSON-round-trips as an array,
    // never `{}` (which is what json(res, new Set()) would serialize to).
    expect(JSON.parse(JSON.stringify(result))).toEqual({ node_ids: ['acc-bel-001', 'saf-des-002'] });
  });

  it('t/2003: reads the v2 shape (nodes[].node_id) into { node_ids }', () => {
    writeGreatestHits(JSON.stringify({
      version: 2,
      nodes: [
        { node_id: 'acc-beliefs-085', pov: 'accelerationist', bdi_category: 'beliefs', debate_count: 107, crux_link_count: 2 },
        { node_id: 'acc-beliefs-032', pov: 'accelerationist', bdi_category: 'beliefs', debate_count: 85, crux_link_count: 21 },
      ],
    }));
    expect(loadGreatestHitsNodeIds()).toEqual({ node_ids: ['acc-beliefs-085', 'acc-beliefs-032'] });
  });

  it('t/2003: v1 node_ids take precedence when both shapes are present', () => {
    writeGreatestHits(JSON.stringify({ version: 2, node_ids: ['v1-id'], nodes: [{ node_id: 'v2-id' }] }));
    expect(loadGreatestHitsNodeIds()).toEqual({ node_ids: ['v1-id'] });
  });

  it('t/2003: v2 filters entries with a non-string or missing node_id', () => {
    writeGreatestHits(JSON.stringify({ version: 2, nodes: [{ node_id: 'ok' }, { node_id: 42 }, {}] }));
    expect(loadGreatestHitsNodeIds()).toEqual({ node_ids: ['ok'] });
  });

  it('returns null on malformed JSON (graceful no-op)', () => {
    writeGreatestHits('{ not valid json');
    expect(loadGreatestHitsNodeIds()).toBeNull();
  });

  it('coerces a missing / non-array node_ids to an empty list', () => {
    writeGreatestHits(JSON.stringify({ version: 1 }));
    expect(loadGreatestHitsNodeIds()).toEqual({ node_ids: [] });
    writeGreatestHits(JSON.stringify({ node_ids: 'oops' }));
    expect(loadGreatestHitsNodeIds()).toEqual({ node_ids: [] });
  });

  it('filters out non-string entries', () => {
    writeGreatestHits(JSON.stringify({ node_ids: ['ok', 42, null, 'also-ok'] }));
    expect(loadGreatestHitsNodeIds()).toEqual({ node_ids: ['ok', 'also-ok'] });
  });
});
