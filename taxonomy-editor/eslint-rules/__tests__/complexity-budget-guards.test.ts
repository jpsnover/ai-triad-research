// @vitest-environment node
// Guards around lib's complexity ratchet (t/3823 Phase 2, SO e/286#2):
//  C2: check-complexity-budget-disables.mjs refuses inline bypasses of local/complexity-budget.
//  C1: generate-complexity-baseline.mjs --ext filters the walk and rejects an extension it does not measure.
// Lives here with the rule's own tests (t/3093 precedent: lib eslint-rules are tested from taxonomy-editor).

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
// @ts-expect-error -- plain .mjs module, no type declarations
import { findBypasses, scan } from '../../../lib/eslint-rules/check-complexity-budget-disables.mjs';

type Bypass = { line: number; directive: string; reason: string };
const LIB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../lib');
const GENERATOR = path.join(LIB, 'eslint-rules/generate-complexity-baseline.mjs');

describe('C2: inline bypasses of local/complexity-budget are refused', () => {
  it.each([
    ['block disable naming the rule', '/* eslint-disable local/complexity-budget */\nexport const a = 1;'],
    ['block disable among other rules', '/* eslint-disable no-console, local/complexity-budget -- why */\nexport const a = 1;'],
    ['next-line disable naming the rule', '// eslint-disable-next-line local/complexity-budget\nexport const a = 1;'],
    ['same-line disable naming the rule', 'export const a = 1; // eslint-disable-line local/complexity-budget'],
    ['blanket block disable', '/* eslint-disable */\nexport const a = 1;'],
    ['blanket next-line disable', '// eslint-disable-next-line\nexport const a = 1;'],
    ['blanket disable with only a description', '/* eslint-disable -- legacy */\nexport const a = 1;'],
    ['inline config turning the rule off', '/* eslint local/complexity-budget: off */\nexport const a = 1;'],
    ['inline config among other rules', '/* eslint no-console: 0, local/complexity-budget: "off" */\nexport const a = 1;'],
  ])('%s', (_label, src) => {
    const found = findBypasses(src) as Bypass[];
    expect(found).toHaveLength(1);
    expect(found[0].line).toBeGreaterThanOrEqual(1);
  });

  it.each([
    ['a disable naming an unrelated rule', '// eslint-disable-next-line @typescript-eslint/no-explicit-any\nexport const a: any = 1;'],
    ['an eslint-enable', '/* eslint-enable */\nexport const a = 1;'],
    ['an env/globals config comment', '/* eslint-env node */\n/* global foo */\nexport const a = 1;'],
    ['prose that mentions the rule', '// see local/complexity-budget for the gate\nexport const a = 1;'],
    ['the built-in complexity rule (advisory, not the gate)', '// eslint-disable-next-line complexity\nexport const a = 1;'],
  ])('allows %s', (_label, src) => {
    expect(findBypasses(src)).toEqual([]);
  });

  it('reports the right line and skips test files and node_modules when scanning a tree', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'cb-bypass-'));
    try {
      mkdirSync(path.join(root, 'sub'));
      mkdirSync(path.join(root, 'node_modules'));
      writeFileSync(path.join(root, 'sub/a.ts'), 'export const a = 1;\n\n/* eslint-disable local/complexity-budget */\n');
      writeFileSync(path.join(root, 'sub/a.test.ts'), '/* eslint-disable */\n');
      writeFileSync(path.join(root, 'node_modules/x.ts'), '/* eslint-disable */\n');
      writeFileSync(path.join(root, 'b.tsx'), 'export const b = 1;\n');
      const { files, violations } = scan(root) as { files: number; violations: (Bypass & { file: string })[] };
      expect(files).toBe(2); // sub/a.ts and b.tsx only
      expect(violations).toEqual([expect.objectContaining({ file: 'sub/a.ts', line: 3 })]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('the real lib tree is clean, so the gate starts green', () => {
    expect((scan(LIB) as { violations: unknown[] }).violations).toEqual([]);
  });
});

describe('C1: generate-complexity-baseline.mjs --ext', () => {
  let root: string;
  // Each file holds one function of complexity 17 (> threshold 15), so every measured file becomes an entry.
  const over = `export function f(n: number): number {\n${Array.from({ length: 16 }, (_, i) => `  if (n === ${i}) return ${i};`).join('\n')}\n  return -1;\n}\n`;

  beforeAll(() => {
    root = mkdtempSync(path.join(tmpdir(), 'cb-ext-'));
    writeFileSync(path.join(root, 'a.ts'), over);
    writeFileSync(path.join(root, 'b.tsx'), over);
    writeFileSync(path.join(root, 'c.js'), over.replace('f(n: number): number', 'f(n)')); // plain JS: no annotations
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  const run = (...args: string[]) => spawnSync(process.execPath, [GENERATOR, '--root', root, ...args], { encoding: 'utf8' });

  it('--ext ts,tsx walks only .ts/.tsx: the .js file gets no entry, and __meta__.ext records the filter', () => {
    const out = path.join(root, 'b-ext.json');
    const r = run('--baseline', out, '--ext', 'ts,tsx');
    expect(r.status, r.stderr).toBe(0);
    const baseline = JSON.parse(readFileSync(out, 'utf8'));
    expect(Object.keys(baseline).filter((k) => k !== '__meta__').sort()).toEqual(['a.ts', 'b.tsx']);
    expect(baseline.__meta__.ext).toEqual(['.ts', '.tsx']);
  });

  it('without --ext the walk is unchanged (the .js file is measured too) and __meta__ has no ext key', () => {
    const out = path.join(root, 'b-all.json');
    const r = run('--baseline', out);
    expect(r.status, r.stderr).toBe(0);
    const baseline = JSON.parse(readFileSync(out, 'utf8'));
    expect(Object.keys(baseline).filter((k) => k !== '__meta__').sort()).toEqual(['a.ts', 'b.tsx', 'c.js']);
    expect('ext' in baseline.__meta__).toBe(false);
  });

  it('rejects an extension the generator does not measure, and writes nothing', () => {
    const out = path.join(root, 'b-bad.json');
    const r = run('--baseline', out, '--ext', 'ts,py');
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/names an extension this generator does not measure/);
    expect(() => readFileSync(out)).toThrow();
  });
});
