// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// @vitest-environment node
// POV-tag orphan scan (t/3985; SO e/253#2 + #4): the differential classification, strict file reading, and
// the CLI's exit codes.

import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { scanPovTagOrphans, orphanScanExitCode, readTaxonomyNodes, type TaggedNode } from './povTagScan.js';
import type { PovTagRegistry } from './povTags.js';

const entry = (id: string) => ({ id, label: id, soul_doc: `skeptic.${id}`, description: `${id} wing` });
const reg = (...ids: string[]): PovTagRegistry => ({ version: 1, povs: ids.length ? { skeptic: ids.map(entry) } : {} });

describe('scanPovTagOrphans', () => {
  const tagged = (tags: unknown): TaggedNode[] => [{ id: 'skp-beliefs-001', pov_tags: tags }, { id: 'skp-beliefs-002' }, { id: 'sit-001' }];

  it('passes a clean corpus (plain mode)', () => {
    const r = scanPovTagOrphans(tagged(['critical']), reg('critical'));
    expect(r).toMatchObject({ mode: 'plain', checked: 3, introduced: 0, preexisting: 0, structural: 0 });
    expect(orphanScanExitCode(r)).toBe(0);
  });

  it('FAILS a registry change that removes a tag the data still carries (introduced, by tag)', () => {
    const r = scanPovTagOrphans(tagged(['critical']), reg(), reg('critical'));
    expect(r).toMatchObject({ mode: 'differential', introduced: 1, introducedByTag: { 'skeptic.critical': 1 }, preexisting: 0 });
    expect(orphanScanExitCode(r)).toBe(1);
  });

  it('only WARNS on an orphan already present under the base registry (one bad data commit never reds every PR)', () => {
    const r = scanPovTagOrphans(tagged(['old']), reg('critical'), reg('critical'));
    expect(r).toMatchObject({ introduced: 0, preexisting: 1, preexistingByTag: { 'skeptic.old': 1 } });
    expect(orphanScanExitCode(r)).toBe(0);
  });

  it('passes a rename done in order: new tag added, data migrated, old tag removed', () => {
    // Data already migrated to "new"; base still has both; this registry drops "old".
    const r = scanPovTagOrphans(tagged(['new']), reg('new'), reg('old', 'new'));
    expect(r.introduced).toBe(0);
    expect(orphanScanExitCode(r)).toBe(0);
  });

  it('reports structural problems: fail in plain mode, warn in differential mode', () => {
    const nodes: TaggedNode[] = [{ id: 'sit-001', pov_tags: ['critical'] }, { id: 'skp-beliefs-001', pov_tags: 'critical' }];
    const plain = scanPovTagOrphans(nodes, reg('critical'));
    expect(plain.structural).toBe(2);
    expect(orphanScanExitCode(plain)).toBe(1);
    const diff = scanPovTagOrphans(nodes, reg('critical'), reg('critical'));
    expect(diff.structural).toBe(2);
    expect(orphanScanExitCode(diff)).toBe(0);
  });

  it('counts each distinct tag on a node once, and per tag across nodes', () => {
    const nodes: TaggedNode[] = [
      { id: 'skp-beliefs-001', pov_tags: ['gone', 'gone'] },
      { id: 'skp-beliefs-002', pov_tags: ['gone', 'critical'] },
    ];
    const r = scanPovTagOrphans(nodes, reg('critical'), reg('critical', 'gone'));
    expect(r.introducedByTag).toEqual({ 'skeptic.gone': 2 });
    expect(r.structural).toBe(1); // the duplicate on 001
  });

  it('throws on a node without a string id (the scan cannot run), never skips it', () => {
    expect(() => scanPovTagOrphans([{ pov_tags: [] } as unknown as TaggedNode], reg())).toThrow(/string "id"/);
  });
});

/** Write a taxonomy Origin dir: the four node files, plus optional extras. Returns its path. */
function originDir(files: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), 'povtagscan-'));
  for (const [name, doc] of Object.entries(files)) writeFileSync(join(dir, name), typeof doc === 'string' ? doc : JSON.stringify(doc));
  return dir;
}
const FOUR = (skeptic: unknown[] = [{ id: 'skp-beliefs-001' }]) => ({
  'accelerationist.json': { nodes: [{ id: 'acc-beliefs-001' }] },
  'safetyist.json': { nodes: [{ id: 'saf-beliefs-001' }] },
  'skeptic.json': { nodes: skeptic },
  'situations.json': { nodes: [{ id: 'sit-001' }] },
});

