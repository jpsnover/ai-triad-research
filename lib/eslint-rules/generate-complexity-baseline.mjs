#!/usr/bin/env node
// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Write-only-downward complexity baseline generator (t/3821).
// Usage: node generate-complexity-baseline.mjs --root <dir> --baseline <file> [--threshold <N>]
//        node generate-complexity-baseline.mjs --root <dir> --drift-check
//
// ── Which counter feeds what ────────────────────────────────────────────────────────
// measureComplexities  — uses ESLint's built-in `complexity` rule at `max:0`.
//   This is the ONLY counter that writes baseline numbers. The built-in is authoritative.
// measureOurMax        — uses the mirror `local/complexity-budget` at `threshold:1`.
//   Used ONLY in --drift-check mode to verify parity. It never touches the baseline.
//
// Consequence: baseline numbers are built-in numbers, not mirror numbers. After a parity
// fix (mirror patched to match built-in), regeneration is belt-and-braces — it restores
// any entries that drifted during the period of mismatch. Mirror fix alone restores correct
// gate behaviour; regeneration is the belt, not the suspenders.
// ────────────────────────────────────────────────────────────────────────────────────
//
// ── Replace semantics (e/240#15) ─────────────────────────────────────────────────
// Each run produces a FRESH baseline containing ONLY the files walked under --root.
// Existing entries are consulted for write-only-downward semantics (ratchet), but
// keys with no matching file on disk are NOT preserved. This prevents accumulation:
// two runs from different cwd values produce two different key spellings for the same
// physical file; without replace semantics both spellings accumulate and become
// indistinguishable from live rows. The generator asserts its own output shape after
// writing (see self-validation below).
// ────────────────────────────────────────────────────────────────────────────────────
//
// --drift-check mode: compares per-file max complexity from the built-in `complexity` rule
// against the mirror rule (complexity-budget.js). Exits 1 on any mismatch. This is the
// total parity assertion that the fixture-based ARM 6 test cannot provide — it runs over
// every source file so no node-set divergence can hide in a gap between hand-picked examples.
// Runtime: ~15s for 1114 files (acceptable for a CI step; not on the hot path).
// Note: .tsx/.jsx files require parserOptions.ecmaFeatures.jsx or they fail silently (skipped).
//
// ── Test file exclusion (TL ruling, e/240#15) ────────────────────────────────────
// *.test.ts, *.test.tsx, *.spec.ts, *.spec.tsx, and __tests__/ directories are excluded.
// These match eslint.config.mjs TEST_GLOBS — the complexity-budget rule is not applied
// to test files (Block A has ignores: TEST_GLOBS), so baselined test entries are inert.
// Excluding them avoids silently gating test complexity and keeps the key count equal to
// the file count the gate actually enforces.
// ────────────────────────────────────────────────────────────────────────────────────
//
// ── Scan scope and coverage (e/240#22, t/3823) ───────────────────────────────────
// Use --scan <subdir> to limit the walk to a subdirectory of --root (keys remain
// relative to --root, so the ESLint rule's resolveKey still matches). This baseline
// was generated with --scan src; it covers taxonomy-editor/src only. lib/ (debate/,
// inquiry/, ai-client/) is unmeasured, unbaselined, and ungated — tracked at t/3823.
// ────────────────────────────────────────────────────────────────────────────────────
//
// ── Baseline inclusion rule (SO e/240#17) ────────────────────────────────────────
// Only files with max > threshold are baselined. Sub-threshold files are NOT offenders:
// a baselined entry for a max-1 file would freeze it at 1, causing any added branch to
// red the build — a materially different gate from "freeze current offenders at threshold".
// Non-offender files are handled by the rule's overThreshold path if they eventually grow.
// ────────────────────────────────────────────────────────────────────────────────────
//
// Write-only-downward semantics (corrected per TL t/3821#2):
//   WRITE if observed.max <= existing.max && observed.countOver <= existing.countOver (Pareto)
//   WRITE if observed.max <  existing.max  (decomposition — max strictly down, countOver may rise)
//   KEEP  otherwise (regression — existing entry unchanged)
// This ensures the baseline always describes a state the tree actually passed through.

