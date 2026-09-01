#!/usr/bin/env node
// t/2626 / t/3209 / t/3165 — Build-artifact-completeness gate for the server's lib modules that
// tsc does NOT add to the program automatically.
//
// Two classes of "referenced but not statically imported" lib module, both of which tsc omits
// from emit unless forced — so the module is silently absent from dist and the route/worker
// 'Cannot find module's / 500s the first time it runs in the container:
//
//   CLASS A — dynamic import() (t/2626).  `import('<lib spec>')` does not add the target to the
//     tsc program. Fix: a static `import type * as X from '<spec>'` in the importing file forces
//     emission. (newsReport, t/2626; sibling of the moved-prompts / unemitted-newsReport gaps.)
//     Detection: scan the SERVER SOURCE for import() specifiers, check each emitted to dist.
//
//   CLASS B — worker/asset entry via `new URL('./x.js', import.meta.url)` (t/3209 / t/3165).  A
//     worker entry is referenced ONLY as a URL string (`new Worker(new URL('./embeddingWorker.js',
//     import.meta.url))`), never imported, so tsc never emits it UNLESS its lib subtree is in the
//     server tsconfig `include`. `embeddingWorker.js` shipped absent → EMBEDDING_WORKER_OFFLOAD=1
//     → MODULE_NOT_FOUND → 500 (t/3209). Fix: add the module's `../lib/<subtree>/**/*` to
//     `tsconfig.server.json` `include`.
//     Detection: scan the EMITTED dist JS (the actual runtime artifact) for these URL refs and
//     verify each referenced sibling .js is ALSO in dist. Scanning the built output — not the
//     source + `include` — is deliberate: the referencing module (offThreadEmbedding.js) is always
//     emitted because it IS imported, so its URL ref is always seen, INDEPENDENT of whether the
//     worker's subtree is in `include`. Deriving the scan from `include` would be circular — the
//     gate would go blind to the exact regression (a subtree dropped from `include`) it must catch.
//
// This gate runs AFTER build:server (on the real dist) and FAILS the build if any module in
// either class has no corresponding dist/server/lib/*.js.
//
// Gate co-location (per TL condition 3): the scan targets and the exemption list live HERE, not in
// external config.
//
// Known limitations (TL GV note, p/333#132 — none occur in the current codebase; if one ever
// does, add the module to EXEMPT with a why-comment, or extend the matcher):
//   1. Multi-line — a specifier split across lines (`import(\n  '...'\n)` or a `new URL(` broken
//      across lines) is not matched (the scan is line-oriented). tsc emits both idioms on one line.
//   2. Computed specifier — `import(someVar)` / `new URL(someVar, import.meta.url)` (non-literal)
//      can't be statically resolved, so it is skipped (nothing to check).
//   3. Bracket type-access — the type-query skip handles `import('...').T` (dot) but not the
//      rarer `import('...')['T']` (bracket), which would be treated as a runtime import.
//
// Usage: node scripts/check-server-lib-emits.mjs   (exit 0 = all emitted; exit 1 = missing)

import { readFileSync, readdirSync, existsSync, statSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const TE = resolve(HERE, '..');                        // taxonomy-editor/
const SERVER_SRC = join(TE, 'src', 'server');
const DIST_SERVER = join(TE, 'dist', 'server');        // build:server output root
const DIST_LIB = join(DIST_SERVER, 'lib');             // rootDir=../ + outDir=dist/server → lib lands here

// Exemptions: modules intentionally not emitted (e.g. type-only surfaces the runtime never
// import()s, or a URL asset ref resolved at runtime by other means). Keep EMPTY unless a real case
// appears; each entry needs a why-comment. Key for Class A = lib-relative path without extension
// (e.g. 'debate/someTypeOnly'); key for Class B = dist-server-relative target path without
// extension (e.g. 'lib/embeddings/embeddingWorker').
const EXEMPT = new Set([
  // (none)
]);

/** Recursively collect files with `ext` under dir (skipping __tests__, node_modules, .d.ts). */
function collectFiles(dir, ext) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__' || entry === 'node_modules') continue;
      out.push(...collectFiles(full, ext));
    } else if (entry.endsWith(ext) && !entry.endsWith('.d.ts')) {
      if (ext === '.ts' && entry.endsWith('.test.ts')) continue;
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
  let m = spec.match(/(?:^|\/)lib\/(.+)$/);            // relative form: strip through '.../lib/'
  if (!m) m = spec.match(/^@lib\/(.+)$/);              // aliased form: strip '@lib/'
  if (!m) return null;
  return m[1].replace(/\.js$/, '');                    // drop a trailing .js if present
}

