// @vitest-environment node
//
// t/2644 — featureFlags lost-update race. Prod runs 2 replicas, each with its own 30s cache.
// The old write path re-serialized a (possibly stale) whole cache, so a stale-cache replica's
// write clobbered another replica's committed change at FILE granularity — the env-web-opeds
// revert bounced back to true. Fix: read-modify-write against FRESH file state (merge only the
// target flag) + a content-hash precondition with bounded retry + atomic temp→rename.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { setFlag, getFlagMetadata, _resetFlagCache } from '../featureFlags.js';

let dataRoot: string;
const SAVED: Record<string, string | undefined> = {};
const flagsFile = () => path.join(dataRoot, 'admin', 'feature-flags.json');
const auditFile = () => path.join(dataRoot, 'admin', 'feature-flags-audit.ndjson');
const readDisk = () => JSON.parse(fs.readFileSync(flagsFile(), 'utf-8')) as { flags: Record<string, { enabled: boolean }> };

beforeEach(() => {
  dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ffrmw-'));
  for (const k of ['AI_TRIAD_DATA_ROOT', 'AI_TRIAD_STATE_ROOT', 'ADMIN_USERS']) SAVED[k] = process.env[k];
  delete process.env.AI_TRIAD_STATE_ROOT;
  process.env.AI_TRIAD_DATA_ROOT = dataRoot; // getStateRoot() defaults to getDataRoot() when STATE_ROOT unset
  process.env.ADMIN_USERS = 'jpsnover';
  _resetFlagCache();
});
afterEach(() => {
  vi.restoreAllMocks();
  for (const k of ['AI_TRIAD_DATA_ROOT', 'AI_TRIAD_STATE_ROOT', 'ADMIN_USERS']) {
    if (SAVED[k] === undefined) delete process.env[k]; else process.env[k] = SAVED[k];
  }
  fs.rmSync(dataRoot, { recursive: true, force: true });
  _resetFlagCache();
});

describe('t/2644 — RMW anti-clobber', () => {
  it('EXACT incident repro: a stale-cache write to flag Y does NOT clobber flag X\'s committed revert', () => {
    // 1. This replica flips X=true → disk has X:true, and this process's _cache now holds X:true.
    setFlag('env-web-opeds', { enabled: true, scope: 'env:web' });
    expect(readDisk().flags['env-web-opeds'].enabled).toBe(true);

    // 2. ANOTHER replica reverts X→false directly on disk. This process's _cache stays STALE (true) —
    //    it never observed the revert (the exact multi-replica condition).
    const disk = readDisk();
    disk.flags['env-web-opeds'].enabled = false;
    fs.writeFileSync(flagsFile(), JSON.stringify(disk, null, 2));

    // 3. This (stale-cache) replica now writes an UNRELATED flag Y.
    setFlag('some-other-flag', { enabled: true, scope: 'global' });

    // 4. The RMW merged onto FRESH disk state → X's committed revert SURVIVES; Y is added.
    const after = readDisk();
    expect(after.flags['env-web-opeds'].enabled).toBe(false); // ← the revert is NOT bounced back to true
    expect(after.flags['some-other-flag'].enabled).toBe(true);
  });

  it('a persistent concurrent writer surfaces a visible error after bounded retries (not a silent clobber)', () => {
    // Seed a real file so the first fresh read parses.
    setFlag('seed', { enabled: true, scope: 'global' });
    _resetFlagCache();

    // Simulate a writer that commits on EVERY read → the content-hash precondition can never match,
    // so the RMW must exhaust its retries and throw (visible), never silently write a stale view.
    let n = 0;
    vi.spyOn(fs, 'readFileSync').mockImplementation(() =>
      Buffer.from(JSON.stringify({ flags: { seed: { name: 'seed', enabled: true, scope: 'global', created_at: 'c', updated_at: 'u' } }, _race: n++ })),
    );
    expect(() => setFlag('x', { enabled: true, scope: 'global' })).toThrow(/could not commit|concurrent/i);
  });

  it('appends exactly one audit entry per successful RMW write', () => {
    setFlag('a', { enabled: true, scope: 'global' }, 'jpsnover');
    setFlag('b', { enabled: false, scope: 'global' }, 'jpsnover');
    const audit = fs.readFileSync(auditFile(), 'utf-8').trim().split('\n').map(l => JSON.parse(l));
    expect(audit.map(e => e.flag)).toEqual(['a', 'b']);
    expect(audit[0]).toMatchObject({ action: 'set', flag: 'a', by: 'jpsnover' });
    _resetFlagCache();
    expect(getFlagMetadata('a')?.enabled).toBe(true); // committed + readable
  });
});