import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join, relative, extname } from 'path';
import { Linter } from 'eslint';
import tseslint from 'typescript-eslint';
import { parseArgs } from 'node:util';
import { isAcceptable } from './complexity-budget-predicate.js';
import complexityBudgetRule from './complexity-budget.js';

const { values: args } = parseArgs({
  options: {
    root:         { type: 'string' },
    scan:         { type: 'string' },  // optional subdirectory under --root to walk
    baseline:     { type: 'string' },
    threshold:    { type: 'string', default: '15' },
    'drift-check': { type: 'boolean', default: false },
  },
  strict: true,
});

const isDriftCheck = args['drift-check'];

if (!args.root || (!isDriftCheck && !args.baseline)) {
  console.error('Usage: node generate-complexity-baseline.mjs --root <dir> --baseline <file> [--threshold <N>] [--scan <subdir>]');
  console.error('       node generate-complexity-baseline.mjs --root <dir> --drift-check');
  process.exit(1);
}

const ROOT      = args.root;
const BASELINE  = args.baseline;
// WALK_ROOT: where to walk. --scan limits the walk to a subdirectory; keys remain
// relative to ROOT so the ESLint rule's resolveKey still matches (e/240#22).
const WALK_ROOT = args.scan ? join(ROOT, args.scan) : ROOT;
const THRESHOLD = parseInt(args.threshold, 10);
const TS_EXTS   = new Set(['.ts', '.tsx']);
const TSX_EXTS  = new Set(['.tsx', '.jsx']);
const JS_EXTS   = new Set(['.js', '.jsx', '.mjs', '.cjs']);

/** Returns true for test/spec files and __tests__ directory entries (TL ruling, e/240#15). */
function isTestFile(relPath) {
  return /\.(test|spec)\.[jt]sx?$/.test(relPath) || relPath.includes('/__tests__/') || relPath.includes('\\__tests__\\');
}

/** Recursively enumerate TS/JS source files, skipping node_modules and hidden dirs. */
function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(full);
    } else if (entry.isFile()) {
      const ext = extname(entry.name);
      if (TS_EXTS.has(ext) || JS_EXTS.has(ext)) yield full;
    }
  }
}

/**
 * Measure per-function cyclomatic complexities using ESLint's built-in `complexity` rule.
 * The built-in is authoritative; our rule mirrors its node set — the drift test verifies parity.
 *
 * @param {string} code
 * @param {string} filename
 * @returns {number[]}
 */
function measureComplexities(code, filename) {
  const linter = new Linter({ configType: 'flat' });
  const isTs = TS_EXTS.has(extname(filename));
  /** @type {import('eslint').Linter.Config} */
  // Do NOT pass { filename } to verify() — ESLint 10 flat config then requires a matching
  // `files:` glob in the config, and omitting it returns "No matching configuration found"
  // for every file (all rules silently skip). We pick the right parser from the extension
  // above; the filename is not needed for analysis.
  const isJsx = TSX_EXTS.has(extname(filename));
  const config = {
    rules: { complexity: ['error', { max: 0 }] },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      ...(isTs ? { parser: tseslint.parser } : {}),
      ...(isJsx ? { parserOptions: { ecmaFeatures: { jsx: true } } } : {}),
    },
  };
  const messages = linter.verify(code, config);
  return messages
    .filter((m) => m.ruleId === 'complexity')
    .map((m) => {
      const match = m.message.match(/complexity of (\d+)/);
      return match ? parseInt(match[1], 10) : 1;
    });
}

/**
 * Compute file-level baseline entry from per-function complexities.
 * @param {number[]} complexities
 * @param {number} threshold
 * @returns {{ max: number; countOver: number } | null}
 */
function toEntry(complexities, threshold) {
  if (complexities.length === 0) return null;
  return {
    max: Math.max(...complexities),
    countOver: complexities.filter((c) => c > threshold).length,
  };
}

