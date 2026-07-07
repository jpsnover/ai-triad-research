// @vitest-environment node

/**
 * t/908 — paired flight-recorder dump storage + retention.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  isValidDumpId, selectExpiredDumps, writeDump, dumpsDir, mergeDumps, readMergedDump, type DumpFileInfo,
} from '../flightRecorderDumps.js';

describe('isValidDumpId (t/908)', () => {
  it('accepts UUID-safe ids, rejects traversal/empty/oversized', () => {
    expect(isValidDumpId('3f9a-aaaa-bbbb')).toBe(true);
    expect(isValidDumpId('a'.repeat(128))).toBe(true);
    expect(isValidDumpId('../etc/passwd')).toBe(false);
    expect(isValidDumpId('a/b')).toBe(false);
    expect(isValidDumpId('')).toBe(false);
    expect(isValidDumpId('a'.repeat(129))).toBe(false);
    expect(isValidDumpId(42)).toBe(false);
  });
});

function f(dumpId: string, kind: 'client' | 'server', mtime: number, size = 10): DumpFileInfo {
  return { name: `${kind}-${dumpId}.jsonl`, dumpId, mtime, size };
}

describe('selectExpiredDumps (t/908 AC#7)', () => {
  it('keeps everything when under both caps', () => {
    expect(selectExpiredDumps([f('a', 'client', 2), f('a', 'server', 2), f('b', 'client', 1)])).toEqual([]);
  });

  it('drops oldest dumpId pairs beyond the group cap — whole pairs together', () => {
    const files: DumpFileInfo[] = [];
    for (let i = 0; i < 22; i++) { files.push(f(`d${i}`, 'client', i), f(`d${i}`, 'server', i)); }
    const del = selectExpiredDumps(files, 20);
    // The 2 oldest groups (d0, d1) → both halves of each deleted.
    expect(del.sort()).toEqual(['client-d0.jsonl', 'client-d1.jsonl', 'server-d0.jsonl', 'server-d1.jsonl'].sort());
  });

  it('enforces the byte cap by dropping oldest survivors', () => {
    const files = [f('new', 'server', 3, 40), f('mid', 'server', 2, 40), f('old', 'server', 1, 40)];
    const del = selectExpiredDumps(files, 20, 100); // total 120 > 100 → drop oldest (old)
    expect(del).toEqual(['server-old.jsonl']);
  });
});

describe('writeDump (t/908)', () => {
  let root: string;
  beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'frdump-')); });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  it('writes a paired client + server dump joinable by dumpId', async () => {
    await writeDump(root, 'client', 'abc', '{"seq":1}\n');
    await writeDump(root, 'server', 'abc', '{"seq":2}\n');
    const dir = dumpsDir(root);
    expect(fs.existsSync(path.join(dir, 'client-abc.jsonl'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'server-abc.jsonl'))).toBe(true);
  });

  it('records each written dump in the sidecar retention index (t/1350)', async () => {
    await writeDump(root, 'client', 'abc', '{"seq":1}\n');
    await writeDump(root, 'server', 'abc', '{"seq":22}\n');
    const index = JSON.parse(fs.readFileSync(path.join(dumpsDir(root), 'dumps-index.json'), 'utf-8'));
    expect(index.abc).toBeDefined();
    expect(index.abc.client).toBe(Buffer.byteLength('{"seq":1}\n'));
    expect(index.abc.server).toBe(Buffer.byteLength('{"seq":22}\n'));
    expect(typeof index.abc.ts).toBe('number');
  });
});

// ── Merge logic (t/939) ─────────────────────────────────────────────

function ndjson(...records: Record<string, unknown>[]): string {
  return records.map(r => JSON.stringify(r)).join('\n') + '\n';
}

describe('mergeDumps (t/939)', () => {
  it('interleaves events by _wall timestamp and tags with _source/_merged_seq', () => {
    const client = ndjson(
      { _type: 'header', timestamp: '2026-01-01T00:00:00Z', capacity: 100, retained: 2, lost: 0 },
      { _type: 'event', _wall: '2026-01-01T00:00:01Z', type: 'click' },
      { _type: 'event', _wall: '2026-01-01T00:00:03Z', type: 'nav' },
    );
    const server = ndjson(
      { _type: 'header', timestamp: '2026-01-01T00:00:00Z', capacity: 200, retained: 1, lost: 0 },
      { _type: 'event', _wall: '2026-01-01T00:00:02Z', type: 'api.call' },
    );
    const merged = mergeDumps(client, server);
    const lines = merged.trim().split('\n').map(l => JSON.parse(l));

    const header = lines[0];
    expect(header._type).toBe('header');
    expect(header.merged).toBe(true);
    expect(header.total_events).toBe(3);
    expect(header.sources).toEqual(['client', 'server']);

    const events = lines.filter(l => l._source && l._type !== 'trigger');
    expect(events).toHaveLength(3);
    expect(events[0]._wall).toBe('2026-01-01T00:00:01Z');
    expect(events[0]._source).toBe('client');
    expect(events[0]._merged_seq).toBe(0);
    expect(events[1]._wall).toBe('2026-01-01T00:00:02Z');
    expect(events[1]._source).toBe('server');
    expect(events[1]._merged_seq).toBe(1);
    expect(events[2]._wall).toBe('2026-01-01T00:00:03Z');
    expect(events[2]._source).toBe('client');
    expect(events[2]._merged_seq).toBe(2);
  });

  it('deduplicates dictionary entries by category:value', () => {
    const client = ndjson(
      { _type: 'header' },
      { _type: 'dictionary', handle: 0, category: 'component', value: 'Toolbar' },
      { _type: 'dictionary', handle: 1, category: 'component', value: 'Sidebar' },
    );
    const server = ndjson(
      { _type: 'header' },
      { _type: 'dictionary', handle: 0, category: 'component', value: 'Toolbar' },
      { _type: 'dictionary', handle: 1, category: 'route', value: '/api/health' },
    );
    const merged = mergeDumps(client, server);
    const lines = merged.trim().split('\n').map(l => JSON.parse(l));
    const dicts = lines.filter(l => l._type === 'dictionary');
    expect(dicts).toHaveLength(3);
    expect(dicts.map(d => `${d.category}:${d.value}`)).toEqual([
      'component:Toolbar', 'component:Sidebar', 'route:/api/health',
    ]);
  });

  it('unions context fields and tracks provenance', () => {
    const client = ndjson(
      { _type: 'header' },
      { _type: 'context', userId: 'alice', theme: 'dark' },
    );
    const server = ndjson(
      { _type: 'header' },
      { _type: 'context', nodeVersion: '22', uptime: 3600 },
    );
    const merged = mergeDumps(client, server);
    const lines = merged.trim().split('\n').map(l => JSON.parse(l));
    const ctx = lines.find(l => l._type === 'context');
    expect(ctx.userId).toBe('alice');
    expect(ctx.theme).toBe('dark');
    expect(ctx.nodeVersion).toBe('22');
    expect(ctx._client_fields).toEqual(['userId', 'theme']);
    expect(ctx._server_fields).toEqual(['nodeVersion', 'uptime']);
  });

  it('handles client-only merge (no server dump)', () => {
    const client = ndjson(
      { _type: 'header', timestamp: '2026-01-01T00:00:00Z' },
      { _type: 'event', _wall: '2026-01-01T00:00:01Z', type: 'click' },
    );
    const merged = mergeDumps(client, null);
    const lines = merged.trim().split('\n').map(l => JSON.parse(l));
    const header = lines[0];
    expect(header.merged).toBe(true);
    expect(header.sources).toEqual(['client']);
    expect(header.total_events).toBe(1);
  });

  it('tags triggers with _source from each side', () => {
    const client = ndjson(
      { _type: 'header' },
      { _type: 'trigger', action: 'user-clicked-dump' },
    );
    const server = ndjson(
      { _type: 'header' },
      { _type: 'trigger', action: 'admin-requested' },
    );
    const merged = mergeDumps(client, server);
    const lines = merged.trim().split('\n').map(l => JSON.parse(l));
    const triggers = lines.filter(l => l._type === 'trigger');
    expect(triggers).toHaveLength(2);
    expect(triggers[0]._source).toBe('client');
    expect(triggers[1]._source).toBe('server');
  });
});

describe('readMergedDump (t/939)', () => {
  let root: string;
  beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'frdump-merge-')); });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  it('merges paired files from disk', async () => {
    const clientNdjson = ndjson(
      { _type: 'header', capacity: 100 },
      { _type: 'event', _wall: '2026-01-01T00:00:01Z', type: 'click' },
    );
    const serverNdjson = ndjson(
      { _type: 'header', capacity: 200 },
      { _type: 'event', _wall: '2026-01-01T00:00:02Z', type: 'api' },
    );
    await writeDump(root, 'client', 'test-id', clientNdjson);
    await writeDump(root, 'server', 'test-id', serverNdjson);

    const merged = await readMergedDump(root, 'test-id');
    expect(merged).not.toBeNull();
    const lines = merged!.trim().split('\n').map(l => JSON.parse(l));
    expect(lines[0].merged).toBe(true);
    expect(lines[0].total_events).toBe(2);
  });

  it('returns null when neither file exists', async () => {
    expect(await readMergedDump(root, 'nonexistent')).toBeNull();
  });

  it('handles single-side (client only) gracefully', async () => {
    await writeDump(root, 'client', 'solo', ndjson(
      { _type: 'header' },
      { _type: 'event', _wall: '2026-01-01T00:00:01Z', type: 'click' },
    ));
    const merged = await readMergedDump(root, 'solo');
    expect(merged).not.toBeNull();
    const lines = merged!.trim().split('\n').map(l => JSON.parse(l));
    expect(lines[0].sources).toEqual(['client']);
  });

  it('excludes the server half when includeServer:false (t/1064 — non-admin merge)', async () => {
    await writeDump(root, 'client', 'gated', ndjson(
      { _type: 'header' },
      { _type: 'event', _wall: '2026-01-01T00:00:01Z', type: 'click' },
    ));
    await writeDump(root, 'server', 'gated', ndjson(
      { _type: 'header' },
      { _type: 'event', _wall: '2026-01-01T00:00:02Z', type: 'api' },
    ));
    const merged = await readMergedDump(root, 'gated', { includeServer: false });
    expect(merged).not.toBeNull();
    const lines = merged!.trim().split('\n').map(l => JSON.parse(l));
    expect(lines[0].sources).toEqual(['client']); // server events withheld from non-admin
    expect(lines[0].total_events).toBe(1);
  });

  it('returns null for a server-only dumpId when includeServer:false', async () => {
    await writeDump(root, 'server', 'srvonly', ndjson(
      { _type: 'header' },
      { _type: 'event', _wall: '2026-01-01T00:00:01Z', type: 'api' },
    ));
    expect(await readMergedDump(root, 'srvonly', { includeServer: false })).toBeNull();
  });
});
