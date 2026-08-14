#!/usr/bin/env node
// t/2626 — Build-artifact-completeness gate for the server's dynamic lib imports.
//
// A `dynamic import()` of a lib/ module does NOT add that module to the tsc program, so a
// module reached ONLY via import() is silently never emitted to dist → 'Cannot find module'
// → a 500 in the container the first time the route runs (newsReport, t/2626; the sibling
// class of the moved-prompts and unemitted-newsReport build-artifact gaps).
//
// This gate runs AFTER build:server (on the real dist) and FAILS the build if any dynamic
// import() of a lib module has no corresponding dist/server/lib/*.js. The fix it names is a
// static `import type * as X from '<spec>'` in the importing file, which forces emission.
//
// Gate co-location (per TL condition 3): the scan target and the exemption list live HERE,
// not in external config.
//
// Usage: node scripts/check-server-lib-emits.mjs   (exit 0 = all emitted; exit 1 = missing)

import { readFileSync, readdirSync, existsSync, statSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const TE = resolve(HERE, '..');                       // taxonomy-editor/
const SERVER_SRC = join(TE, 'src', 'server');
const DIST_LIB = join(TE, 'dist', 'server', 'lib');   // rootDir=../ + outDir=dist/server → lib lands here

// Exemptions: lib modules intentionally not emitted (e.g. type-only surfaces the runtime
// never import()s). Keep EMPTY unless a real case appears; each entry needs a why-comment.
// Key = lib-relative path without extension, e.g. 'debate/someTypeOnly'.
const EXEMPT = new Set([
  // (none)
]);

/** Recursively collect .ts files under dir (skipping __tests__ and .d.ts). */
function collectTsFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__' || entry === 'node_modules') continue;
      out.push(...collectTsFiles(full));
    } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

// Map a lib import specifier → its lib-relative path (no extension), or null if not a lib module.
//   relative:  ../../../../lib/debate/newsReport.js  → 'debate/newsReport'
//   aliased:   @lib/debate/newsReport(.js)           → 'debate/newsReport'
// Any ups-count is fine: lib always lands at dist/server/lib/<suffix> regardless of source depth.
function toLibRel(spec) {
  let m = spec.match(/(?:^|\/)lib\/(.+)$/);           // relative form: strip through '.../lib/'
  if (!m) m = spec.match(/^@lib\/(.+)$/);             // aliased form: strip '@lib/'
  if (!m) return null;
  return m[1].replace(/\.js$/, '');                   // drop a trailing .js if present
}

const findings = [];
let checked = 0;

for (const file of collectTsFiles(SERVER_SRC)) {
  const lines = readFileSync(file, 'utf-8').split(/\r?\n/);
  lines.forEach((line, i) => {
    // Match every `import('<spec>')` call on the line.
    const re = /import\(\s*['"]([^'"]+)['"]\s*\)/g;
    let mm;
    while ((mm = re.exec(line)) !== null) {
      // Skip TYPE queries `import('...').SomeType` — type-erased, no runtime emission needed.
      const after = line.slice(mm.index + mm[0].length);
      if (/^\s*\./.test(after)) continue;
      const libRel = toLibRel(mm[1]);
      if (!libRel || EXEMPT.has(libRel)) continue;
      checked++;
      const distPath = join(DIST_LIB, `${libRel}.js`);
      if (!existsSync(distPath)) {
        findings.push({ file: file.slice(TE.length + 1), line: i + 1, spec: mm[1], distPath: distPath.slice(TE.length + 1) });
      }
    }
  });
}

if (findings.length > 0) {
  console.error('\nBUILD-ARTIFACT GATE FAILED (t/2626) — dynamic import() of a lib module that never emitted to dist:\n');
  for (const f of findings) {
    console.error(`  ${f.file}:${f.line}`);
    console.error(`    import('${f.spec}')`);
    console.error(`    → missing: ${f.distPath}\n`);
  }
  console.error('Fix: add a static `import type * as X from \'<spec>\'` at the top of the importing file.');
  console.error('A dynamic import() alone does NOT add the module to the tsc program, so it never emits.');
  console.error(`\n${findings.length} unemitted dynamic-lib import(s). Run build:server first if dist is stale.\n`);
  process.exit(1);
}

console.log(`check-server-lib-emits: ${checked} dynamic lib import(s) all emitted to dist. OK`);
process.exit(0);