/**
 * Write-only-downward decision (t/3821#2 corrected semantics).
 * Returns true if the observed entry should replace the existing one.
 * Delegates to the shared isAcceptable predicate so rule and generator always agree.
 *
 * @param {{ max: number; countOver: number }} observed
 * @param {{ max: number; countOver: number } | undefined} existing
 */
function shouldWrite(observed, existing) {
  if (!existing) return true; // new file — always write
  return isAcceptable(observed, existing, THRESHOLD);
}

/**
 * Compute our rule's max complexity for a file using the mirror implementation.
 * Runs the rule at threshold:0 with no baseline so every function above 0 emits
 * an overThreshold message containing "max N".
 *
 * @param {string} code
 * @param {string} filename
 * @returns {number} max complexity (1 if no functions / no messages)
 */
function measureOurMax(code, filename) {
  const linter = new Linter({ configType: 'flat' });
  const isTs = TS_EXTS.has(extname(filename));
  const isJsx = TSX_EXTS.has(extname(filename));
  // Same no-filename rule as measureComplexities — see comment there.
  const messages = linter.verify(
    code,
    {
      plugins: { local: { rules: { 'complexity-budget': complexityBudgetRule } } },
      rules: { 'local/complexity-budget': ['error', { threshold: 1 }] },
      languageOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        ...(isTs ? { parser: tseslint.parser } : {}),
        ...(isJsx ? { parserOptions: { ecmaFeatures: { jsx: true } } } : {}),
      },
    },
  );
  for (const m of messages) {
    if (m.ruleId === 'local/complexity-budget') {
      const match = m.message.match(/max (\d+)/);
      if (match) return parseInt(match[1], 10);
    }
  }
  return 1;
}

// ── Main ──────────────────────────────────────────────────────────────────────

if (isDriftCheck) {
  // ── Drift-check mode: built-in vs mirror, every file, assert zero mismatches ──
  const mismatches = [];
  let checked = 0;

  for (const absPath of walk(ROOT)) {
    let code;
    try { code = readFileSync(absPath, 'utf-8'); } catch { continue; }

    let builtinComplexities;
    try { builtinComplexities = measureComplexities(code, absPath); } catch { continue; }
    if (builtinComplexities.length === 0) continue;

    const builtinMax = Math.max(...builtinComplexities);
    const ourMax = measureOurMax(code, absPath);
    checked++;

    if (builtinMax !== ourMax) {
      mismatches.push({ file: relative(ROOT, absPath).replace(/\\/g, '/'), builtinMax, ourMax });
    }
  }

  if (mismatches.length > 0) {
    console.error(`TOOLING PARITY FAILURE: ${mismatches.length} file(s) where built-in max ≠ rule max.`);
    console.error(`This is a defect in lib/eslint-rules/complexity-budget.js (the mirror), not in author code.`);
    console.error(`Owner: Shared Lib (lib/eslint-rules/).`);
    console.error(`Remediation (three ordered steps):`);
    console.error(`  1. Fix the mirror — update INCREMENT_NODES in complexity-budget.js to match the built-in.`);
    console.error(`  2. Regenerate the baseline — node generate-complexity-baseline.mjs --root <dir> --baseline <file>.`);
    console.error(`  3. Verify parity green — re-run --drift-check; expect 0 mismatches.`);
    console.error(`Exit: fix the mirror rule (ESLint JS), NOT the baseline JSON.`);
    console.error(`Files:`);
    for (const m of mismatches) {
      console.error(`  ${m.file}: built-in=${m.builtinMax}, rule=${m.ourMax}`);
    }
    process.exit(1);
  }

  console.log(`Drift check passed: ${checked} files checked, 0 mismatches.`);
  process.exit(0);
}