// ─── CLASS A: dynamic import() of a lib module (scan src/server) ───────────────────────────────
const importFindings = [];
let checkedImports = 0;

for (const file of collectFiles(SERVER_SRC, '.ts')) {
  const lines = readFileSync(file, 'utf-8').split(/\r?\n/);
  lines.forEach((line, i) => {
    const re = /import\(\s*['"]([^'"]+)['"]\s*\)/g;    // every `import('<spec>')` on the line
    let mm;
    while ((mm = re.exec(line)) !== null) {
      // Skip TYPE queries `import('...').SomeType` — type-erased, no runtime emission needed.
      const after = line.slice(mm.index + mm[0].length);
      if (/^\s*\./.test(after)) continue;
      const libRel = toLibRel(mm[1]);
      if (!libRel || EXEMPT.has(libRel)) continue;
      checkedImports++;
      const distPath = join(DIST_LIB, `${libRel}.js`);
      if (!existsSync(distPath)) {
        importFindings.push({ file: file.slice(TE.length + 1), line: i + 1, spec: mm[1], distPath: distPath.slice(TE.length + 1) });
      }
    }
  });
}

// ─── CLASS B: worker/asset entry `new URL('./x.js', import.meta.url)` (scan EMITTED dist JS) ────
const workerFindings = [];
let checkedWorkers = 0;

if (existsSync(DIST_SERVER)) {
  for (const file of collectFiles(DIST_SERVER, '.js')) {
    const lines = readFileSync(file, 'utf-8').split(/\r?\n/);
    lines.forEach((line, i) => {
      // `new URL('<relative>.js', import.meta.url)` — the module-relative worker/asset-entry idiom
      // as emitted by tsc. The `import.meta.url` 2nd arg distinguishes it from runtime URL parsing
      // (e.g. `new URL(req.url, 'http://localhost')`), which is correctly ignored (zero-noise).
      const re = /new\s+URL\(\s*['"](\.[^'"]+\.js)['"]\s*,\s*import\.meta\.url\s*\)/g;
      let mm;
      while ((mm = re.exec(line)) !== null) {
        const targetAbs = resolve(dirname(file), mm[1]);         // spec is relative to THIS dist file
        const distRel = targetAbs.slice(DIST_SERVER.length + 1).replace(/\\/g, '/').replace(/\.js$/, '');
        if (EXEMPT.has(distRel)) continue;
        checkedWorkers++;
        if (!existsSync(targetAbs)) {
          workerFindings.push({
            file: file.slice(TE.length + 1),
            line: i + 1,
            spec: mm[1],
            distPath: targetAbs.slice(TE.length + 1),
          });
        }
      }
    });
  }
}

// ─── Report ──────────────────────────────────────────────────────────────────────────────────
let failed = false;

if (importFindings.length > 0) {
  failed = true;
  console.error('\nBUILD-ARTIFACT GATE FAILED (t/2626, Class A) — dynamic import() of a lib module that never emitted to dist:\n');
  for (const f of importFindings) {
    console.error(`  ${f.file}:${f.line}`);
    console.error(`    import('${f.spec}')`);
    console.error(`    → missing: ${f.distPath}\n`);
  }
  console.error('Fix: add a static `import type * as X from \'<spec>\'` at the top of the importing file.');
  console.error('A dynamic import() alone does NOT add the module to the tsc program, so it never emits.\n');
}

if (workerFindings.length > 0) {
  failed = true;
  console.error('\nBUILD-ARTIFACT GATE FAILED (t/3209/t/3165, Class B) — `new URL(\'./x.js\', import.meta.url)` worker/asset entry never emitted to dist:\n');
  for (const f of workerFindings) {
    console.error(`  ${f.file}:${f.line}`);
    console.error(`    new URL('${f.spec}', import.meta.url)`);
    console.error(`    → missing: ${f.distPath}\n`);
  }
  console.error('Fix: add the referenced module\'s `../lib/<subtree>/**/*` to tsconfig.server.json `include`.');
  console.error('A URL-string worker entry is never imported, so tsc omits it unless its subtree is in `include`');
  console.error('(it can\'t be forced via `import type`, unlike a dynamic import()).\n');
}

if (failed) {
  const total = importFindings.length + workerFindings.length;
  console.error(`${total} unemitted lib artifact(s). Run build:server first if dist is stale.\n`);
  process.exit(1);
}

console.log(`check-server-lib-emits: ${checkedImports} dynamic import(s) + ${checkedWorkers} URL-worker entr(ies), all emitted to dist. OK`);
process.exit(0);
