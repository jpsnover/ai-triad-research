// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// @vitest-environment node
// POV tags (t/3955): the shared rule, the registry schema, the registry↔soul pairing, and the CLI gate.

import { describe, it, expect } from 'vitest';
import { readdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  validatePovTags, loadPovTagRegistry, checkRegistrySoulPairs, PovTagRegistrySchema, type PovTagRegistry,
} from './povTags.js';

const entry = (pov: string, id: string) => ({ id, label: id, soul_doc: `${pov}.${id}`, description: `${id} wing` });
// A registry WITH tags, for the pass arms (the committed registry ships empty until t/3956 adds souls).
const REG: PovTagRegistry = { version: 1, povs: { skeptic: [entry('skeptic', 'critical'), entry('skeptic', 'institutional')] } };

describe('validatePovTags', () => {
  it('PASSES registered tags on a node of that POV (one tag, and shared ground with both)', () => {
    expect(validatePovTags('skp-beliefs-001', ['critical'], REG)).toEqual([]);
    expect(validatePovTags('skp-beliefs-001', ['critical', 'institutional'], REG)).toEqual([]);
  });

  it('PASSES absent, null and [] (all mean untagged)', () => {
    expect(validatePovTags('skp-beliefs-001', undefined, REG)).toEqual([]);
    expect(validatePovTags('skp-beliefs-001', null, REG)).toEqual([]);
    expect(validatePovTags('skp-beliefs-001', [], REG)).toEqual([]);
  });

  it('REJECTS an unknown tag', () => {
    expect(validatePovTags('skp-beliefs-001', ['radical'], REG)[0]).toMatch(/not registered for skeptic/);
  });

  it('REJECTS a duplicate', () => {
    expect(validatePovTags('skp-beliefs-001', ['critical', 'critical'], REG).join()).toMatch(/more than once/);
  });

  it('REJECTS a tag from another POV (a skeptic tag on an accelerationist node)', () => {
    expect(validatePovTags('acc-beliefs-001', ['critical'], REG)[0]).toMatch(/accelerationist has no tags/);
  });

  it('REJECTS any pov_tags on a situation or retired cc- node, even an empty array', () => {
    expect(validatePovTags('sit-001', ['critical'], REG)[0]).toMatch(/only allowed on POV nodes/);
    expect(validatePovTags('sit-001', [], REG)[0]).toMatch(/only allowed on POV nodes/);
    expect(validatePovTags('cc-beliefs-001', ['critical'], REG)).toHaveLength(1);
  });

  it('REJECTS a scalar: a one-element array unrolled to a string (TL t/3955#4 cond 2)', () => {
    expect(validatePovTags('skp-beliefs-001', 'critical', REG)[0]).toMatch(/must be an array.*unrolled to a scalar/);
  });

  it('REJECTS a malformed id and a non-string entry', () => {
    expect(validatePovTags('skp-beliefs-001', ['Critical'], REG).join()).toMatch(/kebab-case/);
    expect(validatePovTags('skp-beliefs-001', [42], REG)[0]).toMatch(/must be strings/);
  });
});

describe('PovTagRegistrySchema', () => {
  it('ACCEPTS the committed registry (empty povs until t/3956 adds the Skeptic tags with their souls)', () => {
    const reg = loadPovTagRegistry();
    expect(reg.version).toBe(1);
    expect(reg.povs).toEqual({});
  });

  it('ACCEPTS a registry with tags', () => {
    expect(PovTagRegistrySchema.safeParse(REG).success).toBe(true);
  });

  it('REJECTS an unknown POV, a duplicate id, a soul_doc that does not match, a bad id and extra keys', () => {
    expect(PovTagRegistrySchema.safeParse({ version: 1, povs: { neutral: [] } }).success).toBe(false);
    expect(PovTagRegistrySchema.safeParse({ version: 1, povs: { skeptic: [entry('skeptic', 'critical'), entry('skeptic', 'critical')] } }).success).toBe(false);
    expect(PovTagRegistrySchema.safeParse({ version: 1, povs: { skeptic: [{ ...entry('skeptic', 'critical'), soul_doc: 'skeptic.other' }] } }).success).toBe(false);
    expect(PovTagRegistrySchema.safeParse({ version: 1, povs: { skeptic: [entry('skeptic', 'Not_Kebab')] } }).success).toBe(false);
    expect(PovTagRegistrySchema.safeParse({ version: 1, povs: {}, extra: true }).success).toBe(false);
  });
});