/** @type {Record<string, { max: number; countOver: number }>} */
let existingRaw = {};
try {
  existingRaw = JSON.parse(readFileSync(BASELINE, 'utf-8'));
} catch (err) {
  if (/** @type {any} */ (err).code !== 'ENOENT') {
    // Malformed or permission error — fail loudly. ENOENT is fine (first run).
    console.error(`Could not read existing baseline "${BASELINE}": ${/** @type {Error} */ (err).message}`);
    process.exit(1);
  }
  // ENOENT → no existing baseline, start fresh (first run)
}
// Strip __meta__ — it is not a file entry and must not feed ratchet lookups.
const { __meta__: _existingMeta, ...existing } = existingRaw;

// Replace semantics: start fresh — only files visited in this run appear in the output.
// Existing entries are consulted for write-only-downward ratchet semantics only.
// Stale keys from prior runs with a different --root value are never visited and therefore
// never appear in the output (e/240#15).
const updated = {};
let written = 0;
let kept    = 0;
let skipped = 0;

for (const absPath of walk(WALK_ROOT)) {
  const relKey = relative(ROOT, absPath).replace(/\\/g, '/');

  // Skip test files — the ESLint rule does not apply to them (eslint.config.mjs TEST_GLOBS).
  if (isTestFile(relKey)) { skipped++; continue; }

  let code;
  try {
    code = readFileSync(absPath, 'utf-8');
  } catch {
    continue;
  }

  let complexities;
  try {
    complexities = measureComplexities(code, absPath);
  } catch {
    // Parse errors (e.g. syntax errors in source) — skip file
    skipped++;
    continue;
  }

  const observed = toEntry(complexities, THRESHOLD);
  if (!observed) {
    skipped++;
    continue; // no functions in file
  }

  // Only baseline offenders (max > threshold). Sub-threshold files are NOT offenders:
  // baselined entries for them would freeze their peak complexity at today's value,
  // causing any added branch to red the build — a materially different gate from the
  // approved design, which is "freeze current offenders" (SO e/240#17).
  // Non-offenders are handled by the rule's overThreshold path when they eventually
  // exceed the threshold.
  if (observed.max <= THRESHOLD) {
    skipped++;
    continue;
  }

  if (shouldWrite(observed, existing[relKey])) {
    updated[relKey] = observed;
    written++;
  } else {
    // Regression: keep the existing entry so the ratchet holds.
    updated[relKey] = existing[relKey];
    kept++;
  }
}

// ── Self-validation (e/240#15) ───────────────────────────────────────────────────
// Assert that the output contains exactly the files visited (no stale accumulation)
// and that no two keys resolve to the same file under a different root spelling.
const outputKeys = Object.keys(updated);
const visitedCount = written + kept;
if (outputKeys.length !== visitedCount) {
  console.error(`BASELINE INTEGRITY ERROR: output has ${outputKeys.length} keys but visited ${visitedCount} files — generator logic bug.`);
  process.exit(1);
}
const suffixesSeen = new Set();
for (const key of outputKeys) {
  // Strip one leading path segment (e.g. 'src/') to detect duplicate-root spellings.
  const suffix = key.replace(/^[^/]+\//, '');
  if (suffixesSeen.has(suffix)) {
    console.error(`BASELINE INTEGRITY ERROR: duplicate suffix "${suffix}" (key "${key}") — two root spellings for the same file. Re-run with a consistent --root.`);
    process.exit(1);
  }
  suffixesSeen.add(suffix);
}
// ────────────────────────────────────────────────────────────────────────────────

// __meta__ records the generating threshold so the rule can detect a mismatch at lint
// time (e/240#22, t/3838). It is not a file entry — the rule and self-validation skip it.
const outputWithMeta = { __meta__: { threshold: THRESHOLD }, ...updated };
writeFileSync(BASELINE, JSON.stringify(outputWithMeta, null, 2) + '\n', 'utf-8');
console.log(`Baseline written: ${BASELINE}`);
console.log(`  __meta__: { threshold: ${THRESHOLD} }`);
console.log(`  file entries: ${Object.keys(updated).length} (updated: ${written}, kept (ratchet): ${kept}), skipped (test / no functions / parse error / sub-threshold): ${skipped}`);
