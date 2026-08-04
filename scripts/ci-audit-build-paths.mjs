#!/usr/bin/env node
/**
 * scripts/ci-audit-build-paths.mjs — build-path dependency coverage check (t/2077)
 *
 * Problem: a new runtime dependency added to a package compiled into the container
 * (e.g., lib/) is silently absent from the production runtime if it is not also
 * listed in the package whose deps the production stage installs (taxonomy-editor/).
 * This was caught only by the required container check going red — a late gate.
 *
 * How it works:
 *   Parses taxonomy-editor/Dockerfile to DERIVE (not hand-list) which local packages
 *   are compiled into the image but whose production deps are NOT installed by the
 *   prod-deps stage. For each such "compiled-not-prod-installed" package, verifies
 *   that all of its runtime dependencies are covered by what the prod-deps stage
 *   does install. Fails (exit 1) if any gap is found.
 *
 * Derivation, not hand-listing: build paths come from Dockerfile parsing so a new
 * build stage that omits a package's deps is caught automatically, avoiding the
 * same failure class one level up (t/2077 design note).
 *
 * Exit 0 = clean. Exit 1 = gap detected.
 *
 * Gate verification (AC proof):
 *   Add any dep to lib/package.json "dependencies" that is NOT in
 *   taxonomy-editor/package.json "dependencies" → this script exits 1.
 *   Remove it → exits 0.
 *
 * Zero noise at landing: lib/'s two runtime deps (decode-named-character-reference,
 * micromark-util-decode-numeric-character-reference) are already present in
 * taxonomy-editor/package.json — no pre-existing violations.
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DOCKERFILE = resolve(ROOT, 'taxonomy-editor/Dockerfile');

// ── Dockerfile parser ──────────────────────────────────────────────────────
// Extracts per-stage: which local package.json files are COPY'd in, and
// whether the stage runs a production-only install (--prod / --omit=dev).
// Handles single-line COPY and RUN instructions; skips --from copies.

function parseStages(content) {
  const stages = [];
  let current = null;

  for (const rawLine of content.split('\n')) {
    // Strip inline comments and trailing whitespace; skip blanks.
    const line = rawLine.replace(/\s*#.*$/, '').trim();
    if (!line) continue;

    // FROM ... AS <name> — start a new stage
    const fromMatch = line.match(/^FROM\s+\S+(?:\s+AS\s+(\w+))?/i);
    if (fromMatch) {
      current = {
        name: fromMatch[1] ?? `__stage${stages.length}__`,
        localPackageDirs: new Set(),
        hasProdInstall: false,
        hasAnyInstall: false,
      };
      stages.push(current);
      continue;
    }
    if (!current) continue;

    // COPY (local, not --from): identify which local package dirs are copied in.
    // A COPY copies a package if it includes package.json explicitly or copies
    // the entire directory (path with no file extension = likely a directory).
    if (/^COPY\s+(?!--from)/i.test(line)) {
      const tokens = line.replace(/^COPY\s+/i, '').split(/\s+/).filter(t => !t.startsWith('--'));
      // Last token is the destination; all before are sources.
      const srcs = tokens.slice(0, -1);
      for (const src of srcs) {
        const isPackageJson = src.endsWith('package.json');
        const isDirectory   = !src.includes('.'); // heuristic: no extension = dir
        if (isPackageJson || isDirectory) {
          // Normalise: strip trailing slash and /package.json to get the local dir name.
          const localDir = src.replace(/\/package\.json$/, '').replace(/\/$/, '');
          current.localPackageDirs.add(localDir);
        }
      }
    }

    // RUN containing a package manager install — detect --prod flag.
    if (/^RUN\s+.*\b(pnpm install|npm ci|npm install)\b/i.test(line)) {
      current.hasAnyInstall = true;
      if (/--prod\b|--only=prod(uction)?|--omit=dev/.test(line)) {
        current.hasProdInstall = true;
      }
    }
  }

  return stages;
}

// ── Dep reader ─────────────────────────────────────────────────────────────

function readRuntimeDeps(localDir) {
  try {
    const pkg = JSON.parse(readFileSync(resolve(ROOT, localDir, 'package.json'), 'utf8'));
    return Object.keys(pkg.dependencies ?? {});
  } catch {
    return [];
  }
}

// ── Main ───────────────────────────────────────────────────────────────────

const stages = parseStages(readFileSync(DOCKERFILE, 'utf8'));

// Classify local package dirs per install type across all stages.
const prodInstalledDirs  = new Set(); // dirs in a stage with --prod install
const buildInstalledDirs = new Set(); // dirs in a stage with any install (incl. devDeps)

for (const stage of stages) {
  if (!stage.hasAnyInstall) continue;
  for (const dir of stage.localPackageDirs) {
    buildInstalledDirs.add(dir);
    if (stage.hasProdInstall) prodInstalledDirs.add(dir);
  }
}

// Compiled-not-prod-installed: dirs installed for build/compilation but whose
// node_modules do NOT reach the runtime container (no prod-stage install for them).
// Filter to only dirs that are actual packages (have a package.json) — the heuristic
// also picks up plain source dirs like taxonomy-editor/src/ which have no deps to check.
const compiledNotInstalled = [...buildInstalledDirs]
  .filter(d => !prodInstalledDirs.has(d))
  .filter(d => { try { readFileSync(resolve(ROOT, d, 'package.json')); return true; } catch { return false; } });

console.log('Build-path coverage analysis (derived from taxonomy-editor/Dockerfile)');
console.log(`  Production stage packages : ${[...prodInstalledDirs].join(', ')  || '(none)'}`);
console.log(`  Build-only packages       : ${compiledNotInstalled.join(', ')    || '(none)'}`);

if (compiledNotInstalled.length === 0) {
  console.log('\nNo compiled-not-installed packages found — no gap possible. ✓');
  process.exit(0);
}

// Union of runtime deps available in the production container.
const prodAvailableDeps = new Set([...prodInstalledDirs].flatMap(readRuntimeDeps));

let failed = false;
for (const pkg of compiledNotInstalled) {
  const deps = readRuntimeDeps(pkg);
  const gaps = deps.filter(d => !prodAvailableDeps.has(d));

  if (gaps.length === 0) {
    console.log(`\n✓ ${pkg}/: all ${deps.length} runtime dep(s) covered by production stage.`);
  } else {
    console.error(`\n❌ Build-path gap in ${pkg}/package.json:`);
    for (const g of gaps) {
      console.error(`   "${g}" is compiled into the container but NOT installed in the production stage.`);
      console.error(`   Fix: add "${g}" to taxonomy-editor/package.json "dependencies".`);
    }
    failed = true;
  }
}

if (failed) {
  console.error('\nBuild-path coverage check FAILED — runtime container will be missing the listed deps.');
  process.exit(1);
}
console.log('\nBuild-path coverage check passed. ✓');