describe('checkRegistrySoulPairs (spec §2.1; the .soul.json is the source of truth, CL t/3955#5)', () => {
  it('PAIRED: every registry tag has its soul and every tag soul is registered', () => {
    expect(checkRegistrySoulPairs(REG, ['skeptic.soul.json', 'skeptic.critical.soul.json', 'skeptic.institutional.soul.json'])).toEqual([]);
  });

  it('FLAGS a registry tag with no soul file, and a tag soul file with no registry entry', () => {
    const problems = checkRegistrySoulPairs(REG, ['skeptic.critical.soul.json', 'skeptic.radical.soul.json']);
    expect(problems.join('\n')).toMatch(/"skeptic.institutional" has no soul file/);
    expect(problems.join('\n')).toMatch(/skeptic.radical.soul.json has no registry entry/);
  });

  it('ignores per-POV souls and the generated .soul.md views', () => {
    expect(checkRegistrySoulPairs(REG, ['skeptic.soul.json', 'skeptic.critical.soul.md'])).toHaveLength(2); // both tags still lack .json
  });

  it('the REAL lib/debate/soul-docs directory is paired with the committed registry', () => {
    const dir = fileURLToPath(new URL('../debate/soul-docs/', import.meta.url));
    expect(checkRegistrySoulPairs(loadPovTagRegistry(), readdirSync(dir))).toEqual([]);
  });
});

describe('pov-tags-cli (the blocking gate t/3969 shells out to)', () => {
  const cli = fileURLToPath(new URL('./pov-tags-cli.ts', import.meta.url));
  const tsx = fileURLToPath(new URL('../../node_modules/.bin/' + (process.platform === 'win32' ? 'tsx.cmd' : 'tsx'), import.meta.url));
  const run = (input: string) => {
    const dir = mkdtempSync(join(tmpdir(), 'povtags-'));
    try {
      const file = join(dir, 'in.json');
      writeFileSync(file, input);
      const r = spawnSync(tsx, [cli, '--input', file], { encoding: 'utf8', shell: process.platform === 'win32' });
      const last = r.stdout.trim().split('\n').at(-1) ?? '';
      return { code: r.status, out: last ? (() => { try { return JSON.parse(last); } catch { return null; } })() : null };
    } finally { rmSync(dir, { recursive: true, force: true }); }
  };

  it('exit 0 when every node is valid (untagged nodes, a whole-file shape)', () => {
    const r = run(JSON.stringify({ nodes: [{ id: 'skp-beliefs-001' }, { id: 'sit-001' }] }));
    expect(r.code).toBe(0);
    expect(r.out).toEqual({ checked: 2, invalid: 0, errors: [] });
  });

  it('exit 1 with the errors listed when a node is invalid (unregistered tag, a scalar)', () => {
    const r = run(JSON.stringify([{ id: 'skp-beliefs-001', pov_tags: ['critical'] }, { id: 'skp-beliefs-002', pov_tags: 'critical' }]));
    expect(r.code).toBe(1);
    expect(r.out.invalid).toBe(2);
    expect(r.out.errors.join('\n')).toMatch(/unrolled to a scalar/);
  });

  it('exit 2 (could not run) on input it cannot read, never 0', () => {
    expect(run('not json').code).toBe(2);
    expect(run(JSON.stringify({ wrong: true })).code).toBe(2);
  });
}, 60_000);
