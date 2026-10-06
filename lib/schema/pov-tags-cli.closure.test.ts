// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// @vitest-environment node
// t/4021: pins the STATIC relative-import closure of pov-tags-cli.ts.
//
// This list MIRRORS `CLOSURE` in ai-triad-data/.githooks/pov-tags-check. That hook copies exactly these
// files into a scratch dir and runs the CLI from there, so any new static import here breaks the data
// repo's hook (and its hook-arms CI) while this repo stays green. That is what #2897 did. If this test
// fails, either make the new import dynamic (`await import(...)` inside the branch that needs it, as
// --scan-data does for povTagScan), or update this list AND the hook's CLOSURE together.
//
// Dynamic `import(...)` is deliberately not followed: the hook runs only the validate path.
//
// The second describe RUNS the CLI the way the hook does (t/4021#2): only the CLOSURE files, copied into a
// scratch dir under node_modules/.cache. Node stops its package "type" lookup at a node_modules boundary,
// so tsx compiles the CLI as CJS there; a top-level await (what #2933 shipped) fails only in that layout.

import { describe, it, expect, afterAll } from 'vitest';
import { readFileSync, existsSync, mkdirSync, mkdtempSync, copyFileSync, writeFileSync, rmSync } from 'fs';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join, relative, resolve } from 'path';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const HOOK_CLOSURE = [
  'lib/debate/soul-docs/pov-tags.json',
  'lib/flight-recorder/constants.ts',
  'lib/flight-recorder/dictionary.ts',
  'lib/flight-recorder/flightRecorder.ts',
  'lib/flight-recorder/index.ts',
  'lib/flight-recorder/redact.ts',
  'lib/flight-recorder/ringBuffer.ts',
  'lib/flight-recorder/serializer.ts',
  'lib/flight-recorder/types.ts',
  'lib/schema/pov-tags-cli.ts',
  'lib/schema/povTags.ts',
];

// Static forms only: `import … from '…'`, `export … from '…'`, and bare `import '…'`. A dynamic
// `import('…')` has a `(` after `import`, so it matches neither.
const STATIC_SPECIFIER = /(?:^|[\s;])(?:import|export)\s+(?:[^'"();]*?\sfrom\s+)?['"](\.{1,2}\/[^'"]+)['"]/g;

function resolveSpecifier(fromFile: string, spec: string): string {
  const base = resolve(dirname(fromFile), spec);
  for (const candidate of [base, base.replace(/\.js$/, '.ts'), `${base}.ts`]) {
    if (candidate.endsWith('.json') || candidate.endsWith('.ts')) {
      if (existsSync(candidate)) return candidate;
    }
  }
  throw new Error(`unresolvable import '${spec}' in ${relative(REPO_ROOT, fromFile)}`);
}

function staticClosure(entry: string): string[] {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    if (file.endsWith('.json')) continue;
    for (const m of readFileSync(file, 'utf8').matchAll(STATIC_SPECIFIER)) queue.push(resolveSpecifier(file, m[1]));
  }
  return [...seen].map((f) => relative(REPO_ROOT, f).split('\\').join('/')).sort();
}

describe('pov-tags-cli static import closure (t/4021)', () => {
  it('equals the data hook\'s CLOSURE list exactly', () => {
    expect(staticClosure(join(REPO_ROOT, 'lib', 'schema', 'pov-tags-cli.ts'))).toEqual(HOOK_CLOSURE);
  });

  it('the scanner follows static imports and ignores dynamic ones', () => {
    const src = [
      "import { a } from './x.js';",
      "import type { T } from '../y.js';",
      "export { b } from './z.js';",
      "import './side.js';",
      "const m = await import('./dyn.js');",
      "import {\n  multi,\n  line,\n} from './ml.js';",
    ].join('\n');
    expect([...src.matchAll(STATIC_SPECIFIER)].map((m) => m[1])).toEqual(['./x.js', '../y.js', './z.js', './side.js', './ml.js']);
  });
});

describe('pov-tags-cli runs from the hook scratch layout (t/4021#2: CJS under node_modules/.cache)', () => {
  const cacheDir = join(REPO_ROOT, 'node_modules', '.cache');
  mkdirSync(cacheDir, { recursive: true });
  const scratch = mkdtempSync(join(cacheDir, 'pov-tags-closure-test.'));
  afterAll(() => rmSync(scratch, { recursive: true, force: true }));
  for (const f of HOOK_CLOSURE) {
    mkdirSync(dirname(join(scratch, f)), { recursive: true });
    copyFileSync(join(REPO_ROOT, f), join(scratch, f));
  }
  const tsxCli = join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const runCli = (nodes: unknown) => {
    const input = join(scratch, 'input.json');
    writeFileSync(input, JSON.stringify(nodes));
    return spawnSync(process.execPath, [tsxCli, join(scratch, 'lib', 'schema', 'pov-tags-cli.ts'), '--input', input], { encoding: 'utf8', timeout: 60_000 });
  };
  const registry = JSON.parse(readFileSync(join(REPO_ROOT, 'lib', 'debate', 'soul-docs', 'pov-tags.json'), 'utf8')) as { povs: Record<string, { id: string }[]> };
  const [pov, entries] = Object.entries(registry.povs).find(([, list]) => list.length > 0) ?? ['skeptic', []];
  const tag = entries[0]?.id;
  const nodeId = `${({ accelerationist: 'acc', safetyist: 'saf', skeptic: 'skp' } as Record<string, string>)[pov] ?? 'skp'}-beliefs-001`;

  it('has no package.json "type" in scope, as in the hook', () => {
    expect(existsSync(join(scratch, 'package.json'))).toBe(false);
    expect(existsSync(join(scratch, 'lib', 'package.json'))).toBe(false);
  });

  it('validates: an unregistered tag exits 1 with the JSON contract line', () => {
    const r = runCli([{ id: nodeId, pov_tags: ['definitely-not-registered'] }]);
    expect(r.status, r.stderr).toBe(1);
    expect(JSON.parse(r.stdout.trim().split('\n').at(-1)!)).toMatchObject({ checked: 1, invalid: 1 });
  }, 60_000);

  it.runIf(!!tag)('validates: a registered tag exits 0', () => {
    const r = runCli([{ id: nodeId, pov_tags: [tag] }]);
    expect(r.status, r.stderr).toBe(0);
    expect(JSON.parse(r.stdout.trim().split('\n').at(-1)!)).toMatchObject({ checked: 1, invalid: 0 });
  }, 60_000);
});