describe('readTaxonomyNodes (CL p/3#285 scope; strict)', () => {
  it('reads only the four taxonomy node files, ignoring a decoy log with a "nodes" array', () => {
    const dir = originDir({ ...FOUR(), 'entity_extraction_log.json': { nodes: [{ id: 'skp-x', pov_tags: 'not-even-an-array' }] } });
    try {
      expect(readTaxonomyNodes(dir).map((n) => n.id).sort()).toEqual(['acc-beliefs-001', 'saf-beliefs-001', 'sit-001', 'skp-beliefs-001']);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('throws when a node file is missing or malformed: never "0 orphans"', () => {
    const { ['skeptic.json']: _omit, ...withoutSkeptic } = FOUR();
    const missing = originDir(withoutSkeptic);
    const malformed = originDir({ ...FOUR(), 'skeptic.json': 'not json' });
    const noNodes = originDir({ ...FOUR(), 'skeptic.json': { pov: 'skeptic' } });
    try {
      expect(() => readTaxonomyNodes(missing)).toThrow(/skeptic\.json/);
      expect(() => readTaxonomyNodes(malformed)).toThrow(/skeptic\.json/);
      expect(() => readTaxonomyNodes(noNodes)).toThrow(/no "nodes" array/);
    } finally { for (const d of [missing, malformed, noNodes]) rmSync(d, { recursive: true, force: true }); }
  });
});

describe('pov-tags-cli --scan-data (exit 0 / 1 / 2)', () => {
  const cli = fileURLToPath(new URL('./pov-tags-cli.ts', import.meta.url));
  const tsx = fileURLToPath(new URL('../../node_modules/.bin/' + (process.platform === 'win32' ? 'tsx.cmd' : 'tsx'), import.meta.url));
  const run = (args: string[]) => {
    const r = spawnSync(tsx, [cli, ...args], { encoding: 'utf8', shell: process.platform === 'win32' });
    const last = r.stdout.trim().split('\n').at(-1) ?? '';
    return { code: r.status, out: last ? (() => { try { return JSON.parse(last); } catch { return null; } })() : null };
  };
  // A tag the committed registry does NOT list, so it is an orphan under "this" (the checkout's) registry.
  const ORPHANED = [{ id: 'skp-beliefs-001', pov_tags: ['retired-wing'] }];

  it('exit 0 on an untagged corpus', () => {
    const dir = originDir(FOUR());
    try {
      const r = run(['--scan-data', dir]);
      expect(r.code).toBe(0);
      expect(r.out).toMatchObject({ mode: 'plain', checked: 4, introduced: 0 });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('exit 1 when this registry orphans a tag the base registry listed (differential)', () => {
    const dir = originDir({ ...FOUR(ORPHANED), 'base.json': reg('retired-wing') });
    try {
      const r = run(['--scan-data', dir, '--base-registry', join(dir, 'base.json')]);
      expect(r.code).toBe(1);
      expect(r.out).toMatchObject({ mode: 'differential', introduced: 1, introducedByTag: { 'skeptic.retired-wing': 1 } });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('exit 0 with a warning when the base registry already lacked the tag (preexisting)', () => {
    const dir = originDir({ ...FOUR(ORPHANED), 'base.json': reg() });
    try {
      const r = run(['--scan-data', dir, '--base-registry', join(dir, 'base.json')]);
      expect(r.code).toBe(0);
      expect(r.out).toMatchObject({ introduced: 0, preexisting: 1 });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('exit 2 (could not run) on a missing dir, a missing node file, or an invalid base registry', () => {
    const { ['situations.json']: _omit, ...partial } = FOUR();
    const dir = originDir({ ...partial, 'base.json': { version: 1, povs: { skeptic: [{ id: 'BAD ID' }] } } });
    const full = originDir({ ...FOUR(), 'base.json': { version: 1, povs: { skeptic: [{ id: 'BAD ID' }] } } });
    try {
      expect(run(['--scan-data', join(dir, 'does-not-exist')]).code).toBe(2);
      expect(run(['--scan-data', dir]).code).toBe(2);
      expect(run(['--scan-data', full, '--base-registry', join(full, 'base.json')]).code).toBe(2);
      expect(run(['--scan-data']).code).toBe(2);
    } finally { for (const d of [dir, full]) rmSync(d, { recursive: true, force: true }); }
  });
}, 120_000);
